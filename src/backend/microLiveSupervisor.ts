import {
  KeySelectionType,
  MicroLiveSupervisorState,
  MicroLiveTradeRecord,
} from '../types/backend';

export class MicroLiveSupervisor {
  private state: MicroLiveSupervisorState;

  constructor() {
    this.state = {
      activeKeyType: 'WORKING_KEY',
      workingKeyPubkey: '',
      probeKeyPubkey: '',
      activePubkey: '',
      balanceSol: 0,
      maxTradeSol: 0.02, // Жесткий лимит размера сделки (0.01 - 0.05)
      dailyTradesCount: 0,
      maxDailyTrades: 5, // Жесткий лимит сделок на первое окно
      dailyLossSol: 0,
      maxDailyLossSol: 0.04, // Строгий суточный стоп-лосс
      consecutiveLosses: 0,
      maxConsecutiveLosses: 3,
      narrativeMultiplier: 1.0, // Ограничение доверия нарративу [1.0 - 1.1]
      trades: [],
      deviationSummaryRu: 'Ожидание боевых сделок для расчета фактического проскальзывания.',
      overallDeviationStatus: 'MATCHES',
      netPnLSol: 0,
      winratePct: 0,
      capsulesCount: 0,
      candidateHypothesesCount: 0,
      pendingConfirmationCount: 0,
      pendingConfirmationListRu: [],
      keepAwakeIncidents: [],
      verdictRu:
        'Режим микро-торговли готов. Ожидание сигналов из реального WebSocket / gRPC стрима.',
    };
  }

  public getState(): MicroLiveSupervisorState {
    return { ...this.state };
  }

  public setKeySelection(keyType: KeySelectionType, realPubkey?: string, realBalance?: number): MicroLiveSupervisorState {
    this.state.activeKeyType = keyType;
    if (realPubkey) {
      this.state.activePubkey = realPubkey;
      if (keyType === 'PROBE_KEY') {
        this.state.probeKeyPubkey = realPubkey;
      } else {
        this.state.workingKeyPubkey = realPubkey;
      }
    }
    if (typeof realBalance === 'number') {
      this.state.balanceSol = realBalance;
    }
    return this.getState();
  }

  public addTradeRecord(record: MicroLiveTradeRecord): MicroLiveSupervisorState {
    this.state.trades.unshift(record);
    this.state.dailyTradesCount = Math.min(
      this.state.maxDailyTrades,
      this.state.dailyTradesCount + 1
    );
    this.state.capsulesCount++;
    this.state.netPnLSol = Number((this.state.netPnLSol + record.netPnLSol).toFixed(5));
    const wins = this.state.trades.filter((t) => t.netPnLSol > 0).length;
    this.state.winratePct = Number(((wins / this.state.trades.length) * 100).toFixed(1));
    return this.getState();
  }

  public checkInvariants(pnlInput?: any): { safeToTrade: boolean; reasonRu?: string } {
    const pnl = Number(pnlInput) || 0;
    if (isNaN(pnl)) {
      return { safeToTrade: false, reasonRu: 'Недопустимое числовое значение PnL' };
    }
    if (this.state.consecutiveLosses >= this.state.maxConsecutiveLosses) {
      return { safeToTrade: false, reasonRu: `Достигнут лимит убыточных сделок подряд (${this.state.consecutiveLosses}/${this.state.maxConsecutiveLosses})` };
    }
    if (this.state.dailyLossSol >= this.state.maxDailyLossSol) {
      return { safeToTrade: false, reasonRu: `Достигнут дневной лимит убытка (${this.state.dailyLossSol.toFixed(4)} SOL)` };
    }
    return { safeToTrade: true };
  }

  public setRiskLimits(limits: { maxTradeSol?: number; maxDailyLossSol?: number; maxConsecutiveLosses?: number }): MicroLiveSupervisorState {
    if (typeof limits.maxTradeSol === 'number') {
      this.state.maxTradeSol = limits.maxTradeSol;
    }
    if (typeof limits.maxDailyLossSol === 'number') {
      this.state.maxDailyLossSol = limits.maxDailyLossSol;
    }
    if (typeof limits.maxConsecutiveLosses === 'number') {
      this.state.maxConsecutiveLosses = limits.maxConsecutiveLosses;
    }
    return this.getState();
  }
}

export const defaultMicroLiveSupervisor = new MicroLiveSupervisor();
