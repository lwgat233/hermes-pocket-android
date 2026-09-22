package dev.hermes.pocket

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * 协议分发器 —— 与 bridge/server.mjs 是同一套 JSON 协议，前端代码一行都不用改。
 * 每条消息在后台线程处理，回包统一走 WebView 的 replyProxy。
 */
object Bridge {
    private const val TAG = "HermesPocket"
    private var ctx: Context? = null
    private var sender: ((String) -> Unit)? = null
    /** 需要非空 Context 的地方用这个（attach 之后才有值） */
    private val appCtx: Context get() = ctx ?: throw IllegalStateException("Bridge 还没 attach")
    private val pool = Executors.newFixedThreadPool(4) { r ->
        Thread(r, "hpk-bridge").also { it.isDaemon = true }
    }

    @Volatile private var session: SshSession? = null
    @Volatile private var eventWatch: EventWatch? = null
    @Volatile private var lastHostKey: JSONObject? = null

    fun attach(c: Context, send: (String) -> Unit) {
        ctx = c.applicationContext
        sender = send
        SshSession.appCtx = c.applicationContext      // 省电落盘缓存要用 filesDir
    }

    fun post(o: JSONObject) { sender?.invoke(o.toString()) }

    fun handle(raw: String) {
        pool.execute {
            val m = try { JSONObject(raw) } catch (e: Exception) { return@execute }
            try { dispatch(m) } catch (t: Throwable) {
                val id = m.optLong("_rid", 0)
                if (id != 0L) err(id, t.message ?: t.toString())
                else post(JSONObject().put("t", "log").put("msg", t.message ?: t.toString()))
            }
        }
    }

    /* ======================================================== Hermes 面板 */

    /**
     * 「看 Hermes 的技能 / 记忆」的取数逻辑。
     *
     * 命令是**固定字符串**，没有任何用户输入拼进去 —— 用户只会出现在 `hermes.read` 的路径里，
     * 那个走严格字符集校验。
     * 用 `find -printf` 一次拿全量（路径/大小/时间），`grep -H` 一次拿全量描述，
     * 避免"每个技能起两个子进程"（62 个技能就是 120+ 个进程，面板会明显卡）。
     *
     * ⚠ 区段标记前后必须**强制换行**：`cat` 出来的文件末尾很可能没有换行符
     *（实测 ~/.hermes/memories 下的 .md 就没有），那样 `echo @@MEM` 会粘在正文尾巴上，
     * 标记行再也匹配不到，整段内容会被并进上一个区段 —— 这类"分隔符被吞"的 bug 极其隐蔽。
     *
     * ⚠ 注释里千万别写"斜杠紧跟星号"的通配路径（比如记忆目录后接通配符）：那会被 Kotlin 当成
     * **嵌套块注释**的开始（Kotlin 的块注释是可嵌套的！），外层注释就再也不闭合，
     * 报错是莫名其妙的 "Unclosed comment"。本文件就踩过一次。
     */
    private val HERMES_INFO_CMD =
        "H=\"\$HOME/.hermes\"; " +
        "printf '\\n@@FIND\\n'; find \"\$H/skills\" -name SKILL.md -printf '%p\\t%s\\t%T@\\n' 2>/dev/null; " +
        // 描述用 find -exec grep -H 取（别用 shell 通配 skills/<分类>/<技能>/SKILL.md：
        // 那个写法里的 `/` 紧跟通配符，会把 Kotlin 词法搞崩 —— "未闭合注释" 的真实原因）
        "printf '\\n@@DESC\\n'; find \"\$H/skills\" -name SKILL.md -exec grep -H -m1 '^description:' {} + 2>/dev/null; " +
        "printf '\\n@@CONF\\n'; grep -E 'memory_char_limit|user_char_limit' \"\$H/config.yaml\" 2>/dev/null; " +
        "printf '\\n@@END\\n'"

    private val HERMES_MEM_CMD =
        "H=\"\$HOME/.hermes\"; printf '\\n@@USER\\n'; cat \"\$H/memories/USER.md\" 2>/dev/null; " +
        "printf '\\n@@MEM\\n'; cat \"\$H/memories/MEMORY.md\" 2>/dev/null; printf '\\n@@END\\n'"

    private val HERMES_MARKERS = listOf("@@FIND", "@@DESC", "@@CONF", "@@USER", "@@MEM", "@@END")

    /**
     * 拆出这一行里的区段标记，返回 (标记或 null, 标记**之前**的残留正文)。
     * 双保险：即使正文尾巴粘着标记（文件没有尾换行），也能把正文和标记都对上。
     */
    private fun splitMarker(line: String): Pair<String?, String> {
        val t = line.trimEnd()
        for (m in HERMES_MARKERS) {
            if (t == m) return m to ""
            if (t.endsWith(m) && t.length > m.length) return m to t.substring(0, t.length - m.length)
        }
        return null to line
    }

    private fun sshOrThrow() = session ?: throw IllegalStateException("还没连接")

    // ---------------- talk（多角色频道）：固定命令 + 参数校验 ----------------
    // 远端 roles-chat 项目的位置（"定型"里说过它可搬；真搬了只改这一行）
    private val talkRoot = "/vol1/1000/airesults/roles-chat"

    /** 角色全名只允许 <场景>.<角色> 这种形状，别的字符一律拒 */
    private fun talkRole(s: String): String {
        val v = s.trim()
        require(Regex("^[a-z0-9-]+\\.[a-z0-9-]+$").matches(v)) { "角色名不合规：$v" }
        return v
    }

    /** 正文/话题：只挡控制字符（避免把远端终端搞坏） */
    private fun talkText(s: String): String = s.replace(Regex("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]"), " ").trim()

    private fun talkCmd(args: List<String>): String {
        val q = { x: String -> "'" + x.replace("'", "'\\''") + "'" }
        return "python3 " + q("$talkRoot/tools/talk.py") + " " + args.joinToString(" ") { q(it) }
    }

    /** 跑 talk.py 并把它的 JSON 输出解析回对象（不是 JSON 就把原文放 raw 里，别吞掉） */
    private fun talkJson(args: List<String>, timeoutMs: Long = 20000L): JSONObject {
        val out = sshOrThrow().exec(talkCmd(args), timeoutMs).trim()
        return try {
            JSONObject(out)
        } catch (e: Exception) {
            JSONObject().put("raw", out).put("cmd", args.joinToString(" "))
        }
    }


