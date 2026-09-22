package dev.hermes.pocket

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * WebView 外壳。
 *
 * 安全设计的几条硬决定：
 *   1) 前端不放在 file:// 上，而是走 WebViewAssetLoader 提供的
 *      https://appassets.androidplatform.net —— 这是个**安全源**，
 *      file:// 源在 WebView 里既拿不到 crypto.subtle，也容易和文件系统纠缠。
 *   2) 用 WebViewCompat.addWebMessageListener 做 JS↔原生通道，而不是
 *      @JavascriptInterface —— 后者会往 JS 全局挂一个可反射的对象；
 *      addWebMessageListener 只对**指定源**开放，注入面更小。
 *      （保留 @JavascriptInterface 兜底路径，给不支持该特性的老 WebView。）
 *   3) 禁止一切外部导航、禁文件访问、禁混合内容：这个 App 只加载自己的资源。
 */
class MainActivity : android.app.Activity() {

    private lateinit var web: WebView
    @Volatile private var proxy: JavaScriptReplyProxy? = null

    private val assetHost = "appassets.androidplatform.net"
    private val origin get() = "https://$assetHost"

    /**
     * 自己实现静态资源映射，不用 WebViewAssetLoader 的 AssetsPathHandler。
     *
     * 原因：AssetsPathHandler 把 URL 去掉注册前缀后**直接当 assets 根下的路径**打开，
     * 注册 "/ui/" 会去开 assets/index.html（不存在）—— 它不会保留 ui/ 这一层。
     * 这里自己剥前缀，映射关系一眼可验证：/ui/xxx → assets/ui/xxx。
     */
    private val MIME = mapOf(
        "html" to "text/html", "js" to "text/javascript", "css" to "text/css",
        "json" to "application/json", "ttf" to "font/ttf", "woff2" to "font/woff2",
        "svg" to "image/svg+xml", "png" to "image/png", "map" to "application/json"
    )

    private fun serveAsset(path: String): WebResourceResponse {
        // URL /ui/xxx  →  assets/ui/xxx（只剥前导斜杠，保留 ui/ 这一层）
        val rel = path.trimStart('/').ifEmpty { "ui/index.html" }
        val ext = rel.substringAfterLast('.', "").lowercase()
        val mime = MIME[ext] ?: "application/octet-stream"
        return try {
            val stream = assets.open(rel)
            WebResourceResponse(mime, if (mime.startsWith("text/") || mime.contains("json")) "utf-8" else null,
                200, "OK", mapOf("Cache-Control" to "no-store"), stream)
        } catch (t: Throwable) {
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                emptyMap(), java.io.ByteArrayInputStream("404 $rel".toByteArray()))
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.setBackgroundColor(0xFF080C11.toInt())
        setContentView(web)

        configure(web)
        wireChannel(web)

        current = this
        web.loadUrl("$origin/ui/index.html")
        askNotificationPermission()
    }

    /* ------------------------------------------------------ WebView 配置 */

