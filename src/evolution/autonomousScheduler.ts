import {
  MarketRegime,
  RegimeFeatureVector,
  CandidateDials,
  GenerationLedgerItem,
  SchedulerStatusInfo,
  ShadowEvaluationReport,
} from './types';
import { detectMarketRegime, RegimeDetectionResult } from './regimeDetector';
import { proposeDialsForRegime } from './dialOptimizer';
import { evaluateCandidateInShadow, PINNED_BASELINE_V32, BaselineMetrics } from './shadowReplayEngine';
import { ClosedDealItem, PreauthorizedBound, StrategyCandidate } from '../types/backend';

export interface EvolutionCycleOutput {
  cycleIndex: number;
  timestamp: string;
  regime: MarketRegime;
  regimeRu: string;
  confidencePct: number;
  shadowReport: ShadowEvaluationReport;
  actionTakenRu: string;
  autoPromoted: boolean;
  rollbackTriggered: boolean;
  activeVersion: string;
}

export type EvolutionStateListener = (info: SchedulerStatusInfo) => void;

/**
 * AUTONOMOUS EVOLUTION CORE & SCHEDULER
 * 
 * RUNTIME AUTONOMY CLAUSE v2:
 * Работает локально в приложении на телефоне как фоновая задача (WorkManager/alarm + wake lock).
 * Никакого чата, внешних серверов или облачного ИИ во время торгов.
 * 
 * Квантовые методики в ядре:
 * 1. Regime Detection: Unsupervised HMM / GMM кластеризация вектора признаков (Rabiner 1989, Hamilton 1989).
 * 2. Dial Optimization: Multi-Armed Bandit / Thompson Sampling по безопасным коридорам (Auer 2002, Agrawal 2012).
 * 3. Validation: Walk-Forward Out-Of-Sample симуляция на локальных капсулах (Pardo 2008).
 * 4. Objective: Risk-Adjusted Expectancy за вычетом всех комиссий, чаевых и slippage (Sortino 1994).
 * 5. Drift Guard: Автоматический откат на проверенный checkpoint при деградации (Widmer & Kubat 1996 'Concept Drift').
 * 6. Feedback Control: PID-подобная балансировка чаевых Jito под скорость включения в блок (Aström & Murray 2008).
 */
export class AutonomousEvolutionScheduler {
  private isRunning: boolean = true;
  private intervalSec: number = 45;
  private nextCycleInSec: number = 45;
  private timer: any = null;
  private countdownTimer: any = null;
  private totalCyclesRun: number = 0;
  private lastCycleTimestamp: string | null = null;
  private lastCycleResultRu: string = 'Инициализирован. Ожидание первого такта...';
  
  private pinnedBaseline: BaselineMetrics = { ...PINNED_BASELINE_V32 };
  private activeVersion: string = PINNED_BASELINE_V32.version;
  
  private activeDials: CandidateDials = {
    greed: 70,
    exitSpeed: 85,
    scamSuspicion: 90,
    trendTrust: 50,
    commissionAggression: 0.0008,
    followSmartMoney: true,
    socialTrends: true,
  };

  private currentRegimeResult: RegimeDetectionResult;
  private preauthorizedBound: PreauthorizedBound = 'CONSERVATIVE_10';
  private ledger: GenerationLedgerItem[] = [];
  private listeners: EvolutionStateListener[] = [];
  
  // Колбэки для интеграции с движком
  private onStateUpdated?: () => void;
  private getClosedDealsFn?: () => ClosedDealItem[];

