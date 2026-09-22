package dev.hermes.pocket

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * 前台服务 —— 「长期链接」的宿主保障。
 *
 * 为什么必须要有：
 *   - Doze / 应用待机 会掐掉后台 App 的网络和 CPU。SSH 长连接如果跑在一个后台
 *     Activity 里，息屏几分钟就断。前台服务 + PARTIAL_WAKE_LOCK 是被系统允许的
 *     长期持网方式。
 *   - Android 14 要求声明 foregroundServiceType；这里用 specialUse（常驻交互式
 *     会话，不属于 dataSync 等既有类型）。
 *
 * 资源纪律：wake lock 只在真的有会话时持有 —— 会话结束立刻释放，
 * 否则会变成「明明断了还一直吊着 CPU」的耗电怪。
 */
class SessionService : Service() {

    companion object {
        const val CHANNEL_ID = "hpk_session"
        private const val NOTIF_ID = 0x4850  // "HP"
        private var started = false

        @Volatile var keepAwake: Boolean = true

        /**
         * 省电：由前端在"息屏/后台"时置位。
         *
         * 它**不是**断开连接 —— TCP socket 由内核维持着，睡着的只是"我们自己的 CPU 时间"：
         *   · 放开 PARTIAL_WAKE_LOCK，让 CPU 真的能睡；
         *   · 停掉 SSH 层心跳（应用层定时器都要唤醒 CPU）；
         *   · 暂缓自动重连（睡着时反复重连是最费电的：每次唤醒 CPU + 电台）。
         * 亮屏回来前端立刻关掉省电，并用既有的环形缓冲把睡着期间漏掉的输出补回来。
         */
        @Volatile var powerSave: Boolean = false

        @Volatile private var instance: SessionService? = null

        /** 静态入口：Bridge 只能拿到 object，拿不到 Service 实例 */
        fun applyWake() { instance?.syncWake() }

        fun applyPowerSave(on: Boolean) {
            powerSave = on
            instance?.syncWake()
        }

        fun wakeHeld(): Boolean = instance?.wake?.isHeld == true

        /** 屏幕是不是亮着（省电判断的兜底：前端叫醒之前，原生自己也能看出来） */
        fun screenOn(ctx: Context): Boolean = try {
            (ctx.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
        } catch (t: Throwable) { true }

        fun start(ctx: Context?, text: String) {
            val c = ctx ?: return
            try {
                val i = Intent(c, SessionService::class.java).putExtra("text", text)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) c.startForegroundService(i)
                else c.startService(i)
                started = true
            } catch (t: Throwable) { /* 后台启动受限时忽略，连接本身不受影响 */ }
        }

        fun stop(ctx: Context?) {
            val c = ctx ?: return
            if (!started) return
            started = false
            try { c.stopService(Intent(c, SessionService::class.java)) } catch (t: Throwable) {}
        }
    }

    private var wake: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, getString(R.string.fgs_channel), NotificationManager.IMPORTANCE_LOW)
                    .apply { description = "SSH 长连接保持"; setShowBadge(false) }
            )
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val text = intent?.getStringExtra("text") ?: "SSH 会话"
        startForeground(NOTIF_ID, notification(text))
        syncWake()
        return START_STICKY
    }

    private fun notification(text: String): Notification {
        val open = android.app.PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.fgs_title))
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
    }

    private fun syncWake() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        // 省电期间**主动放开** CPU 唤醒锁：连接靠内核持有的 socket 活着，
        // 不需要我们一直把 CPU 拽着（那才是待机耗电大头）。
        if (keepAwake && !powerSave) {
            if (wake == null) {
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "hermes-pocket:ssh")
                wake?.setReferenceCounted(false)
            }
            // 无超时的 wake lock 只在会话存续期间持有
            if (wake?.isHeld == false) wake?.acquire()
        } else releaseWake()
    }

    private fun releaseWake() {
        try { if (wake?.isHeld == true) wake?.release() } catch (t: Throwable) {}
        wake = null
    }

    override fun onDestroy() {
        releaseWake()
        if (instance === this) instance = null
        super.onDestroy()
    }
}
