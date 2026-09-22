package dev.hermes.pocket

import android.util.Base64
import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.ChannelShell
import com.jcraft.jsch.HostKey
import com.jcraft.jsch.HostKeyRepository
import com.jcraft.jsch.JSch
import com.jcraft.jsch.KeyPair
import com.jcraft.jsch.Session
import com.jcraft.jsch.UserInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * SSH 会话：长连接 + 保活 + 断线自愈。
 *
 * 「长期链接」在这台机器上是两层保障：
 *   1) 传输层 —— jsch 的 serverAliveInterval 发 SSH keepalive，能在 NAT/防火墙
 *      静默断链时把死连接识别出来；同时 App 维持前台服务 + wake lock 防 Doze 掐网
 *   2) 会话层 —— 远端跑 tmux，重连后 `tmux attach` 把 Hermes 会话原样接回来
 *      （进程在远端活着，手机端断网只是掉了显示通道）
 */
object SshUtil {
    /** SSH 字符串：4 字节长度 + 内容。用来从 host key blob 里取算法名 */
    fun sshString(blob: ByteArray): String {
        if (blob.size < 4) return "unknown"
        val n = ((blob[0].toInt() and 0xff) shl 24) or ((blob[1].toInt() and 0xff) shl 16) or
                ((blob[2].toInt() and 0xff) shl 8) or (blob[3].toInt() and 0xff)
        if (n <= 0 || n > blob.size - 4) return "unknown"
        return String(blob, 4, n, Charsets.US_ASCII)
    }

    fun fingerprint(blob: ByteArray): String =
        "SHA256:" + Base64.encodeToString(
            MessageDigest.getInstance("SHA-256").digest(blob), Base64.NO_WRAP
        ).trimEnd('=')

    fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    fun unb64(s: String): ByteArray = Base64.decode(s, Base64.NO_WRAP)
}

/**
 * TOFU 主机密钥校验器 —— 和真实 SSH 的 known_hosts 一致：**按 (主机, 密钥类型) 分别记录**。
 *
 * 判定拆成三种，不再一律当警报：
 *   · 同类型 + 指纹一致        → 正常（不弹任何框）
 *   · 已知主机 + 另一种类型    → 正常现象（服务器换了协商算法，例如升级后从 ecdsa 换到 ed25519）
 *   · 同类型 + 指纹不同        → 才真的可疑，判 CHANGED 拦住
 */
private fun tofuKeyRepo(target: String, h: String, port: Int, onEvent: (JSONObject) -> Unit = {}): HostKeyRepository =
    object : HostKeyRepository {
        override fun check(hh: String, key: ByteArray): Int {
            val fp = SshUtil.fingerprint(key)
            val algo = SshUtil.sshString(key)
            val sameType = Store.knownFingerprint(target, algo)   // 同一类型已记录的指纹
            val known = Store.isKnownHost(target)                 // 这台主机以前信任过（任意类型）
            val mismatch = sameType != null && sameType != fp     // 同类型换了密钥 → 才真的可疑
            val newType = sameType == null && known               // 已知主机，但这个密钥类型头一次见
            onEvent(JSONObject().put("t", "hostkey").apply {
                put("host", h); put("port", port); put("algo", algo)
                put("fingerprint", fp)
                put("storedFingerprint", sameType ?: "")
                put("known", known)
                put("changed", mismatch)
                put("newType", newType)
            })
            return if (mismatch) HostKeyRepository.CHANGED else HostKeyRepository.OK
        }
        override fun add(hostkey: HostKey?, ui: UserInfo?) {}
        override fun remove(host: String?, type: String?) {}
        override fun remove(host: String?, type: String?, key: ByteArray?) {}
        override fun getKnownHostsRepositoryID(): String = "hermes-pocket-tofu"
        override fun getHostKey(): Array<HostKey> = emptyArray()
        override fun getHostKey(host: String?, type: String?): Array<HostKey> = emptyArray()
    }