  constructor(options?: {
    getClosedDeals?: () => ClosedDealItem[];
    onStateUpdated?: () => void;
  }) {
    this.getClosedDealsFn = options?.getClosedDeals;
    this.onStateUpdated = options?.onStateUpdated;

    // Первичная детекция режима
    const initialFeatures = this.collectFeatureVector();
    this.currentRegimeResult = detectMarketRegime(initialFeatures);

    // Добавляем начальную запись в леджер
    this.ledger.push({
      id: 'init-v32',
      timestamp: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      version: 'v3.2-standard',
      regime: this.currentRegimeResult.regime,
      regimeRu: this.currentRegimeResult.regimeRu,
      status: 'ACTIVE_PINNED',
      statusRu: 'Базовый проверенный пресет',
      dials: { ...this.activeDials },
      netExpectancyPct: 5.4,
      maxDrawdownPct: 2.1,
      scoreDeltaPct: 0,
      explanationRu: 'Заводская проверенная конфигурация с жесткими математическими триггерами.',
    });

    this.startScheduler();
  }

  public setCallbacks(getClosedDeals: () => ClosedDealItem[], onStateUpdated: () => void) {
    this.getClosedDealsFn = getClosedDeals;
    this.onStateUpdated = onStateUpdated;
  }

  private startScheduler() {
    if (typeof window === 'undefined') return;

    // Таймер обратного отсчета (секундомер)
    this.countdownTimer = setInterval(() => {
      if (!this.isRunning) return;
      this.nextCycleInSec = Math.max(0, this.nextCycleInSec - 1);
      if (this.nextCycleInSec <= 0) {
        this.nextCycleInSec = this.intervalSec;
        this.runCycle();
      }
      this.notifyListeners();
    }, 1000);
  }

  /**
   * Сбор вектора признаков с блокчейна и локального холодного пути
   */
  public collectFeatureVector(): RegimeFeatureVector {
    // В реальном APK берется из Yellowstone gRPC + AccountSubscribe + Cold Path
    // В симуляторе генерирует реалистичный срез рынка
    const hour = new Date().getHours();
    const isWeekend = [0, 6].includes(new Date().getDay());

    let buyerInflow = 42 + Math.floor((Math.random() - 0.4) * 20);
    const blockTip = 0.0008 + (Math.random() - 0.4) * 0.0006;
    let liquidity = 32.5 + (Math.random() - 0.5) * 8;
    const fundingDensity = 24 + Math.floor(Math.random() * 20);

    if (isWeekend) {
      buyerInflow = Math.max(12, buyerInflow - 20);
      liquidity = Math.max(10, liquidity - 12);
    }

    return {
      buyerInflowVelocity: buyerInflow,
      buyerDispersionScore: 78,
      blockCompetitionTipSol: Number(blockTip.toFixed(4)),
      liquidityDepthSol: Number(liquidity.toFixed(1)),
      bidAskSpreadPct: 1.1,
      fundingClusterDensityPct: fundingDensity,
      socialVelocityScore: 65,
      socialSpamScorePct: 18,
      botLandedRatePct: 86,
      botActualSlippagePct: 1.15,
      botNetExpectancyPct: this.pinnedBaseline.netExpectancyPct,
      botMaxDrawdownPct: this.pinnedBaseline.maxDrawdownPct,
      botConsecutiveLosses: 0,
    };
  }

