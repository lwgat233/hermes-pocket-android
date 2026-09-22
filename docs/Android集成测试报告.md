# Hermes Pocket — Android 集成测试报告

- 被测物: `hermes-pocket-debug.apk`（5,068,051 字节，sha256 `703e0ffb…1d7aa0`，见 `apk-sha256.txt`）
- 测试时间: 2026-09-16 23:36 – 23:56 CST
- 测试环境: 飞牛 fnOS（Debian 12 基底，自编译内核 6.18.18.c1032-trim）/ Android 14 google_apis x86_64 模拟器（emulator-5554）/ OpenSSH 9.2 测试服务端
- 结论: **23 项检查全部通过**，含真实 SSH 连接、真实 TUI 渲染、断线自愈、密钥加密落盘

---

## 1. 被测软件是什么

Hermes Pocket 是一个 **WebView 外壳 + 原生 SSH 客户端** 的安卓终端 App：

- 前端跑在 WebView 里（xterm.js + 一层手机适配），**不依赖任何远程服务**
- SSH 连接由 App 内的 Kotlin 原生层用 jsch 直接建立，私钥不出设备
- 前端与原生用 JSON 协议通信；同一份前端也能通过 WebSocket 连 `bridge/server.mjs`
  在桌面浏览器里跑（协议一致，前端一行不改）

关键路径：`WebView(assets/ui) → WebMessagePort 桥 → Bridge.kt(协议分发) → Ssh.kt(jsch) → 远端 sshd`

---

## 2. 测试是怎么做的（为什么这些结论可信）

模拟器里没有可用的 UI 自动化（uiautomator 看不到 WebView 内部），所以**没有靠截图判断**，
而是打开 debug 构件的 WebView devtools socket，用标准 CDP 直接读**真实 App 进程内**的页面状态：

```
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
node tools/cdp.mjs --file android-e2e-probe.js     # 在页面上下文里跑断言
```

断言读的是真实对象字段（`HP.App.state`、`HP.App.term.cols`、`HP.App.watcher.alt`、
xterm 缓冲区文本），不是「没崩就算过」。

测试用的 SSH 服务端是**独立起的真 sshd**（127.0.0.1:2222，自己的 host key 与
authorized_keys，不需要 root，也没碰 `~/.ssh`），所以 PTY、窗口尺寸、备用屏、
tmux 渲染全都是真实行为。模拟器经 `10.0.2.2` 访问宿主 loopback。

---

## 3. 测试项与结果

| # | 测试项 | 结果 | 实际观测值 |
|---|---|---|---|
| 1 | Keystore 主密钥就绪（AES-256-GCM） | ✓ | TEE 可信执行环境（模拟器无 StrongBox，已自动降级） |
| 2 | 走原生 SSH 通道 | ✓ | `_native=true`、`HP.hasNative()` true |
| 3 | 私钥导入 + 指纹计算 | ✓ | Ed25519 `SHA256:UsmprTonLnHC49NcRrDqZfo5FJwg73XgHFVJ6MyXDlE` |
| 4 | `key.list` 只回元数据 | ✓ | 响应中无 `privSealed`、无私钥明文 |
| 5 | 主机保存并回读 | ✓ | `lwgat@10.0.2.2:2222` |
| 6 | `host.list` 不回传口令/密文 | ✓ | 只回 `hasPassword` 布尔 |
| 7 | **SSH 会话建立（jsch 原生直连）** | ✓ | state=connected |
| 8 | 首次连接弹主机密钥确认（TOFU） | ✓ | 未知指纹时弹出确认 |
| 9 | 信任后会话保持 | ✓ | 确认后仍 connected |
| 10 | 远端命令回显 | ✓ | `HPK_MARKER_42` 出现在终端缓冲 |
| 11 | **resize 传到远端 PTY** | ✓ | 本地 48×39 → 远端 `stty size` 返回 `39 48` |
| 12 | TUI 备用屏被嗅探到 | ✓ | 捕获 `\x1b[?1049h` |
| 13 | 鼠标模式被嗅探到 | ✓ | mode=1002 |
| 14 | **TUI 下列数顶到 ≥80（手机原本 48 列）** | ✓ | cols 48 → 80 |
| 15 | 字号不低于可读下限 | ✓ | 13px → 10px（不再压到 6-7px） |
| 16 | 功能键条切到 TUI 那一行 | ✓ | shell 行隐藏、TUI 行显示 |
| 17 | 状态栏徽标显示 TUI | ✓ | `TUI·鼠标` |
| 18 | 横向平移状态与实际溢出一致 | ✓ | 可见 62 列 / 需要 80 列 → pan=true |
| 19 | **tmux 在备用屏里真的渲染出内容** | ✓ | 读到窗口状态栏 `[app] 0:sleep* "galaxy-fnos"` |
| 20 | Ctrl-B d 从 tmux 退出回到 shell | ✓ | alt=false |
| 21 | 远端 exit 后掉线被感知 | ✓ | 事件序列含 `disconnected` |
| 22 | **掉线后自动重连成功（原生层自愈）** | ✓ | `disconnected → reconnecting → connected` |
| 23 | 状态栏有保活/流量反馈 | ✓ | rtt 栏 `↑1.7K` |

