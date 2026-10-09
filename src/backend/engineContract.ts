import {
  OperatingMode,
  TrafficLightStatus,
  EngineStateV2,
  HealthIndicators,
  MoneySummary,
  DecisionItem,
  MarketCandidate,
  SmartWalletItem,
  SocialTrendItem,
  ClosedDealItem,
  TransactionTrackingRecord,
  SelftestResult,
  CapsuleRecord,
  CapsuleReplayResult,
  StrategyCandidate,
  StrategyParams,
  PromotionResult,
  RollbackResult,
  ModeSwitchResult,
  SweepResult,
  WalletChangeResult,
  GasSettings,
  InvariantCheck,
  PreflightCheckItem,
  NeedsYouCard,
  KeepAwakeStatus,
  RegimeStatus,
  EvolutionCycleResult,
  PreauthorizedBound,
  DryRunReport,
  MicroLiveSupervisorState,
  KeySelectionType,
  ScalingCanaryState,
  HardeningAuditReport,
  DailyDigestState,
  HandsOffAuditReport,
  VitalSignsInfo,
} from '../types/backend';
import { SigningAdapter } from '../signing/signingAdapter';
import { KeepAwakeAdapter } from '../keepAwakeAdapter';

/**
 * Локальный контракт EngineBackend для автономного Phone-Host приложения Alpha-Flip v3.2.
 * 
 * RUNTIME AUTONOMY CLAUSE v2:
 * 1. Нет отдельного внешнего сервера. Приложение на телефоне — самодостаточный хост.
 * 2. Чтение (Read-Only) работает по публичному адресу и открытому RPC без сид-фразы.
 * 3. Подпись (Signing) использует локальный Keystore на телефоне (в браузере заблокирован).
 * 4. Управление режимами проверяет локальный Preflight Gate.
 * 5. Keep-Awake / Foreground Service держит телефон в рабочем состоянии 24/7.
 */
export interface EngineBackend {
  // Базовое состояние и подписка
  getState(): EngineStateV2;
  subscribe(callback: (state: EngineStateV2) => void): () => void;
  getBackendType(): 'simulator' | 'live_apk';
  getSigningAdapter(): SigningAdapter;
  getKeepAwakeAdapter(): KeepAwakeAdapter;

  // Методы чтения (Read-Only)
  getStatus(): Promise<TrafficLightStatus>;
  getHealth(): Promise<HealthIndicators>;
  getLiveAction(): Promise<string>;
  getMoney(): Promise<MoneySummary>;
  getDecisions(n?: number): Promise<DecisionItem[]>;
  getNeedsYou(): Promise<NeedsYouCard | null>;
  getMarketCandidates(): Promise<MarketCandidate[]>;
  getSmartMoneyList(): Promise<SmartWalletItem[]>;
  getTrends(): Promise<SocialTrendItem[]>;
  getHistory(filter?: string): Promise<ClosedDealItem[]>;
  getParcel(dealId: string): Promise<TransactionTrackingRecord | null>;
  getTrackingTransactions(): Promise<TransactionTrackingRecord[]>;
  getCommissionPolicy(): Promise<GasSettings>;
  getGasSettings(): Promise<GasSettings>;
  getInvariantsStatus(): Promise<InvariantCheck[]>;
  getPreflight(): Promise<PreflightCheckItem[]>;
  getPreflightChecklist(): Promise<PreflightCheckItem[]>;
  getStrategyParams(): Promise<StrategyParams>;
  getKeepAwakeStatus(): Promise<KeepAwakeStatus>;

  // Управление режимами и автопилотом
  startEngine(mode?: OperatingMode): Promise<ModeSwitchResult>;
  pauseEngine(): Promise<void>;
  emergencyKill(): Promise<void>;
  setMode(mode: OperatingMode): Promise<ModeSwitchResult>;
  armAutopilot(enabled: boolean): Promise<boolean>;
  setDockMode(on: boolean): Promise<boolean>;

  // Действия оператора
  submitOperatorChoice(action: string): Promise<boolean>;
  requestSweep(amountSol: number): Promise<SweepResult>;
  sweepProfit(): { success: boolean; amountSol: number }; // Синхронный вызов для мгновенного тоста в UI
  changeHotWallet(newPubkey: string): Promise<WalletChangeResult>;
  setCommissionPolicy(policy: Partial<GasSettings>): Promise<GasSettings>;
  updateGasSettings(partial: Partial<GasSettings>): Promise<GasSettings>;
  updateStrategyParams(partial: Partial<StrategyParams>): Promise<StrategyParams>;

  // Самопроверка, Сухой прогон (Dry-Run) и Черный ящик
  runDryRun(): Promise<DryRunReport>;
  runSelftest(scope?: string): Promise<SelftestResult>;
  runSelfTest(): { passedCount: number; totalCount: number };
  captureCapsule(windowSec?: number): Promise<CapsuleRecord>;
  replayCapsule(id: string): Promise<CapsuleReplayResult>;

  // Эволюция параметров и Режимы рынка (Stage 22)
  proposeCandidates(session?: string): Promise<StrategyCandidate[]>;
  promoteCandidate(version: string, confirmToken?: string): Promise<PromotionResult>;
  rollbackParams(version: string): Promise<RollbackResult>;
  rollbackToPinned(): Promise<RollbackResult>;
  getRegimeStatus(): Promise<RegimeStatus>;
  runEvolutionCycle(): Promise<EvolutionCycleResult>;
  getEvolutionSchedulerInfo(): { isRunning: boolean; nextCycleSec: number; totalCycles: number; lastResultRu: string; pinnedVersion: string };
  setPreauthorizedBound(bound: PreauthorizedBound): Promise<void>;
  setSchedulerPaused(paused: boolean): Promise<void>;

  // Боевой-микро (Stage 24)
  getMicroLiveStatus(): Promise<MicroLiveSupervisorState>;
  setKeySelection(keyType: KeySelectionType): Promise<MicroLiveSupervisorState>;

  // Масштабирование <=2x, канареечная эволюция и аудит ядра (Stage 25)
  getScalingCanaryStatus(): Promise<ScalingCanaryState>;
  requestScaleStep(): Promise<{ eligible: boolean; nextSizeSol: number; messageRu: string; needsConfirmation: boolean }>;
  confirmScaleStep(): Promise<ScalingCanaryState>;
  rollbackScaleStep(): Promise<ScalingCanaryState>;
  runHardeningAudit(): Promise<HardeningAuditReport>;

  // Полная автономность «Под ключ» и Суточный дайджест (Stage 27)
  getDailyDigest(): Promise<DailyDigestState>;
  getHandsOffAudit(): Promise<HandsOffAuditReport>;
  runHandsOffVerification(): Promise<HandsOffAuditReport>;
  triggerLocalPushDigest(): Promise<{ delivered: boolean; titleRu: string; bodyRu: string }>;

  // Stage 30: Подсистемы A, B, C (Очередь пушей, Монитор Vital Signs, Экспорт журнала)
  exportTradeJournal(format?: 'json' | 'csv'): Promise<{ success: boolean; filename: string; recordsCount: number; messageRu: string }>;
  getVitalSigns(): VitalSignsInfo;
  getRequestInboxQueue(): NeedsYouCard[];
  dismissRequestInboxCard(id?: string): Promise<boolean>;
  simulateNetworkPing(targetMs?: number): number;
}

