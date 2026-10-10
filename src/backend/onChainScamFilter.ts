/**
 * OnChainScamFilter & Economic Edge Gate
 * Ported from Rust Alpha-Flip HFT Engine (cabal.rs & economics.rs).
 * 
 * Checks:
 * 1. Metadata & Authority check: Reject if mint_authority != null or freeze_authority != null.
 * 2. Token-2022 Transfer Hook check: Reject tokens with transfer fee or transfer hook extensions.
 * 3. Buyer Clustering (Same-slot bundling): Reject if > 4 buys happen in the identical slot with identical amounts («Сговор создателя»).
 * 4. Creator holding check: Reject if creator holds > 15% outside bonding curve.
 * 5. Economic Edge Gate: Constant product x * y = k Price Impact calculation.
 *    Reject if Total Cost (Entry Impact + Exit Impact + DEX fee + Jito Tip + Slippage) > 4.5% («Ниже порога выгоды»).
 */

export interface TokenOnChainMeta {
  mint: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isToken2022: boolean;
  hasTransferHook: boolean;
  hasTransferFee: boolean;
  creatorAddress?: string;
  creatorHoldingPct?: number;
}

export interface SlotTransactionRecord {
  slot: number;
  wallet: string;
  amountSol: number;
  timestampMs: number;
}

export interface EconomicEdgeAssessment {
  passed: boolean;
  entryPriceImpactPct: number;
  exitPriceImpactPct: number;
  dexFeePct: number;
  jitoTipPct: number;
  slippagePct: number;
  totalLossPct: number;
  thresholdPct: number;
  reasonRu: string;
}

export interface FilterResult {
  passed: boolean;
  rejectReasonRu?: string;
  detailsRu?: string;
  code?: 'SCAM_AUTHORITY' | 'TOKEN2022_HOOK' | 'CABAL_SAME_SLOT' | 'CREATOR_HOLDING_HIGH' | 'LOW_ECONOMIC_EDGE';
}

export class OnChainScamFilter {
  // Cache of recent buy transactions per mint to detect same-slot cluster bundling
  private recentBuysByMint: Map<string, SlotTransactionRecord[]> = new Map();

  /**
   * Record a transaction for cluster analysis
   */
  public recordBuy(mint: string, tx: SlotTransactionRecord): void {
    if (this.recentBuysByMint.size > 200 && !this.recentBuysByMint.has(mint)) {
      const oldestKey = this.recentBuysByMint.keys().next().value;
      if (oldestKey) {
        this.recentBuysByMint.delete(oldestKey);
      }
    }

    let list = this.recentBuysByMint.get(mint);
    if (!list) {
      list = [];
      this.recentBuysByMint.set(mint, list);
    }
    list.push(tx);
    // Keep only last 50 transactions per token
    if (list.length > 50) {
      list.shift();
    }
  }

  /**
   * 1. Validate on-chain metadata and authorities
   */
  public evaluateMetadata(meta: TokenOnChainMeta): FilterResult {
    const isValidMeta = !!(meta && typeof meta === 'object' && (meta.mint || (meta as any).name || meta.creatorHoldingPct !== undefined));
    if (!isValidMeta) {
      return {
        passed: false,
        code: 'SCAM_AUTHORITY',
        rejectReasonRu: 'Некорректная метаинформация токена',
        detailsRu: 'Метаданные токена отсутствуют или не соответствуют требуемой структуре.',
      };
    }
    // 1a. Mint / Freeze Authority check
    if (meta.mintAuthority !== null && meta.mintAuthority !== undefined && meta.mintAuthority !== '') {
      return {
        passed: false,
        code: 'SCAM_AUTHORITY',
        rejectReasonRu: 'Скомпрометированный контракт: mint_authority не сожжен',
        detailsRu: `mint_authority активен (${meta.mintAuthority.slice(0, 8)}...). Создатель может бесконечно печатать токены.`,
      };
    }

    if (meta.freezeAuthority !== null && meta.freezeAuthority !== undefined && meta.freezeAuthority !== '') {
      return {
        passed: false,
        code: 'SCAM_AUTHORITY',
        rejectReasonRu: 'Скомпрометированный контракт: freeze_authority не сожжен (риск блокировки)',
        detailsRu: `freeze_authority активен (${meta.freezeAuthority.slice(0, 8)}...). Адрес может заблокировать продажу.`,
      };
    }

    // 1b. Token-2022 Transfer Hook & Fee check
    if (meta.isToken2022 && (meta.hasTransferHook || meta.hasTransferFee)) {
      return {
        passed: false,
        code: 'TOKEN2022_HOOK',
        rejectReasonRu: 'Скрытый налог Token-2022: обнаружен TransferHook или скрытая комиссия',
        detailsRu: 'Расширения Token-2022 содержат перехватчик трансфера (TransferHook), блокирующий продажи розничным трейдерам.',
      };
    }

    // 1c. Creator holding check: CTO Absorption Aware
    if (meta.creatorHoldingPct !== undefined && meta.creatorHoldingPct > 15) {
      const devSoldEst = (meta.creatorHoldingPct / 100) * 5; // estimated SOL
      const netInflow = (meta as any).netSolInflow10s || 0;
      if (netInflow > devSoldEst) {
        return {
          passed: true,
          rejectReasonRu: `⚡ CTO / Выкуп пролива: Дев вышел, чистый приток +${netInflow.toFixed(2)} SOL`,
        };
      }
      return {
        passed: false,
        code: 'CREATOR_HOLDING_HIGH',
        rejectReasonRu: 'Пролив создателя не выкуплен рынком',
        detailsRu: `Создатель продал/удерживает ${meta.creatorHoldingPct.toFixed(1)}%, приток (${netInflow.toFixed(2)} SOL) еще не поглотил объем дева.`,
      };
    }

    return { passed: true };
  }