class SshSession(
    private val host: JSONObject,
    private val emit: (JSONObject) -> Unit
) {
    val id: String = Store.newId()
    private val alive = AtomicBoolean(true)
    private val bytesIn = AtomicLong(0)
    private val bytesOut = AtomicLong(0)
    private var openedAt: Long = 0

    @Volatile private var session: Session? = null
    @Volatile private var channel: ChannelShell? = null
    @Volatile private var out: OutputStream? = null
    @Volatile private var reader: Thread? = null
    private val outLock = Any()

    private var cols = 80
    private var rows = 24
    private var attempts = 0
    private var reconnectThread: Thread? = null

    /* ------------------------------------------------------------------------
       下行输出的环形缓冲。
       WebView 被系统冻结时（切后台、息屏、被回收）事件可能投递不到 JS；
       Termux 是原生渲染所以永远不会丢，我们要达到同样效果就得自己留一份。
       JS 记录自己渲染到的 seq，回到前台用 session.since(seq) 把漏掉的补上。
       ------------------------------------------------------------------------ */
    private val rxRing = ArrayDeque<Pair<Long, String>>()
    private var rxSeq = 0L
    private var rxRingBytes = 0L
    private val rxRingCap = 512 * 1024

    private fun rememberRx(b64: String): Long {
        synchronized(rxRing) {
            rxSeq += 1
            rxRing.addLast(rxSeq to b64)
            rxRingBytes += b64.length
            while (rxRingBytes > rxRingCap && rxRing.size > 1) {
                rxRingBytes -= rxRing.removeFirst().second.length
            }
            return rxSeq
        }
    }

    /** 取 seq 之后的所有输出；lost=true 表示中间有一段已经被环形缓冲丢掉了 */
    fun since(fromSeq: Long): JSONObject = synchronized(rxRing) {
        val arr = JSONArray()
        for ((q, b) in rxRing) if (q > fromSeq) arr.put(JSONObject().put("seq", q).put("data", b))
        val oldest = rxRing.firstOrNull()?.first ?: (rxSeq + 1)
        JSONObject()
            .put("sessionId", id)
            .put("seq", rxSeq)
            .put("lost", fromSeq + 1 < oldest)
            .put("chunks", arr)
    }

    val target = "${host.optString("host")}:${host.optInt("port", 22)}"

    private fun ev(t: String, extra: JSONObject.() -> Unit = {}): JSONObject {
        val o = JSONObject().put("t", t)
        o.extra()
        emit(o)
        return o
    }

    private fun state(s: String, msg: String? = null) {
        ev("state") {
            put("state", s); put("sessionId", id); put("host", target)
            put("name", host.optString("name").ifEmpty { host.optString("host") })
            if (msg != null) put("msg", msg)
        }
    }

    /* ------------------------------------------------------------ 连接 */

    companion object {
        /** 应用上下文（省电落盘缓存要用 filesDir）；Bridge.attach 时塞进来 */
        @Volatile var appCtx: android.content.Context? = null
    }

    fun open(startCols: Int, startRows: Int) {
        cols = startCols; rows = startRows
        state("connecting")
        try { connectOnce() } catch (t: Throwable) {
            state("error", t.message ?: t.toString())
            scheduleReconnect()
        }
    }

    private fun connectOnce() {
        val user = host.getString("user")
        val port = host.optInt("port", 22)
        val h = host.getString("host")
        val useKey = host.optString("auth", "key") == "key"
        android.util.Log.i("hpk-ssh", "connectOnce target=$h:$port user=$user auth=${host.optString("auth")} useKey=$useKey keyId=${host.optString("keyId")} hasPw=${host.has("passwordSealed")}")

        // 认证 + 主机密钥校验统一走 SshFactory.openAuthedSession ——
        // 「文件事件通道」用的是同一个函数，两处逻辑不会各自漂移。
        val s = SshFactory.openAuthedSession(host) { emit(it) }
        // 状态里显示真实的心跳值（连接时 SshFactory 已按主机配置设好，这里只是把它记下来，
        // 否则界面上永远显示"关"，让人误以为断线检测没开）
        lastKeepalive = host.optInt("keepalive", 30).let { if (it > 0) it else 0 }
        session = s

        val ch = s.openChannel("shell") as ChannelShell
        ch.setPtyType("xterm-256color", cols, rows, 0, 0)
        val o = ch.outputStream
        val i = ch.inputStream
        ch.connect(15000)
        channel = ch; out = o
        openedAt = System.currentTimeMillis()
        attempts = 0

        state("connected")
        emitMetrics()

        reader = Thread({ readLoop(i) }, "hpk-ssh-read-${id.take(6)}").also {
            it.isDaemon = true; it.start()
        }
    }

    private fun readLoop(input: java.io.InputStream) {
        val buf = ByteArray(32768)
        try {
            while (alive.get()) {
                val n = input.read(buf)
                if (n < 0) break
                if (n == 0) continue
                bytesIn.addAndGet(n.toLong())
                val b64 = Base64.encodeToString(buf, 0, n, Base64.NO_WRAP)
                val seq = rememberRx(b64)
                // 省电（息屏/后台）时**不发事件给 JS**：数据照样进环形缓冲，另外**落盘**。
                // 为什么不发：JS 收到就得解码 + 喂 watcher + 写 xterm（WebView 还被节流），
                // 这正是"后台不该做的渲染工作"。等亮屏由前端一次性把这段取回去渲染。
                if (SessionService.powerSave) { spillAppend(buf, n); continue }
                ev("data") { put("sessionId", id); put("data", b64); put("seq", seq) }
            }
        } catch (t: Throwable) {
            if (alive.get()) state("error", t.message ?: t.toString())
        } finally {
            if (alive.get()) {
                state("disconnected")
                scheduleReconnect()
            }
        }
    }

    /* ------------------------------------------------------------ 读写 */

    fun write(b64: String) {
        val o = out ?: run { state("error", "会话未就绪"); return }
        try {
            val b = SshUtil.unb64(b64)
            synchronized(outLock) { o.write(b); o.flush() }
            bytesOut.addAndGet(b.size.toLong())
        } catch (t: Throwable) { state("error", "写入失败: ${t.message}") }
    }

    fun resize(c: Int, r: Int) {
        cols = c; rows = r
        try { channel?.setPtySize(c, r, 0, 0) } catch (t: Throwable) { /* 通道可能正在重建 */ }
    }

    fun emitMetrics() {
        ev("metrics") {
            put("sessionId", id); put("bytesIn", bytesIn.get()); put("bytesOut", bytesOut.get())
            put("uptimeMs", if (openedAt > 0) System.currentTimeMillis() - openedAt else 0)
        }
    }

    /**
     * 在**已认证的会话**上新开一个 exec 通道跑一条只读命令，返回 stdout。
     *
     * 给「看 Hermes 的技能 / 记忆」这类面板用：不新开连接（复用终端那条），
     * 但**自带超时** —— 远端万一卡住，读循环到点就断开通道，面板不会一直转圈。
     */
    fun exec(cmd: String, timeoutMs: Long = 8000): String {
        val s = session ?: throw IllegalStateException("还没连接")
        val ch = s.openChannel("exec") as ChannelExec
        val sb = StringBuilder()
        try {
            ch.setCommand(cmd)
            val inp = ch.inputStream
            ch.connect(5000)
            val buf = ByteArray(8192)
            val deadline = System.currentTimeMillis() + timeoutMs
            while (System.currentTimeMillis() < deadline) {
                if (inp.available() > 0) {
                    val n = inp.read(buf)
                    if (n < 0) break
                    sb.append(String(buf, 0, n, Charsets.UTF_8))
                } else if (ch.isClosed) break else Thread.sleep(20)
            }
        } finally {
            try { ch.disconnect() } catch (t: Throwable) { }
        }
        return sb.toString()
    }

    /* ---------------------------------------------------- 落盘缓存（省电用） */

    /**
     * 省电期间的输出**落盘**。
     *
     * 内存里的环形缓冲有上限（512KB，滚动覆盖），而且进程被杀就没了；
     * 这里再落一份到应用私有目录，容量更大（1MB），**扛得住进程被杀**。
     * 亮屏时前端先取这份（`session.spill`）渲染完，再恢复正常的事件流 ——
     * 顺序由前端用"取盘 → 关省电 → 渲染 → 重放期间收到的事件"保证。
     */
    @Volatile private var spillOut: java.io.OutputStream? = null
    private var spillSize = 0L
    private val spillCap = 1024 * 1024

    private fun spillPath(): java.io.File? =
        appCtx?.let { java.io.File(it.filesDir, "spill-$id.log") }

    private fun spillAppend(buf: ByteArray, n: Int) {
        synchronized(rxRing) {
            try {
                val f = spillPath() ?: return
                if (spillOut == null) {
                    spillOut = java.io.FileOutputStream(f, true)
                    spillSize = f.length()
                }
                if (spillSize >= spillCap) return          // 满了就停手（内存环形缓冲仍在滚）
                spillOut!!.write(buf, 0, n)
                spillOut!!.flush()
                spillSize += n
            } catch (t: Throwable) { }
        }
    }

    /** 取走落盘缓存并清空（返回 Base64；truncated 表示期间因为超上限丢过东西） */
    fun spillDrain(): JSONObject = synchronized(rxRing) {
        var out = ""
        var bytes = 0
        try {
            val f = spillPath()
            if (f != null && f.exists() && f.length() > 0) {
                val data = f.readBytes()
                bytes = data.size
                out = Base64.encodeToString(data, Base64.NO_WRAP)
            }
        } catch (t: Throwable) { }
        try { spillOut?.close() } catch (t: Throwable) { }
        spillOut = null
        try { spillPath()?.delete() } catch (t: Throwable) { }
        spillSize = 0
        JSONObject()
            .put("bytes", bytes)
            .put("data", out)
            .put("seq", rxSeq)                              // 这段数据覆盖到哪个 seq（前端据此对齐）
            .put("truncated", bytes >= spillCap)
    }

    fun close(silent: Boolean = false) {
        alive.set(false)
        reconnectThread?.interrupt()
        try { channel?.disconnect() } catch (t: Throwable) {}
        try { session?.disconnect() } catch (t: Throwable) {}
        channel = null; session = null; out = null
        if (!silent) state("disconnected")
    }

    /* -------------------------------------------------------- 断线自愈 */

    /**
     * 调整 SSH 层心跳间隔（0 = 关闭）。JSch 允许连接之后再改，
     * 所以省电时可以在**不断开连接**的前提下把应用层心跳静音。
     */
    fun setKeepalive(sec: Int) {
        try {
            lastKeepalive = sec
            val s = session ?: return
            if (sec <= 0) { s.setServerAliveInterval(0); s.setServerAliveCountMax(0) }
            else { s.setServerAliveInterval(sec * 1000); s.setServerAliveCountMax(4) }
        } catch (t: Throwable) { }
    }

    @Volatile var lastKeepalive: Int = 0

    /** 亮屏回来时叫一次：没在连就重连（省电期间的重连是被前端压住的） */
    fun kick() {
        if (!alive.get()) return
        if (session == null) scheduleReconnect()
    }

    private fun scheduleReconnect() {
        if (!alive.get()) return
        if (!host.optBoolean("autoReconnect", true)) return
        // 省电（息屏/后台）期间**不重连** —— 睡着时每次重连都要唤醒 CPU + 电台，
        // 是待机耗电的大头；等亮屏由前端 kick() 立刻补上。
        if (SessionService.powerSave) return
        if (reconnectThread?.isAlive == true) return
        reconnectThread = Thread({
            var delay = 3000L
            while (alive.get() && attempts < 12) {
                attempts++
                state("reconnecting", "第 $attempts 次，${delay / 1000}s 后重试")
                try { Thread.sleep(delay) } catch (e: InterruptedException) { return@Thread }
                if (!alive.get()) return@Thread
                try {
                    connectOnce()
                    return@Thread
                } catch (t: Throwable) {
                    state("error", "重连失败: ${t.message}")
                }
                delay = (delay * 1.7).toLong().coerceAtMost(60000L)
            }
        }, "hpk-ssh-reconn-${id.take(6)}").also { it.isDaemon = true; it.start() }
    }

    fun waitClosed(ms: Long) {
        try { reader?.join(ms) } catch (e: InterruptedException) {}
    }
}

