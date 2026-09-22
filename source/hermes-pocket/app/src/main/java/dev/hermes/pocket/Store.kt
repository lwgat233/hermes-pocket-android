package dev.hermes.pocket

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 落盘层：主机 / 密钥元数据 / 已知主机指纹 / 偏好。
 *
 * 约定（与 bridge/server.mjs 一致）：
 *   - 含密字段统一叫 `*Sealed`，值是 Vault 密文，**任何读接口都不回传**
 *   - 读接口只回 `hasPassword: true` 这种存在性标记
 */
object Store {
    private lateinit var dir: File
    lateinit var root: File; private set

    fun init(ctx: Context) {
        dir = File(ctx.filesDir, "pocket").also { it.mkdirs() }
        root = dir
    }

    private fun f(n: String) = File(dir, n)

    @Synchronized
    fun readArray(n: String): JSONArray =
        try { JSONArray(f(n).readText()) } catch (e: Exception) { JSONArray() }

    @Synchronized
    fun readObject(n: String): JSONObject =
        try { JSONObject(f(n).readText()) } catch (e: Exception) { JSONObject() }

    @Synchronized
    fun write(n: String, o: Any) {
        val tmp = File(dir, "$n.tmp")
        tmp.writeText(o.toString())
        if (!tmp.renameTo(f(n))) { f(n).writeText(o.toString()); tmp.delete() }
    }

    /* ------------------------------------------------------------ 主机 */

    @Synchronized
    fun hosts(): JSONArray = readArray("hosts.json")

    @Synchronized
    fun hostById(id: String): JSONObject? {
        val a = hosts()
        for (i in 0 until a.length()) if (a.optJSONObject(i)?.optString("id") == id) return a.optJSONObject(i)
        return null
    }

    /** 存主机；password 只写不读 */
    @Synchronized
    fun saveHost(inObj: JSONObject): String {
        val a = hosts()
        val id = inObj.optString("id").ifEmpty { newId() }
        val rec = JSONObject()
        for (k in listOf("name", "host", "port", "user", "auth", "keyId", "startCmd")) {
            if (inObj.has(k)) rec.put(k, inObj.get(k))
        }
        rec.put("id", id)
        rec.put("port", inObj.optInt("port", 22))
        rec.put("autoReconnect", inObj.optBoolean("autoReconnect", true))
        rec.put("keepalive", inObj.optInt("keepalive", 30))

        val old = hostById(id)
        if (old != null) {
            rec.put("created", old.optLong("created", System.currentTimeMillis()))
            if (old.has("passwordSealed")) rec.put("passwordSealed", old.getString("passwordSealed"))
            if (old.has("lastUsed")) rec.put("lastUsed", old.getLong("lastUsed"))
        } else rec.put("created", System.currentTimeMillis())

        val pw = inObj.optString("password", "")
        if (pw.isNotEmpty()) rec.put("passwordSealed", Vault.sealText(pw))
        if (inObj.has("passwordSealed")) rec.put("passwordSealed", inObj.getString("passwordSealed"))

        val out = JSONArray()
        var replaced = false
        for (i in 0 until a.length()) {
            val o = a.optJSONObject(i) ?: continue
            if (o.optString("id") == id) { out.put(rec); replaced = true } else out.put(o)
        }
        if (!replaced) out.put(rec)
        write("hosts.json", out)
        return id
    }

    @Synchronized
    fun deleteHost(id: String) {
        val a = hosts(); val out = JSONArray()
        for (i in 0 until a.length()) {
            val o = a.optJSONObject(i) ?: continue
            if (o.optString("id") != id) out.put(o)
        }
        write("hosts.json", out)
    }

    @Synchronized
    fun touchHost(id: String) {
        val h = hostById(id) ?: return
        h.put("lastUsed", System.currentTimeMillis())
        val a = hosts(); val out = JSONArray()
        for (i in 0 until a.length()) {
            val o = a.optJSONObject(i) ?: continue
            out.put(if (o.optString("id") == id) h else o)
        }
        write("hosts.json", out)
    }

    /** 只回非敏感字段 */
    @Synchronized
    fun listHosts(): JSONArray {
        val a = hosts(); val out = JSONArray()
        for (i in 0 until a.length()) {
            val o = a.optJSONObject(i) ?: continue
            val r = JSONObject()
            for (k in listOf("id", "name", "host", "port", "user", "auth", "keyId", "startCmd",
                             "autoReconnect", "keepalive", "lastUsed")) {
                if (o.has(k)) r.put(k, o.get(k))
            }
            r.put("hasPassword", o.has("passwordSealed"))
            r.put("keyName", keyById(o.optString("keyId"))?.optString("name") ?: "")
            out.put(r)
        }
        return out
    }

    /* ------------------------------------------------------------ 密钥 */

    @Synchronized
    fun keys(): JSONArray = readArray("keys.json")

    @Synchronized
    fun keyById(id: String): JSONObject? {
        val a = keys()
        for (i in 0 until a.length()) if (a.optJSONObject(i)?.optString("id") == id) return a.optJSONObject(i)
        return null
    }

