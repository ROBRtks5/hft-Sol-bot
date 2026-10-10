export type OperatingMode = 'SIMULATION' | 'MICRO_LIVE' | 'PAUSED' | 'RECOVERING' | 'KILLED' | 'OBSERVE' | 'SHADOW';
export type TrafficLightStatus = 'AUTONOMOUS' | 'TUNING' | 'PROBLEM' | 'STOPPED';

export type SyntheticFailureCode = 
  | 'DISCONNECT'
  | 'JITO_NOT_LANDED'
  | 'COMPUTE_BUDGET'
  | 'SLIPPAGE'
  | 'DEV_DUMP'
  | 'CABAL'
  | 'SMART_MONEY_DUMP'
  | 'STATE_DRIFT'
  | 'MIGRATION';

export interface TransactionTrackingRecord {
  id: string;
  symbol: string;
  sideRu: 'Покупка' | 'Продажа';
  step: 'PREPARED' | 'SENT' | 'LANDED' | 'EXECUTED' | 'CONFIRMED' | 'FAILED' | 'RETRYING';
  stepRu: string;
  signature: string;
  sentTimeAgo: string;
  actualFeeSol: number;
  actualTipSol: number;
  slippagePlannedPct: number;
  slippageActualPct: number;
  errorMessageRu?: string;
  failureCode?: SyntheticFailureCode;
  retryCount?: number;
  nextStepRecommendationRu: string;
  blocksFinality: number;
}

export interface GasSettings {
  channelMode: 'JITO_PRIVATE' | 'MIXED' | 'NORMAL';
  urgencyLevel: 'ECONOMY' | 'FAST' | 'TURBO' | 'ULTRA';
  feeMode: 'SMART_CAP' | 'EXACT';
  maxFeeSol: number;
  solPriceUsd: number;
  referenceFastTipSol: number;
  spentTodaySol: number;
  dailyBudgetSol: number;
  autoOptimize: boolean;
  targetLandedRatePct: number;
}

export type CommissionPolicy = GasSettings;

export interface MarketCandidate {
  mint: string;
  symbol: string;
  status: 'safe' | 'suspicious' | 'scam';
  buyersCount: number;
  smartMoneyPresent: boolean;
  trendScore: number;
  oneLineReasonRu: string;
  liquiditySol: number;
  priceSol?: number;
  solReserve?: number;
  tokenReserve?: number;
  lastVolumeBuySol?: number;
  lastVolumeSellSol?: number;
  slot?: number;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  isToken2022?: boolean;
  hasTransferHook?: boolean;
  creatorHoldingPct?: number;
}

export interface SmartWalletItem {
  pubkey: string;
  tagRu: string;
  winratePct: number;
  avgHoldMin: number;
  isActiveNow: boolean;
  following: boolean;
}

export interface SocialTrendItem {
  keyword: string;
  confidencePct: number;
  spamRiskPct: number;
  matchedCoins: string[];
}

export interface ClosedDealItem {
  id: string;
  symbol: string;
  entryPriceSol: number;
  exitPriceSol: number;
  profitSol: number;
  profitPct: number;
  scenarioRu: string;
  reasonRu: string;
  holdTimeSec: number;
}

export interface HealthIndicators {
  blockchainConnection: 'green' | 'yellow' | 'red';
  executionSpeed: 'green' | 'yellow' | 'red';
  hourlyErrorsCount: number;
  systemResourcesPct: number;
  needsOperatorHelp: boolean;
}

export interface DecisionItem {
  id: string;
  timeStr: string;
  kind: 'bought' | 'rejected' | 'sold' | 'candidate';
  symbol: string;
  mint?: string;
  actionRu: string;
  reasonRu: string;
  detailsRu?: string;
}

export interface PreflightCheckItem {
  id: string;
  titleRu: string;
  passed: boolean;
  explanationRu: string;
}

export interface InvariantCheck {
  name: string;
  titleRu: string;
  status: 'green' | 'yellow' | 'red';
  descriptionRu: string;
}

export interface StrategyParams {
  greed: number;
  exitSpeed: number;
  scamSuspicion: number;
  followSmartMoney: boolean;
  socialTrends: boolean;
  presetVersion: string;
}

export interface StrategyCandidate {
  version: string;
  titleRu: string;
  riskChangeRu: 'понижен' | 'нейтральный' | 'повышен';
  expectedWinratePct: number;
  params: StrategyParams;
  confirmationTokenNeeded: boolean;
  confirmationToken?: string;
}