    /** tmux 字段分隔符：普通可见串，远端不会吃掉，出问题时肉眼也看得清 */
    private const val SEP = "__HP__"

    /** 读 skill/记忆文件（只读）：REL 由 Kotlin 侧注入 */
    private val SKILL_READ_PY = """import base64, hashlib, os
p = os.path.join(os.path.expanduser('~'), '.hermes', REL)
try:
    b = open(p, 'rb').read()
except Exception as e:
    print('@@ERR', '读不到:', e); raise SystemExit(0)
print('@@SIZE', len(b))
print('@@SHA', hashlib.sha256(b).hexdigest())
print('@@B64')
print(base64.b64encode(b).decode())
""".trimIndent()

    /**
     * 写回 skill/记忆文件（**危险操作**）：先拿 expect 的 sha256 **对账**（远端被别人改过就拒绝，不静默覆盖）
     * → 备份原文件 → 原子替换 → 读回算 sha256/字节数。只有读回的和写进去的完全一样，`@@OK` 才是 1。
     */
    private val SKILL_WRITE_PY = """import base64, hashlib, os, shutil, time
home = os.path.expanduser('~')
p = os.path.join(home, '.hermes', REL)
new = base64.b64decode(B64)
cur = ''
exists = os.path.exists(p)
if exists:
    try:
        cur = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    except Exception as e:
        print('@@ERR', '读远端失败:', e); raise SystemExit(0)
if EXPECT and cur != EXPECT:
    print('@@ERR', '远端文件已变（现在是 %s，你手上的是 %s），先重新打开再改' % (cur[:12], EXPECT[:12])); raise SystemExit(0)
if not exists and EXPECT:
    print('@@ERR', '远端文件没了（你手上的是 %s）' % EXPECT[:12]); raise SystemExit(0)
bak = ''
if exists:
    bak = p + '.hpk-bak-' + time.strftime('%Y%m%d-%H%M%S')
    shutil.copy2(p, bak)
tmp = p + '.hpk-tmp'
open(tmp, 'wb').write(new)
os.replace(tmp, p)
back = open(p, 'rb').read()
print('@@OLD', (cur[:12] if cur else '(新文件)'))
print('@@NEW', hashlib.sha256(back).hexdigest())
print('@@SIZE', len(back))
print('@@BAK', os.path.basename(bak))
print('@@OK', '1' if back == new else '0')
""".trimIndent()

    /** sha256（手机侧写完自校验用） */
    private fun sha256Hex(b: ByteArray): String =
        java.security.MessageDigest.getInstance("SHA-256").digest(b)
            .joinToString("") { String.format("%02x", it) }

    /** 读 skill / 记忆文件：回带标记 + **base64**（正文原样，字节数/sha 能对账） */
    private fun skillRead(relIn: String): JSONObject {
        val rel = safeRel(relIn)
        return pyRun("REL = " + pyStr(rel) + "\n" + SKILL_READ_PY, 20000)
    }

    /**
     * 写回 skill / 记忆文件：**先对账再写**，改前备份，写完读回校验。
     * @param b64 新内容的 base64（正文里可能有任意字符，走 base64 才不会在路上被吃掉）
     * @param expectSha 打开时那一版的 sha256（远端变了就拒绝写）
     */
    private fun skillWrite(relIn: String, b64: String, expectSha: String): JSONObject {
        val rel = safeRel(relIn)
        if (b64.length > 1_400_000)                   // ~1MB 正文，超出直接说清楚
            return JSONObject().put("raw", "@@ERR 内容太大（base64 " + b64.length + " 字节），这条通道不适合整篇回写")
        if (!Regex("^[A-Za-z0-9+/=]*$").matches(b64))
            return JSONObject().put("raw", "@@ERR 内容不是合法的 base64")
        val exp = if (Regex("^[0-9a-f]{64}$").matches(expectSha)) expectSha else ""
        return pyRun(
            "REL = " + pyStr(rel) + "\nEXPECT = " + pyStr(exp) +
                "\nB64 = " + pyStr(b64) + "\n" + SKILL_WRITE_PY, 30000
        )
    }