  /**
   * 2. Detect same-slot buyer clustering (Cabal bundling)
   * If > 4 buys happen in the identical slot with identical amounts (within 0.005 SOL)
   */
  public evaluateBuyerClustering(mint: string): FilterResult {
    const buys = this.recentBuysByMint.get(mint);
    if (!buys || buys.length < 5) {
      return { passed: true };
    }

    // Group buys by slot
    const slotGroups = new Map<number, SlotTransactionRecord[]>();
    for (const b of buys) {
      const g = slotGroups.get(b.slot) || [];
      g.push(b);
      slotGroups.set(b.slot, g);
    }

    for (const [slot, slotBuys] of slotGroups.entries()) {
      if (slotBuys.length >= 4) {
        // Check if amounts are virtually identical (difference < 0.005 SOL)
        let identicalAmountCount = 1;
        const refAmount = slotBuys[0].amountSol;
        for (let i = 1; i < slotBuys.length; i++) {
          if (Math.abs(slotBuys[i].amountSol - refAmount) <= 0.005) {
            identicalAmountCount++;
          }
        }

        if (identicalAmountCount >= 4) {
          return {
            passed: false,
            code: 'CABAL_SAME_SLOT',
            rejectReasonRu: 'Сговор создателя: бандл-снайпинг в одном слоте',
            detailsRu: `Обнаружен бандл в слоте ${slot}: ${identicalAmountCount} адресов купили одинаковые объемы (${refAmount.toFixed(3)} SOL).`,
          };
        }
      }
    }

    return { passed: true };
  }

  /**
   * 3. Economic Edge Gate: Constant Product Price Impact calculation
   * Formula for constant product AMM / bonding curve (x * y = k):
   * dx = amountSol
   * x = currentSolReserve
   * Price Impact = dx / (x + dx)
   * 
   * Total Cost = Entry Impact + Exit Impact + DEX Fee (0.25% or 1%) + Jito Tip Pct + Slippage (1.0%)
   * Reject if Total Cost > 4.5%
   */
  public evaluateEconomicEdge(params: {
    tradeSizeSol: number;
    solReserve: number;
    jitoTipSol: number;
    dexFeePct?: number;
    slippagePct?: number;
  }): EconomicEdgeAssessment {
    const { tradeSizeSol, solReserve, jitoTipSol } = params;
    const dexFeePct = params.dexFeePct ?? 1.0; // 1% default on Pump.fun bonding curve or 0.25% Raydium
    const slippagePct = params.slippagePct ?? 1.0; // 1% standard slippage buffer

    if (solReserve <= 0 || tradeSizeSol <= 0) {
      return {
        passed: false,
        entryPriceImpactPct: 99,
        exitPriceImpactPct: 99,
        dexFeePct,
        jitoTipPct: 0,
        slippagePct,
        totalLossPct: 100,
        thresholdPct: 4.5,
        reasonRu: 'Ниже порога выгоды: нулевой резерв пула',
      };
    }

    // AMM Price Impact for Entry: dx / (x + dx)
    const entryImpact = (tradeSizeSol / (solReserve + tradeSizeSol)) * 100;

    // AMM Price Impact for Exit (approximate symmetrical reserve or after +10% price pump)
    const exitImpact = (tradeSizeSol / (solReserve + tradeSizeSol * 2)) * 100;

    // Jito Tip as % of trade size
    const jitoTipPct = (jitoTipSol / tradeSizeSol) * 100;

    // Total roundtrip drag / loss
    const totalLossPct = Number((entryImpact + exitImpact + dexFeePct + jitoTipPct + slippagePct).toFixed(2));
    const thresholdPct = 4.5;

    const passed = !isNaN(totalLossPct) && isFinite(totalLossPct) && totalLossPct <= thresholdPct;

    return {
      passed,
      entryPriceImpactPct: Number(entryImpact.toFixed(2)),
      exitPriceImpactPct: Number(exitImpact.toFixed(2)),
      dexFeePct,
      jitoTipPct: Number(jitoTipPct.toFixed(2)),
      slippagePct,
      totalLossPct,
      thresholdPct,
      reasonRu: passed
        ? `Выгода подтверждена: суммарные потери ${totalLossPct}% <= ${thresholdPct}%`
        : `Ниже порога выгоды: суммарные потери ${totalLossPct}% превышают лимит ${thresholdPct}% (Impact: ${(entryImpact + exitImpact).toFixed(2)}%, Jito: ${jitoTipPct.toFixed(2)}%, Слип: ${slippagePct}%)`,
    };
  }

  public clearMint(mint: string): void {
    this.recentBuysByMint.delete(mint);
  }
}
