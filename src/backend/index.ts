import { EngineBackend } from './engineContract';
import { SimulatorBackendAdapter } from './simulatorAdapter';
import { LiveApkAdapter, CandidateMetric } from './liveApkAdapter';
import { RealSolanaSigningAdapter, createSigningAdapter } from '../signing/signingAdapter';
import { createKeepAwakeAdapter } from '../keepAwakeAdapter';
import { EngineStateV2, OperatingMode, ModeSwitchResult } from '../types/backend';
import { SecureStorage } from '../secureStorage';

export * from '../types/backend';
export * from './engineContract';
export * from './simulatorAdapter';
export * from './liveApkAdapter';
export * from '../signing/signingAdapter';
export * from '../keepAwakeAdapter';

export class LiveApkBackendAdapter extends SimulatorBackendAdapter {
  constructor(signingAdapter?: any, keepAwakeAdapter?: any) {
    super(signingAdapter, keepAwakeAdapter);
    // Подписка на смену FSM состояний для мгновенного обновления UI
    LiveApkAdapter.getInstance().onStateChange(() => {
      this.notify();
    });
  }

  public getBackendType(): 'simulator' | 'live_apk' {
    return 'live_apk';
  }

  public getCustomRpcUrl(): string {
    return SecureStorage.getCustomRpcUrl();
  }

  public async setCustomRpcUrl(rpcUrl: string): Promise<boolean> {
    SecureStorage.storeCustomRpcUrl(rpcUrl);
    return true;
  }

  public async syncRealAccount(): Promise<void> {
    const live = LiveApkAdapter.getInstance();
    const keypair = await SecureStorage.getKeypair();
    const rpcUrl = this.getCustomRpcUrl() || 'https://api.mainnet-beta.solana.com';
    await live.initFromKeypair(keypair, rpcUrl);
    this.notify();
  }

  public async startEngine(mode?: OperatingMode): Promise<ModeSwitchResult> {
    const live = LiveApkAdapter.getInstance();
    const keypair = await SecureStorage.getKeypair();
    const rpcUrl = this.getCustomRpcUrl() || 'https://api.mainnet-beta.solana.com';

    if (!keypair) {
      return {
        success: false,
        mode: 'PAUSED',
        reasonRu: 'Ключ кошелька не найден. Импортируйте сид-фразу в Настройках.',
      };
    }

    const ok = await live.start(keypair, rpcUrl);
    if (!ok) {
      return {
        success: false,
        mode: 'PAUSED',
        reasonRu: `Недостаточно SOL на балансе (${live.balanceSol.toFixed(4)} SOL < 0.01 SOL) или ошибка WSS соединения`,
      };
    }

    this.state.mode = mode || 'MICRO_LIVE';
    this.state.trafficLight = 'AUTONOMOUS';
    this.notify();

    return {
      success: true,
      mode: this.state.mode,
      reasonRu: 'Боевой режим MICRO_LIVE успешно запущен',
    };
  }

  public async pauseEngine(): Promise<void> {
    const live = LiveApkAdapter.getInstance();
    await live.stop('Пауза оператора');
    this.state.mode = 'PAUSED';
    this.state.trafficLight = 'STOPPED';
    this.notify();
  }

  public async emergencyKill(): Promise<void> {
    const live = LiveApkAdapter.getInstance();
    await live.emergencyStop('Аварийный стоп оператора');
    this.state.mode = 'KILLED';
    this.state.trafficLight = 'PROBLEM';
    this.notify();
  }

  public async requestSweep(amountSol: number) {
    const live = LiveApkAdapter.getInstance();
    const res = await this.signingAdapter.signAndSendSweep(amountSol, this.state.wallets.coldVaultPubkey);
    if (res.success) {
      await live.syncRealBalance();
      this.state.balanceSol = live.balanceSol;
      this.state.wallets.sweepsHistory.unshift({
        id: `sw-${Date.now()}`,
        date: 'Только что',
        amountSol,
        target: 'Холодный сейф',
      });
      this.notify();
      return { success: true, amountSol, txSignature: res.txSignature };
    }
    return { success: false, amountSol: 0, errorRu: res.errorRu };
  }

  public getState(): EngineStateV2 {
    const baseState = super.getState();
    const live = LiveApkAdapter.getInstance();

    const activePos = live.activePosition ? {
      symbol: live.activePosition.mint.slice(0, 4).toUpperCase(),
      mint: live.activePosition.mint,
      entrySol: live.activePosition.solInvested,
      entryPriceSol: live.activePosition.entryPriceSol,
      currentPriceSol: live.activePosition.currentPriceSol,
      currentPercent: Number((((live.activePosition.currentPriceSol - live.activePosition.entryPriceSol) / live.activePosition.entryPriceSol) * 100).toFixed(2)),
      holdTimeSec: Math.floor((Date.now() - live.activePosition.entryTimestamp) / 1000),
      stopLossPercent: -15,
    } : null;

    return {
      ...baseState,
      botState: live.state,
      balanceSol: live.balanceSol,
      rejectedByFilters: live.telemetry.rejectedCount,
      activePosition: activePos,
      decisions: live.decisions,
      mode: live.isRunning ? 'MICRO_LIVE' : baseState.mode,
      liveActionTextRu: live.isRunning ? `Мониторинг логов Pump.fun... [WSS: ${live.telemetry.netStatus}]` : baseState.liveActionTextRu,
    };
  }
}