  /**
   * Выполнение одного такта эволюции (доступно как по расписанию, так и по кнопке оператора)
   */
  public runCycle(): EvolutionCycleOutput {
    this.totalCyclesRun++;
    const nowStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.lastCycleTimestamp = nowStr;

    // 1. Детекция текущего режима рынка
    const features = this.collectFeatureVector();
    this.currentRegimeResult = detectMarketRegime(features);

    // 2. Генерация кандидата внутри безопасного коридора (Правило 2: кандидат пишется только в слот)
    const { candidateDials, version, titleRu } = proposeDialsForRegime(
      this.activeDials,
      this.currentRegimeResult.corridors,
      this.totalCyclesRun
    );

    // 3. Теневая оценка в песочнице на исторических сделках (Shadow Replay)
    const deals = this.getClosedDealsFn ? this.getClosedDealsFn() : [];
    const shadowReport = evaluateCandidateInShadow(
      version,
      candidateDials,
      this.currentRegimeResult.corridors,
      deals,
      this.pinnedBaseline
    );

    let actionTakenRu = '';
    let autoPromoted = false;
    const rollbackTriggered = false;

    // 4. Проверка условий продвижения / отклонения
    if (!shadowReport.passed) {
      actionTakenRu = shadowReport.rejectReasonRu || 'Отклонен: не прошел тест чистой доходности';
      this.ledger.unshift({
        id: `gen-${this.totalCyclesRun}`,
        timestamp: nowStr,
        version,
        regime: this.currentRegimeResult.regime,
        regimeRu: this.currentRegimeResult.regimeRu,
        status: 'REJECTED',
        statusRu: 'Отклонен песочницей',
        dials: candidateDials,
        netExpectancyPct: shadowReport.candidateNetExpectancyPct,
        maxDrawdownPct: shadowReport.candidateMaxDrawdownPct,
        scoreDeltaPct: shadowReport.netExpectancyDeltaPct,
        explanationRu: actionTakenRu,
      });
    } else if (shadowReport.confirmationTokenNeeded) {
      // Требуется подтверждение оператора (Правило 3: повышение риска)
      actionTakenRu = `Кандидат подготовлен. Требуется подтверждение: ${shadowReport.confirmationToken}`;
      this.ledger.unshift({
        id: `gen-${this.totalCyclesRun}`,
        timestamp: nowStr,
        version,
        regime: this.currentRegimeResult.regime,
        regimeRu: this.currentRegimeResult.regimeRu,
        status: 'CONFIRMATION_PENDING',
        statusRu: 'Ждет токена оператора',
        dials: candidateDials,
        netExpectancyPct: shadowReport.candidateNetExpectancyPct,
        maxDrawdownPct: shadowReport.candidateMaxDrawdownPct,
        scoreDeltaPct: shadowReport.netExpectancyDeltaPct,
        explanationRu: `Прибыль выше (+${shadowReport.candidateNetExpectancyPct}%), но параметры повышают риск. Введен токен для защиты.`,
      });
    } else {
      // Авто-применение в рамках предодобренного коридора
      const canAutoPromote =
        this.preauthorizedBound !== 'CONFIRM_EACH' &&
        shadowReport.netExpectancyDeltaPct >= 0 &&
        shadowReport.candidateMaxDrawdownPct <= this.pinnedBaseline.maxDrawdownPct;

      if (canAutoPromote) {
        autoPromoted = true;
        this.activeDials = { ...candidateDials };
        this.activeVersion = version;
        actionTakenRu = `Авто-продвижение: чистая прибыль +${shadowReport.candidateNetExpectancyPct}% (дельта +${shadowReport.netExpectancyDeltaPct}%), просадка ${shadowReport.candidateMaxDrawdownPct}%.`;
        this.ledger.unshift({
          id: `gen-${this.totalCyclesRun}`,
          timestamp: nowStr,
          version,
          regime: this.currentRegimeResult.regime,
          regimeRu: this.currentRegimeResult.regimeRu,
          status: 'AUTO_PROMOTED',
          statusRu: 'Применен автоматически',
          dials: candidateDials,
          netExpectancyPct: shadowReport.candidateNetExpectancyPct,
          maxDrawdownPct: shadowReport.candidateMaxDrawdownPct,
          scoreDeltaPct: shadowReport.netExpectancyDeltaPct,
          explanationRu: actionTakenRu,
        });
      } else {
        actionTakenRu = 'Кандидат одобрен, но ожидает ручного переключения (режим строгого подтверждения)';
      }
    }

    // Ограничиваем историю леджера 25 записями
    if (this.ledger.length > 25) {
      this.ledger = this.ledger.slice(0, 25);
    }

    this.lastCycleResultRu = actionTakenRu;
    this.notifyListeners();
    if (this.onStateUpdated) this.onStateUpdated();

    return {
      cycleIndex: this.totalCyclesRun,
      timestamp: nowStr,
      regime: this.currentRegimeResult.regime,
      regimeRu: this.currentRegimeResult.regimeRu,
      confidencePct: this.currentRegimeResult.confidencePct,
      shadowReport,
      actionTakenRu,
      autoPromoted,
      rollbackTriggered,
      activeVersion: this.activeVersion,
    };
  }

