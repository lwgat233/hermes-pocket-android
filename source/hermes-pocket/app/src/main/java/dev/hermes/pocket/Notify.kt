package dev.hermes.pocket

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/**
 * 终端事件通知。
 *
 * 手机端跑 SSH 最实际的两个需求：
 *   1) 长命令跑完要知道（把手机放下，回来一看通知就行）
 *   2) 需要授权 / 连接出问题要知道（不然就是"静默失败"，回来只看到一片黑）
 *
 * 三条纪律：
 *   · App 在前台时默认**不发**（用户正看着，弹通知是噪音）；只有 urgent 才穿透。
 *   · 同类事件做节流，避免刷屏（比如某个程序疯狂输出 BEL）。
 *   · 没拿到通知权限就安静地不发，不抛异常。
 */
object Notify {
    const val CHANNEL = "hpk-events"

    @Volatile private var foreground = false
    private val lastAt = HashMap<String, Long>()
    private val minGap = mapOf(
        "bell" to 3000L,
        "osc" to 800L,
        "done" to 3000L,
        "attention" to 12000L,
        "conn" to 5000L
    )

    fun setForeground(b: Boolean) { foreground = b }
    fun isForeground(): Boolean = foreground

    fun granted(ctx: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 33)
            ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        else true

    fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL) != null) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "终端事件", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "命令完成、需要授权、连接状态变化"
                enableVibration(true)
            }
        )
    }

    /** 返回是否真的发出去了（前台抑制/节流/无权限都会返回 false） */
    fun post(ctx: Context, kind: String, title: String, body: String, urgent: Boolean): Boolean {
        if (foreground && !urgent) return false
        if (!granted(ctx)) return false
        val now = System.currentTimeMillis()
        val gap = minGap[kind] ?: 2000L
        synchronized(lastAt) {
            if (now - (lastAt[kind] ?: 0L) < gap) return false
            lastAt[kind] = now
        }
        ensureChannel(ctx)

        val i = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("hpk_kind", kind)
        }
        val pi = PendingIntent.getActivity(
            ctx, kind.hashCode(), i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title.ifEmpty { "Hermes Pocket" })
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setWhen(now)
            .build()
        return try {
            (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(kind.hashCode(), n)
            true
        } catch (t: Throwable) {
            false
        }
    }
}