/**
 * Локальный Phone-Host Proxy для управления движком внутри приложения.
 * Без отдельного сервера. По умолчанию запускает безопасный симулятор ядра.
 */
class EngineProxy implements EngineBackend {
  private activeBackend: EngineBackend;
  private simulator: SimulatorBackendAdapter;
  private liveApk: LiveApkBackendAdapter;
  private listeners: ((s: EngineStateV2) => void)[] = [];
  private activeUnsub: (() => void) | null = null;

  constructor() {
    const signing = new RealSolanaSigningAdapter();
    const keepAwake = createKeepAwakeAdapter();
    this.simulator = new SimulatorBackendAdapter(signing, keepAwake);
    this.liveApk = new LiveApkBackendAdapter(signing, keepAwake);
    this.activeBackend = this.liveApk;
    this.attachActiveBackend();
  }

  private attachActiveBackend() {
    if (this.activeUnsub) {
      this.activeUnsub();
    }
    this.activeUnsub = this.activeBackend.subscribe((s) => {
      this.listeners.forEach((cb) => cb(s));
    });
  }

  public switchToSimulator() {
    // В боевом режиме переключение на симулятор заблокировано
    this.activeBackend = this.liveApk;
    this.attachActiveBackend();
  }

  public switchToLiveApk() {
    this.activeBackend = this.liveApk;
    this.attachActiveBackend();
  }

  public getState() {
    return this.activeBackend.getState();
  }