原始输出见 `android-e2e-raw.txt`，探针脚本见 `android-e2e-probe.js`。

---

## 4. 测试过程中发现并修复的缺陷

这些问题都是先把「看起来过了」的假象拆掉才暴露出来的。

### 4.1 jsch 的 Ed25519 在 Android 上静默失效（最隐蔽的一个）

- 现象：连接报 `Algorithm negotiation fail: server_host_key`，
  jsch 提案里**完全没有 ssh-ed25519**，而远端只提供 ed25519。
- 根因：mwiede/jsch 的 `SignatureEd25519` 只存在于 jar 的
  `META-INF/versions/15/` 下（多版本 JAR），**Android 的 ART 不做多版本 JAR 查找**，
  于是 jsch 退回 `com.jcraft.jsch.bc.SignatureEd25519` —— 那个类需要 BouncyCastle。
  BC 不在 classpath 时 jsch 不报错，只是**把该算法从提案里悄悄删掉**。
- 影响：现代服务器（含本机 fnOS 的 sshd）默认就是 ed25519 主机密钥，
  用户自己的密钥也是 ed25519，缺 BC 等于「新一点的服务器全都连不上」。
- 修复：加 `org.bouncycastle:bcprov-jdk18on:1.78.1`（APK 1.68MB → 5.07MB）。

### 4.2 Keystore 主密钥加密路径必崩

- 现象：尚未触发即被发现 —— `setRandomizedEncryptionRequired(true)` 下
  **调用方不得提供 IV**，而代码自己生成 IV 并传 `GCMParameterSpec`，
  会抛 `InvalidAlgorithmParameterException`。
- 修复：加密改为 `cipher.init(ENCRYPT_MODE, key)` 后用 `cipher.iv` 取系统生成的 IV
  （这也从根上杜绝了 IV 复用）；解密方向仍显式传回存储的 IV。

### 4.3 WebView 静态资源映射错位

- 现象：页面显示 404，xterm 完全没加载。
- 根因：`WebViewAssetLoader.AssetsPathHandler` 把 URL 去掉注册前缀后**直接当
  assets 根下的路径**打开，它不会保留 `ui/` 这一层。
- 修复：改为自己实现映射（`/ui/xxx → assets/ui/xxx`，约 20 行），
  行为一眼可验证，并去掉了对这个 API 的依赖。

### 4.4 jsch 与 bcprov 的打包冲突

- 现象：`mergeDebugJavaResource FAILED` —— 两个 jar 都带
  `META-INF/versions/9/OSGI-INF/MANIFEST.MF`。
- 修复：`packaging.resources.excludes` 里排掉该条目。

### 4.5 API 签名靠猜（已改用 javap 核对）

- `KeyPair.getKeyType()` 返回的是 **int 常量**不是 `"ssh-ed25519"`（应为 `getKeyTypeString()`）
- `KeyPair` 没有 `setComment()`，是 `setPublicKeyComment()`
- `KeyPair.load()` **没有**「字节数组 + 口令」重载 → 导入加密私钥改走临时文件
  （文件权限收紧到仅本进程可读，用完立即删除）

### 4.6 手机 TUI 几何策略的可读性

- 现象：为凑够 80 列，字号被自动压到 **7px** —— 技术上"塞进去了"，实际没法看。
- 修复：引入 `readableMin: 10`，缩到可读下限就停，剩下的交给横向平移
  （实测 48 列屏幕 → 80 列 / 10px / pan=true）。

### 4.7 双重重连竞争