    /**
     * 把文件存到**手机本地**：写进「下载/hermes-skills/」（Android 10+ 用 MediaStore，不用权限；
     * 更老或失败就退到 App 自己的外部目录并如实报出真实路径），**写完读回来算一遍 sha256** 才算成功。
     */
    private fun localSave(nameIn: String, b64: String): JSONObject {
        val name = nameIn.trim().replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifEmpty { "skill.md" }
        val bytes = try { android.util.Base64.decode(b64, android.util.Base64.DEFAULT) }
        catch (e: Exception) { return JSONObject().put("raw", "@@ERR 内容不是合法的 base64") }
        val want = sha256Hex(bytes)
        var uri: android.net.Uri? = null
        if (Build.VERSION.SDK_INT >= 29) {
            val cv = android.content.ContentValues().apply {
                put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name)
                put(android.provider.MediaStore.Downloads.MIME_TYPE, "text/markdown")
                put(android.provider.MediaStore.Downloads.RELATIVE_PATH,
                    android.os.Environment.DIRECTORY_DOWNLOADS + "/hermes-skills")
            }
            uri = try {
                appCtx.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv)
                    ?.also { u -> appCtx.contentResolver.openOutputStream(u, "w")?.use { it.write(bytes) } }
            } catch (e: Exception) { null }
        }
        val where: String
        val back: ByteArray?
        if (uri != null) {
            where = "Download/hermes-skills/" + name
            back = try { appCtx.contentResolver.openInputStream(uri)?.use { it.readBytes() } } catch (e: Exception) { null }
        } else {
            val dir = java.io.File(appCtx.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS), "hermes-skills")
            dir.mkdirs()
            val f = java.io.File(dir, name)
            try { f.outputStream().use { it.write(bytes) } } catch (e: Exception) {
                return JSONObject().put("raw", "@@ERR 写不进手机：${e.message ?: "未知原因"}")
            }
            where = f.absolutePath
            back = try { f.readBytes() } catch (e: Exception) { null }
        }
        val got = back?.let { sha256Hex(it) } ?: ""
        return JSONObject().put("raw",
            "@@PATH " + where + "\n@@SIZE " + (back?.size ?: 0) + "\n@@SHA " + got + "\n" +
                "@@OK " + (if (got.isNotEmpty() && got == want && back?.size == bytes.size) "1" else "0"))
    }

    /** 主机名 / IP 白名单（命令里要拼它，先挡住引号、分号这类东西） */
    private fun safeHost(h: String): String {
        val s = h.trim()
        if (s.isEmpty() || s.length > 253 || !Regex("^[A-Za-z0-9._:\\-\\[\\]]+$").matches(s))
            throw IllegalArgumentException("地址不允许：$h")
        return s
    }

    /**
     * ping（只读，不改远端任何东西）：`LC_ALL=C` 保证输出是英文固定格式，界面侧好解析。
     * 全丢包时 ping 会返回非 0 —— 用 `|| true` 保住输出，让界面从统计行里读到「100% packet loss」，
     * 而不是变成一个没有内容的异常。
     */
    private fun netPing(hostIn: String, countIn: Int): JSONObject {
        val host = safeHost(hostIn)
        val n = countIn.coerceIn(1, 20)
        return try {
            val t0 = System.currentTimeMillis()
            val out = sshOrThrow().exec("LC_ALL=C ping -c $n -W 2 -i 0.3 -n '$host' 2>&1 || true", 45000)
            JSONObject().put("raw", out).put("ms", (System.currentTimeMillis() - t0).toInt())
        } catch (e: Exception) {
            JSONObject().put("raw", "@@ERR " + (e.message ?: "ping 跑不起来"))
        }
    }

    /** TCP 端口连通（只回 @@OK / @@MS / @@ERR；HOST / PORT 由 Kotlin 侧注入） */
    private val TCP_PY = """import socket, time
H = HOST
P = PORT
t0 = time.time()
try:
    s = socket.create_connection((H, P), 5)
    s.close()
    print('@@OK 1')
except Exception as e:
    print('@@OK 0')
    print('@@ERR %s' % e)
print('@@MS %d' % round((time.time() - t0) * 1000))
""".trimIndent()

    /** TCP 端口连通（远端 python 建一次连接，量耗时）：只回 @@OK / @@MS / @@ERR，解析在界面侧 */
    private fun netTcp(hostIn: String, portIn: Int): JSONObject {
        val host = safeHost(hostIn)
        val port = portIn.coerceIn(1, 65535)
        return pyRun("HOST = " + pyStr(host) + "\nPORT = " + port + "\n" + TCP_PY, 20000)
    }

    /**
     * 造一段能**直接拼进 python** 的字符串字面量。
     *
     * 注意别用 `JSONObject.quote()`：Android 的 org.json 会把 `/` 转义成 `\/`（JSON 允许，
     * JSON 解码器会还回来），可 python 不认 `\/` 这个转义 —— 反斜杠会原样留在字符串里，
     * 于是路径变成 `skills\/x\/SKILL.md`（远端读不到）、base64 里的 `/` 全被写坏。
     * 这里只转义 python 认的那几个字符。
     */
    private fun pyStr(sIn: String): String {
        val s = sIn
        val sb = StringBuilder(s.length + 8)
        sb.append('"')
        for (c in s) {
            when (c) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (c.code < 0x20) sb.append(String.format("\\u%04x", c.code)) else sb.append(c)
            }
        }
        sb.append('"')
        return sb.toString()
    }

    /** 只放行 skills/ 与 memories/ 下的相对路径（禁 `..`、禁奇怪字符） */
    private fun safeRel(pathIn: String): String {
        val p = pathIn.trim().trimStart('/')
        if (!Regex("^[A-Za-z0-9._/-]+$").matches(p) || p.contains("..") ||
            !(p.startsWith("skills/") || p.startsWith("memories/"))
        ) throw IllegalArgumentException("路径不允许：$pathIn")
        return p
    }

    /** 读系统提示词（只读）：OFF/N 由 Kotlin 侧注入 */
    private val PROMPT_PY = """import sqlite3, os
db = os.path.join(os.path.expanduser('~'), '.hermes', 'state.db')
try:
    c = sqlite3.connect('file:%s?mode=ro' % db, uri=True)
except Exception as e:
    print('@@ERR', '打不开 state.db:', e); raise SystemExit(0)
try:
    row = c.execute('select count(*), ifnull(max(length(prompt)),0), ifnull(min(length(prompt)),0) from system_prompts').fetchone()
    print('@@STAT', '|'.join(str(x) for x in row))
    h = c.execute('select system_prompt_hash from sessions where system_prompt_hash is not null order by rowid desc limit 1').fetchone()
    h = (h[0] or '') if h else ''
    print('@@HASH', h[:12])
    txt = ''
    if h:
        r = c.execute('select prompt from system_prompts where hash=?', (h,)).fetchone()
        if r and r[0]:
            txt = r[0]
    print('@@TOTAL', len(txt))
    print('@@HEAD', (txt.split('\n')[0] if txt else '')[:120])
    print('@@TEXT')
    print(txt[OFF-1:OFF-1+N])
except Exception as e:
    print('@@ERR', e)
""".trimIndent()

    /** 读模型配置（只读） */
    private val MODEL_READ_PY = """
import io, os, re, json, glob
home = os.path.expanduser('~')
cfg = os.path.join(home, '.hermes', 'config.yaml')
print('@@PATH', cfg)
print('@@W', '1' if os.access(cfg, os.W_OK) else '0')
def get(key):
    try:
        txt = io.open(cfg, encoding='utf-8').read()
    except Exception:
        return ''
    in_model = False
    for l in txt.split('\n'):
        if re.match(r'^model:\s*${'$'}', l):
            in_model = True; continue
        if in_model:
            if l and not l.startswith((' ', '\t')):
                break
            m = re.match(r'^\s+' + key + r':\s*(.*)${'$'}', l)
            if m:
                return m.group(1).strip()
    return ''
print('@@MODEL', get('default'))
print('@@PROVIDER', get('provider'))
print('@@BASE', get('base_url'))
cand = []
p = os.path.join(home, '.hermes', 'provider_models_cache.json')
if os.path.exists(p):
    try:
        d = json.load(io.open(p, encoding='utf-8'))
        e = d.get(get('provider')) or {}
        ms = e.get('models') or []
        cand = [x for x in ms if isinstance(x, str)] or [m.get('id', '') for m in ms if isinstance(m, dict)]
    except Exception:
        cand = []
print('@@CAND', ','.join([c for c in cand if c][:40]))
baks = sorted(os.path.basename(x) for x in glob.glob(cfg + '.hpk-bak-*'))
print('@@BAKS', ','.join(baks[-5:]))
""".trimIndent()

    /** 改模型：先备份，再只改 model 段的 default 行，然后读回 + yaml 解析校验（NEW 由 Kotlin 侧注入） */
    private val MODEL_WRITE_PY = """
import io, os, re, shutil, time
cfg = os.path.join(os.path.expanduser('~'), '.hermes', 'config.yaml')
txt = io.open(cfg, encoding='utf-8').read()
lines = txt.split('\n')
in_model, old = False, None
for i, l in enumerate(lines):
    if re.match(r'^model:\s*${'$'}', l):
        in_model = True; continue
    if in_model:
        if l and not l.startswith((' ', '\t')):
            break
        m = re.match(r'^(\s+default:\s*)(.*)${'$'}', l)
        if m:
            old = m.group(2).strip()
            lines[i] = m.group(1) + NEW
            break
if old is None:
    print('@@ERR 没在 config.yaml 的 model 段里找到 default'); raise SystemExit(0)
bak = cfg + '.hpk-bak-' + time.strftime('%Y%m%d-%H%M%S')
shutil.copy2(cfg, bak)
tmp = cfg + '.hpk-tmp'
io.open(tmp, 'w', encoding='utf-8').write('\n'.join(lines))
os.replace(tmp, cfg)
back = io.open(cfg, encoding='utf-8').read()
now, in_model = None, False
for l in back.split('\n'):
    if re.match(r'^model:\s*${'$'}', l):
        in_model = True; continue
    if in_model:
        if l and not l.startswith((' ', '\t')):
            break
        m = re.match(r'^\s+default:\s*(.*)${'$'}', l)
        if m:
            now = m.group(1).strip(); break
yaml_ok = 'skip'
try:
    import yaml
    try:
        yaml.safe_load(back); yaml_ok = 'ok'
    except Exception as e:
        yaml_ok = 'bad: ' + str(e)[:60]
except Exception:
    yaml_ok = 'no-yaml'
print('@@OLD', old)
print('@@NEW', now if now is not None else '(空)')
print('@@OK', '1' if now == NEW else '0')
print('@@YAML', yaml_ok)
print('@@BAK', bak)
""".trimIndent()

    /** 还原模型：从最新的备份恢复 */
    private val MODEL_UNDO_PY = """
import io, os, re, glob, shutil
cfg = os.path.join(os.path.expanduser('~'), '.hermes', 'config.yaml')
baks = sorted(glob.glob(cfg + '.hpk-bak-*'))
if not baks:
    print('@@ERR 没有备份可还原'); raise SystemExit(0)
src = baks[-1]
shutil.copy2(src, cfg)
txt = io.open(cfg, encoding='utf-8').read()
now, in_model = None, False
for l in txt.split('\n'):
    if re.match(r'^model:\s*${'$'}', l):
        in_model = True; continue
    if in_model:
        if l and not l.startswith((' ', '\t')):
            break
        m = re.match(r'^\s+default:\s*(.*)${'$'}', l)
        if m:
            now = m.group(1).strip(); break
print('@@FROM', os.path.basename(src))
print('@@MODEL', now or '(空)')
print('@@OK', '1')
""".trimIndent()

    /**
     * `tmux list-sessions` 的原始输出（字段用分隔符拼成一行，解析在界面侧做）。
     *
     * 只读：这里**没有**、也不许有 kill-session / kill-server 之类的东西 ——
     * 用户的要求是「启动时如果有某个 tmux 就不管且选择这个 tmux，没有就创建，始终不终止 tmux」。
     * 远端没跑 tmux / 没装 tmux 时把 stderr 一起回给界面，让界面如实说"没有会话"。
     */
    private fun tmuxList(): JSONObject {
        val f = "#{session_name}${SEP}#{session_windows}${SEP}#{session_attached}${SEP}" +
            "#{session_activity}${SEP}#{session_created}"
        val cmd = "tmux list-sessions -F '$f' 2>&1 || true"
        return try {
            val out = sshOrThrow().exec(cmd, 8000)
            JSONObject().put("raw", out).put("at", System.currentTimeMillis())
        } catch (e: Exception) {
            JSONObject().put("err", e.message ?: "读取 tmux 会话失败")
        }
    }

    /**
     * 跑一段**远端 python**（只读或改配置都走它），stdout 原样回给界面；出错写 `@@ERR`。
     * 统一成一个入口，免得每个 op 各写一遍 heredoc 拼接（容易漏引号 / 漏超时）。
     */
    private fun pyRun(script: String, timeoutMs: Long = 15000): JSONObject = try {
        JSONObject().put("raw", sshOrThrow().exec("python3 - <<'HPKPY'\n" + script + "\nHPKPY", timeoutMs))
    } catch (e: Exception) {
        JSONObject().put("raw", "@@ERR " + (e.message ?: "远端执行失败"))
    }

    /** 读远端模型（config.yaml 的 model 段）+ 候选（provider_models_cache.json）+ 已有备份 */
    private fun hermesModelRead(): JSONObject = pyRun(MODEL_READ_PY)

    /**
     * 改远端模型：**先备份再改**（`config.yaml.hpk-bak-<时间戳>`），改名后**读回校验**，
     * 并用 yaml 解析一遍确认没改坏（远端没有 pyyaml 就报 no-yaml，不假装验过）。
     * 模型名只允许 1–200 字符、不含换行/单引号 —— 由这里挡住，不把用户输入直接塞进脚本。
     */
    private fun hermesModelWrite(modelIn: String): JSONObject {
        val m = modelIn.trim()
        if (m.isEmpty() || m.length > 200 || m.contains('\n') || m.contains('\'') || m.contains('\\')) {
            return JSONObject().put("raw", "@@ERR 模型名不合法（1–200 字符，不能含换行、单引号、反斜杠）")
        }
        return pyRun("NEW = " + pyStr(m) + "\n" + MODEL_WRITE_PY)
    }

    /** 还原：从最新的备份恢复（能撤销，就不拦人） */
    private fun hermesModelUndo(): JSONObject = pyRun(MODEL_UNDO_PY)

    /**
     * 读**远端会话真正用过的系统提示词**（只读）。
     *
     * 来源是 Hermes 自己的 `state.db`：`system_prompts(hash → prompt)` + `sessions.system_prompt_hash`
     * （实测本机：20 份、最长 21,891 字符）。为什么不"拼一份出来"—— 拼出来的只是**像**，不是真的，
     * 那是假证；这里读的就是真存过的那一份。远端没有 python3 / 打不开库时，把原因写进 `@@ERR` 回给界面。
     */
    private fun hermesPrompt(offsetIn: Int, charsIn: Int): JSONObject {
        val off = offsetIn.coerceIn(1, 5_000_000)
        val n = charsIn.coerceIn(200, 8000)
        return pyRun("OFF = " + off + "\nN = " + n + "\n" + PROMPT_PY)
    }

    private fun hermesGather(): JSONObject {
        val out = sshOrThrow().exec(HERMES_INFO_CMD, 15000)
        val meta = HashMap<String, Pair<Int, Long>>()          // path -> (字节, mtimeMs)
        val desc = HashMap<String, String>()
        var limitMem = 0; var limitUser = 0
        var sect = ""
        out.lineSequence().forEach { raw ->
            val (mark, rest) = splitMarker(raw)
            if (rest.isNotEmpty()) when (sect) {
                "F" -> {
                    val p = rest.split('\t')
                    if (p.size >= 3) meta[p[0]] = (p[1].toIntOrNull() ?: 0) to
                        ((p[2].toDoubleOrNull()?.times(1000))?.toLong() ?: 0L)
                }
                "D" -> {
                    val i = rest.indexOf(":description:")
                    if (i > 0) desc[rest.substring(0, i)] =
                        rest.substring(i + ":description:".length).trim().trim('"')
                }
                "C" -> {
                    val v = rest.substringAfter(':').trim().toIntOrNull()
                    if (v != null) { if (rest.contains("user_char_limit")) limitUser = v else limitMem = v }
                }
            }
            when (mark) { "@@FIND" -> sect = "F"; "@@DESC" -> sect = "D"; "@@CONF" -> sect = "C"; "@@END" -> sect = "" }
        }
        val arr = org.json.JSONArray()
        val home = meta.keys.firstOrNull()?.substringBefore("/skills/") ?: ""
        meta.keys.sorted().forEach { p ->
            val rel = p.substringAfter("/skills/")
            val parts = rel.split('/')
            val m = meta[p]!!
            arr.put(JSONObject()
                .put("rel", rel)
                .put("path", "skills/$rel")            // 读取时用的是相对 ~/.hermes 的路径
                .put("category", parts.getOrNull(0) ?: "")
                .put("name", if (parts.size >= 3) parts[1] else (parts.getOrNull(0) ?: rel))
                .put("size", m.first)
                .put("mtime", m.second)
                .put("desc", desc[p] ?: ""))
        }
        return JSONObject()
            .put("home", home)
            .put("skills", arr)
            .put("count", arr.length())
            .put("memoryLimit", limitMem)
            .put("userLimit", limitUser)
    }

    private fun hermesMemory(): JSONObject {
        val out = sshOrThrow().exec(HERMES_MEM_CMD, 12000)
        val sbUser = StringBuilder(); val sbMem = StringBuilder()
        var sect = ""
        out.lineSequence().forEach { raw ->
            val (mark, rest) = splitMarker(raw)
            if (rest.isNotEmpty()) when (sect) { "U" -> sbUser.appendLine(rest); "M" -> sbMem.appendLine(rest) }
            when (mark) { "@@USER" -> sect = "U"; "@@MEM" -> sect = "M"; "@@END" -> sect = "" }
        }
        val user = sbUser.toString(); val mem = sbMem.toString()
        return JSONObject()
            .put("user", user).put("userChars", user.trim().length)
            .put("memory", mem).put("memoryChars", mem.trim().length)
            .put("memoryEntries", if (mem.isBlank()) 0 else mem.split("§").size)
    }

    /** 读取 Hermes 目录下的文件（只放行 skills/ 与 memories/ 前缀，禁 `..`） */
    private fun hermesRead(pathIn: String): JSONObject {
        val p = pathIn.trim().trimStart('/')
        if (!Regex("^[A-Za-z0-9._/-]+$").matches(p) || p.contains("..") ||
            !(p.startsWith("skills/") || p.startsWith("memories/"))
        ) throw IllegalArgumentException("路径不允许：$pathIn")
        // 单引号包裹：上面的字符集校验已经排除了引号本身，这里再加一层保险
        val out = sshOrThrow().exec("cat \"\$HOME/.hermes/$p\" 2>/dev/null", 12000)
        return JSONObject().put("path", p).put("content", out).put("chars", out.length)
    }

    private fun ok(id: Long, data: Any?) {
        val o = JSONObject().put("t", "res").put("_rid", id).put("ok", true)
        o.put("data", data ?: JSONObject.NULL)
        post(o)
    }

    private fun err(id: Long, msg: String) {
        post(JSONObject().put("t", "err").put("_rid", id).put("msg", msg))
    }

    private fun dispatch(m: JSONObject) {
        val t = m.optString("t")
        // 关联字段是 `_rid`，不是 `id` —— `id` 是业务字段（密钥/主机 id），两者不能混用
        val id = m.optLong("_rid", 0)
        val hasId = id != 0L

        when (t) {
            "hello" -> post(JSONObject().put("t", "state").put("state", "idle")
                .put("native", true).put("version", BuildConfig.VERSION_NAME))

            "bye" -> { session?.close(silent = true); session = null; eventWatch?.stop(); eventWatch = null; SessionService.stop(ctx) }

            "ping" -> { if (hasId) ok(id, JSONObject().put("pong", System.currentTimeMillis())); session?.emitMetrics() }

            /* ------------------------------------------------ 终端事件通知 */
            "app.notify" -> {
                val posted = Notify.post(
                    appCtx,
                    m.optString("kind", "event"),
                    m.optString("title", "Hermes Pocket"),
                    m.optString("body", ""),
                    m.optBoolean("urgent", false)
                )
                if (hasId) ok(id, JSONObject().put("posted", posted).put("foreground", Notify.isForeground()).put("granted", Notify.granted(appCtx)))
            }

            "app.notification.state" -> if (hasId) ok(id, JSONObject()
                .put("granted", Notify.granted(appCtx))
                .put("foreground", Notify.isForeground())
                .put("channel", Notify.CHANNEL))

            /** 再申请一次通知权限（用户可能第一次点了"不允许"） */
            "app.permission.request" -> {
                val a = MainActivity.current
                if (a != null) a.runOnUiThread { try { a.askNotifications() } catch (t: Throwable) { } }
                if (hasId) ok(id, JSONObject().put("ok", a != null).put("granted", Notify.granted(appCtx)))
            }

            /** 打开系统的「应用通知设置」——国产系统上常需要用户手动允许通知/后台弹通知 */
            "app.settings.notifications" -> {
                val c = appCtx
                var opened = true
                try {
                    c.startActivity(
                        android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, c.packageName)
                            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                } catch (t: Throwable) {
                    opened = false
                    try {
                        c.startActivity(
                            android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                                .setData(android.net.Uri.parse("package:${c.packageName}"))
                                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                        opened = true
                    } catch (t2: Throwable) { opened = false }
                }
                if (hasId) ok(id, JSONObject().put("ok", opened).put("granted", Notify.granted(c)))
            }

            /* --------------------------------------- Hermes 技能 / 记忆 */
            // 复用终端那条会话开 exec 通道读，不新开连接；命令是**固定的**，用户数据只进参数校验
            "hermes.info" -> if (hasId) ok(id, hermesGather())
            "hermes.memory" -> if (hasId) ok(id, hermesMemory())
            "hermes.read" -> if (hasId) ok(id, hermesRead(m.optString("path")))
            // tmux 会话清单（只读）。**这一族里永远不出现 kill** —— 用户明说「始终不终止 tmux」。
            // 解析放在界面侧（那边有测试台，能拿真实 tmux 输出喂断言），这里只回原始文本。
            "tmux.list" -> if (hasId) ok(id, tmuxList())
            // 远端会话真正用过的系统提示词（只读；来源 state.db，不是"拼一份像的出来"）
            "hermes.prompt" -> if (hasId) ok(id, hermesPrompt(m.optInt("offset", 1), m.optInt("chars", 1500)))
            // 远端模型：看（只读）/ 改（改前备份 + 读回校验）/ 还原（从备份恢复）
            "hermes.model" -> if (hasId) ok(id, hermesModelRead())
            "hermes.model.set" -> if (hasId) ok(id, hermesModelWrite(m.optString("model", "")))
            "hermes.model.undo" -> if (hasId) ok(id, hermesModelUndo())
            // skill / 记忆：读原文（带 sha256）· 编辑后回写（先对账、改前备份、读完校验）· 存到手机本地
            "skill.read" -> if (hasId) ok(id, skillRead(m.optString("path", "")))
            "skill.write" -> if (hasId) ok(id, skillWrite(m.optString("path", ""), m.optString("b64", ""), m.optString("sha", "")))
            "local.save" -> if (hasId) ok(id, localSave(m.optString("name", ""), m.optString("b64", "")))
            // 网络诊断：ping（只读）/ 端口连通；都只回原始文本或标记，解析在界面侧
            "net.ping" -> if (hasId) ok(id, netPing(m.optString("host", ""), m.optInt("count", 5)))
            "net.tcp" -> if (hasId) ok(id, netTcp(m.optString("host", ""), m.optInt("port", 22)))

            /* ------------------------------------------------ talk（多角色频道） */
            // 命令**固定**（只调 roles-chat 的 talk.py 那几个子命令），用户数据只进参数并做校验；
            // 面板上全是按键，用户不敲命令 —— 这一族就是那些按键的落点。
            "talk.roles" -> if (hasId) ok(id, talkJson(listOf("roles-json")))
            "talk.sessions" -> if (hasId) ok(id, talkJson(listOf("sessions-json")))
            "talk.since" -> if (hasId) ok(id, talkJson(listOf("since-json", "--id", m.optInt("id", 0).toString())))
            "talk.inbox" -> if (hasId) ok(id, talkJson(listOf("inbox", "--role", talkRole(m.optString("role")))))
            "talk.thread" -> if (hasId) ok(id, talkJson(listOf("thread", "--role", talkText(m.optString("role", "")),
                    "--lines", m.optString("limit", "100"))))
            "talk.spawn" -> if (hasId) ok(id, talkJson(listOf("spawn", "--role", talkRole(m.optString("role")))))
            "talk.solo" -> if (hasId) ok(id, talkJson(listOf("solo") +
                    (if (m.optString("name", "").isBlank()) emptyList() else listOf("--name", talkText(m.optString("name"))))))
            "talk.pause" -> if (hasId) ok(id, talkJson(listOf("pause", "--role", talkText(m.optString("role", "")), "--by", "owner.me")))
            "talk.start" -> if (hasId) ok(id, talkJson(listOf("start", "--role", talkText(m.optString("role", "")), "--by", "owner.me")))
            "talk.role-del" -> if (hasId) {
                val a = mutableListOf("role-del", "--full", talkText(m.optString("role", "")), "--by", "owner.me")
                if (m.optBoolean("force", false)) a.add("--force")
                ok(id, talkJson(a))
            }
            "talk.role-edit" -> if (hasId) ok(id, talkJson(listOf("role-edit",
                    "--full", talkText(m.optString("role", "")),
                    "--title", talkText(m.optString("title", "")),
                    "--tags", talkText(m.optString("tags", "")),
                    "--scene", talkText(m.optString("scene", "")),
                    "--by", "owner.me")))
            "talk.reg" -> if (hasId) ok(id, talkJson(listOf("reg",
                    "--full", talkText(m.optString("scene", "")).trim(' ', '.') + "." +
                              talkText(m.optString("name", "")).trim(' ', '.'),
                    "--title", talkText(m.optString("title", "")),
                    "--scope", talkText(m.optString("tags", "")))))
            "talk.asks" -> if (hasId) ok(id, talkJson(listOf("asks-json")))
            "talk.answer" -> if (hasId) ok(id, talkJson(listOf("answer", "--id", m.optString("id", "0"),
                    "--text", talkText(m.optString("text", "")), "--by", "owner.me")))
            "talk.shout" -> if (hasId) {
                val body = talkText(m.optString("body", ""))
                if (body.isBlank()) throw IllegalArgumentException("说要说什么")
                // 广播：也走 say，逐个投递 + 每条带【频道广播】标签 + 各存记录
                val r = runCatching { talkJson(listOf("say", "--by", "me", "--role", "全体",
                        "--kind", "broadcast", "--topic", talkText(m.optString("topic", "喊话")), "--body", body)) }
                ok(id, JSONObject().put("broadcast", true).put("raw", r.getOrNull() ?: JSONObject()))
            }
            "talk.say" -> if (hasId) {
                val to = talkRole(m.optString("role"))
                val body = talkText(m.optString("body", ""))
                if (body.isBlank()) throw IllegalArgumentException("说要说什么")
                // kind: private=只给他本人看；default=发给他但**他人可见**
                val kind = if (m.optString("kind", "private") == "default") "default" else "private"
                val r = runCatching { talkJson(listOf("say", "--by", "me", "--role", to, "--kind", kind,
                        "--body", body, "--topic", talkText(m.optString("topic", "私信")))) }
                ok(id, JSONObject().put("to", to).put("kind", kind).put("delivered", r.isSuccess)
                    .put("raw", r.getOrNull() ?: JSONObject()))
            }
            "talk.capture" -> if (hasId) ok(id, JSONObject().put("raw",
                sshOrThrow().exec(talkCmd(listOf("capture", "--role", talkRole(m.optString("role")),
                    "--lines", m.optInt("lines", 200).toString())), 12000L)))

            /* ------------------------------------------------- hosts */
            "host.list" -> if (hasId) ok(id, Store.listHosts())

            "host.save" -> {
                val h = m.optJSONObject("host") ?: throw IllegalArgumentException("缺少 host")
                val hid = Store.saveHost(h)
                if (hasId) ok(id, JSONObject().put("id", hid).put("ok", true))
            }

            "host.delete" -> { Store.deleteHost(m.optString("id")); if (hasId) ok(id, JSONObject().put("ok", true)) }

            /* -------------------------------------------------- keys */
            "key.list" -> if (hasId) ok(id, Store.listKeys())

            "key.generate" -> {
                val meta = KeyTool.generate(
                    m.optString("name").ifEmpty { "key" },
                    m.optString("algo").ifEmpty { "ed25519" },
                    m.optString("passphrase", "")
                )
                if (hasId) ok(id, meta)
            }

            "key.import" -> {
                val meta = KeyTool.import(m.optString("name").ifEmpty { "imported" },
                    m.optString("privatePem"), m.optString("passphrase", ""))
                if (hasId) ok(id, meta)
            }

            "key.delete" -> { Store.deleteKey(m.optString("id")); if (hasId) ok(id, JSONObject().put("ok", true)) }

            "key.reveal" -> {
                android.util.Log.i(TAG, "reveal: enter id=" + m.optString("id"))
                val rec = Store.keyById(m.optString("id")) ?: throw IllegalArgumentException("无此密钥")
                android.util.Log.i(TAG, "reveal: got record, sealed len=" + rec.optString("privSealed").length)
                val pem = Vault.openText(rec.getString("privSealed"))
                android.util.Log.i(TAG, "reveal: decrypted len=" + pem.length)
                if (hasId) ok(id, pem)
                android.util.Log.i(TAG, "reveal: replied")
            }

            /* ------------------------------------------------- prefs */
            "pref.all" -> if (hasId) ok(id, Store.prefs().also {
                it.put("_vault", Vault.describe())
                it.put("_native", true)
            })

            "pref.set" -> { Store.setPref(m.getString("k"), m.get("v")); if (hasId) ok(id, JSONObject().put("ok", true)) }

            /* ----------------------------------------------- session */
            "session.open" -> {
                val hid = m.getString("hostId")
                val h = Store.hostById(hid) ?: throw IllegalArgumentException("找不到主机 $hid")
                val pass = m.optString("passphrase", "")
                if (pass.isNotEmpty()) h.put("passphrase", pass)
                session?.close(silent = true)
                val s = SshSession(h) { ev -> if (ev.optString("t") == "hostkey") noteHostKey(ev); post(ev) }
                session = s
                Store.touchHost(hid)
                SessionService.start(ctx, "${h.optString("user")}@${h.optString("host")}")
                s.open(m.optInt("cols", 80), m.optInt("rows", 24))
                if (hasId) ok(id, JSONObject().put("sessionId", s.id))
            }

            "session.write" -> session?.write(m.getString("data"))

            "session.resize" -> session?.resize(m.optInt("cols", 80), m.optInt("rows", 24))

            // 回到前台时把 WebView 冻结期间漏掉的输出补回来（原生侧留了 512KB 环形缓冲）
            "session.since" -> if (hasId) ok(id, session?.since(m.optLong("from", 0)))

            /* ------------------------------------------------- 公钥装上服务器 */
            // 就是 ssh-copy-id：用保存的密码连上去，把公钥追加进 authorized_keys，
            // 再用**密钥真连一次**验证。verified=false 时界面不要切成密钥登录。
            "key.install" -> {
                val hid = m.getString("hostId")
                val h = Store.hostById(hid) ?: throw IllegalArgumentException("找不到主机 $hid")
                val keyId = m.optString("keyId").ifEmpty { h.optString("keyId") }
                if (keyId.isEmpty()) throw IllegalArgumentException("这台主机没有选定密钥")
                val rec = Store.keyById(keyId) ?: throw IllegalArgumentException("找不到密钥 $keyId")
                val pub = rec.optString("publicKey")
                if (pub.isEmpty()) throw IllegalArgumentException("这把密钥没有公钥内容")
                if (hasId) ok(id, KeyInstaller.install(h, pub))
            }

            /* --------------------------------------------- 文件事件通道 */
            // 另开一条独立 SSH 连接盯着服务端 home 下的只追加文件，
            // 新增行 → 事件 → 前端调起**手机系统通知**（见 app.js onEventLine）。
            "events.start" -> {
                val hid = m.optString("hostId")
                val h = Store.listHosts().let { arr ->
                    (0 until arr.length()).map { arr.getJSONObject(it) }.find { it.optString("id") == hid }
                } ?: throw IllegalArgumentException("找不到主机 $hid")
                eventWatch?.stop()
                val w = EventWatch(h, m.optString("path"), { ev -> post(ev) })
                eventWatch = w
                w.start()
                if (hasId) ok(id, JSONObject().put("ok", true).put("path", w.pathOf()))
            }

            "events.stop" -> { eventWatch?.stop(); eventWatch = null; if (hasId) ok(id, JSONObject().put("ok", true)) }

            "events.state" -> if (hasId) ok(id, JSONObject()
                .put("running", eventWatch?.isRunning() ?: false)
                .put("state", eventWatch?.state ?: "idle")
                .put("path", eventWatch?.pathOf() ?: ""))

            "session.close" -> { session?.close(); session = null; SessionService.stop(ctx) }

            /* --------------------------------------- 主机密钥确认 */
            "hostkey.answer" -> {
                val pending = lastHostKey
                val key = pending?.let { "${it.optString("host")}:${it.optInt("port", 22)}" }
                when {
                    // 清掉这台主机的指纹记录 → 下次重新走 TOFU
                    m.optString("action") == "forget" && key != null -> Store.forgetHost(key)
                    m.optBoolean("accept", false) && pending != null && key != null ->
                        Store.trustHost(key, pending.optString("fingerprint"), pending.optString("algo"))
                    pending != null && pending.optBoolean("changed", false) -> {
                        // 同一密钥类型但指纹不一致且用户拒绝 → 立刻断链
                        session?.close(silent = true); session = null; SessionService.stop(ctx)
                    }
                }
                if (hasId) ok(id, JSONObject().put("key", key ?: ""))
            }

            "hostkey.forget" -> {
                val k = m.optString("key")
                if (k.isNotEmpty()) Store.forgetHost(k)
                if (hasId) ok(id, JSONObject().put("ok", true))
            }

            "hostkey.list" -> if (hasId) ok(id, Store.knownHosts())

            "hostkey.keys" -> if (hasId) ok(id, Store.knownHostKeys(m.optString("key")))

            /* --------------------------------------------- 剪贴板 */
            "clip.read" -> if (hasId) ok(id, readClip())
            "clip.write" -> { writeClip(m.optString("text")); if (hasId) ok(id, JSONObject().put("ok", true)) }

            "app.configure" -> {
                SessionService.keepAwake = m.optBoolean("keepAwake", true)
                SessionService.applyWake()
                session?.setKeepalive(m.optInt("keepalive", 30))
                if (hasId) ok(id, JSONObject().put("ok", true))
            }

            /**
             * 省电开关。设计要点：**省电不等于断连** ——
             * 只放掉 CPU 唤醒锁、静音应用层心跳、暂缓重连；TCP socket 由内核维持。
             * 亮屏回来前端会立刻关掉省电 + 拉回漏掉的输出（环形缓冲 since）。
             */
            "app.power" -> {
                val save = m.optBoolean("save", false)
                SessionService.applyPowerSave(save)
                session?.setKeepalive(if (save) m.optInt("keepaliveSave", 120) else m.optInt("keepalive", 30))
                if (hasId) ok(id, JSONObject()
                    .put("save", save)
                    .put("wakeHeld", SessionService.wakeHeld())
                    .put("interactive", SessionService.screenOn(appCtx)))
            }

            "app.power.state" -> if (hasId) ok(id, JSONObject()
                .put("save", SessionService.powerSave)
                .put("keepAwake", SessionService.keepAwake)
                .put("wakeHeld", SessionService.wakeHeld())
                .put("keepalive", session?.lastKeepalive ?: 0)
                .put("interactive", SessionService.screenOn(appCtx)))

            /** 亮屏回来叫一次：省电期间被压住的重连在这里补上 */
            "session.kick" -> { session?.kick(); if (hasId) ok(id, JSONObject().put("ok", true)) }

            /** 取走省电期间**落盘**的输出（前端渲染完再关省电，顺序由前端保证） */
            "session.spill" -> if (hasId) ok(id, session?.spillDrain()
                ?: JSONObject().put("bytes", 0).put("data", "").put("seq", 0).put("truncated", false))

            /* ------------------------------------------------- diag */
            // 诊断用：返回指定长度的字符串，用来二分「原生→JS 投递」在什么长度上失效
            "diag.echo" -> { if (hasId) ok(id, "A".repeat(m.optInt("n", 0))) }
            "diag.echoLines" -> {
                val n = m.optInt("n", 0)
                if (hasId) ok(id, (1..n).joinToString("\n") { "line$it" })
            }
            "diag.echoObj" -> {
                val n = m.optInt("n", 0)
                if (hasId) ok(id, JSONObject().put("s", "A".repeat(n)))
            }

            else -> if (hasId) err(id, "未知操作 $t")
        }
    }

    /** SshSession 里 emit 出来的 hostkey 事件顺手留一份，供 hostkey.answer 用 */
    fun noteHostKey(o: JSONObject) { lastHostKey = o }

    private fun readClip(): String {
        val c = ctx ?: return ""
        val cm = c.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return ""
        val clip = cm.primaryClip ?: return ""
        if (clip.itemCount == 0) return ""
        return clip.getItemAt(0).coerceToText(c).toString()
    }

    private fun writeClip(text: String) {
        val c = ctx ?: return
        val cm = c.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        cm.setPrimaryClip(ClipData.newPlainText("hermes-pocket", text))
    }
}
