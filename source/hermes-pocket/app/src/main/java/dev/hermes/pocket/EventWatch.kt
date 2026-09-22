package dev.hermes.pocket

import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.Session
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 文件事件通道 —— **另开一条独立 SSH 连接**，盯着服务端 home 下的一个只追加文件，
 * 把新增的每一行送给前端（前端再调起**手机系统通知**）。
 *
 * 为什么单独一条连接（而不是复用终端会话的 channel）：
 *  - 终端会话会重连、会断、会被用户手动关掉，通知不该跟着一起断；
 *  - 这条通道只跑一句 `tail -F`，独占一条连接最容易排障 ——
 *    在服务端 `ss -tnp | grep :<port>` 数一下连接数就能确认它活着。
 *
 * 协议见服务端 `~/HERMES-POCKET-EVENTS.md`：一行一条，`kind: 标题 | 正文`，
 * kind ∈ {auth, done, info}；`auth` 表示"等你授权"，会当紧急事件穿透到前台。
 */
class EventWatch(
    private val host: JSONObject,
    private val path: String,
    private val emit: (JSONObject) -> Unit
) {
    private val alive = AtomicBoolean(false)
    @Volatile private var session: Session? = null
    private var thread: Thread? = null

    /** 给界面看的一行状态 */
    @Volatile var state: String = "idle"
        private set

    fun isRunning() = alive.get()

    /** 展示用的路径（保留用户写的样子，`~` 不展开） */
    fun pathOf(): String = path.trim().ifEmpty { "~/$DEFAULT_FILE" }

    fun start() {
        if (alive.get()) return
        alive.set(true)
        thread = Thread({ runLoop() }, "hpk-events").also { it.isDaemon = true; it.start() }
    }

    fun stop() {
        alive.set(false)
        try { session?.disconnect() } catch (t: Throwable) { }
        session = null
        thread?.interrupt()      // 打断退避睡眠，别让它挂着
        thread = null
        setState("stopped")
    }

    private fun setState(s: String, msg: String? = null) {
        state = s
        emit(JSONObject().put("t", "eventstate").put("state", s).put("path", path).also {
            if (msg != null) it.put("msg", msg)
        })
    }

    private fun runLoop() {
        var backoff = 2000L
        while (alive.get()) {
            try {
                setState("connecting")
                val s = SshFactory.openAuthedSession(host) { ev -> emit(ev) }
                if (!alive.get()) { try { s.disconnect() } catch (t: Throwable) { }; return }
                session = s
                setState("watching")

                val ch = s.openChannel("exec") as ChannelExec
                // -n 0：从"现在"开始，不重放历史（历史是上一次运行的事，不该再弹一遍通知）
                // -F：文件被裁掉/重建后自动重新打开（我们的限额裁剪就是这么干的）
                ch.setCommand("tail -n 0 -F " + shExpr(path) + " 2>/dev/null")
                val inp = ch.inputStream
                ch.connect(15000)
                val rd = BufferedReader(InputStreamReader(inp, Charsets.UTF_8))
                backoff = 2000L          // 连上了就把退避重置
                while (alive.get()) {
                    val line = try { rd.readLine() } catch (t: Throwable) { break } ?: break
                    if (line.isEmpty()) continue
                    emit(JSONObject().put("t", "event").put("line", line))
                }
                try { ch.disconnect() } catch (t: Throwable) { }
                try { s.disconnect() } catch (t: Throwable) { }
                session = null
                if (!alive.get()) return
                setState("retry")
            } catch (t: Throwable) {
                session = null
                if (!alive.get()) return
                setState("error", t.message ?: t.toString())
            }
            try { Thread.sleep(backoff) } catch (e: InterruptedException) { return }
            backoff = (backoff * 2).coerceAtMost(60000L)
        }
    }

    /**
     * 把路径安全地嵌进 shell 命令。
     *
     * 只允许 `$HOME` 这一个变量展开（`~/x` 会先换成 `$HOME/x`），其余 `$`、反引号、引号、反斜杠
     * 全部转义 —— 路径是用户输入的，直接拼进命令等于给远端 shell 开个口子。
     */
    private fun shExpr(raw: String): String {
        var p = raw.trim().ifEmpty { "\$HOME/$DEFAULT_FILE" }
        if (p == "~") p = "\$HOME"
        else if (p.startsWith("~/")) p = "\$HOME/" + p.substring(2)
        val sb = StringBuilder("\"")
        var i = 0
        while (i < p.length) {
            val c = p[i]
            when {
                c == '\\' -> sb.append("\\\\")
                c == '"' -> sb.append("\\\"")
                c == '`' -> sb.append("\\`")
                c == '$' && p.startsWith("\$HOME", i) -> { sb.append("\$HOME"); i += 5; continue }
                c == '$' -> sb.append("\\$")
                else -> sb.append(c)
            }
            i++
        }
        return sb.append("\"").toString()
    }

    companion object {
        const val DEFAULT_FILE = "hermes-pocket-events.log"
    }
}