- 发现问题：Kotlin 的 `SshSession` 自己会重连，前端 `scheduleReconnect` 也会 ——
  两边同时触发会开出两条连接。
- 修复：原生模式下前端不再自行重连（Kotlin 能复用同一 sessionId，
  且 WebView 被系统冻结时仍能自愈）。

### 4.8 部署脚本会装旧包（测试基础设施的坑）

- 现象：加了依赖、构建其实在失败，而脚本只检查「APK 文件存在」就照装旧包，
  白跑三轮测试 —— 表面现象是「改了代码但行为没变」。
- 修复：门槛改为**只认 gradle 退出码**；产物时间戳未更新仅作为提示
  （构建 UP-TO-DATE 时产物本来就不变，那是正常状态，不能当失败）。

---

## 5. 资源消耗

全程 106 个采样点（`resource-timeline.csv`，10s 间隔，23:38:04 → 23:55:42）。

| 指标 | 最低 | 最高 | 结束 |
|---|---|---|---|
| 可用内存 | **697 MB** | 5252 MB | 1897 MB |
| 模拟器 qemu RSS | — | 3582 MB | 3141 MB |
| 本 Agent 相关进程 RSS | — | 687 MB | 621 MB |
| swap 剩余 | 1762 MB | 2375 MB | 1762 MB |

**没有触发内核 OOM**：`journalctl -k` 中 OOM/killed process 条目数为 0。

资源纪律（这台机器内存本来就紧：总量 7.8GB，模拟器单体 3.1GB 且容器 `MemLimit=0`
即**没有 cgroup 上限**，`vm.panic_on_oom=0` 意味着真撞上会直接触发 OOM killer）：

1. **构建前先停模拟器**腾出 3GB —— 实测可用内存 2024 MB → 5144 MB
2. 构建走 `--no-daemon` + `kotlin.compiler.execution.strategy=in-process`，
   全程只有一个 JVM，堆上限压到 1024m（峰值 java RSS 约 500-700MB）
3. 每步重活前过 `tools/resguard.sh check` 闸门，低于阈值直接拒绝执行
4. 全程后台采样记录曲线，可事后核对峰值
5. 结束后释放自己占用的资源

最低 697 MB 出现在「模拟器停掉后跑构建」那一轮，是预期内的谷值；
与模拟器并存的时段最低约 1200 MB，仍保有 1GB 以上余量。

---

## 6. 未覆盖 / 已知限制

- **未在真机上测过**：全部结论来自 x86_64 模拟器。真机的差异主要在
  StrongBox（模拟器只有 TEE）、Doze/电池优化策略、以及不同厂商 WebView 版本。
- **长时间保活未验证**：前台服务 + wake lock 的 Doze 免杀效果需要真机挂机数小时
  （模拟器不模拟 Doze）。配置已就位（`specialUse` 前台服务 + `PARTIAL_WAKE_LOCK`
  + jsch `serverAliveInterval`），但「挂一夜不断线」这次没有证据。
- **密码认证路径未测**：只测了公钥认证。
- **设备端生成密钥未测**：RSA 4096 在模拟器上生成会较慢，本次测的是导入路径。
- **Nerd Font 未内置**：`/ui/fonts/terminal.ttf` 返回 404 属预期
  （放一个 Nerd Font 进该路径即可补齐图标字形，代码会静默降级到系统等宽）。
- **`net::ERR_NAME_NOT_RESOLVED` 控制台噪音**：来自 WebView 自行发起的
  `/favicon.ico` 请求（不走 `shouldInterceptRequest`），不影响功能，未处理。
- **未做 UI 视觉验收**：本次全部是程序化断言（本模型无法看图），
  字体大小/间距/配色这类观感问题需要人眼确认。

---

## 7. 如何复现

```bash
cd /home/lwgat/hermes-pocket
tools/testssh.sh start          # 起测试用独立 sshd（127.0.0.1:2222，不需要 root）
tools/emu.sh start              # 若模拟器没在跑（属 notifbridge 项目）
tools/deploy.sh 1000            # 构建 + 安装 + 清数据 + 拉起 + 打开 CDP 通道
node tools/cdp.mjs --file /tmp/hpk-probe-integration.js --timeout 240000
```

协议级（不依赖模拟器）的回归测试另有一套，18 项：

```bash
node tools/e2e-web.mjs
```