/**
 * 统一的 JSch 构造入口。
 *
 * 必须走这里，不能直接 `JSch()` —— Android 的 ART **不做多版本 JAR 查找**，
 * 而 jsch 把 EdDSA 的真实实现放在 jar 的 `META-INF/versions/15/` 下，
 * 顶层留的是「要求 Java15+」的桩类：**类能加载（Class.forName 成功），
 * 但一构造 / 一 init 就抛 UnsupportedOperationException**。
 *
 * 于是 jsch 认为该算法可用，永远不会退回 BouncyCastle 实现。症状：
 *   - 连 ed25519 主机/用 ed25519 密钥时，`ssh-ed25519` 静默从算法提案里消失，
 *     报 "Algorithm negotiation fail: serverProposal=ssh-ed25519"
 *   - 设备端「生成密钥」点下去立刻抛 UnsupportedOperationException
 * 即使 classpath 上已经有 BouncyCastle，这两个键也仍指向桩类，所以必须显式覆盖。
 */
object SshFactory {
    private const val BC_KEYPAIR = "com.jcraft.jsch.bc.KeyPairGenEdDSA"
    private const val BC_SIG_25519 = "com.jcraft.jsch.bc.SignatureEd25519"
    private const val BC_SIG_448 = "com.jcraft.jsch.bc.SignatureEd448"

