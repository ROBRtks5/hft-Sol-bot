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
  PreauthorizedBound,
  EvolutionCycleResult,
  DryRunReport,
  MicroLiveSupervisorState,
  KeySelectionType,
  ScalingCanaryState,
  HardeningAuditReport,
  DailyDigestState,
  HandsOffAuditReport,
} from '../types/backend';
import { EngineBackend } from './engineContract';
import { SigningAdapter, createSigningAdapter } from '../signing/signingAdapter';
import { KeepAwakeAdapter, createKeepAwakeAdapter } from '../keepAwakeAdapter';
import { AutonomousEvolutionScheduler } from '../evolution';
import { defaultMicroLiveSupervisor, MicroLiveSupervisor } from './microLiveSupervisor';
import { defaultScalingAndAuditManager, ScalingAndAuditManager } from './scalingAndAuditManager';
import { defaultHandsOffAuditManager, HandsOffAuditManager } from './handsOffAuditManager';
import { defaultRequestInbox, RequestInboxManager } from './requestInbox';
import { defaultVitalSigns, VitalSignsMonitor } from './vitalSigns';
import { defaultJournalExporter, JournalExporter } from './journalExporter';
import { VitalSignsInfo } from '../types/backend';
import {
  SIMULATION_CLOSED_DEALS,
  SIMULATION_DECISIONS,
  SIMULATION_ACTIVE_TRANSACTIONS,
} from './simulationSession';

/**
 * SimulatorBackendAdapter: Встроенный локальный симулятор Alpha-Flip v3.2.
 * Работает автономно внутри приложения без внешнего сервера.
 * 
 * Исполняет локальный цикл (decode -> state -> risk -> economics -> signal -> exit -> journal)
 * на логических слотах Solana со сценариями синтетических сбоев и авто-восстановления.
 */
export class SimulatorBackendAdapter implements EngineBackend {
  private state: EngineStateV2;
  private listeners: ((s: EngineStateV2) => void)[] = [];
  private signingAdapter: SigningAdapter;
  private keepAwakeAdapter: KeepAwakeAdapter;
  private timer: any = null;
  private baselineParams: StrategyParams;
  private currentSlot: number = 294820140;
  private evolutionScheduler: AutonomousEvolutionScheduler;
  private microLiveSupervisor: MicroLiveSupervisor = defaultMicroLiveSupervisor;
  private scalingManager: ScalingAndAuditManager = defaultScalingAndAuditManager;
  private handsOffManager: HandsOffAuditManager = defaultHandsOffAuditManager;
  private requestInbox: RequestInboxManager = defaultRequestInbox;
  private vitalSignsMonitor: VitalSignsMonitor = defaultVitalSigns;
  private journalExporter: JournalExporter = defaultJournalExporter;

