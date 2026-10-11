/**
 * Тактильный отклик (Haptic Feedback / Вибрация)
 * Поддерживает мобильные браузеры и Android WebView с безопасным фоллбэком.
 * 
 * - 10 мс: обычные клики, табы, переключение кнопок настроек (light / selection)
 * - 25 мс: сохранение настроек, переключение режимов (medium / success)
 * - 40 мс: ошибки, экстренный стоп, стоп-лосс (heavy / error)
 */

export type HapticType = 'light' | 'medium' | 'heavy' | 'selection' | 'error' | 'success';

export function hapticFeedback(type: HapticType = 'light'): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
      switch (type) {
        case 'light':
        case 'selection':
          navigator.vibrate(10);
          break;
        case 'medium':
        case 'success':
          navigator.vibrate(25);
          break;
        case 'heavy':
        case 'error':
          navigator.vibrate(40);
          break;
        default:
          navigator.vibrate(10);
          break;
      }
    }
  } catch {
    // Безопасный no-op: предотвращает падение на устройствах без вибромотора
  }
}

/**
 * Прямой вызов вибрации с произвольной задержкой в миллисекундах
 */
export function triggerVibration(durationMs: number): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator && typeof navigator.vibrate === 'function') {
      navigator.vibrate(durationMs);
    }
  } catch {
    // no-op
  }
}
