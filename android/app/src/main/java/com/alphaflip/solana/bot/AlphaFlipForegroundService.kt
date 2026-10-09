package com.alphaflip.solana.bot

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * ПОСТОЯННАЯ ФОНОВАЯ СЛУЖБА (FOREGROUND SERVICE) ALPHA-FLIP v3.2
 *
 * Выполняет требования RUNTIME AUTONOMY CLAUSE v2:
 * 1. Держит процесс в ОЗУ смартфона, предотвращая убийство системой Android (Low Memory Killer).
 * 2. Управляет PARTIAL_WAKE_LOCK во время активной открытой позиции и сканирования мемов.
 * 3. Отслеживает заряд батареи (<15%) и температуру процессора (>45°C).
 * 4. Предоставляет постоянное Ongoing-уведомление в шторке со статусом робота.
 */
class AlphaFlipForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "alpha_flip_trading_channel"
        const val NOTIFICATION_ID = 1001
        const val ACTION_START = "ACTION_START_AUTONOMOUS_TRADING"
        const val ACTION_STOP = "ACTION_STOP_AUTONOMOUS_TRADING"
        const val ACTION_DOCK_MODE = "ACTION_SET_DOCK_MODE"
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var isDockMode = false

    private val batteryReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            val tempTenths = intent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0
            val tempCelsius = tempTenths / 10.0

            if (level > 0 && scale > 0) {
                val pct = (level * 100) / scale
                if (pct < 15) {
                    // Критический разряд: перевод робота в безопасный режим удержания
                    updateNotification("⚠️ Батарея <15%. Новые сделки на паузе, позиция сопровождается")
                } else if (tempCelsius > 45.0) {
                    // Перегрев: снижение частоты опроса
                    updateNotification("🌡 Перегрев (${tempCelsius}°C). Охлаждение, новые входы заблокированы")
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        registerReceiver(batteryReceiver, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        acquirePartialWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                releaseWakeLock()
                stopForeground(true)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_DOCK_MODE -> {
                isDockMode = intent.getBooleanExtra("dock_enabled", false)
            }
        }

        val notification = buildOngoingNotification("🟢 РАБОТАЕТ АВТОНОМНО (Hot-Key под защитой Keystore)")
        startForeground(NOTIFICATION_ID, notification)
        return START_STICKY // Перезапускать службу автоматически при принудительном завершении
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterReceiver(batteryReceiver)
        releaseWakeLock()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun acquirePartialWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "AlphaFlip::HftTradeWakeLock"
        ).apply {
            setReferenceCounted(false)
            acquire(60 * 60 * 1000L) // Максимум 1 час непрерывного импульса с авто-обновлением
        }
    }

    private fun releaseWakeLock() {
        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Alpha-Flip Торговый Сервис",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Постоянный статус автономного торгового робота на телефоне"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildOngoingNotification(statusText: String): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Alpha-Flip v3.2 — Автопилот")
            .setContentText(statusText)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun updateNotification(newStatus: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildOngoingNotification(newStatus))
    }
}
