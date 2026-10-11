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
  buyerWallet?: string;
  slot?: number;
}

export function isBigIntType(val: unknown): boolean {
  return typeof val === 'bigint';
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

    if (!baseTick || baseTick.priceSol <= 0 || !now || now.priceSol <= 0) return 0;

    const dP = ((now.priceSol - baseTick.priceSol) / baseTick.priceSol) * 100;
    if (isNaN(dP) || !isFinite(dP)) return 0;
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
    if (isNaN(dp500ms) || !isFinite(dp500ms) || dp500ms <= 1.8) {
      return {
        isSignalValid: false,
        dp500ms: isNaN(dp500ms) ? 0 : dp500ms,
        dp2000ms: isNaN(dp2000ms) ? 0 : dp2000ms,
        ofi5s: isNaN(ofiSol) ? 0 : ofiSol,
        reasonRu: `dP/dt 500мс (${isNaN(dp500ms) ? '0' : dp500ms.toFixed(2)}%) ниже порога импульса (1.80%)`,
      };
    }

    if (isNaN(ofiSol) || !isFinite(ofiSol) || ofiSol <= 0) {
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

  /**
   * Calculate Net SOL Inflow and Count Unique Buyers over rolling window (e.g. 5000ms).
   * netSolInflow = sum(buySol) - sum(sellSol)
   * uniqueBuyersCount = count of unique wallet addresses making buys >= 0.01 SOL
   */
  public calculateNetInflowAndBuyers(windowMs: number = 5000): {
    netSolInflow: number;
    buyVolSol: number;
    sellVolSol: number;
    uniqueBuyersCount: number;
  } {
    if (this.ticks.length === 0) {
      return { netSolInflow: 0, buyVolSol: 0, sellVolSol: 0, uniqueBuyersCount: 0 };
    }

    const now = this.ticks[this.ticks.length - 1].timestampMs;
    const thresholdTime = now - windowMs;

    let buyVol = 0;
    let sellVol = 0;
    const uniqueBuyers = new Set<string>();

    for (let i = this.ticks.length - 1; i >= 0; i--) {
      const tick = this.ticks[i];
      if (tick.timestampMs < thresholdTime) break;

      buyVol += tick.volumeBuySol || 0;
      sellVol += tick.volumeSellSol || 0;

      if ((tick.volumeBuySol || 0) >= 0.01) {
        const walletKey = tick.buyerWallet || `buyer_${i}`;
        uniqueBuyers.add(walletKey);
      }
    }

    const netSolInflow = buyVol - sellVol;
    return {
      netSolInflow: Number(netSolInflow.toFixed(4)),
      buyVolSol: Number(buyVol.toFixed(4)),
      sellVolSol: Number(sellVol.toFixed(4)),
      uniqueBuyersCount: uniqueBuyers.size,
    };
  }

  /**
   * Get maximum price in rolling time window (e.g. 30000ms).
   */
  public getMaxPriceInWindow(windowMs: number = 30000): number {
    if (this.ticks.length === 0) return 0;
    const now = this.ticks[this.ticks.length - 1].timestampMs;
    const thresholdTime = now - windowMs;

    let maxPrice = 0;
    for (let i = this.ticks.length - 1; i >= 0; i--) {
      const tick = this.ticks[i];
      if (tick.timestampMs < thresholdTime) break;
      if (tick.priceSol > maxPrice) {
        maxPrice = tick.priceSol;
      }
    }
    return maxPrice;
  }

  /**
   * Strategy: Corridor Hunter 6-25 SOL & Net Inflow Analysis
   * Entry trigger requirements:
   * 1) Bonding curve reserve strictly in safe corridor: 6.0 - 25.0 SOL
   * 2) netSolInflow >= 1.5 SOL over 5s window
   * 3) uniqueBuyersCount >= 4 unique buyers with volume >= 0.01 SOL
   * 4) Current price is within 5% of max price over last 30s
   */
  public evaluateCorridorNetInflowEntry(bondingCurveSol?: number): {
    isSignalValid: boolean;
    bondingSol: number;
    netSolInflow: number;
    uniqueBuyersCount: number;
    priceNearPeak: boolean;
    reasonRu: string;
  } {
    const currentTick = this.getLatestTick();
    const currentBondingSol = bondingCurveSol ?? currentTick?.solReserve ?? currentTick?.priceSol ?? 0;

    // Strict Corridor check 6.0 - 25.0 SOL
    if (currentBondingSol < 6.0 || currentBondingSol > 25.0) {
      return {
        isSignalValid: false,
        bondingSol: currentBondingSol,
        netSolInflow: 0,
        uniqueBuyersCount: 0,
        priceNearPeak: false,
        reasonRu: `Вне коридора 6–25 SOL: баланс кривой ${currentBondingSol.toFixed(2)} SOL`,
      };
    }

    const { netSolInflow, uniqueBuyersCount } = this.calculateNetInflowAndBuyers(5000);
    const maxPrice30s = this.getMaxPriceInWindow(30000);
    const currentPrice = currentTick?.priceSol || 0;

    const priceNearPeak = maxPrice30s > 0 ? currentPrice >= maxPrice30s * 0.95 : true;

    if (netSolInflow < 1.5) {
      return {
        isSignalValid: false,
        bondingSol: currentBondingSol,
        netSolInflow,
        uniqueBuyersCount,
        priceNearPeak,
        reasonRu: `В фокусе: накопление притока (${netSolInflow.toFixed(2)} / 1.50 SOL)`,
      };
    }

    if (uniqueBuyersCount < 4) {
      return {
        isSignalValid: false,
        bondingSol: currentBondingSol,
        netSolInflow,
        uniqueBuyersCount,
        priceNearPeak,
        reasonRu: `Недостаточно покупателей (${uniqueBuyersCount} / 4 unique buyers)`,
      };
    }

    if (!priceNearPeak) {
      return {
        isSignalValid: false,
        bondingSol: currentBondingSol,
        netSolInflow,
        uniqueBuyersCount,
        priceNearPeak: false,
        reasonRu: `Цена откатилась более 5% от максимума 30с`,
      };
    }

    return {
      isSignalValid: true,
      bondingSol: currentBondingSol,
      netSolInflow,
      uniqueBuyersCount,
      priceNearPeak: true,
      reasonRu: `ВХОД ПО ПРИТОКУ: Кривая ${currentBondingSol.toFixed(1)} SOL, +${netSolInflow.toFixed(2)} SOL/5с, Покупателей: ${uniqueBuyersCount}`,
    };
  }

  /**
   * CTO (Community Takeover) Absorption Evaluator:
   * Dev dump does NOT disqualify coin if net inflow over 10s exceeds dev dump volume.
   */
  public evaluateCtoAbsorption(devSoldSol: number, windowMs: number = 10000): {
    isAbsorbed: boolean;
    netInflow10s: number;
    devSoldSol: number;
    reasonRu: string;
  } {
    const { netSolInflow } = this.calculateNetInflowAndBuyers(windowMs);
    const isAbsorbed = netSolInflow > devSoldSol;
    return {
      isAbsorbed,
      netInflow10s: netSolInflow,
      devSoldSol,
      reasonRu: isAbsorbed
        ? `⚡ CTO АБСОРБЦИЯ: Сброс дева ${devSoldSol.toFixed(2)} SOL поглощен рынком (приток +${netSolInflow.toFixed(2)} SOL)`
        : `Пролив дева не поглощен: сброс ${devSoldSol.toFixed(2)} SOL превышает приток +${netSolInflow.toFixed(2)} SOL`,
    };
  }

  public clear(): void {
    this.ticks = [];
  }
}