    @Synchronized
    fun addKey(rec: JSONObject) {
        val a = keys(); a.put(rec); write("keys.json", a)
    }

    @Synchronized
    fun deleteKey(id: String) {
        val a = keys(); val out = JSONArray()
        for (i in 0 until a.length()) {
            val o = a.optJSONObject(i) ?: continue
            if (o.optString("id") != id) out.put(o)
        }
        write("keys.json", out)
    }

    /** 只回元数据 + 公钥，绝不回私钥 */
    @Synchronized
    fun listKeys(): JSONArray {
        val a = keys(); val out = JSONArray()
        for (i in 0 until a.length()) {
            val o = a.optJSONObject(i) ?: continue
            val r = JSONObject()
            for (k in listOf("id", "name", "algo", "bits", "publicKey", "fingerprint",
                             "hasPassphrase", "origin", "created")) {
                if (o.has(k)) r.put(k, o.get(k))
            }
            out.put(r)
        }
        return out
    }

    /* -------------------------------------------------------- 已知主机 */

    @Synchronized
    fun knownHosts(): JSONObject = readObject("known_hosts.json")

    /**
     * 按 (主机, 密钥类型) 查指纹 —— 和真实 SSH 的 known_hosts 一致：**每种密钥类型各存一条**。
     *
     * 旧实现一台主机只存一条指纹，服务器同时提供 ed25519/ecdsa/rsa 时，
     * 只要这次协商到的类型和存的那条不同就会误报「指纹发生变更」并把连接判死。
     * algo 传 null 表示「这台主机以前信任过任意一种密钥」，用来区分
     * 「换了密钥类型」（正常）和「同一类型换了密钥」（才可疑）。
     */
    @Synchronized
    fun knownFingerprint(key: String, algo: String? = null): String? {
        val e = knownHosts().optJSONObject(key) ?: return null
        val keys = e.optJSONObject("keys")
        if (keys == null) {
            // 旧格式：{"fingerprint":..,"algo":..} —— 它天然就是「它自己那种类型」的条目
            val fp = e.optString("fingerprint").ifEmpty { null } ?: return null
            if (algo == null) return fp
            return if (e.optString("algo") == algo) fp else null
        }
        if (algo == null) {
            val it = keys.keys()
            while (it.hasNext()) {
                val v = keys.optJSONObject(it.next())?.optString("fingerprint")
                if (!v.isNullOrEmpty()) return v
            }
            return null
        }
        return keys.optJSONObject(algo)?.optString("fingerprint")?.ifEmpty { null }
    }

    /** 这台主机是不是已知主机（不看类型），兼容旧格式 */
    @Synchronized
    fun isKnownHost(key: String): Boolean = knownFingerprint(key) != null

    @Synchronized
    fun trustHost(key: String, fingerprint: String, algo: String) {
        val o = knownHosts()
        val e = o.optJSONObject(key) ?: JSONObject()
        val keys = e.optJSONObject("keys") ?: JSONObject()
        // 旧扁平格式先迁进来，别丢用户已有的信任记录
        if (e.has("fingerprint")) {
            val oldAlgo = e.optString("algo").ifEmpty { "unknown" }
            if (!keys.has(oldAlgo)) keys.put(
                oldAlgo,
                JSONObject().put("fingerprint", e.optString("fingerprint"))
                    .put("added", e.optLong("added", System.currentTimeMillis()))
            )
        }
        keys.put(algo, JSONObject().put("fingerprint", fingerprint).put("added", System.currentTimeMillis()))
        e.put("keys", keys)
        e.remove("fingerprint"); e.remove("algo"); e.remove("added")
        e.put("updated", System.currentTimeMillis())
        o.put(key, e)
        write("known_hosts.json", o)
    }

    /** 抹掉某台主机的全部指纹（服务器重装过、或想重新 TOFU 时用） */
    @Synchronized
    fun forgetHost(key: String) {
        val o = knownHosts()
        if (o.has(key)) { o.remove(key); write("known_hosts.json", o) }
    }

    /** 某台主机已记录的「密钥类型 -> 指纹」，给界面显示 */
    @Synchronized
    fun knownHostKeys(key: String): JSONObject {
        val keys = knownHosts().optJSONObject(key)?.optJSONObject("keys") ?: return JSONObject()
        val out = JSONObject()
        val it = keys.keys()
        while (it.hasNext()) {
            val a = it.next()
            out.put(a, keys.optJSONObject(a)?.optString("fingerprint") ?: "")
        }
        return out
    }

    /* ------------------------------------------------------------ 偏好 */

    @Synchronized fun prefs(): JSONObject = readObject("prefs.json")

    @Synchronized
    fun setPref(k: String, v: Any) {
        val o = prefs(); o.put(k, v); write("prefs.json", o)
    }

    fun newId(): String = java.util.UUID.randomUUID().toString().replace("-", "").substring(0, 16)
}