    @Volatile private var configured = false

    /**
     * jsch 的配置表是**全局静态**的 —— 只有 `JSch.setConfig(String, String)`（static）
     * 这一条路，没有实例级配置（`setConfigRepository` 是给 ssh_config 用的，不是这个）。
     * 所以只能在进程内设一次；App 启动时调，幂等、可重复调用。
     */
    @Synchronized
    fun init() {
        if (configured) return
        JSch.setConfig("keypairgen.eddsa", BC_KEYPAIR)              // 生成密钥
        JSch.setConfig("keypairgen_fromprivate.eddsa", BC_KEYPAIR)  // 由私钥反推公钥（bc 同一个类两个都实现）
        JSch.setConfig("signature.ed25519", BC_SIG_25519)           // 签名 / 验签
        JSch.setConfig("signature.ed448", BC_SIG_448)
        configured = true
    }

    fun jsch(): JSch { init(); return JSch() }

    /**
     * 打开一条**已完成认证**的 SSH 会话。
     *
     * 终端会话和「文件事件通道」共用这一套认证逻辑，避免两份实现漂移：
     * 认证方式跟随主机配置（`auth=key` 用私钥，否则用保存的密码），主机密钥走 TOFU。
     * known-hosts 的 key 与终端会话用**同一个** `host:port`（见 SshSession.target），
     * 所以第二条连接不会再问一遍指纹。
     */
    fun openAuthedSession(host: JSONObject, onHostKey: ((JSONObject) -> Unit)? = null): Session {
        val user = host.getString("user")
        val port = host.optInt("port", 22)
        val h = host.getString("host")
        val target = "$h:$port"
        val useKey = host.optString("auth", "key") == "key"
        val passphrase = host.optString("passphrase", "")

        val jsch = jsch()
        jsch.hostKeyRepository = if (onHostKey != null) tofuKeyRepo(target, h, port, onHostKey)
        else tofuKeyRepo(target, h, port)
        val s = jsch.getSession(user, h, port)
        s.setConfig("StrictHostKeyChecking", "yes")
        s.setConfig("PreferredAuthentications", if (useKey) "publickey" else "password,keyboard-interactive")
        val ka = host.optInt("keepalive", 30)
        if (ka > 0) { s.setServerAliveInterval(ka * 1000); s.setServerAliveCountMax(4) }

        var priv: ByteArray? = null
        if (useKey) {
            val keyId = host.optString("keyId")
            val rec = keyId.takeIf { it.isNotEmpty() }?.let { Store.keyById(it) }
                ?: throw IllegalStateException("找不到密钥 $keyId")
            if (!rec.has("privSealed")) throw IllegalStateException("密钥没有私钥内容")
            priv = Vault.open(rec.getString("privSealed"))
            jsch.addIdentity(
                "hpk:${rec.optString("id")}", priv, null,
                if (passphrase.isNotEmpty()) passphrase.toByteArray() else null
            )
        } else {
            val sealed = host.optString("passwordSealed")
            if (sealed.isEmpty()) throw IllegalStateException("该主机没有保存密码")
            s.setPassword(Vault.openText(sealed))
        }
        try { s.connect(20000) } finally { priv?.fill(0) }
        return s
    }
}