export interface CapsuleRecord {
  capsuleId: string;
  titleRu: string;
  timestamp: string;
  framesCount: number;
  summaryRu: string;
}

export interface CapsuleReplayResult {
  capsuleId: string;
  success: boolean;
  diffRu: string;
  replayedPnLSol: number;
  verifiedInvariants: number;
}

export interface ModeSwitchResult {
  success: boolean;
  mode: OperatingMode;
  reasonRu: string;
  blockedBySecurity?: boolean;
}

export interface PromotionResult {
  success: boolean;
  activeVersion: string;
  messageRu: string;
  autoRollbackTriggered?: boolean;
}

export interface RollbackResult {
  success: boolean;
  revertedToVersion: string;
  reasonRu: string;
}

export interface SweepResult {
  success: boolean;
  amountSol: number;
  txSignature?: string;
  errorRu?: string;
}

export interface WalletChangeResult {
  success: boolean;
  newPubkey: string;
  errorRu?: string;
}

export interface SelftestResult {
  passedCount: number;
  totalCount: number;
  allGreen: boolean;
  reportRu: string;
  failingChecksRu?: string[];
}

export interface DryRunReport {
  timestamp: string;
  pipeAlive: boolean;
  status: TrafficLightStatus;
  health: HealthIndicators;
  preflightChecksPassed: number;
  preflightChecksTotal: number;
  preflightAllGreen: boolean;
  keySafetyAllGreen: boolean;
  activeTransactionsCount: number;
  keepAwakeReady: boolean;
  transactionsSentCount: number; // Строго 0! Никаких реальных транзакций
  summaryRu: string;
  checksRu: { nameRu: string; passed: boolean; detailsRu: string }[];
}

export interface NeedsYouCard {
  id: string;
  titleRu: string;
  descriptionRu: string;
  severity: 'WARN' | 'CRITICAL' | 'INFO';
  optionsRu: { action: string; labelRu: string; isDestructive?: boolean }[];
  queuedAt?: number;
  expiresAt?: number;
  repeatCount?: number;
  dedupKey?: string;
  sourceRu?: string;
}

// Stage 30 Vital Signs and Journal Export
export interface VitalSignsInfo {
  balanceSol: number;
  emergencyExitReserveSol: number;
  isGasReserveSafe: boolean;
  gasStatusRu: string;
  lastNetworkResponseTs: number;
  timeSinceLastNetworkSec: number;
  livenessStatusRu: string;
  isNetworkStale: boolean;
  rpcPingMs: number;
  rpcStatus: 'green' | 'yellow' | 'red';
  rpcStatusRu: string;
  networkTypeRu: string;
}

export interface JournalExportReport {
  success: boolean;
  filename: string;
  format: 'json' | 'csv';
  recordsCount: number;
  fileSizeKb: number;
  messageRu: string;
}

export interface MoneySummary {
  balanceSol: number;
  earnedTodaySol: number;
  earnedTodayPct: number;
  pnlHistory: number[];
}

export interface KeepAwakeStatus {
  foregroundService: boolean;
  wakeLockHeld: boolean;
  batteryExempt: boolean;
  dockMode: boolean;
  watchdogAlive: boolean;
  lastRecoveryAt: number | null;
  pauseReasonRu: string | null;
  platformRu: string;
}

export type MarketRegime = 
  | 'CALM' 
  | 'THEMED_HYPE' 
  | 'CABAL_WAR' 
  | 'LIQUIDITY_DRY' 
  | 'MEV_CONGESTION' 
  | 'WEEKEND_LOW_LIQ';

export interface DialCorridor {
  nameRu: string;
  descriptionRu: string;
  min: number;
  max: number;
  current: number;
  isAuto: boolean;
  unit: string;
}

export interface RegimeStatus {
  regime: MarketRegime;
  regimeRu: string;
  confidencePct: number;
  reasonRu: string;
  dials: {
    greed: DialCorridor;
    exitSpeed: DialCorridor;
    scamSuspicion: DialCorridor;
    trendTrust: DialCorridor;
    commissionAggression: DialCorridor;
  };
}

export interface EvolutionLedgerEntry {
  id: string;
  timestamp: string;
  version: string;
  type: 'AUTO_PROMOTE' | 'NEEDS_YOU_PENDING' | 'REJECTED' | 'ROLLBACK';
  summaryRu: string;
  riskTypeRu: 'Понижен' | 'Нейтральный' | 'Повышен';
  netExpectancyPct: number;
  maxDrawdownPct: number;
  trapScorePct: number;
}

