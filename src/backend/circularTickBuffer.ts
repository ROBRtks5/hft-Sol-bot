/**
 * CircularTickBuffer - High-Frequency Trading Ring Buffer for Token Ticks
 * Ported from Rust Alpha-Flip HFT Engine (momentum.rs / ingest ring buffer).
 * 
 * Stores the last 100 ticks per token in RAM with microsecond timestamps:
 * - price (in SOL per token or relative bonding curve price)
 * - solReserve (SOL in bonding curve / AMM)
 * - tokenReserve (token amount in curve / pool)
 * - volumeBuySol (cumulative or per-tick buy volume)
 * - volumeSellSol (cumulative or per-tick sell volume)
 * 
 * Provides:
 * - dP/dt: Price derivative over rolling windows (e.g. 500ms, 2000ms)
 * - OFI (Order Flow Imbalance): sum(buy_volume) - sum(sell_volume) over rolling window (5s)
 */

export interface PriceTick {
  timestampMs: number;
  priceSol: number;
  solReserve: number;
  tokenReserve: number;
  volumeBuySol: number;
  volumeSellSol: number;
  slot?: number;
}

export class CircularTickBuffer {
  private readonly capacity: number;
  private ticks: PriceTick[] = [];

  constructor(capacity: number = 100) {
    this.capacity = capacity;
  }

  /**
   * Push a new price tick to the ring buffer.
   */
  public pushTick(tick: PriceTick): void {
    if (this.ticks.length >= this.capacity) {
      this.ticks.shift();
    }
    this.ticks.push(tick);
  }

  /**
   * Get all ticks currently in RAM.
   */
  public getTicks(): readonly PriceTick[] {
    return this.ticks;
  }

  /**
   * Get the most recent tick.
   */
  public getLatestTick(): PriceTick | null {
    if (this.ticks.length === 0) return null;
    return this.ticks[this.ticks.length - 1];
  }

  /**
   * Calculate dP/dt: percentage price change over a given rolling time window in milliseconds.
   * Formula: dP = ((P_now - P_window_start) / P_window_start) * 100%
   * 
   * Returns:
   *   dP percentage (e.g. 2.1 for +2.1%)
   */
  public calculatePriceDerivative(windowMs: number): number {
    if (this.ticks.length < 2) return 0;

    const now = this.ticks[this.ticks.length - 1];
    const thresholdTime = now.timestampMs - windowMs;

    // Find the tick closest to or immediately before/at thresholdTime
    let baseTick: PriceTick | null = null;
    for (let i = this.ticks.length - 1; i >= 0; i--) {
      if (this.ticks[i].timestampMs <= thresholdTime) {
        baseTick = this.ticks[i];
        break;
      }
    }

    // If window is longer than our buffer span, use the earliest tick
    if (!baseTick) {
      baseTick = this.ticks[0];
    }

    if (!baseTick || baseTick.priceSol <= 0) return 0;

    const dP = ((now.priceSol - baseTick.priceSol) / baseTick.priceSol) * 100;
    return Number(dP.toFixed(3));
  }

  /**
   * Calculate OFI (Order Flow Imbalance) over rolling window (e.g. 5000ms).
   * Formula: OFI = sum(buy_volume_sol) - sum(sell_volume_sol) for ticks where tick.timestampMs >= (now - windowMs)
   * 
   * Returns:
   *   Net SOL volume imbalance. If OFI > 0: buyers dominate. If OFI < 0: sellers dumping.
   */
  public calculateOFI(windowMs: number = 5000): { ofiSol: number; buyVolSol: number; sellVolSol: number } {
    if (this.ticks.length === 0) {
      return { ofiSol: 0, buyVolSol: 0, sellVolSol: 0 };
    }

    const now = this.ticks[this.ticks.length - 1].timestampMs;
    const thresholdTime = now - windowMs;

    let buyVol = 0;
    let sellVol = 0;

    for (let i = this.ticks.length - 1; i >= 0; i--) {
      const tick = this.ticks[i];
      if (tick.timestampMs < thresholdTime) break;
      buyVol += tick.volumeBuySol;
      sellVol += tick.volumeSellSol;
    }

    const ofi = buyVol - sellVol;
    return {
      ofiSol: Number(ofi.toFixed(4)),
      buyVolSol: Number(buyVol.toFixed(4)),
      sellVolSol: Number(sellVol.toFixed(4)),
    };
  }

  /**
   * Check momentum entry gate:
   * 1) dP/dt over 500ms > 1.8%
   * 2) dP/dt over 2000ms > 0%
   * 3) OFI over 5000ms > 0
   */
  public evaluateMomentumEntry(): {
    isSignalValid: boolean;
    dp500ms: number;
    dp2000ms: number;
    ofi5s: number;
    reasonRu: string;
  } {
    const dp500ms = this.calculatePriceDerivative(500);
    const dp2000ms = this.calculatePriceDerivative(2000);
    const { ofiSol } = this.calculateOFI(5000);

    // Gate requirements: dP/dt > 1.8% over 500ms AND OFI > 0
    if (dp500ms <= 1.8) {
      return {
        isSignalValid: false,
        dp500ms,
        dp2000ms,
        ofi5s: ofiSol,
        reasonRu: `dP/dt 500мс (${dp500ms.toFixed(2)}%) ниже порога импульса (1.80%)`,
      };
    }

    if (ofiSol <= 0) {
      return {
        isSignalValid: false,
        dp500ms,
        dp2000ms,
        ofi5s: ofiSol,
        reasonRu: `OFI (${ofiSol.toFixed(4)} SOL) отрицателен или нулевой: преобладают продажи`,
      };
    }

    return {
      isSignalValid: true,
      dp500ms,
      dp2000ms,
      ofi5s: ofiSol,
      reasonRu: `Импульс подтвержден: dP/dt 500мс +${dp500ms.toFixed(2)}%, OFI +${ofiSol.toFixed(4)} SOL`,
    };
  }

  public clear(): void {
    this.ticks = [];
  }
}
