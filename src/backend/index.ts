import { EngineBackend } from './engineContract';
import { SimulatorBackendAdapter } from './simulatorAdapter';
import { LiveApkBackendAdapter } from './liveApkAdapter';
import { RealSolanaSigningAdapter, createSigningAdapter } from '../signing/signingAdapter';
import { createKeepAwakeAdapter } from '../keepAwakeAdapter';
import { EngineStateV2 } from '../types/backend';

export * from '../types/backend';
export * from './engineContract';
export * from './simulatorAdapter';
export * from './liveApkAdapter';
export * from '../signing/signingAdapter';
export * from '../keepAwakeAdapter';

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
    this.activeBackend = this.simulator;
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
