export type MarketRegime = 
  | 'CALM' 
  | 'THEMED_HYPE' 
  | 'CABAL_WAR' 
  | 'LIQUIDITY_DRY' 
  | 'MEV_CONGESTION' 
  | 'WEEKEND_LOW_LIQ';

export interface RegimeFeatureVector {
  buyerInflowVelocity: number;       // Сделок в минуту (0 - 120)
  buyerDispersionScore: number;      // Разнообразие кошельков (0 - 100%)
  blockCompetitionTipSol: number;    // Плотность чаевых Jito (0.0001 - 0.01 SOL)
  liquidityDepthSol: number;         // Глубина пула (5 - 200 SOL)
  bidAskSpreadPct: number;           // Спред покупки/продажи (0.1 - 5.0%)
  fundingClusterDensityPct: number;  // Связанность кошельков создателя (0 - 100%)
  socialVelocityScore: number;       // Скорость упоминаний (0 - 100)
  socialSpamScorePct: number;        // Спам-боты в соцсетях (0 - 100%)
  botLandedRatePct: number;          // Процент попадания в блок (0 - 100%)
  botActualSlippagePct: number;      // Фактическое проскальзывание (0 - 5%)
  botNetExpectancyPct: number;       // Чистая матожидаемость после всех комиссий (-5% - +25%)
  botMaxDrawdownPct: number;         // Текущая просадка (0 - 10%)
  botConsecutiveLosses: number;      // Серия убытков подряд (0 - 5)
}

export interface DialRange {
  nameRu: string;
  descriptionRu: string;
  min: number;
  max: number;
  defaultVal: number;
  unit: string;
  isFloorProtected?: boolean; // Нельзя опускать ниже минимума без ручного токена
}

export interface RegimeCorridors {
  regime: MarketRegime;
  regimeRu: string;
  descriptionRu: string;
  greed: DialRange;
  exitSpeed: DialRange;
  scamSuspicion: DialRange;
  trendTrust: DialRange;
  commissionAggression: DialRange;
}

export interface CandidateDials {
  greed: number;                // 30 - 100 % (высота лесенки TP)
  exitSpeed: number;            // 40 - 100 % (окно OFI и тайм-стоп)
  scamSuspicion: number;        // 50 - 100 % (порог отсева кабалов)
  trendTrust: number;           // 10 - 100 % (потолок доверия хайпу)
  commissionAggression: number; // 0.0002 - 0.005 SOL (коридор чаевых Jito)
  followSmartMoney: boolean;
  socialTrends: boolean;
}

export interface CostBreakdown {
  grossProfitSol: number;
  dexFeeSol: number;         // Комиссия пула (0.25 - 0.3%)
  jitoTipSol: number;        // Чаевые Jito
  priorityFeeSol: number;    // Compute budget priority
  ataRentSol: number;        // Аренда токен-аккаунта
  slippageLossSol: number;   // Потери на неблагоприятном проскальзывании
  totalCostsSol: number;     // Сумма всех издержек
  netProfitSol: number;      // Чистый остаток
  netExpectancyPct: number;  // Чистая матожидаемость в %
}

export interface ShadowEvaluationReport {
  version: string;
  passed: boolean;
  rejectReasonRu?: string;
  riskChangeRu: 'понижен' | 'нейтральный' | 'повышен';
  baselineNetExpectancyPct: number;
  candidateNetExpectancyPct: number;
  netExpectancyDeltaPct: number;
  baselineMaxDrawdownPct: number;
  candidateMaxDrawdownPct: number;
  simulatedDealsCount: number;
  simulatedWinratePct: number;
  costs: CostBreakdown;
  invariantBreachesCount: number;
  confirmationTokenNeeded: boolean;
  confirmationToken?: string;
}

export interface GenerationLedgerItem {
  id: string;
  timestamp: string;
  version: string;
  regime: MarketRegime;
  regimeRu: string;
  status: 'ACTIVE_PINNED' | 'AUTO_PROMOTED' | 'CONFIRMATION_PENDING' | 'REJECTED' | 'ROLLED_BACK';
  statusRu: string;
  dials: CandidateDials;
  netExpectancyPct: number;
  maxDrawdownPct: number;
  scoreDeltaPct: number;
  explanationRu: string;
}

export interface SchedulerStatusInfo {
  isRunning: boolean;
  intervalSec: number;
  nextCycleInSec: number;
  totalCyclesRun: number;
  lastCycleTimestamp: string | null;
  lastCycleResultRu: string;
  pinnedVersion: string;
  currentRegime: MarketRegime;
  currentRegimeRu: string;
  regimeConfidencePct: number;
}
