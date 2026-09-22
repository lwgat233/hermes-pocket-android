plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.hermes.pocket"
    compileSdk = 34

    defaultConfig {
        applicationId = "dev.hermes.pocket"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf(
            "META-INF/*.kotlin_module",
            "META-INF/DEPENDENCIES",
            // jsch 和 bcprov 都带这个多版本 JAR 条目，AGP 会因为重复而直接失败
            "META-INF/versions/9/OSGI-INF/MANIFEST.MF",
            "META-INF/versions/**/OSGI-INF/MANIFEST.MF"
        )
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
    // SSH 协议栈：mwiede/jsch —— Android 上验证过的 JSch 维护分支，
    // 支持 curve25519 / aes-gcm，单 jar 无 NDK 依赖。
    //
    // 注意：jsch 的 SignatureEd25519 只存在于 jar 的 META-INF/versions/15/ 下
    // （多版本 JAR），而 **Android 的 ART 不支持多版本 JAR 查找**，于是它会退回
    // com.jcraft.jsch.bc.SignatureEd25519 —— 那个类需要 BouncyCastle。
    // 少了 BC 的表现很隐蔽：ssh-ed25519 会静默从 server_host_key 提案里消失，
    // 连接报 "Algorithm negotiation fail: serverProposal=ssh-ed25519"。
    // 现代服务器（含本机 fnOS 的 sshd）默认就是 ed25519 host key，用户密钥也是，
    // 所以 BC 不是可选项。
    implementation("com.github.mwiede:jsch:0.2.26")
    implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")
    implementation("org.slf4j:slf4j-nop:2.0.13")
}
