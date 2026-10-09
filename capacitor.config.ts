import { CapacitorConfig } from '@capacitor/cli';

/**
 * CAPACITOR CONFIGURATION FOR ALPHA-FLIP v3.2
 * 
 * RUNTIME AUTONOMY CLAUSE v2:
 * Полный нативный хост на телефоне (Android APK/AAB).
 * Никаких внешних серверов, локальное прямое подключение к Solana RPC / Jito.
 */
const config: CapacitorConfig = {
  appId: 'com.alphaflip.solana.bot',
  appName: 'Alpha-Flip v3.2',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    cleartext: false, // Запрет незашифрованного HTTP трафика
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    // Настройки фонового сервиса и пробуждения процессора
    BackgroundRunner: {
      label: 'com.alphaflip.solana.bot.trading',
      src: 'dist/background.js',
      event: 'checkMemecoinSignals',
      repeat: true,
      interval: 15,
      autoStart: true,
    },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false, // Отключено в релизе для защиты памяти процесса
  },
};

export default config;
