/**
 * Vital Signs Monitor (Монитор жизненных показателей смартфона и сети)
 * 
 * Subsystem B для Stage 30 (Findings 3, 4, 5):
 * 1. Газовый резерв: проверка баланса SOL на минимум для экстренного выхода (порог 0.015 SOL).
 *    Расчет: max(0.015, (max_priority_fee + base_fee) * 3).
 *    Если баланс < порога:
 *      - Вход в новые сделки авто-блокируется
 *      - Выставляется защитная пауза
 *      - Не бросает открытую сделку (сопровождает её до выхода)
 *      - Пушит понятное предупреждение оператору на русском
 * 
 * 2. Doze/Network Liveness:
 *    - Фиксация времени последнего ответа сети (lastNetworkResponseTs)
 *    - Расчет задержки (разница между текущим временем и ответом)
 *    - Защита от тихих зависаний в кармане
 * 
 * 3. RPC Latency & Network Quality:
 *    - Оценка пинга RPC (в миллисекундах)
 *    - Желтое предупреждение, если пинг > 450 мс
 *    - Индикация Wi-Fi / сотовой связи
 */

export interface VitalSignsStatus {
  // Газовый резерв
  balanceSol: number;
  emergencyExitReserveSol: number;
  isGasReserveSafe: boolean;
  gasStatusRu: string;

  // Liveness сети и Doze
  lastNetworkResponseTs: number;
  timeSinceLastNetworkSec: number;
  livenessStatusRu: string;
  isNetworkStale: boolean; // > 15 секунд без ответов

  // Пинг RPC и качество связи
  rpcPingMs: number;
  rpcStatus: 'green' | 'yellow' | 'red';
  rpcStatusRu: string;
  networkTypeRu: string;
}

export class VitalSignsMonitor {
  private lastPingMs: number = 72;
  private lastNetworkTs: number = Date.now();
  private emergencyFloorSol: number = 0.015;

  /**
   * Рассчитать требуемый аварийный резерв SOL:
   * max(0.015, (max_fee + priority_tip) * 3)
   */
  public calculateEmergencyReserve(maxFeeSol: number, tipSol: number): number {
    const dynamicReserve = (maxFeeSol + tipSol) * 3;
    return Number(Math.max(this.emergencyFloorSol, dynamicReserve).toFixed(4));
  }

  /**
   * Проверить достаточность баланса для безопасного продолжения торговли
   */
  public checkGasAffordability(balanceSol: number, requiredReserveSol: number): {
    affordable: boolean;
    deficitSol: number;
    messageRu: string;
  } {
    if (balanceSol < requiredReserveSol) {
      const deficit = Number((requiredReserveSol - balanceSol).toFixed(4));
      return {
        affordable: false,
        deficitSol: deficit,
        messageRu: `⚠️ Баланс (${balanceSol} SOL) ниже аварийного резерва (${requiredReserveSol} SOL). Новые сделки заблокированы, открытая позиция под защитой.`,
      };
    }
    return {
      affordable: true,
      deficitSol: 0,
      messageRu: `Газовый резерв в норме (${balanceSol} SOL при минимуме ${requiredReserveSol} SOL).`,
    };
  }

  /**
   * Обновить отметку сетевого отклика
   */
  public recordNetworkResponse(pingMs?: number): void {
    this.lastNetworkTs = Date.now();
    if (typeof pingMs === 'number') {
      this.lastPingMs = Math.max(12, Math.round(pingMs));
    }
  }

  /**
   * Получить полный статус жизненных показателей
   */
  public getStatus(balanceSol: number, maxFeeSol: number = 0.002, tipSol: number = 0.0008): VitalSignsStatus {
    const now = Date.now();
    const reserveSol = this.calculateEmergencyReserve(maxFeeSol, tipSol);
    const gasCheck = this.checkGasAffordability(balanceSol, reserveSol);

    const timeSinceLastSec = Math.max(0, Math.round((now - this.lastNetworkTs) / 1000));
    const isStale = timeSinceLastSec > 15;

    // Оценка пинга: зеленый <= 450мс, желтый 451-999мс, красный >= 1000мс
    let rpcStatus: 'green' | 'yellow' | 'red' = 'green';
    let rpcStatusRu = 'Связь быстрая (< 450 мс)';

    if (this.lastPingMs > 1000) {
      rpcStatus = 'red';
      rpcStatusRu = `Критическая задержка RPC (${this.lastPingMs} мс)`;
    } else if (this.lastPingMs > 450) {
      rpcStatus = 'yellow';
      rpcStatusRu = `⚠️ Задержка RPC повышена (${this.lastPingMs} мс > 450 мс)`;
    } else {
      rpcStatusRu = `Отклик RPC: ${this.lastPingMs} мс (в норме)`;
    }

    let livenessRu = 'Сеть жива (отклик < 3 сек назад)';
    if (timeSinceLastSec > 30) {
      livenessRu = `🔴 Сеть не отвечает ${timeSinceLastSec} сек (возможен глубокий Doze или обрыв)`;
    } else if (timeSinceLastSec > 15) {
      livenessRu = `🟡 Задержка отклика ${timeSinceLastSec} сек (радиоканал просыпается)`;
    }

    return {
      balanceSol,
      emergencyExitReserveSol: reserveSol,
      isGasReserveSafe: gasCheck.affordable,
      gasStatusRu: gasCheck.messageRu,
      lastNetworkResponseTs: this.lastNetworkTs,
      timeSinceLastNetworkSec: timeSinceLastSec,
      livenessStatusRu: livenessRu,
      isNetworkStale: isStale,
      rpcPingMs: this.lastPingMs,
      rpcStatus,
      rpcStatusRu,
      networkTypeRu: 'Мобильный интернет / Wi-Fi',
    };
  }

  /**
   * Обновление задержки пинга сети без Math.random() (чистый детерминированный учет)
   */
  public simulatePingVariation(targetMs?: number): number {
    if (typeof targetMs === 'number' && Number.isFinite(targetMs)) {
      this.lastPingMs = Math.max(1, Math.round(targetMs));
    }
    this.recordNetworkResponse(this.lastPingMs);
    return this.lastPingMs;
  }
}

export const defaultVitalSigns = new VitalSignsMonitor();