/**
 * 设备端生成 Ed25519 密钥，并自己拼 OpenSSH v1 私钥格式。
 *
 * 为什么要自己拼：jsch 上游**明确不支持**用旧 PEM 格式导出 EdDSA 私钥 ——
 * `KeyPairEdDSA.getBegin()/getEnd()/getPrivateKey()` 直接抛 UnsupportedOperationException，
 * 源码注释写着 `SSH_OPENSSH_V1 isn't supported yet, have these methods fail.`，
 * 而 vendor 字段是包私有的、没有公开 setter（`VENDOR_OPENSSH_V1` 也拿不到）。
 * Android 上又没有 ssh-keygen 可以调。所以只能用 BouncyCastle 生成密钥、
 * 自己按 RFC 里的 openssh-key-v1 布局拼出来 —— 拼出来的东西 jsch 自己能读回
 * （`KeyPair.loadOpenSSHKeyv1`），也能被真正的 OpenSSH 使用。
 */
object Ed25519Key {
    private class W {
        private val b = java.io.ByteArrayOutputStream()
        fun u32(v: Int) { b.write(v ushr 24); b.write(v ushr 16); b.write(v ushr 8); b.write(v) }
        fun bytes(a: ByteArray) = b.write(a).let { }
        fun str(a: ByteArray) { u32(a.size); b.write(a) }
        fun str(s: String) = str(s.toByteArray(Charsets.US_ASCII))
        fun out() = b.toByteArray()
    }