export type PreauthorizedBound = 'CONFIRM_EACH' | 'CONSERVATIVE_10' | 'MODERATE_20';

export interface EvolutionCycleResult {
  hypothesesEvaluated: number;
  candidatesGenerated: number;
  sandboxedPassed: number;
  autoPromoted: number;
  needsYouRequested: number;
  rollbacksTriggered: number;
  activePinnedVersion: string;
  messageRu: string;
}

export interface EngineStateV2 {
  trafficLight: TrafficLightStatus;
  mode: OperatingMode;
  autopilotArmed: boolean;
  liveActionTextRu: string;
  balanceSol: number;
  earnedTodaySol: number;
  earnedTodayPct: number;
  activePosition: {
    symbol: string;
    mint?: string;
    entrySol: number;
    currentPercent: number;
    holdTimeSec: number;
    stopLossPercent: number;
    entryPriceSol?: number;
    currentPriceSol?: number;
    lastOfiSol?: number;
    peakPercent?: number;
    remainingTokensPct?: number; // 100% initially, reduces after Tier 1 (50%) and Tier 2 (20% left)
    tier1Closed?: boolean; // +30% -> sell 50%
    tier2Closed?: boolean; // +60% -> sell 30%
  } | null;
  healthIndicators: HealthIndicators;
  pnlHistory: number[];
  decisions: DecisionItem[];
  wallets: {
    hotWalletPubkey: string;
    coldVaultPubkey: string;
    balanceSol: number;
    sweepsHistory: { id: string; date: string; amountSol: number; target: string }[];
  };
  gas: GasSettings;
  activeTransactions: TransactionTrackingRecord[];
  preflightChecklist: PreflightCheckItem[];
  invariants: InvariantCheck[];
  analytics: {
    winratePct: number;
    avgWinPct: number;
    avgLossPct: number;
    maxDrawdownPct: number;
    totalDealsCount: number;
    gasFeesSpentSol: number;
    priorityTipsSpentSol: number;
    slippagePlannedPct: number;
    slippageActualPct: number;
    scenarioMix: { name: string; count: number; pct: number }[];
  };
  candidates: MarketCandidate[];
  smartWallets: SmartWalletItem[];
  trends: SocialTrendItem[];
  closedDeals: ClosedDealItem[];
  keepAwake: KeepAwakeStatus;
  backendType: 'simulator' | 'live_apk';
  isLiveConnected: boolean;
  lastSyncTs: number;
  totalTicksReceived: number;
  candidatesScanned: number;
  rejectedByFilters: number;
  lastTickTimestamp: number;
  needsYou: NeedsYouCard | null;
  requestInboxCount: number;
  requestInboxList: NeedsYouCard[];
  vitalSigns: VitalSignsInfo;
  activeCandidatePreset: StrategyCandidate | null;
  regimeStatus: RegimeStatus;
  evolutionLedger: EvolutionLedgerEntry[];
  preauthorizedBound: PreauthorizedBound;
  microLive: MicroLiveSupervisorState;
  scalingCanary: ScalingCanaryState;
  dailyDigest: DailyDigestState;
  handsOffAudit: HandsOffAuditReport;
}

export type KeySelectionType = 'WORKING_KEY' | 'PROBE_KEY';

export type DeviationStatus = 'MATCHES' | 'SLIGHTLY_WORSE' | 'SIGNIFICANTLY_WORSE';

export interface MicroLiveTradeRecord {
  id: string;
  symbol: string;
  timestamp: string;
  sizeSol: number;
  grossProfitPct: number;
  actualSlippagePct: number;
  expectedSlippagePct: number;
  jitoTipSol: number;
  networkFeeSol: number;
  totalCostsSol: number;
  netPnLSol: number;
  netProfitPct: number;
  deviation: DeviationStatus;
  deviationRu: string;
  capsuleId: string;
}

export interface MicroLiveSupervisorState {
  activeKeyType: KeySelectionType;
  workingKeyPubkey: string;
  probeKeyPubkey: string;
  activePubkey: string;
  balanceSol: number;
  maxTradeSol: number;
  dailyTradesCount: number;
  maxDailyTrades: number;
  dailyLossSol: number;
  maxDailyLossSol: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  narrativeMultiplier: number;
  trades: MicroLiveTradeRecord[];
  deviationSummaryRu: string;
  overallDeviationStatus: DeviationStatus;
  netPnLSol: number;
  winratePct: number;
  capsulesCount: number;
  candidateHypothesesCount: number;
  pendingConfirmationCount: number;
  pendingConfirmationListRu: string[];
  keepAwakeIncidents: string[];
  verdictRu: string;
}