  constructor(signingAdapter?: SigningAdapter, keepAwakeAdapter?: KeepAwakeAdapter) {
    this.signingAdapter = signingAdapter || createSigningAdapter();
    this.keepAwakeAdapter = keepAwakeAdapter || createKeepAwakeAdapter();

    this.baselineParams = {
      greed: 70,
      exitSpeed: 85,
      scamSuspicion: 90,
      followSmartMoney: true,
      socialTrends: true,
      presetVersion: 'v3.2-standard',
    };

    this.state = {
      trafficLight: 'AUTONOMOUS',
      mode: 'SIMULATION',
      autopilotArmed: true,
      liveActionTextRu: 'Ищу новые монеты: 4 кандидата в проверке, отсекаю сговор создателей...',
      balanceSol: 0,
      earnedTodaySol: 0,
      earnedTodayPct: 0,
      activePosition: null,
      healthIndicators: {
        blockchainConnection: 'green',
        executionSpeed: 'green',
        hourlyErrorsCount: 0,
        systemResourcesPct: 9,
        needsOperatorHelp: false,
      },
      pnlHistory: [0],
      decisions: [],
      wallets: {
        hotWalletPubkey: '',
        coldVaultPubkey: '',
        balanceSol: 0,
        sweepsHistory: [],
      },
      gas: {
        channelMode: 'JITO_PRIVATE',
        urgencyLevel: 'TURBO',
        feeMode: 'SMART_CAP',
        maxFeeSol: 0.002,
        solPriceUsd: 152,
        referenceFastTipSol: 0.0008,
        spentTodaySol: 0.0058,
        dailyBudgetSol: 0.03,
        autoOptimize: true,
        targetLandedRatePct: 85,
      },
      activeTransactions: SIMULATION_ACTIVE_TRANSACTIONS,
      preflightChecklist: [
        { id: '1', titleRu: '1. Тесты ядра и самопроверка (Self-test green)', passed: true, explanationRu: '16 из 16 проверок инвариантов успешно пройдены.' },
        { id: '2', titleRu: '2. Инварианты эволюции (Правила 1-4 активны)', passed: true, explanationRu: 'Hot path изолирован от ИИ, авто-откат на базу активен.' },
        { id: '3', titleRu: '3. Журнал сделок на диске подтвержден', passed: true, explanationRu: 'Сверка журнала 100% пройдена, чистое восстановление.' },
        { id: '4', titleRu: '4. Изоляция приватных ключей и чек-лист безопасности', passed: true, explanationRu: 'Торговый сид изолирован на устройстве, доступ в облако/GitHub закрыт.' },
        { id: '5', titleRu: '5. Баланс кошелька выше дна безопасности (мин. 0.05 SOL)', passed: true, explanationRu: 'Текущий баланс 0.2884 SOL (порог 0.05 SOL).' },
        { id: '6', titleRu: '6. Лимиты риска заданы (макс 0.02 SOL на сделку)', passed: true, explanationRu: 'Ограничение позиции и дневной стоп-лосс активны.' },
        { id: '7', titleRu: '7. Бюджет комиссий Jito и сети установлен', passed: true, explanationRu: 'Дневной лимит 0.03 SOL, плавающий смарт-кап активен.' },
        { id: '8', titleRu: '8. Аварийный выключатель (Kill-Switch) доступен', passed: true, explanationRu: 'Мгновенная остановка проверена.' },
        { id: '9', titleRu: '9. Keep-Awake стек готов (Служба, Doze, Watchdog)', passed: true, explanationRu: 'Фоновая служба и сторожевой пес активны.' },
        { id: '10', titleRu: '10. Торговый seed в нативном Keystore (в браузере MOCK)', passed: this.signingAdapter.isCapable(), explanationRu: this.signingAdapter.isCapable() ? 'Аппаратный Keystore подтвержден' : 'В веб-превью симуляция (ввод ключа только в APK на телефоне).' },
        { id: '11', titleRu: '11. Зафиксирована стабильная базовая версия параметров', passed: true, explanationRu: 'Базовый пресет v3.2-standard зафиксирован.' },
      ],
      invariants: [
        {
          name: 'ONE_POSITION_CAP',
          titleRu: 'Строго одна открытая сделка',
          status: 'green',
          descriptionRu: 'Робот физически не может купить вторую монету, пока не закрыта текущая.',
        },
        {
          name: 'NO_DOUBLE_SELL',
          titleRu: 'Защита от повторной продажи',
          status: 'green',
          descriptionRu: 'Идемпотентные ключи гарантируют исключение дублирующих заявок в блокчейне.',
        },
        {
          name: 'SEED_ISOLATION',
          titleRu: 'Торговый seed изолирован в Keystore',
          status: 'green',
          descriptionRu: 'Ключи никогда не покидают мобильное устройство и не передаются в облако, логи или GitHub.',
        },
        {
          name: 'CAPS_ENFORCED',
          titleRu: 'Тройные катастрофические лимиты',
          status: 'green',
          descriptionRu: 'Размер сделки <= 0.02 SOL, дневной стоп-лосс и лимит 3 убытков подряд жестко соблюдаются.',
        },
        {
          name: 'PROFIT_SWEEP_SAFETY',
          titleRu: 'Холодный сейф — только публичный адрес',
          status: 'green',
          descriptionRu: 'Вывод только на публичный адрес кошелька оператора. Полномочий тратить из сейфа у бота нет.',
        },
        {
          name: 'COLD_PATH_GEMINI_ZERO_SIGN',
          titleRu: 'Cold path и Gemini: 0 прав подписи',
          status: 'green',
          descriptionRu: 'ИИ только советует, не имеет доступа к ключам и не может ослабить фильтры скама или стоп-лосс.',
        },
        {
          name: 'AI_ADVISORY_BOUNDED',
          titleRu: 'Ограниченный множитель ИИ',
          status: 'green',
          descriptionRu: 'Множитель доверия нарративу ограничен [0.8x - 1.2x] и не может перекрывать лимиты риска.',
        },
        {
          name: 'PAUSE_NEVER_ABANDON',
          titleRu: 'Пауза при низком заряде не бросает сделку',
          status: 'green',
          descriptionRu: 'При заряде < 15% вход новых монет блокируется, но открытая позиция безопасно выводится по правилам.',
        },
        {
          name: 'KEEP_AWAKE_ALIVE',
          titleRu: 'Служба переднего плана активна 24/7',
          status: 'green',
          descriptionRu: 'Неубиваемая служба с постоянным уведомлением и авто-восстановлением через AlarmManager.',
        },
      ],
      analytics: {
        winratePct: 76.2,
        avgWinPct: 9.4,
        avgLossPct: -2.3,
        maxDrawdownPct: -3.8,
        totalDealsCount: 42,
        gasFeesSpentSol: 0.0019,
        priorityTipsSpentSol: 0.0058,
        slippagePlannedPct: 1.1,
        slippageActualPct: 1.18,
        scenarioMix: [
          { name: 'Свежий запуск', count: 24, pct: 57 },
          { name: 'CTO Прорыв', count: 8, pct: 19 },
          { name: 'Умные деньги', count: 4, pct: 10 },
          { name: 'Прорыв на биржу', count: 3, pct: 7 },
          { name: 'Дев-дамп (ловушка)', count: 3, pct: 7 },
        ],
      },
      candidates: [
        {
          mint: '4kKq...77vX',
          symbol: 'FROGGY',
          status: 'safe',
          buyersCount: 52,
          smartMoneyPresent: true,
          trendScore: 88,
          oneLineReasonRu: 'Чистый контракт, создатель вышел, 52 живых покупателя за 30 секунд.',
          liquiditySol: 34.2,
        },
        {
          mint: '8kLp...99aA',
          symbol: 'CATROCKET',
          status: 'suspicious',
          buyersCount: 19,
          smartMoneyPresent: false,
          trendScore: 42,
          oneLineReasonRu: 'Подозрительно высокая концентрация монет на 3 связанных адресах.',
          liquiditySol: 18.5,
        },
        {
          mint: '2mNq...77zZ',
          symbol: 'SCAMCOIN',
          status: 'scam',
          buyersCount: 6,
          smartMoneyPresent: false,
          trendScore: 10,
          oneLineReasonRu: 'Обнаружен скрытый запрет на продажу (TransferHook blacklisting).',
          liquiditySol: 8.1,
        },
      ],
      smartWallets: [
        {
          pubkey: '3B9z...jKw8',
          tagRu: 'Надёжный снайпер',
          winratePct: 82,
          avgHoldMin: 1.8,
          isActiveNow: true,
          following: true,
        },
        {
          pubkey: 'G5qR...9xLm',
          tagRu: 'Быстро сливает (осторожно)',
          winratePct: 61,
          avgHoldMin: 0.5,
          isActiveNow: false,
          following: false,
        },
        {
          pubkey: 'K8sP...4vTt',
          tagRu: 'Крупный инсайдер',
          winratePct: 89,
          avgHoldMin: 3.2,
          isActiveNow: true,
          following: true,
        },
      ],
      trends: [
        { keyword: 'AI Agent Solana', confidencePct: 94, spamRiskPct: 8, matchedCoins: ['NEURAL', 'AIPUMP'] },
        { keyword: 'Cute Mascot Memes', confidencePct: 76, spamRiskPct: 22, matchedCoins: ['FROGGY'] },
        { keyword: 'Burn CTO Breakout', confidencePct: 88, spamRiskPct: 14, matchedCoins: ['MOONCAT'] },
      ],
      closedDeals: SIMULATION_CLOSED_DEALS,
      keepAwake: this.keepAwakeAdapter.getStatus(),
      backendType: 'simulator',
      isLiveConnected: true,
      lastSyncTs: Date.now(),
      needsYou: this.requestInbox.peek(),
      requestInboxCount: this.requestInbox.count(),
      requestInboxList: this.requestInbox.getAll(),
      vitalSigns: this.vitalSignsMonitor.getStatus(0.2884, 0.002, 0.0008),
      activeCandidatePreset: {
        version: 'v3.3-candidate-alpha',
        titleRu: 'Ускоренный скальпинг + защита от скрытых налогов',
        riskChangeRu: 'повышен',
        expectedWinratePct: 81.2,
        params: {
          greed: 75,
          exitSpeed: 90,
          scamSuspicion: 95,
          followSmartMoney: true,
          socialTrends: true,
          presetVersion: 'v3.3-candidate-alpha',
        },
        confirmationTokenNeeded: true,
        confirmationToken: 'CONFIRM-RISK-75',
      },
      regimeStatus: {
        regime: 'CALM',
        regimeRu: 'Спокойный рынок',
        confidencePct: 82,
        reasonRu: 'Сбалансированный рынок, низкая MEV-нагрузка.',
        dials: {
          greed: { nameRu: 'Жадность (Тейк-профит)', descriptionRu: 'Высота фиксации', min: 50, max: 80, current: 70, isAuto: true, unit: '%' },
          exitSpeed: { nameRu: 'Скорость выхода (Стоп-лосс)', descriptionRu: 'Реакция на разворот', min: 60, max: 85, current: 85, isAuto: true, unit: '%' },
          scamSuspicion: { nameRu: 'Подозрительность к скаму', descriptionRu: 'Отсев ловушек', min: 80, max: 100, current: 90, isAuto: true, unit: '%' },
          trendTrust: { nameRu: 'Доверие трендам', descriptionRu: 'Потолок доверия', min: 20, max: 60, current: 50, isAuto: true, unit: '%' },
          commissionAggression: { nameRu: 'Агрессия комиссий (Jito Tip)', descriptionRu: 'Чаевые за блок', min: 0.0003, max: 0.0012, current: 0.0008, isAuto: true, unit: 'SOL' },
        },
      },
      evolutionLedger: [],
      preauthorizedBound: 'CONSERVATIVE_10',
      microLive: defaultMicroLiveSupervisor.getState(),
      scalingCanary: this.scalingManager.getState(),
      dailyDigest: this.handsOffManager.getDailyDigest(),
      handsOffAudit: this.handsOffManager.getHandsOffAuditReport(),
    };

    this.evolutionScheduler = new AutonomousEvolutionScheduler({
      getClosedDeals: () => this.state.closedDeals,
      onStateUpdated: () => this.syncFromEvolutionScheduler(),
    });

    this.syncFromEvolutionScheduler();
    this.startSimulationHeartbeat();
  }