    /** @return Triple(私钥 PEM, 公钥行, 公钥 blob) */
    fun generate(comment: String): Triple<String, String, ByteArray> {
        val gen = org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator()
        gen.init(org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters(java.security.SecureRandom()))
        val kp = gen.generateKeyPair()
        val seed = (kp.private as org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters).encoded  // 32
        val pub = (kp.public as org.bouncycastle.crypto.params.Ed25519PublicKeyParameters).encoded    // 32

        // 公钥 blob（SSH 线格式）：string "ssh-ed25519" + string pub
        val pubBlob = W().apply { str("ssh-ed25519"); str(pub) }.out()

        // openssh-key-v1 外层
        val rnd = java.security.SecureRandom()
        val check = rnd.nextInt()
        val privBlock = W().apply {
            u32(check); u32(check)          // 两个相同的校验整数
            str("ssh-ed25519")
            str(pub)
            str(seed + pub)                 // 私钥段 = 32 字节种子 ‖ 32 字节公钥
            str(comment)
            var pad = 1
            // 用 cipher "none" 时按 8 字节块对齐
            while (out().size % 8 != 0) { bytes(byteArrayOf(pad.toByte())); pad++ }
        }.out()

        val outer = W().apply {
            bytes("openssh-key-v1\u0000".toByteArray(Charsets.US_ASCII))
            str("none")                     // ciphername
            str("none")                     // kdfname
            str(ByteArray(0))               // kdfoptions
            u32(1)                          // nkeys
            str(pubBlob)
            str(privBlock)
        }.out()

        val b64 = android.util.Base64.encodeToString(outer, android.util.Base64.NO_WRAP)
        val pem = "-----BEGIN OPENSSH PRIVATE KEY-----\n" +
            b64.chunked(70).joinToString("\n") +
            "\n-----END OPENSSH PRIVATE KEY-----\n"

        val pubLine = "ssh-ed25519 ${SshUtil.b64(pubBlob)} $comment"
        return Triple(pem, pubLine, pubBlob)
    }

    /**
     * 需要口令时：把刚拼好的 v1 PEM 交给 jsch 读回来再写一遍。
     * jsch 解析 v1 会把内部 vendor 置为 VENDOR_OPENSSH_V1，此时 writePrivateKey(口令)
     * 才走 v1 分支（bcrypt 加密）而不是抛异常。失败就退回无口令版本并如实标注。
     */
    fun withPassphrase(jsch: JSch, pem: String, passphrase: String): String {
        if (passphrase.isEmpty()) return pem
        return try {
            val kp = KeyPair.load(jsch, pem.toByteArray(), null)
            val out = java.io.ByteArrayOutputStream()
            kp.writePrivateKey(out, passphrase.toByteArray())
            String(out.toByteArray())
        } catch (t: Throwable) { pem }
    }
}

/** 设备侧生成 / 导入密钥（私钥永不离开设备，直接进 Keystore 加密库） */
object KeyTool {
    fun generate(name: String, algo: String, passphrase: String): JSONObject {
        val jsch = SshFactory.jsch()
        val comment = "hermes-pocket:$name"

        // ed25519 走自研 OpenSSH v1 路径（jsch 写不了）；rsa/ecdsa 用 jsch
        if (algo.lowercase() !in listOf("rsa", "ecdsa")) {
            val (rawPem, pubLine, pubBlob) = Ed25519Key.generate(comment)
            val pem = Ed25519Key.withPassphrase(jsch, rawPem, passphrase)
            val effectivePass = passphrase.isNotEmpty() && pem != rawPem
            val rec = JSONObject()
                .put("id", Store.newId()).put("name", name)
                .put("algo", "Ed25519").put("bits", 256)
                .put("publicKey", pubLine)
                .put("fingerprint", SshUtil.fingerprint(pubBlob))
                .put("hasPassphrase", effectivePass)
                .put("origin", "generated")
                .put("created", System.currentTimeMillis())
                .put("privSealed", Vault.seal(pem.toByteArray()))
            Store.addKey(rec)
            return meta(rec)
        }

        val kp: KeyPair = when (algo.lowercase()) {
            "rsa" -> KeyPair.genKeyPair(jsch, KeyPair.RSA, 4096)
            "ecdsa" -> KeyPair.genKeyPair(jsch, KeyPair.ECDSA, 256)
            else -> throw IllegalArgumentException("不支持的算法 $algo")
        }
        kp.setPublicKeyComment("hermes-pocket:$name")
        val priv = ByteArrayOutputStream()
        if (passphrase.isNotEmpty()) kp.writePrivateKey(priv, passphrase.toByteArray())
        else kp.writePrivateKey(priv)
        val blob = kp.getPublicKeyBlob()
        val type = kp.getKeyTypeString()   // 注意：getKeyType() 返回的是 int 常量，不是 "ssh-ed25519"

        val rec = JSONObject()
            .put("id", Store.newId())
            .put("name", name)
            .put("algo", when (type) {
                "ssh-ed25519" -> "Ed25519"
                "ssh-rsa" -> "RSA"
                else -> "ECDSA"
            })
            .put("bits", when (type) { "ssh-rsa" -> 4096; "ssh-ed25519" -> 256; else -> 256 })
            .put("publicKey", "$type ${SshUtil.b64(blob)} hermes-pocket:$name")
            .put("fingerprint", SshUtil.fingerprint(blob))
            .put("hasPassphrase", passphrase.isNotEmpty())
            .put("origin", "generated")
            .put("created", System.currentTimeMillis())
            .put("privSealed", Vault.seal(priv.toByteArray()))
        priv.reset()
        Store.addKey(rec)
        return meta(rec)
    }

