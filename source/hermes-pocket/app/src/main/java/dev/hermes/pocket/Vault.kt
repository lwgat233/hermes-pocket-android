package dev.hermes.pocket

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 设备侧密钥库。
 *
 * Android Keystore 里只放一把**不可导出**的 AES-256-GCM 主密钥（能上 StrongBox 就上，
 * 否则退到 TEE），用户的 SSH 私钥 / 密码用这把主密钥加密后落盘。
 * 这与 bridge/server.mjs 的 master.key 是同一套设计，区别是私钥永不出设备。
 *
 * 关键点：私钥明文只在内存里短暂存在（连接时解密 → 交给 jsch → 尽快清零），
 * 落盘的一律是密文；host.list / key.list 这类读接口永不回传明文。
 */
object Vault {
    private const val PROVIDER = "AndroidKeyStore"
    private const val ALIAS = "hpk_vault_v1"
    private const val IV_LEN = 12
    private const val TAG_BITS = 128

    @Volatile private var cached: SecretKey? = null

    /** 主密钥是否真的落在独立安全芯片（StrongBox）里 */
    @Volatile var strongBox: Boolean = false; private set
    @Volatile var ready: Boolean = false; private set
    @Volatile var lastError: String? = null; private set

    fun init(ctx: Context) {
        try { ensureKey(); ready = true; lastError = null }
        catch (t: Throwable) { ready = false; lastError = t.message ?: t.toString() }
    }

    @Synchronized
    private fun ensureKey(): SecretKey {
        cached?.let { return it }
        val ks = KeyStore.getInstance(PROVIDER)
        ks.load(null, null)
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let {
            cached = it.secretKey
            // 已存在的 key 无法回查是否 StrongBox，保守报 false
            return it.secretKey
        }
        val k = generate()
        cached = k
        return k
    }

    private fun generate(): SecretKey {
        // StrongBox 是 API 28+；不可用的设备/模拟器会抛，退到 TEE
        val attempts: List<Boolean> =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) listOf(true, false) else listOf(false)
        var last: Throwable? = null
        for (sb in attempts) {
            try {
                val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
                val b = KeyGenParameterSpec.Builder(
                    ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                if (sb) b.setIsStrongBoxBacked(true)
                gen.init(b.build())
                return gen.generateKey().also { strongBox = sb }
            } catch (t: Throwable) { last = t }
        }
        throw IllegalStateException("无法创建 Keystore 主密钥: ${last?.message}", last)
    }

    /** 明文 → "v1:" + base64(iv ‖ ciphertext‖tag) */
    fun seal(plain: ByteArray): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        // 主密钥开了 setRandomizedEncryptionRequired(true)，此时**必须**由系统生成 IV：
        // 自己传 GCMParameterSpec 会抛 InvalidAlgorithmParameterException（调用方不得指定 IV）。
        // 这也正是我们想要的 —— 从根上杜绝 IV 复用。
        c.init(Cipher.ENCRYPT_MODE, ensureKey())
        val iv = c.iv
        val ct = c.doFinal(plain)
        return "v1:" + Base64.encodeToString(iv + ct, Base64.NO_WRAP)
    }

    fun open(blob: String): ByteArray {
        android.util.Log.i("HermesPocket", "Vault.open: enter blobLen=" + blob.length)
        val raw = Base64.decode(blob.removePrefix("v1:"), Base64.NO_WRAP)
        android.util.Log.i("HermesPocket", "Vault.open: decoded=" + raw.size)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        // 解密方向允许调用方给 IV（加密方向才禁止），所以这里显式传回存下来的那个 IV
        c.init(
            Cipher.DECRYPT_MODE, ensureKey(),
            GCMParameterSpec(TAG_BITS, raw.copyOfRange(0, IV_LEN))
        )
        android.util.Log.i("HermesPocket", "Vault.open: cipher inited")
        val out = c.doFinal(raw.copyOfRange(IV_LEN, raw.size))
        android.util.Log.i("HermesPocket", "Vault.open: done=" + out.size)
        return out
    }

    fun sealText(s: String) = seal(s.toByteArray(Charsets.UTF_8))
    fun openText(b: String) = String(open(b), Charsets.UTF_8)

    /** 状态简述，给设置页/测试报告用 */
    fun describe(): String =
        if (!ready) "Keystore 不可用: ${lastError ?: "未知"}"
        else "AES-256-GCM 主密钥就绪（${if (strongBox) "StrongBox 独立安全芯片" else "TEE 可信执行环境"}）"
}
