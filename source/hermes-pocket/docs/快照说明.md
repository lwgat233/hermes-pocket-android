# source/hermes-pocket —— 本轮的源码快照（供复现构件）

这是什么
----------------------------------------------------------------
Hermes Pocket 的完整工作树快照（不是某几个文件的片段）。归档目录里那个 APK 就是**从这份快照**干净构建出来的。

怎么复现构件哈希
----------------------------------------------------------------
    cp -r /vol1/1000/airesults/hermes-pocket/source/hermes-pocket /tmp/hpk-repro
    printf 'sdk.dir=$HOME/tools/android-sdk\n' > /tmp/hpk-repro/local.properties
    cd /tmp/hpk-repro && gradle --no-daemon -Pkotlin.compiler.execution.strategy=in-process :app:assembleDebug
    sha256sum app/build/outputs/apk/debug/app-debug.apk

得到的 sha256 应当等于 `../apk/测试版/hermes-pocket-键盘与输入框-测试-20260921-kbdC.apk.sha256`
（本轮实测一致：`d2c99b19b121e6a914095b2e93447e8b829a087e0e2e4a288249b325d8c4a7c9`）。
构建环境：JDK 17.0.2、Gradle 8.7、Android SDK（compileSdk 34 / minSdk 26），无需 root。

快照里**故意没有**的东西（别以为漏了）
----------------------------------------------------------------
- `app/build/`、`.gradle/`、`bridge/node_modules/` —— 构建产物与缓存，复现时由构建自己生成
- `local.properties` —— 里面是本机 SDK 路径，换个机器就该重写（上面那行 `printf` 就是它）
- 私钥 / 口令 / 签名密钥库 / 应用数据快照 —— 一律不进归档（密钥由 App 在设备上用一次性导入，
  签名用的是 Android 通用 debug 签名，不是本项目的密钥）

版本串从哪来
----------------------------------------------------------------
`app/src/main/assets/build-info.json` 是**唯一版本源**（打进包、可 `unzip -p … assets/build-info.json` 核对）；
`tools/stamp-build.py` 在**出包时自动写入**这一包的版本串（`轮次名-日期-时分秒`）与打包时间，
再盖进 `app/src/main/assets/ui/app.js` 的 `HP.BUILD` / `HP.BUILDINFO`，
界面「设置 → 构建版本」与终端横幅都读它 —— 版本串不再有手写的机会。
出包用 `bash tools/build.sh --name "…" --feature "…" --feature-id "…"`（盖章 → `--check` → 构建 → 解开包对账 → 归档，对账不过不归档）；
复核构件用 `python3 tools/stamp-build.py --verify <apk>`（退出码 0 = 包内与源树逐字节一致）。

目录速查（只列要紧的）
----------------------------------------------------------------
    app/src/main/assets/ui/     界面（app.js 主程序、panels.js 各栏目、registry.js 栏目登记表、
                                ui.js 渲染入口、remote.js/net.js 远端数据解析、net.js 流量统计…）
    app/src/main/assets/build-info.json   版本源
    app/src/main/java/dev/hermes/pocket/  Bridge.kt（WebView ↔ 原生桥：SSH、密钥库、远端命令）
    tools/                       校验脚本（check_*_py.py 把 Bridge.kt 里的远端脚本原样抽出来跑）
    tools/ui-harness/            本地测试台（harness.mjs 假桥 + t-*.mjs 断言 + d-*.mjs 设备驱动）
    docs/                        项目文档（功能规格 / 模块划分 / 界面规范 / 问题与需求登记）