    fun import(name: String, pem: String, passphrase: String): JSONObject {
        if (!Regex("BEGIN [A-Z0-9 ]*PRIVATE KEY").containsMatchIn(pem))
            throw IllegalArgumentException("不是 PEM 私钥")
        val jsch = SshFactory.jsch()
        val kp = try {
            try {
                KeyPair.load(jsch, pem.toByteArray(), null)          // 无口令
            } catch (t: Throwable) {
                // jsch 的 KeyPair.load 没有「字节数组 + 口令」重载，加密私钥只能落到临时文件；
                // 文件权限收紧到仅本进程可读，用完立即删除（App 私有目录，非本用户读不到）
                if (passphrase.isEmpty()) throw IllegalArgumentException("私钥有口令，请填口令后重试")
                val tmp = java.io.File.createTempFile("hpk-import", null, Store.root)
                try {
                    tmp.writeBytes(pem.toByteArray())
                    tmp.setReadable(false, false); tmp.setReadable(true, true)
                    tmp.setWritable(false, false); tmp.setWritable(true, true)
                    KeyPair.load(jsch, tmp.absolutePath, passphrase)
                } finally { tmp.delete() }
            }
        } catch (t: Throwable) { throw IllegalArgumentException("解析私钥失败（口令不对？）: ${t.message}") }
        val blob = kp.getPublicKeyBlob() ?: throw IllegalArgumentException("这个私钥取不到公钥，无法使用")
        val type = kp.getKeyTypeString()

        val rec = JSONObject()
            .put("id", Store.newId()).put("name", name)
            .put("algo", when (type) {
                "ssh-ed25519" -> "Ed25519"; "ssh-rsa" -> "RSA"; else -> "ECDSA"
            })
            .put("bits", 0)
            .put("publicKey", "$type ${SshUtil.b64(blob)} hermes-pocket:$name")
            .put("fingerprint", SshUtil.fingerprint(blob))
            .put("hasPassphrase", passphrase.isNotEmpty())
            .put("origin", "imported")
            .put("created", System.currentTimeMillis())
            .put("privSealed", Vault.seal(pem.toByteArray()))
        Store.addKey(rec)
        return meta(rec)
    }

    private fun meta(rec: JSONObject): JSONObject {
        val r = JSONObject()
        for (k in listOf("id", "name", "algo", "bits", "publicKey", "fingerprint",
                         "hasPassphrase", "origin", "created")) {
            if (rec.has(k)) r.put(k, rec.get(k))
        }
        return r
    }
}

/**
 * 把公钥装到服务器 —— 就是 ssh-copy-id 干的事，然后用**密钥真连一次**验证。
 *
 * 为什么装完一定要验证：装上看都不看就把主机切成密钥登录，万一没装上用户就再也进不去了。
 * 只有用密钥真的登录成功，才告诉界面「可以切成密钥登录」。
 */
object KeyInstaller {