  private syncFromEvolutionScheduler() {
    if (!this.evolutionScheduler) return;
    const regimeRes = this.evolutionScheduler.getRegimeResult();
    const dials = this.evolutionScheduler.getActiveDials();
    const ledger = this.evolutionScheduler.getLedger();

    this.state.regimeStatus = {
      regime: regimeRes.regime,
      regimeRu: regimeRes.regimeRu,
      confidencePct: regimeRes.confidencePct,
      reasonRu: regimeRes.reasonRu,
      dials: {
        greed: {
          nameRu: regimeRes.corridors.greed.nameRu,
          descriptionRu: regimeRes.corridors.greed.descriptionRu,
          min: regimeRes.corridors.greed.min,
          max: regimeRes.corridors.greed.max,
          current: dials.greed,
          isAuto: true,
          unit: regimeRes.corridors.greed.unit,
        },
        exitSpeed: {
          nameRu: regimeRes.corridors.exitSpeed.nameRu,
          descriptionRu: regimeRes.corridors.exitSpeed.descriptionRu,
          min: regimeRes.corridors.exitSpeed.min,
          max: regimeRes.corridors.exitSpeed.max,
          current: dials.exitSpeed,
          isAuto: true,
          unit: regimeRes.corridors.exitSpeed.unit,
        },
        scamSuspicion: {
          nameRu: regimeRes.corridors.scamSuspicion.nameRu,
          descriptionRu: regimeRes.corridors.scamSuspicion.descriptionRu,
          min: regimeRes.corridors.scamSuspicion.min,
          max: regimeRes.corridors.scamSuspicion.max,
          current: dials.scamSuspicion,
          isAuto: true,
          unit: regimeRes.corridors.scamSuspicion.unit,
        },
        trendTrust: {
          nameRu: regimeRes.corridors.trendTrust.nameRu,
          descriptionRu: regimeRes.corridors.trendTrust.descriptionRu,
          min: regimeRes.corridors.trendTrust.min,
          max: regimeRes.corridors.trendTrust.max,
          current: dials.trendTrust,
          isAuto: true,
          unit: regimeRes.corridors.trendTrust.unit,
        },
        commissionAggression: {
          nameRu: regimeRes.corridors.commissionAggression.nameRu,
          descriptionRu: regimeRes.corridors.commissionAggression.descriptionRu,
          min: regimeRes.corridors.commissionAggression.min,
          max: regimeRes.corridors.commissionAggression.max,
          current: dials.commissionAggression,
          isAuto: true,
          unit: regimeRes.corridors.commissionAggression.unit,
        },
      },
    };

    this.state.evolutionLedger = ledger.map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      version: item.version,
      type: item.status === 'AUTO_PROMOTED' ? 'AUTO_PROMOTE'
        : item.status === 'ROLLED_BACK' ? 'ROLLBACK'
        : item.status === 'CONFIRMATION_PENDING' ? 'NEEDS_YOU_PENDING'
        : 'REJECTED',
      summaryRu: item.explanationRu,
      riskTypeRu: item.dials.greed > 80 ? 'Повышен' : 'Нейтральный',
      netExpectancyPct: item.netExpectancyPct,
      maxDrawdownPct: item.maxDrawdownPct,
      trapScorePct: 4,
    }));

    this.state.preauthorizedBound = this.evolutionScheduler.getPreauthorizedBound();
    this.baselineParams = {
      greed: dials.greed,
      exitSpeed: dials.exitSpeed,
      scamSuspicion: dials.scamSuspicion,
      followSmartMoney: dials.followSmartMoney,
      socialTrends: dials.socialTrends,
      presetVersion: this.evolutionScheduler.getStatusInfo().pinnedVersion,
    };

    this.notify();
  }

  private startSimulationHeartbeat() {
    if (typeof window === 'undefined') return;
    this.timer = setInterval(() => {
      this.currentSlot += 4;
      // Плавное обновление времени удержания открытой позиции
      if (this.state.activePosition && this.state.mode !== 'PAUSED' && this.state.mode !== 'KILLED') {
        this.state.activePosition.holdTimeSec += 3;
        const delta = (Math.random() - 0.48) * 0.4;
        this.state.activePosition.currentPercent = Number(
          (this.state.activePosition.currentPercent + delta).toFixed(1)
        );
      }
      this.state.keepAwake = this.keepAwakeAdapter.getStatus();
      this.state.lastSyncTs = Date.now();
      // Stage 30 Vital signs & ping update
      this.vitalSignsMonitor.recordNetworkResponse();
      this.state.vitalSigns = this.vitalSignsMonitor.getStatus(
        this.state.balanceSol,
        this.state.gas?.maxFeeSol || 0.002,
        this.state.gas?.referenceFastTipSol || 0.0008
      );
      // Auto-gas check: if balance drops below emergency floor
      if (!this.state.vitalSigns.isGasReserveSafe && this.state.mode !== 'PAUSED' && this.state.mode !== 'KILLED') {
        this.state.mode = 'PAUSED';
        this.state.trafficLight = 'PROBLEM';
        this.state.liveActionTextRu = '⚠️ Баланс ниже резерва (0.015 SOL): пауза новых сделок. Открытая сделка под защитой.';
        this.requestInbox.push({
          id: 'gas-reserve-deficit',
          titleRu: 'Газовый резерв: Баланс ниже порога выхода',
          descriptionRu: this.state.vitalSigns.gasStatusRu,
          severity: 'CRITICAL',
          optionsRu: [
            { action: 'dismiss_inbox_card', labelRu: 'Понятно (оставить паузу)' },
          ],
        });
      }
      this.state.needsYou = this.requestInbox.peek();
      this.state.requestInboxCount = this.requestInbox.count();
      this.state.requestInboxList = this.requestInbox.getAll();
      this.notify();
    }, 4000);
  }

  public getState(): EngineStateV2 {
    return this.state;
  }

  public subscribe(callback: (state: EngineStateV2) => void): () => void {
    this.listeners.push(callback);
    callback(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  private notify() {
    this.listeners.forEach((cb) => cb({ ...this.state }));
  }

  public getBackendType(): 'simulator' | 'live_apk' {
    return 'simulator';
  }

  public getSigningAdapter(): SigningAdapter {
    return this.signingAdapter;
  }

  public getKeepAwakeAdapter(): KeepAwakeAdapter {
    return this.keepAwakeAdapter;
  }

  public async getStatus(): Promise<TrafficLightStatus> {
    return this.state.trafficLight;
  }

  public async getHealth(): Promise<HealthIndicators> {
    return this.state.healthIndicators;
  }

  public async getLiveAction(): Promise<string> {
    return this.state.liveActionTextRu;
  }

  public async getMoney(): Promise<MoneySummary> {
    return {
      balanceSol: this.state.balanceSol,
      earnedTodaySol: this.state.earnedTodaySol,
      earnedTodayPct: this.state.earnedTodayPct,
      pnlHistory: this.state.pnlHistory,
    };
  }

  public async getDecisions(n: number = 10): Promise<DecisionItem[]> {
    return this.state.decisions.slice(0, n);
  }

  public async getNeedsYou(): Promise<NeedsYouCard | null> {
    return this.state.needsYou;
  }

  public async getMarketCandidates(): Promise<MarketCandidate[]> {
    return this.state.candidates;
  }

  public async getSmartMoneyList(): Promise<SmartWalletItem[]> {
    return this.state.smartWallets;
  }

  public async getTrends(): Promise<SocialTrendItem[]> {
    return this.state.trends;
  }

  public async getHistory(_filter?: string): Promise<ClosedDealItem[]> {
    return this.state.closedDeals;
  }

  public async getParcel(dealId: string): Promise<TransactionTrackingRecord | null> {
    return this.state.activeTransactions.find((tx) => tx.id === dealId) || null;
  }

  public async getTrackingTransactions(): Promise<TransactionTrackingRecord[]> {
    return this.state.activeTransactions;
  }

  public async getCommissionPolicy(): Promise<GasSettings> {
    return this.state.gas;
  }

  public async getGasSettings(): Promise<GasSettings> {
    return this.state.gas;
  }

  public async getInvariantsStatus(): Promise<InvariantCheck[]> {
    return this.state.invariants;
  }

  public async getPreflight(): Promise<PreflightCheckItem[]> {
    return this.state.preflightChecklist;
  }

  public async getPreflightChecklist(): Promise<PreflightCheckItem[]> {
    return this.state.preflightChecklist;
  }

  public async getStrategyParams(): Promise<StrategyParams> {
    return this.baselineParams;
  }

  public async getKeepAwakeStatus(): Promise<KeepAwakeStatus> {
    return this.state.keepAwake;
  }

  public async armAutopilot(enabled: boolean): Promise<boolean> {
    this.state.autopilotArmed = enabled;
    if (enabled && this.state.mode === 'PAUSED') {
      this.state.mode = 'SIMULATION';
      this.state.trafficLight = 'AUTONOMOUS';
      this.state.liveActionTextRu = 'Автопилот включен: 24/7 автономный поиск и вход по жестким триггерам.';
    }
    this.notify();
    return true;
  }

  public async setDockMode(on: boolean): Promise<boolean> {
    await this.keepAwakeAdapter.setDockMode(on);
    this.state.keepAwake.dockMode = on;
    this.notify();
    return true;
  }

  /**
   * СТРОГАЯ ИЗОЛЯЦИЯ СИМУЛЯТОРА (STAGE 31 / БЛОК 2):
   * SimulatorBackendAdapter изолирован исключительно для режима SIMULATION и self-test.
   * Любая попытка запуска MICRO_LIVE / LIVE через симулятор физически заблокирована.
   */
  public async setMode(mode: OperatingMode): Promise<ModeSwitchResult> {
    if (mode === 'MICRO_LIVE') {
      const reason =
        'ИЗОЛЯЦИЯ МОКОВ: SimulatorBackendAdapter изолирован только для режима SIMULATION и тестов. Боевой режим MICRO_LIVE физически заблокирован в симуляторе. Для реальной торговли переключитесь на LiveApkBackendAdapter с реальным RPC и аппаратным Keystore.';
      return {
        success: false,
        mode: 'SIMULATION',
        blockedBySecurity: true,
        reasonRu: reason,
      };
    }

    this.state.mode = mode;
    if (mode === 'SIMULATION') {
      this.state.trafficLight = 'AUTONOMOUS';
      this.state.liveActionTextRu = 'Симуляция запущена: расчет сделок без риска реальных денег.';
    } else if (mode === 'PAUSED') {
      this.state.trafficLight = 'STOPPED';
      this.state.liveActionTextRu = 'Робот на паузе: новые покупки заблокированы, открытая сделка под защитой.';
    } else if (mode === 'KILLED') {
      this.state.trafficLight = 'STOPPED';
      this.state.activePosition = null;
      this.state.liveActionTextRu = 'АВАРИЙНЫЙ СТОП: все позиции экстренно ликвидированы в SOL.';
    }
    this.notify();
    return {
      success: true,
      mode: this.state.mode,
      reasonRu: `Режим успешно изменен на ${mode}`,
    };
  }

  public async startEngine(mode: OperatingMode = 'SIMULATION'): Promise<ModeSwitchResult> {
    if (mode === 'MICRO_LIVE') {
      return {
        success: false,
        mode: 'SIMULATION',
        blockedBySecurity: true,
        reasonRu: 'ИЗОЛЯЦИЯ МОКОВ: Запуск боевого режима через SimulatorBackendAdapter запрещен. Используйте LiveApkBackendAdapter.',
      };
    }
    return await this.setMode(mode);
  }

  public async pauseEngine(): Promise<void> {
    await this.setMode('PAUSED');
  }

  public async emergencyKill(): Promise<void> {
    await this.setMode('KILLED');
  }

  public simulateKeepAwakeStress() {
    this.state.keepAwake.pauseReasonRu = 'Низкий заряд батареи (<15%): пауза новых входов';
    this.state.mode = 'PAUSED';
    this.state.trafficLight = 'PROBLEM';
    this.state.liveActionTextRu = '⚠️ Батарея <15%: новые покупки на паузе. Открытая сделка сопровождается стоп-лоссом.';
    this.requestInbox.push({
      id: 'stress-battery',
      titleRu: 'Стресс Keep-Awake: Батарея < 15%',
      descriptionRu: 'Симулятор проверил правило: новые сделки заблокированы, но открытая позиция НЕ брошена и сопровождается стоп-лоссом.',
      severity: 'WARN',
      optionsRu: [
        { action: 'resume_battery', labelRu: 'Подключить зарядку и возобновить' }
      ]
    });
    this.state.needsYou = this.requestInbox.peek();
    this.state.requestInboxCount = this.requestInbox.count();
    this.state.requestInboxList = this.requestInbox.getAll();
    this.notify();
  }

  public async submitOperatorChoice(action: string): Promise<boolean> {
    if (action === 'resume_battery') {
      this.state.keepAwake.pauseReasonRu = null;
      this.state.mode = 'SIMULATION';
      this.state.trafficLight = 'AUTONOMOUS';
      this.state.liveActionTextRu = 'Зарядка подключена: автономный поиск и вход возобновлены.';
      this.requestInbox.resolve('stress-battery');
    } else if (action === 'confirm_scale_step') {
      await this.confirmScaleStep();
      this.requestInbox.resolve('scale-up-confirmation');
      return true;
    } else if (action === 'dismiss_scale_step') {
      this.requestInbox.resolve('scale-up-confirmation');
    } else if (action === 'dismiss_inbox_card') {
      this.requestInbox.pop();
    } else {
      // Любое другое действие оператора закрывает верхнюю карточку
      this.requestInbox.pop();
    }
    this.state.needsYou = this.requestInbox.peek();
    this.state.requestInboxCount = this.requestInbox.count();
    this.state.requestInboxList = this.requestInbox.getAll();
    this.state.healthIndicators.needsOperatorHelp = this.state.requestInboxCount > 0;
    this.notify();
    return true;
  }

  public async requestSweep(amountSol: number): Promise<SweepResult> {
    if (!this.signingAdapter.isCapable()) {
      this.state.balanceSol = Number(Math.max(0, this.state.balanceSol - amountSol).toFixed(4));
      this.state.wallets.sweepsHistory.unshift({
        id: `sw-${Date.now()}`,
        date: 'Только что',
        amountSol,
        target: 'Холодный сейф (9xQe...)',
      });
      this.notify();
      return { success: true, amountSol };
    }
    const res = await this.signingAdapter.signAndSendSweep(amountSol, this.state.wallets.coldVaultPubkey);
    if (res.success) {
      this.state.balanceSol = Number(Math.max(0, this.state.balanceSol - amountSol).toFixed(4));
      this.state.wallets.sweepsHistory.unshift({
        id: `sw-${Date.now()}`,
        date: 'Только что',
        amountSol,
        target: 'Холодный сейф (9xQe...)',
      });
      this.notify();
      return { success: true, amountSol, txSignature: res.txSignature };
    }
    return { success: false, amountSol: 0, errorRu: res.errorRu };
  }

  public sweepProfit(): { success: boolean; amountSol: number } {
    const amount = 0.02;
    this.state.balanceSol = Number(Math.max(0, this.state.balanceSol - amount).toFixed(4));
    this.state.wallets.sweepsHistory.unshift({
      id: `sw-${Date.now()}`,
      date: 'Только что',
      amountSol: amount,
      target: 'Холодный сейф (9xQe...)',
    });
    this.notify();
    return { success: true, amountSol: amount };
  }

  public async changeHotWallet(newPubkey: string): Promise<WalletChangeResult> {
    this.state.wallets.hotWalletPubkey = newPubkey;
    this.notify();
    return { success: true, newPubkey };
  }

  public async setCommissionPolicy(policy: Partial<GasSettings>): Promise<GasSettings> {
    this.state.gas = { ...this.state.gas, ...policy };
    this.notify();
    return this.state.gas;
  }

  public async updateGasSettings(partial: Partial<GasSettings>): Promise<GasSettings> {
    return await this.setCommissionPolicy(partial);
  }

  public async updateStrategyParams(partial: Partial<StrategyParams>): Promise<StrategyParams> {
    this.baselineParams = { ...this.baselineParams, ...partial };
    return this.baselineParams;
  }

  public async runDryRun(): Promise<DryRunReport> {
    const status = await this.getStatus();
    const health = await this.getHealth();
    const preflight = await this.getPreflightChecklist();
    const invariants = await this.getInvariantsStatus();
    const keepAwake = this.keepAwakeAdapter.getStatus();

    const passedPreflight = preflight.filter((p) => p.passed).length;
    const allGreenPreflight = passedPreflight === preflight.length;
    const allGreenInvariants = invariants.every((inv) => inv.status === 'green');

    const checksRu = [
      {
        nameRu: 'Локальный транспорт RPC/gRPC',
        passed: true,
        detailsRu: `Логический слот ${this.currentSlot}, отставание 0 слотов. Трансляция данных активна.`,
      },
      {
        nameRu: 'Чтение баланса и кошелька (Read-Only)',
        passed: true,
        detailsRu: `Баланс: ${this.state.balanceSol} SOL (выше защитного порога 0.05 SOL). Ключи не запрашиваются.`,
      },
      {
        nameRu: 'Модуль отслеживания посылок (Parcel Tracking)',
        passed: true,
        detailsRu: `${this.state.activeTransactions.length} транзакций в журнале трекинга. Идемпотентность подтверждена.`,
      },
      {
        nameRu: 'Keep-Awake стек (Foreground & Watchdog)',
        passed: keepAwake.watchdogAlive,
        detailsRu: `Фоновая служба: ${keepAwake.foregroundService ? 'ВКЛ' : 'Эмуляция'}, Watchdog активен.`,
      },
      {
        nameRu: 'Изоляция приватных ключей (Key-Safety)',
        passed: true,
        detailsRu: 'Торговый seed изолирован. В сеть, DOM, GitHub и логи секреты не передаются.',
      },
      {
        nameRu: 'Запрет реальных транзакций (Dry-Run strictly 0 tx)',
        passed: true,
        detailsRu: 'Транзакции в блокчейн НЕ отправлялись (отправлено: 0). Исполнение заблокировано.',
      },
    ];

    return {
      timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      pipeAlive: true,
      status,
      health,
      preflightChecksPassed: passedPreflight,
      preflightChecksTotal: preflight.length,
      preflightAllGreen: allGreenPreflight,
      keySafetyAllGreen: allGreenInvariants,
      activeTransactionsCount: this.state.activeTransactions.length,
      keepAwakeReady: keepAwake.watchdogAlive,
      transactionsSentCount: 0,
      summaryRu: 'Сухой прогон успешно завершен. Мост пульт <-> локальный движок функционирует без отправки транзакций.',
      checksRu,
    };
  }

  public async runSelftest(_scope?: string): Promise<SelftestResult> {
    return {
      passedCount: 16,
      totalCount: 16,
      allGreen: true,
      reportRu: 'Все 16 жестких инвариантов безопасности и защиты депозита соблюдены на 100%.',
    };
  }

  public runSelfTest(): { passedCount: number; totalCount: number } {
    return { passedCount: 16, totalCount: 16 };
  }

  public async captureCapsule(windowSec: number = 30): Promise<CapsuleRecord> {
    const record: CapsuleRecord = {
      capsuleId: `cap-${Date.now()}`,
      titleRu: `Снимок импульса (${windowSec} сек)`,
      timestamp: new Date().toLocaleTimeString('ru-RU'),
      framesCount: 48,
      summaryRu: 'Зафиксировано 48 тиков книги заявок и обновлений bonding curve.',
    };
    return record;
  }

  public async replayCapsule(id: string): Promise<CapsuleReplayResult> {
    return {
      capsuleId: id,
      success: true,
      diffRu: 'Математическое совпадение 100%. Расхождений с журналом ордеров не обнаружено.',
      replayedPnLSol: 0.0018,
      verifiedInvariants: 16,
    };
  }

  public async proposeCandidates(_session?: string): Promise<StrategyCandidate[]> {
    if (this.state.activeCandidatePreset) {
      return [this.state.activeCandidatePreset];
    }
    return [];
  }

  public async promoteCandidate(version: string, confirmToken?: string): Promise<PromotionResult> {
    const candidate = this.state.activeCandidatePreset;
    if (!candidate || candidate.version !== version) {
      return { success: false, activeVersion: this.baselineParams.presetVersion, messageRu: 'Кандидат не найден' };
    }

    if (candidate.confirmationTokenNeeded) {
      if (confirmToken !== candidate.confirmationToken) {
        return {
          success: false,
          activeVersion: this.baselineParams.presetVersion,
          messageRu: `Требуется токен подтверждения повышения риска (${candidate.confirmationToken}).`,
        };
      }
    }

    this.baselineParams = { ...candidate.params };
    this.notify();
    return {
      success: true,
      activeVersion: version,
      messageRu: `Пресет ${version} успешно перенесен в активную конфигурацию.`,
    };
  }

  public async rollbackParams(version: string): Promise<RollbackResult> {
    this.baselineParams = {
      greed: 70,
      exitSpeed: 85,
      scamSuspicion: 90,
      followSmartMoney: true,
      socialTrends: true,
      presetVersion: 'v3.2-standard',
    };
    this.notify();
    return {
      success: true,
      revertedToVersion: 'v3.2-standard',
      reasonRu: `Выполнен авто-откат с ${version} на стабильную базовую версию v3.2-standard.`,
    };
  }

  public async getRegimeStatus(): Promise<RegimeStatus> {
    return this.state.regimeStatus;
  }

  public async runEvolutionCycle(): Promise<EvolutionCycleResult> {
    const output = this.evolutionScheduler.runCycle();
    this.syncFromEvolutionScheduler();
    return {
      hypothesesEvaluated: 12,
      candidatesGenerated: 1,
      sandboxedPassed: output.shadowReport.passed ? 1 : 0,
      autoPromoted: output.autoPromoted ? 1 : 0,
      needsYouRequested: output.shadowReport.confirmationTokenNeeded ? 1 : 0,
      rollbacksTriggered: output.rollbackTriggered ? 1 : 0,
      activePinnedVersion: output.activeVersion,
      messageRu: output.actionTakenRu,
    };
  }

  public async rollbackToPinned(): Promise<RollbackResult> {
    this.evolutionScheduler.rollbackToPinned();
    this.syncFromEvolutionScheduler();
    return {
      success: true,
      revertedToVersion: 'v3.2-standard',
      reasonRu: 'Откат к проверенному пресету v3.2-standard выполнен успешно.',
    };
  }

  public getEvolutionSchedulerInfo(): { isRunning: boolean; nextCycleSec: number; totalCycles: number; lastResultRu: string; pinnedVersion: string } {
    const info = this.evolutionScheduler.getStatusInfo();
    return {
      isRunning: info.isRunning,
      nextCycleSec: info.nextCycleInSec,
      totalCycles: info.totalCyclesRun,
      lastResultRu: info.lastCycleResultRu,
      pinnedVersion: info.pinnedVersion,
    };
  }

  public async setPreauthorizedBound(bound: PreauthorizedBound): Promise<void> {
    this.evolutionScheduler.setPreauthorizedBound(bound);
    this.state.preauthorizedBound = bound;
    this.notify();
  }

  public async setSchedulerPaused(paused: boolean): Promise<void> {
    this.evolutionScheduler.setPaused(paused);
    this.notify();
  }

  public async getMicroLiveStatus(): Promise<MicroLiveSupervisorState> {
    return this.microLiveSupervisor.getState();
  }

  public async setKeySelection(keyType: KeySelectionType): Promise<MicroLiveSupervisorState> {
    const updated = this.microLiveSupervisor.setKeySelection(keyType);
    this.state.microLive = updated;
    this.state.wallets.balanceSol = updated.balanceSol;
    this.state.wallets.hotWalletPubkey = updated.activePubkey;
    this.notify();
    return updated;
  }

  // =========================================================================
  // STAGE 25: Controlled Scaling & Hardening Audit Methods
  // =========================================================================

  public async getScalingCanaryStatus(): Promise<ScalingCanaryState> {
    return this.scalingManager.getState();
  }

  public async requestScaleStep(): Promise<{ eligible: boolean; nextSizeSol: number; messageRu: string; needsConfirmation: boolean }> {
    const res = this.scalingManager.requestScaleStep();
    if (res.eligible && res.needsConfirmation) {
      this.requestInbox.push({
        id: 'scale-up-confirmation',
        titleRu: `Запрос масштабирования позиции: ${this.state.scalingCanary.currentSizeSol} -> ${res.nextSizeSol} SOL`,
        descriptionRu: `Окно стабильности подтверждено (>=10 сделок, фактическое отклонение <2.5%). Переход на шаг <=2x увеличивает экспозицию. Требуется личное подтверждение оператора согласно RUNTIME AUTONOMY CLAUSE v2.`,
        severity: 'WARN',
        optionsRu: [
          { action: 'confirm_scale_step', labelRu: `Подтвердить масштаб до ${res.nextSizeSol} SOL` },
          { action: 'dismiss_scale_step', labelRu: 'Отклонить, остаться на текущем размере' },
        ],
      });
      this.state.needsYou = this.requestInbox.peek();
      this.state.requestInboxCount = this.requestInbox.count();
      this.state.requestInboxList = this.requestInbox.getAll();
      this.state.healthIndicators.needsOperatorHelp = true;
      this.notify();
    }
    return res;
  }

  public async confirmScaleStep(): Promise<ScalingCanaryState> {
    const updated = this.scalingManager.confirmScaleStep();
    this.state.scalingCanary = updated;
    this.requestInbox.resolve('scale-up-confirmation');
    this.state.needsYou = this.requestInbox.peek();
    this.state.requestInboxCount = this.requestInbox.count();
    this.state.requestInboxList = this.requestInbox.getAll();
    this.state.healthIndicators.needsOperatorHelp = this.state.requestInboxCount > 0;
    this.notify();
    return updated;
  }

  public async rollbackScaleStep(): Promise<ScalingCanaryState> {
    const updated = this.scalingManager.rollbackStep();
    this.state.scalingCanary = updated;
    this.requestInbox.resolve('scale-up-confirmation');
    this.state.needsYou = this.requestInbox.peek();
    this.state.requestInboxCount = this.requestInbox.count();
    this.state.requestInboxList = this.requestInbox.getAll();
    this.state.healthIndicators.needsOperatorHelp = this.state.requestInboxCount > 0;
    this.notify();
    return updated;
  }

  public async runHardeningAudit(): Promise<HardeningAuditReport> {
    const rep = this.scalingManager.runHardeningAudit();
    this.state.scalingCanary.auditReport = rep;
    this.notify();
    return rep;
  }

  // Stage 27: Полная автономность «Под ключ» и Суточный дайджест
  public async getDailyDigest(): Promise<DailyDigestState> {
    return this.handsOffManager.getDailyDigest();
  }

  public async getHandsOffAudit(): Promise<HandsOffAuditReport> {
    return this.handsOffManager.getHandsOffAuditReport();
  }

  public async runHandsOffVerification(): Promise<HandsOffAuditReport> {
    const rep = this.handsOffManager.runHandsOffAudit();
    this.state.handsOffAudit = rep;
    this.notify();
    return rep;
  }

  public async triggerLocalPushDigest(): Promise<{ delivered: boolean; titleRu: string; bodyRu: string }> {
    const res = this.handsOffManager.triggerLocalPushDigest();
    this.state.dailyDigest.notificationDelivered = true;
    this.notify();
    return res;
  }

  // =========================================================================
  // STAGE 30: Auditor Findings (Request Inbox, Vital Signs, Journal Export)
  // =========================================================================

  public async exportTradeJournal(format: 'json' | 'csv' = 'csv'): Promise<{ success: boolean; filename: string; recordsCount: number; messageRu: string }> {
    const res = this.journalExporter.exportJournal(this.state.closedDeals, format, this.state);
    return {
      success: res.success,
      filename: res.filename,
      recordsCount: res.recordsCount,
      messageRu: res.messageRu,
    };
  }

  public getVitalSigns(): VitalSignsInfo {
    this.vitalSignsMonitor.recordNetworkResponse();
    const st = this.vitalSignsMonitor.getStatus(
      this.state.balanceSol,
      this.state.gas?.maxFeeSol || 0.002,
      this.state.gas?.referenceFastTipSol || 0.0008
    );
    this.state.vitalSigns = st;
    return st;
  }

  public getRequestInboxQueue(): NeedsYouCard[] {
    return this.requestInbox.getAll();
  }

  public async dismissRequestInboxCard(id?: string): Promise<boolean> {
    if (id) {
      this.requestInbox.resolve(id);
    } else {
      this.requestInbox.pop();
    }
    this.state.needsYou = this.requestInbox.peek();
    this.state.requestInboxCount = this.requestInbox.count();
    this.state.requestInboxList = this.requestInbox.getAll();
    this.state.healthIndicators.needsOperatorHelp = this.state.requestInboxCount > 0;
    this.notify();
    return true;
  }

  public simulateNetworkPing(targetMs?: number): number {
    const ping = this.vitalSignsMonitor.simulatePingVariation(targetMs);
    this.state.vitalSigns = this.vitalSignsMonitor.getStatus(
      this.state.balanceSol,
      this.state.gas?.maxFeeSol || 0.002,
      this.state.gas?.referenceFastTipSol || 0.0008
    );
    // Если пинг критический > 450мс, генерируем предупреждение в Request Inbox
    if (ping > 450) {
      this.requestInbox.push({
        id: 'rpc-ping-warning',
        titleRu: 'Связь RPC: Задержка > 450 мс',
        descriptionRu: `Текущий пинг до узла Solana составляет ${ping} мс. Возможно замедление доставки транзакций через Jito. Рекомендуется проверить качество Wi-Fi / 4G.`,
        severity: 'WARN',
        optionsRu: [
          { action: 'dismiss_inbox_card', labelRu: 'Понятно (продолжать)' },
        ],
      });
      this.state.needsYou = this.requestInbox.peek();
      this.state.requestInboxCount = this.requestInbox.count();
      this.state.requestInboxList = this.requestInbox.getAll();
    }
    this.notify();
    return ping;
  }
}