  public subscribe(cb: (s: EngineStateV2) => void) {
    this.listeners.push(cb);
    cb(this.activeBackend.getState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  public getBackendType() {
    return this.activeBackend.getBackendType();
  }

  public getSigningAdapter() {
    return this.activeBackend.getSigningAdapter();
  }

  public getKeepAwakeAdapter() {
    return this.activeBackend.getKeepAwakeAdapter();
  }

  public async syncRealAccount() {
    if (this.activeBackend.syncRealAccount) {
      await this.activeBackend.syncRealAccount();
    }
  }

  public async setRiskLimits(limits: { maxTradeSol?: number; maxDailyLossSol?: number; maxConsecutiveLosses?: number }) {
    if (this.activeBackend.setRiskLimits) {
      await this.activeBackend.setRiskLimits(limits);
    }
  }

  public getCustomRpcUrl(): string {
    if (this.activeBackend.getCustomRpcUrl) {
      return this.activeBackend.getCustomRpcUrl();
    }
    return '';
  }

  public async setCustomRpcUrl(rpcUrl: string): Promise<boolean> {
    if (this.activeBackend.setCustomRpcUrl) {
      return await this.activeBackend.setCustomRpcUrl(rpcUrl);
    }
    return false;
  }

  public getTopCorridorCandidates() {
    if (this.activeBackend.getTopCorridorCandidates) {
      return this.activeBackend.getTopCorridorCandidates();
    }
    return [];
  }

  public getStatus() {
    return this.activeBackend.getStatus();
  }

  public getHealth() {
    return this.activeBackend.getHealth();
  }

  public getLiveAction() {
    return this.activeBackend.getLiveAction();
  }

  public getMoney() {
    return this.activeBackend.getMoney();
  }

  public getDecisions(n?: number) {
    return this.activeBackend.getDecisions(n);
  }

  public getNeedsYou() {
    return this.activeBackend.getNeedsYou();
  }

  public getMarketCandidates() {
    return this.activeBackend.getMarketCandidates();
  }

  public getSmartMoneyList() {
    return this.activeBackend.getSmartMoneyList();
  }

  public getTrends() {
    return this.activeBackend.getTrends();
  }

  public getHistory(filter?: string) {
    return this.activeBackend.getHistory(filter);
  }

  public getParcel(dealId: string) {
    return this.activeBackend.getParcel(dealId);
  }

  public getTrackingTransactions() {
    return this.activeBackend.getTrackingTransactions();
  }

  public getCommissionPolicy() {
    return this.activeBackend.getCommissionPolicy();
  }

  public getGasSettings() {
    return this.activeBackend.getGasSettings();
  }

  public getInvariantsStatus() {
    return this.activeBackend.getInvariantsStatus();
  }

  public getPreflight() {
    return this.activeBackend.getPreflight();
  }

  public getPreflightChecklist() {
    return this.activeBackend.getPreflightChecklist();
  }

  public getStrategyParams() {
    return this.activeBackend.getStrategyParams();
  }

  public getKeepAwakeStatus() {
    return this.activeBackend.getKeepAwakeStatus();
  }

  public startEngine(mode?: any) {
    if (mode === 'MICRO_LIVE' || mode === 'LIVE') {
      this.switchToLiveApk();
      return this.liveApk.startEngine(mode);
    }
    return this.activeBackend.startEngine(mode);
  }

  public pauseEngine() {
    return this.activeBackend.pauseEngine();
  }

  public emergencyKill() {
    return this.activeBackend.emergencyKill();
  }

  public setMode(mode: any) {
    if (mode === 'MICRO_LIVE' || mode === 'LIVE') {
      this.switchToLiveApk();
      return this.liveApk.setMode(mode);
    }
    return this.activeBackend.setMode(mode);
  }

  public armAutopilot(enabled: boolean) {
    return this.activeBackend.armAutopilot(enabled);
  }

  public setDockMode(on: boolean) {
    return this.activeBackend.setDockMode(on);
  }

  public submitOperatorChoice(action: string) {
    return this.activeBackend.submitOperatorChoice(action);
  }

  public requestSweep(amountSol: number) {
    return this.activeBackend.requestSweep(amountSol);
  }

  public sweepProfit() {
    return this.activeBackend.sweepProfit();
  }

  public changeHotWallet(newPubkey: string) {
    return this.activeBackend.changeHotWallet(newPubkey);
  }

  public setCommissionPolicy(policy: any) {
    return this.activeBackend.setCommissionPolicy(policy);
  }

  public updateGasSettings(partial: any) {
    return this.activeBackend.updateGasSettings(partial);
  }

  public updateStrategyParams(partial: any) {
    return this.activeBackend.updateStrategyParams(partial);
  }

  public runDryRun() {
    return this.activeBackend.runDryRun();
  }

  public runSelftest(scope?: string) {
    return this.activeBackend.runSelftest(scope);
  }

  public runSelfTest() {
    return this.activeBackend.runSelfTest();
  }

  public captureCapsule(windowSec?: number) {
    return this.activeBackend.captureCapsule(windowSec);
  }

  public replayCapsule(id: string) {
    return this.activeBackend.replayCapsule(id);
  }

  public proposeCandidates(session?: string) {
    return this.activeBackend.proposeCandidates(session);
  }

  public promoteCandidate(version: string, confirmToken?: string) {
    return this.activeBackend.promoteCandidate(version, confirmToken);
  }

  public rollbackParams(version: string) {
    return this.activeBackend.rollbackParams(version);
  }

  public rollbackToPinned() {
    return this.activeBackend.rollbackToPinned();
  }

  public getRegimeStatus() {
    return this.activeBackend.getRegimeStatus();
  }

  public runEvolutionCycle() {
    return this.activeBackend.runEvolutionCycle();
  }

  public getEvolutionSchedulerInfo() {
    return this.activeBackend.getEvolutionSchedulerInfo();
  }

  public setPreauthorizedBound(bound: any) {
    return this.activeBackend.setPreauthorizedBound(bound);
  }

  public setSchedulerPaused(paused: boolean) {
    return this.activeBackend.setSchedulerPaused(paused);
  }

  public getMicroLiveStatus() {
    return this.activeBackend.getMicroLiveStatus();
  }

  public setKeySelection(keyType: any) {
    return this.activeBackend.setKeySelection(keyType);
  }

  public getScalingCanaryStatus() {
    return this.activeBackend.getScalingCanaryStatus();
  }

  public requestScaleStep() {
    return this.activeBackend.requestScaleStep();
  }

  public confirmScaleStep() {
    return this.activeBackend.confirmScaleStep();
  }

  public rollbackScaleStep() {
    return this.activeBackend.rollbackScaleStep();
  }

  public runHardeningAudit() {
    return this.activeBackend.runHardeningAudit();
  }

  // Stage 27: Полная автономность «Под ключ» и Суточный дайджест
  public getDailyDigest() {
    return this.activeBackend.getDailyDigest();
  }

  public getHandsOffAudit() {
    return this.activeBackend.getHandsOffAudit();
  }

  public runHandsOffVerification() {
    return this.activeBackend.runHandsOffVerification();
  }

  public triggerLocalPushDigest() {
    return this.activeBackend.triggerLocalPushDigest();
  }

  // Stage 30: Подсистемы A, B, C
  public exportTradeJournal(format?: 'json' | 'csv') {
    return this.activeBackend.exportTradeJournal(format);
  }

  public getVitalSigns() {
    return this.activeBackend.getVitalSigns();
  }

  public getRequestInboxQueue() {
    return this.activeBackend.getRequestInboxQueue();
  }

  public dismissRequestInboxCard(id?: string) {
    return this.activeBackend.dismissRequestInboxCard(id);
  }

  public simulateNetworkPing(targetMs?: number) {
    return this.activeBackend.simulateNetworkPing(targetMs);
  }
}

export const ActiveEngine = new EngineProxy();
export const EngineBackendInstance = ActiveEngine;