  /**
   * Проверка условий авто-отката (Правило 4):
   * Вызывается при обновлении состояния торгов (сделка или капсула)
   */
  public checkAndTriggerAutoRollback(recentLossStreak: number, currentDrawdownPct: number): boolean {
    if (this.activeVersion === PINNED_BASELINE_V32.version) {
      return false; // Уже на базе
    }

    const isDegraded =
      recentLossStreak >= 3 ||
      currentDrawdownPct > 2.5;

    if (isDegraded) {
      this.rollbackToPinned(
        `Сработал авто-откат (Правило 4): серия из ${recentLossStreak} убытков или просадка ${currentDrawdownPct}% > 2.5%.`
      );
      return true;
    }

    return false;
  }

  /**
   * Откат к проверенной заводской базе
   */
  public rollbackToPinned(reasonRu?: string): void {
    const prevVersion = this.activeVersion;
    this.activeVersion = PINNED_BASELINE_V32.version;
    this.activeDials = {
      greed: 70,
      exitSpeed: 85,
      scamSuspicion: 90,
      trendTrust: 50,
      commissionAggression: 0.0008,
      followSmartMoney: true,
      socialTrends: true,
    };

    const nowStr = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const explanation = reasonRu || `Ручной откат с версии ${prevVersion} на проверенную стабильную базу v3.2.`;

    this.ledger.unshift({
      id: `rollback-${Date.now()}`,
      timestamp: nowStr,
      version: PINNED_BASELINE_V32.version,
      regime: this.currentRegimeResult.regime,
      regimeRu: this.currentRegimeResult.regimeRu,
      status: 'ROLLED_BACK',
      statusRu: 'Выполнен откат',
      dials: { ...this.activeDials },
      netExpectancyPct: PINNED_BASELINE_V32.netExpectancyPct,
      maxDrawdownPct: PINNED_BASELINE_V32.maxDrawdownPct,
      scoreDeltaPct: 0,
      explanationRu: explanation,
    });

    this.lastCycleResultRu = explanation;
    this.notifyListeners();
    if (this.onStateUpdated) this.onStateUpdated();
  }

  public getStatusInfo(): SchedulerStatusInfo {
    return {
      isRunning: this.isRunning,
      intervalSec: this.intervalSec,
      nextCycleInSec: this.nextCycleInSec,
      totalCyclesRun: this.totalCyclesRun,
      lastCycleTimestamp: this.lastCycleTimestamp,
      lastCycleResultRu: this.lastCycleResultRu,
      pinnedVersion: this.activeVersion,
      currentRegime: this.currentRegimeResult.regime,
      currentRegimeRu: this.currentRegimeResult.regimeRu,
      regimeConfidencePct: this.currentRegimeResult.confidencePct,
    };
  }

  public getRegimeResult(): RegimeDetectionResult {
    return this.currentRegimeResult;
  }

  public getActiveDials(): CandidateDials {
    return { ...this.activeDials };
  }

  public getLedger(): GenerationLedgerItem[] {
    return [...this.ledger];
  }

  public getPreauthorizedBound(): PreauthorizedBound {
    return this.preauthorizedBound;
  }

  public setPreauthorizedBound(bound: PreauthorizedBound): void {
    this.preauthorizedBound = bound;
    this.notifyListeners();
  }

  public setPaused(paused: boolean): void {
    this.isRunning = !paused;
    this.notifyListeners();
  }

  public subscribe(listener: EvolutionStateListener): () => void {
    this.listeners.push(listener);
    listener(this.getStatusInfo());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    const status = this.getStatusInfo();
    this.listeners.forEach((fn) => fn(status));
  }

  public destroy(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.timer) clearInterval(this.timer);
  }
}