    @Suppress("DEPRECATION")
    private fun configure(w: WebView) {
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            // 只加载自带资源，因此把所有能碰到本地/远程文件的口子都关掉
            allowFileAccess = false
            allowContentAccess = false
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_NO_CACHE
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = true
            useWideViewPort = false
            loadWithOverviewMode = false
            textZoom = 100
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) w.settings.safeBrowsingEnabled = true
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        w.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, req: WebResourceRequest): WebResourceResponse? {
                val u = req.url
                if (u.host == assetHost && (u.path ?: "").startsWith("/ui/")) return serveAsset(u.path!!)
                return null
            }

            override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest): Boolean {
                // 前端是单页应用，任何跳出去都不该发生；拦掉（返回 true = 不导航）
                return req.url.host != assetHost
            }
        }
    }

    private fun wireChannel(w: WebView) {
        // 原生 → JS 统一走这里；replyProxy 只能在主线程用
        Bridge.attach(this) { s -> runOnUiThread { proxy?.postMessage(s) } }

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                w, "HermesPocket", setOf(origin),
                object : WebViewCompat.WebMessageListener {
                    override fun onPostMessage(
                        view: WebView, message: WebMessageCompat, sourceOrigin: Uri,
                        isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy
                    ) {
                        proxy = replyProxy
                        message.data?.let { Bridge.handle(it) }
                    }
                }
            )
        } else {
            // 老 WebView 兜底：@JavascriptInterface + HP.recv()
            w.addJavascriptInterface(NativeFallback(), "PocketNative")
        }
    }

    /** 仅在没有 addWebMessageListener 的设备上使用 */
    inner class NativeFallback {
        @JavascriptInterface
        fun send(msg: String) { Bridge.handle(msg) }

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
    }

    /** 供 Bridge 调用：用户第一次可能点了"不允许"，得能从设置里再申请一次 */
    fun askNotifications() = askNotificationPermission()

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 1001) return
        val ok = grantResults.isNotEmpty() && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED
        // 结果告诉前端：好更新设置面板里的状态，并在授权成功时立刻发一条测试通知
        evalJs("(function(){try{return HP.App.onNotifyPermission(${if (ok) "true" else "false"})}catch(e){return '0'}})()") { }
    }

    /* -------------------------------------------------------------- 返回键 */

    @Deprecated("Activity.onBackPressed 已弃用，但这里行为明确且无依赖")
    override fun onBackPressed() {
        // 先让 JS 处理（关面板/退出沉浸），它返回 "0" 表示它也处理不了 → 退出
        web.evaluateJavascript(
            "(function(){try{return (window.HP&&HP.App&&HP.App.onBack)?(HP.App.onBack()?'1':'0'):'0'}catch(e){return '0'}})()"
        ) { r ->
            if (r == null || r.contains("0")) { if (!web.canGoBack()) finish() else super.onBackPressed() }
        }
    }

    /**
     * 生命周期与 WebView 的关系（这里刻意**不**调 web.onPause）。
     *
     * 踩过的坑：一开始在 onPause 里调了 web.onPause()，
     * 而只要有任何系统窗口盖到上面（权限弹窗、安装器、分屏切换……），
     * Activity 就会被 paused → WebView 被冻住 → 定时器/rAF 全停，
     * 终端不再刷新、键条布局也不再更新。实测被 GrantPermissionsActivity 盖住后
     * rAF 帧数为 0、setInterval 一次都没触发，整个界面看起来就是「卡死不刷新」。
     *
     * 对终端类应用来说，会话和画面都必须一直活着（Termux 是前台服务 + 原生渲染，
     * 天然不会被冻），所以这里只做「恢复动作」，绝不让 WebView 进入暂停态。
     */
    override fun onResume() {
        super.onResume()
        Notify.setForeground(true)
        try { web.onResume() } catch (t: Throwable) {}
        try { web.resumeTimers() } catch (t: Throwable) {}
        web.postDelayed({
            try {
                web.evaluateJavascript(
                    "(function(){try{return (window.HP&&HP.App&&HP.App.onAppResume)?HP.App.onAppResume():'no'}catch(e){return 'err:'+(e&&e.message)}})()"
                ) { _ -> }
            } catch (t: Throwable) {}
        }, 120)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // 从系统弹窗回来时焦点会变，顺手再唤醒一次，兜住「静默冻结」
        if (hasFocus) {
            try { web.onResume() } catch (t: Throwable) {}
            try { web.resumeTimers() } catch (t: Throwable) {}
            web.postDelayed({
                try {
                    web.evaluateJavascript(
                        "(function(){try{return (window.HP&&HP.App&&HP.App.onAppResume)?HP.App.onAppResume():'no'}catch(e){return 'e'}})()"
                    ) { _ -> }
                } catch (t: Throwable) {}
            }, 200)
        }
    }

    override fun onPause() {
        // 只通知 JS 记个时间点，**不暂停 WebView**（见上面的说明）
        Notify.setForeground(false)
        try {
            web.evaluateJavascript(
                "(function(){try{return (window.HP&&HP.App&&HP.App.onAppPause)?HP.App.onAppPause():'no'}catch(e){return 'e'}})()", null
            )
        } catch (t: Throwable) {}
        super.onPause()
    }

    /** 点通知回到 App：告诉 JS 是哪类事件，让它把会话/焦点摆好 */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val kind = intent.getStringExtra("hpk_kind") ?: "open"
        Notify.setForeground(true)
        web.postDelayed({
            try {
                web.evaluateJavascript(
                    "(function(){try{return (window.HP&&HP.App&&HP.App.onNotifyTap)?HP.App.onNotifyTap(${JSONObject.quote(kind)}):'no'}catch(e){return 'e'}})()"
                ) { _ -> }
            } catch (t: Throwable) {}
        }, 250)
    }

    override fun onDestroy() {
        if (current === this) current = null
        try { web.destroy() } catch (t: Throwable) { }
        super.onDestroy()
    }

    /** 供测试/诊断：当前 WebView 里的状态快照 */
    fun evalJs(js: String, cb: (String?) -> Unit) = web.evaluateJavascript(js) { cb(it) }

    companion object {
        /** 当前 Activity 实例，给 Bridge 用来发起"运行时权限申请 / 打开系统设置" */
        @Volatile var current: MainActivity? = null
        fun raw(o: Any): String = JSONObject.quote(o.toString())
    }
}
