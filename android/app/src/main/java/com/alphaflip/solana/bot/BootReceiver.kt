package com.alphaflip.solana.bot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * РЕСИВЕР АВТО-ВОССТАНОВЛЕНИЯ ПОСЛЕ ПЕРЕЗАГРУЗКИ ТЕЛЕФОНА (BOOT_COMPLETED)
 *
 * Если телефон перезагрузился (ночью или из-за обновления ОС), данный ресивер
 * моментально поднимает защищенную службу Alpha-Flip, восстанавливает сессию
 * и возобновляет контроль над лимитами и открытыми позициями.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED ||
            intent?.action == "android.intent.action.QUICKBOOT_POWERON") {
            
            context?.let { ctx ->
                val serviceIntent = Intent(ctx, AlphaFlipForegroundService::class.java).apply {
                    action = AlphaFlipForegroundService.ACTION_START
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(serviceIntent)
                } else {
                    ctx.startService(serviceIntent)
                }
            }
        }
    }
}