    fun install(host: JSONObject, pubLine: String): JSONObject {
        val user = host.optString("user")
        val h = host.optString("host")
        val port = host.optInt("port", 22)
        val target = "$h:$port"

        // 公钥整行直接塞进远端命令里，先把单引号去掉免得破坏引号
        val line = pubLine.trim().replace("'", "")
        val parts = line.split(Regex("\\s+"))
        if (parts.size < 2 || parts[0].isEmpty() || parts[1].isEmpty()) {
            return JSONObject().put("ok", false).put("msg", "公钥内容不完整，无法安装")
        }
        val blob = parts[1]

        val sealed = host.optString("passwordSealed")
        if (sealed.isEmpty()) {
            return JSONObject().put("ok", false).put("msg",
                "这台主机没有保存密码，没法自动安装。请先用密码连接一次，或在服务器上手动把公钥追加到 ~/.ssh/authorized_keys")
        }
        val pw = try { Vault.openText(sealed) } catch (t: Throwable) {
            return JSONObject().put("ok", false).put("msg", "读取保存的密码失败：${t.message ?: t}")
        }

        // 幂等：已经在了就什么都不做；顺带把 ~/.ssh 的权限摆正（sshd 对权限很挑）
        val cmd = buildString {
            append("umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; ")
            append("chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys; ")
            append("if grep -qF '$blob' ~/.ssh/authorized_keys 2>/dev/null; then echo HPK_ALREADY; ")
            append("else printf '%s\\n' '$line' >> ~/.ssh/authorized_keys; echo HPK_ADDED; fi; ")
            append("echo HPK_COUNT=$(grep -c . ~/.ssh/authorized_keys)")
        }

        var out = ""
        var rc = -1
        try {
            val jsch = SshFactory.jsch()
            jsch.hostKeyRepository = tofuKeyRepo(target, h, port)
            val s = jsch.getSession(user, h, port)
            s.setConfig("StrictHostKeyChecking", "yes")
            s.setConfig("PreferredAuthentications", "password,keyboard-interactive")
            s.setPassword(pw)
            s.connect(20000)
            try {
                val ch = s.openChannel("exec") as ChannelExec
                ch.setCommand(cmd)
                val inp = ch.inputStream
                ch.connect(15000)
                val sb = StringBuilder()
                val buf = ByteArray(4096)
                while (true) { val n = inp.read(buf); if (n < 0) break; sb.append(String(buf, 0, n)) }
                out = sb.toString().trim()
                rc = ch.exitStatus
                ch.disconnect()
            } finally { s.disconnect() }
        } catch (t: Throwable) {
            return JSONObject().put("ok", false).put("msg", "连接失败：${t.message ?: t}")
        }

        val added = out.contains("HPK_ADDED")
        val already = out.contains("HPK_ALREADY")
        val count = Regex("HPK_COUNT=(\\d+)").find(out)?.groupValues?.get(1)?.toIntOrNull() ?: 0

        // 装完用密钥真连一次
        val keyId = host.optString("keyId")
        val verified = keyId.isNotEmpty() && tryKeyLogin(host, keyId, target, h, port)

        val okMsg = when {
            verified && already -> "公钥本来就在服务器上，密钥登录验证通过"
            verified -> "公钥已装到服务器，并用密钥成功登录验证过"
            else -> "公钥已写入服务器，但密钥登录验证没通过（可能是 sshd 禁止该算法或权限问题）"
        }
        return JSONObject()
            .put("ok", true).put("added", added).put("already", already)
            .put("count", count).put("verified", verified)
            .put("out", out).put("exit", rc).put("msg", okMsg)
    }

    /** 用主机选定的密钥试连一次，只看能不能登录 */
    private fun tryKeyLogin(host: JSONObject, keyId: String, target: String, h: String, port: Int): Boolean {
        val rec = Store.keyById(keyId) ?: return false
        if (!rec.has("privSealed")) return false
        val priv = Vault.open(rec.getString("privSealed"))
        val pp = host.optString("passphrase", "")
        return try {
            val jsch = SshFactory.jsch()
            jsch.hostKeyRepository = tofuKeyRepo(target, h, port)
            val s = jsch.getSession(host.optString("user"), h, port)
            s.setConfig("StrictHostKeyChecking", "yes")
            s.setConfig("PreferredAuthentications", "publickey")
            jsch.addIdentity("hpk-verify", priv, null, if (pp.isNotEmpty()) pp.toByteArray() else null)
            s.connect(15000)
            s.disconnect()
            true
        } catch (t: Throwable) {
            false
        } finally {
            priv.fill(0)
        }
    }
}