// =========================================================================
// STAGE 25: Controlled Scaling (<=2x) & Canary Evolution & Hardening Audit
// =========================================================================

export interface ScalingStepRecord {
  stepIndex: number;
  tradeSizeSol: number;
  statusRu: 'ЗАВЕРШЕН' | 'АКТИВЕН' | 'ЗАБЛОКИРОВАН' | 'ОТКАТ';
  stableTradesCount: number;
  netPnLSol: number;
  winratePct: number;
  drawdownPct: number;
  pinnedVersion: string;
  timestamp: string;
}

export interface HardeningAuditItem {
  id: number;
  titleRu: string;
  passed: boolean;
  statusRu: 'ЗЕЛЕНЫЙ' | 'ВНИМАНИЕ' | 'КРАСНЫЙ';
  detailsRu: string;
  evidenceRu: string;
}

export interface HardeningAuditReport {
  overallVerdictRu: 'ГОТОВО К ПРОДУ' | 'НЕ ГОТОВО';
  isProductionReady: boolean;
  score: string;
  items: HardeningAuditItem[];
  auditedAt: string;
  safeWorkingRangeSol: string;
  pinnedVersion: string;
}

export interface ScalingCanaryState {
  currentStepIndex: number;
  currentSizeSol: number;
  nextScaleSizeSol: number;
  maxExposureCapSol: number;
  stableWindowTrades: number;
  requiredStableTrades: number;
  isScaleEligible: boolean;
  activePinnedVersion: string;
  canaryStatus: 'IDLE' | 'CANARY_PROBING' | 'BEATING_PINNED' | 'DRIFT_ROLLBACK';
  canaryStatusRu: string;
  canaryVersion: string;
  canaryExpectancyDeltaPct: number;
  driftGuardArmed: boolean;
  stepsHistory: ScalingStepRecord[];
  auditReport: HardeningAuditReport;
  lastScalingActionRu: string;
}

// =========================================================================
// STAGE 27: Hands-Off Autonomy & Daily Digest & Turnkey Verification
// =========================================================================

export interface DailyDigestState {
  date: string;
  generatedAt: string;
  netPnLSol: number;
  netPnLPct: number;
  tradesCount: number;
  winratePct: number;
  actualVsSimulatorDeviationRu: 'совпадает' | 'чуть хуже' | 'сильно хуже';
  actualVsSimulatorDetailsRu: string;
  invariantsAllGreen: boolean;
  invariantsSummaryRu: string;
  keepAwakeEventsCount: number;
  keepAwakeSummaryRu: string;
  dockDurationHours: number;
  pocketDurationHours: number;
  alertsCriticalCount: number;
  operatorInterventionsCount: number;
  operatorInterventionsReasonRu: string;
  evolutionProposalsTotal: number;
  evolutionAutoPromoted: number;
  evolutionNeedsConfirmation: number;
  autoSweepTotalSol: number;
  vaultDestinationPubkey: string;
  notificationDelivered: boolean;
  oneLineSummaryRu: string;
  notificationTitleRu: string;
  notificationBodyRu: string;
}

export interface HandsOffAuditItem {
  id: number;
  titleRu: string;
  passed: boolean;
  categoryRu: '24/7_ДОК' | 'КАРМАН' | 'ПОЛЗУНКИ_АВТО' | 'ЭВОЛЮЦИЯ' | 'КЛЮЧ_И_NATIVE' | 'ПОСЫЛКА_И_ТРЕКИНГ' | 'ЗАМКИ';
  verdictRu: string;
  evidenceRu: string;
}

export interface HandsOffAuditReport {
  overallVerdictRu: 'СИСТЕМА СОБРАНА ПОД КЛЮЧ' | 'НЕ ГОТОВО';
  isTurnkeyReady: boolean;
  auditScore: string;
  items: HandsOffAuditItem[];
  auditedAt: string;
  dockUnattendedProofRu: string;
  pocketHonestyGapRu: string;
  operatorInterventions24h: number;
  oneLineOperatorRuleRu: string;
}

