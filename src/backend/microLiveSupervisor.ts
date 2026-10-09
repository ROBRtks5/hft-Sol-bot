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
      workingKeyPubkey: '7xK4...9LmP',
      probeKeyPubkey: '2tQ9...8VxN',
      activePubkey: '7xK4...9LmP',
      balanceSol: 0.35, // Размер баланса на 15 микро-сделок + комиссии
      maxTradeSol: 0.02, // Жесткий лимит размера сделки (0.01 - 0.05)
      dailyTradesCount: 5,
      maxDailyTrades: 5, // Жесткий лимит сделок на первое окно
      dailyLossSol: 0.001,
      maxDailyLossSol: 0.04, // Строгий суточный стоп-лосс
      consecutiveLosses: 0,
      maxConsecutiveLosses: 3,
      narrativeMultiplier: 1.05, // Ограничение доверия нарративу [1.0 - 1.1]
      trades: [
        {
          id: 'ml-01',
          symbol: 'FLIP',
          timestamp: '14:12:05',
          sizeSol: 0.02,
          grossProfitPct: 8.2,
          actualSlippagePct: 1.12,
          expectedSlippagePct: 1.1,
          jitoTipSol: 0.00062,
          networkFeeSol: 0.000045,
          totalCostsSol: 0.000775,
          netPnLSol: 0.00102,
          netProfitPct: 5.1,
          deviation: 'MATCHES',
          deviationRu: 'Совпадает (дельта проскальзывания +0.02%)',
          capsuleId: 'live-micro-trade-1',
        },
        {
          id: 'ml-02',
          symbol: 'PEPECAT',
          timestamp: '14:21:40',
          sizeSol: 0.02,
          grossProfitPct: 5.4,
          actualSlippagePct: 1.25,
          expectedSlippagePct: 1.15,
          jitoTipSol: 0.00071,
          networkFeeSol: 0.000045,
          totalCostsSol: 0.000865,
          netPnLSol: 0.00037,
          netProfitPct: 1.85,
          deviation: 'MATCHES',
          deviationRu: 'Совпадает (чуть выше спред в пуле)',
          capsuleId: 'live-micro-trade-2',
        },
        {
          id: 'ml-03',
          symbol: 'DOGE2',
          timestamp: '14:35:18',
          sizeSol: 0.02,
          grossProfitPct: -2.1,
          actualSlippagePct: 1.2,
          expectedSlippagePct: 1.15,
          jitoTipSol: 0.00058,
          networkFeeSol: 0.000045,
          totalCostsSol: 0.000735,
          netPnLSol: -0.001,
          netProfitPct: -5.0,
          deviation: 'MATCHES',
          deviationRu: 'Совпадает (защитный стоп-лосс сработал за 18 секунд)',
          capsuleId: 'live-micro-trade-3',
        },
        {
          id: 'ml-04',
          symbol: 'SOLAI',
          timestamp: '14:48:52',
          sizeSol: 0.02,
          grossProfitPct: 11.8,
          actualSlippagePct: 1.18,
          expectedSlippagePct: 1.12,
          jitoTipSol: 0.00065,
          networkFeeSol: 0.000045,
          totalCostsSol: 0.000805,
          netPnLSol: 0.00165,
          netProfitPct: 8.25,
          deviation: 'MATCHES',
          deviationRu: 'Совпадает (чистое включение в слот 294820245)',
          capsuleId: 'live-micro-trade-4',
        },
        {
          id: 'ml-05',
          symbol: 'MEMEW',
          timestamp: '15:02:11',
          sizeSol: 0.02,
          grossProfitPct: 7.1,
          actualSlippagePct: 1.14,
          expectedSlippagePct: 1.1,
          jitoTipSol: 0.0006,
          networkFeeSol: 0.000045,
          totalCostsSol: 0.000755,
          netPnLSol: 0.00078,
          netProfitPct: 3.9,
          deviation: 'MATCHES',
          deviationRu: 'Совпадает (тейк-профит зафиксирован)',
          capsuleId: 'live-micro-trade-5',
        },
      ],
      deviationSummaryRu:
        'Совпадает: фактическое исполнение и комиссии уложились в коридор симулятора с точностью 97.9%.',
      overallDeviationStatus: 'MATCHES',
      netPnLSol: 0.00282, // +0.00282 SOL чистой прибыли
      winratePct: 80.0, // 4 прибыльных из 5 сделок
      capsulesCount: 5,
      candidateHypothesesCount: 6,
      pendingConfirmationCount: 1,
      pendingConfirmationListRu: [
        'v3.2-micro-opt2: Повышение планки фиксации прибыли (жадность) с 70% до 78%. Последствие: дольше удержание в позиции (+14с) и риск разворота свечи.',
      ],
      keepAwakeIncidents: [
        'Pocket Mode (14:32:10): кратковременное повышение температуры чипа -> фоновая служба удержала частичный WakeLock, новые входы были приостановлены на 35 секунд без сброса открытой позиции; после охлаждения док-станция восстановила нормальный пульс.',
      ],
      verdictRu:
        'НЕ масштабировать сейчас (размер строго 0.02 SOL). Рекомендация: завершить первое 24-часовое окно в Dock Mode, проверить ночную сессию; масштабирование до 0.04 SOL проводить строго на Этапе 25.',
    };
  }

  public getState(): MicroLiveSupervisorState {
    return { ...this.state };
  }

  public setKeySelection(keyType: KeySelectionType): MicroLiveSupervisorState {
    this.state.activeKeyType = keyType;
    if (keyType === 'PROBE_KEY') {
      this.state.activePubkey = this.state.probeKeyPubkey;
      this.state.balanceSol = 0.1; // Одноразовый тестовый баланс
    } else {
      this.state.activePubkey = this.state.workingKeyPubkey;
      this.state.balanceSol = 0.35; // Основной боевой микро-баланс
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
}

export const defaultMicroLiveSupervisor = new MicroLiveSupervisor();
