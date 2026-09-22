package dev.hermes.pocket

import android.app.Application

class PocketApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Keystore 主密钥要在任何读写之前就绪：Store 里的 *Sealed 字段全靠它
        Vault.init(this)
        Store.init(this)
        // jsch 的算法配置是全局静态的，必须在任何连接/密钥操作之前设好，
        // 否则 Android 上 EdDSA 会落到「要求 Java15+」的桩实现上
        SshFactory.init()
    }
}
