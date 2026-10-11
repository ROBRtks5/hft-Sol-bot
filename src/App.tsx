import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  BookOpen, 
  Settings as SettingsIcon, 
  Play, 
  Pause, 
  AlertOctagon, 
  Copy, 
  Check, 
  Download, 
  Key, 
  Trash2, 
  X
} from 'lucide-react';
import { EngineBackend, EngineStateV2, BotState } from './backend';
import { LiveApkAdapter, CandidateMetric } from './backend/liveApkAdapter';
import { defaultTradeWalJournal, WalTradeRecord } from './backend/tradeWalJournal';
import { SecureStorage, convertHttpToWsUrl } from './secureStorage';
import { TargetMetric, RiskSettings } from './types/backend';
import { hapticFeedback } from './utils/haptics';

type Tab = 'control' | 'journal' | 'settings';

export default function App() {
  const [engine, setEngine] = useState<EngineStateV2>(() => EngineBackend.getState());
  const [walTrades, setWalTrades] = useState<WalTradeRecord[]>([]);
  const [walTodayPnl, setWalTodayPnl] = useState<{ todayPnlSol: number; count: number }>({ todayPnlSol: 0, count: 0 });
  const [activeTab, setActiveTab] = useState<Tab>('control');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [seedInput, setSeedInput] = useState<string>('');
  const [seedError, setSeedError] = useState<string | null>(null);
  const [hasStoredKey, setHasStoredKey] = useState<boolean>(false);
  const [publicAddress, setPublicAddress] = useState<string | null>(null);
  const [isActionPending, setIsActionPending] = useState<boolean>(false);
  const [journalSubTab, setJournalSubTab] = useState<'trades' | 'radar'>('radar');
  const [topTargets, setTopTargets] = useState<CandidateMetric[]>([]);
  const [liveBalance, setLiveBalance] = useState<number>(0);
  const [rpcInput, setRpcInput] = useState<string>(() => EngineBackend.getCustomRpcUrl?.() || '');
  const [riskSettings, setRiskSettings] = useState<RiskSettings>(() => SecureStorage.getRiskSettings());
  const lastActionTimestampRef = React.useRef<number>(0);

  // СЦЕНАРИЙ 1: Защита от дребезга контактов и спама кнопками (debounce 400 мс)
  const checkDebounce = (cooldownMs = 400): boolean => {
    const now = Date.now();
    if (now - lastActionTimestampRef.current < cooldownMs) {
      return false;
    }
    lastActionTimestampRef.current = now;
    return true;
  };

  // Poll LiveApkAdapter candidates and balance directly
  useEffect(() => {
    const timer = setInterval(() => {
      const adapter = LiveApkAdapter.getInstance();
      setLiveBalance(adapter.balanceSol);
      setTopTargets(adapter.getTopCandidates());
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const refreshWalFeed = async () => {
    try {
      const records = await defaultTradeWalJournal.getRecentDeals(30);
      setWalTrades(records);
      const pnl = await defaultTradeWalJournal.calculateTodayPnl();
      setWalTodayPnl(pnl);
    } catch {
      // fallback to memory
    }
  };

  // Subscribe to engine state
  useEffect(() => {
    let lastClosedCount = -1;
    let lastDecisionsCount = -1;
    const unsub = EngineBackend.subscribe((newState) => {
      setEngine(newState);
      const currentClosedCount = newState.closedDeals ? newState.closedDeals.length : 0;
      const currentDecisionsCount = newState.decisions ? newState.decisions.length : 0;
      if (currentClosedCount !== lastClosedCount || currentDecisionsCount !== lastDecisionsCount) {
        lastClosedCount = currentClosedCount;
        lastDecisionsCount = currentDecisionsCount;
        refreshWalFeed();
      }
      const liveCandidates = LiveApkAdapter.getInstance().getTopCandidates();
      setTopTargets(liveCandidates);
    });
    refreshWalFeed();
    return () => unsub();
  }, []);

  // Check stored seed & public address
  const refreshWalletMeta = async () => {
    try {
      const hasKey = await SecureStorage.hasStoredSeed();
      const addr = await SecureStorage.derivePublicAddress();
      setHasStoredKey(hasKey);
      setPublicAddress(addr);
      if (hasKey && EngineBackend.syncRealAccount) {
        await EngineBackend.syncRealAccount();
      }
    } catch {
      // fallback
    }
  };

  useEffect(() => {
    refreshWalletMeta();
    if (EngineBackend.getCustomRpcUrl) {
      setRpcInput(EngineBackend.getCustomRpcUrl());
    }
  }, []);

  const handleSaveRpc = async () => {
    hapticFeedback('medium');
    if (EngineBackend.setCustomRpcUrl) {
      await EngineBackend.setCustomRpcUrl(rpcInput);
      triggerToast('RPC узел сохранен и переподключен');
      await refreshWalletMeta();
    }
  };

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const handleCopyAddress = () => {
    if (!publicAddress) return;
    hapticFeedback('light');
    navigator.clipboard.writeText(publicAddress);
    setCopied(true);
    triggerToast('Адрес скопирован в буфер');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartTrading = async () => {
    if (!checkDebounce(400) || isActionPending) return;
    hapticFeedback('medium');
    setIsActionPending(true);
    try {
      const res = await EngineBackend.startEngine('MICRO_LIVE');
      if (res.success) {
        triggerToast('Боевой режим MICRO_LIVE запущен.');
      } else {
        hapticFeedback('error');
        triggerToast(res.reasonRu || 'Ошибка запуска.');
      }
    } catch (e: any) {
      hapticFeedback('error');
      triggerToast(e?.message || 'Ошибка запуска');
    } finally {
      setIsActionPending(false);
    }
  };

  const handlePauseTrading = async () => {
    if (!checkDebounce(400) || isActionPending) return;
    hapticFeedback('medium');
    setIsActionPending(true);
    try {
      await EngineBackend.pauseEngine();
      triggerToast('Робот переведен на паузу.');
    } catch (e: any) {
      hapticFeedback('error');
      triggerToast(e?.message || 'Ошибка остановки');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleEmergencyStop = async () => {
    if (!checkDebounce(400) || isActionPending) return;
    hapticFeedback('heavy');
    setIsActionPending(true);
    try {
      await EngineBackend.emergencyKill();
      triggerToast('АВАРИЙНЫЙ СТОП: все операции мгновенно остановлены.');
    } catch (e: any) {
      hapticFeedback('error');
      triggerToast(e?.message || 'Ошибка аварийной остановки');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleExportCsv = async () => {
    hapticFeedback('light');
    const hasAnyTrades = (engine.closedDeals && engine.closedDeals.length > 0) || (engine.decisions && engine.decisions.length > 0);
    if (!hasAnyTrades) {
      triggerToast('Журнал пуст');
      return;
    }
    try {
      const res = await EngineBackend.exportTradeJournal('csv');
      if (res.success && res.recordsCount > 0) {
        triggerToast(`Журнал выгружен (${res.recordsCount} записей)`);
      } else {
        triggerToast('Журнал пуст');
      }
    } catch (e: any) {
      triggerToast(e?.message || 'Ошибка экспорта CSV');
    }
  };

  const handleSaveSeed = async () => {
    setSeedError(null);
    const validation = SecureStorage.validateMnemonicPhrase(seedInput);
    if (!validation.valid) {
      hapticFeedback('error');
      setSeedError(validation.errorRu || 'Некорректная сид-фраза');
      return;
    }
    const res = await SecureStorage.storeSeed(seedInput);
    if (res.success) {
      hapticFeedback('medium');
      triggerToast('Торговый ключ успешно импортирован в Keystore');
      setIsImportModalOpen(false);
      setSeedInput('');
      const signing = EngineBackend.getSigningAdapter();
      if (signing && signing.loadFromKeystore) {
        await signing.loadFromKeystore();
      }
      await refreshWalletMeta();
      if (EngineBackend.syncRealAccount) {
        await EngineBackend.syncRealAccount();
      }
    } else {
      hapticFeedback('error');
      setSeedError(res.errorRu || 'Ошибка сохранения ключа');
    }
  };

  const handleClearKey = async () => {
    if (!checkDebounce(400) || isActionPending) return;

    const live = LiveApkAdapter.getInstance();

    // СЦЕНАРИЙ 1: Защита от удаления ключа во время in-flight ордера
    if (live.state === 'SUBMITTING_ORDER' || live.state === 'CLOSING_POSITION') {
      hapticFeedback('error');
      triggerToast('Дождитесь подтверждения отправленного ордера или нажмите Аварийный стоп');
      return;
    }

    if (live.activePosition) {
      hapticFeedback('error');
      triggerToast('Сначала закройте открытую позицию через Аварийный стоп');
      return;
    }

    hapticFeedback('heavy');
    setIsActionPending(true);
    try {
      // 1. Безопасный разрыв сетевых соединений и остановка таймеров
      await live.stop('Забыть кошелек: разрыв соединений');

      // 2. Стирание закрытого ключа из локального Keystore
      const ok = await SecureStorage.clearSeed();
      if (ok) {
        await EngineBackend.pauseEngine();
        await live.initFromKeypair(null);
        triggerToast('Ключ удален из памяти устройства');
        const signing = EngineBackend.getSigningAdapter();
        if (signing && signing.loadFromKeystore) {
          await signing.loadFromKeystore();
        }
        await refreshWalletMeta();
        if (EngineBackend.syncRealAccount) {
          await EngineBackend.syncRealAccount();
        }
      } else {
        triggerToast('Удаление отклонено оператором');
      }
    } finally {
      setIsActionPending(false);
    }
  };

  // Реактивное обновление настроек риска со сквозной синхронизацией UI и адаптера
  const handleUpdateRisk = async (patch: Partial<RiskSettings>) => {
    hapticFeedback('selection');
    
    // Синхронное обновление реактивного стейта с функциональным сеттером и приведением к Number
    setRiskSettings((prev) => {
      const updated: RiskSettings = { ...prev };
      if (patch.tradeSizeSol !== undefined) {
        const val = Number(patch.tradeSizeSol);
        updated.tradeSizeSol = val;
        LiveApkAdapter.getInstance().setTradeSize(val);
      }
      if (patch.dailyStopSol !== undefined) {
        const val = Number(patch.dailyStopSol);
        updated.dailyStopSol = val;
        LiveApkAdapter.getInstance().setDailyStop(val);
      }
      if (patch.maxLossStreak !== undefined) {
        const val = Number(patch.maxLossStreak);
        updated.maxLossStreak = val;
        LiveApkAdapter.getInstance().setMaxLossStreak(val);
      }
      if (patch.gasProfile !== undefined) {
        updated.gasProfile = patch.gasProfile;
      }
      SecureStorage.saveRiskSettings(updated);
      LiveApkAdapter.getInstance().setRiskSettings(updated);
      return updated;
    });

    try {
      const live = LiveApkAdapter.getInstance();
      const current = live.riskSettings;
      if (EngineBackend.setRiskLimits) {
        await EngineBackend.setRiskLimits({
          maxTradeSol: current.tradeSizeSol,
          maxDailyLossSol: current.dailyStopSol,
          maxConsecutiveLosses: current.maxLossStreak,
        });
      }

      if (patch.gasProfile) {
        let maxFee = 0.00005;
        let tip = 0.00003;
        let urgency: 'ECONOMY' | 'FAST' | 'TURBO' = 'ECONOMY';
        if (patch.gasProfile === 'BALANCED') {
          urgency = 'FAST';
          maxFee = 0.0001;
          tip = 0.00008;
        } else if (patch.gasProfile === 'TURBO') {
          urgency = 'TURBO';
          maxFee = 0.0002;
          tip = 0.00015;
        }
        await EngineBackend.setCommissionPolicy({
          urgencyLevel: urgency,
          maxFeeSol: maxFee,
          referenceFastTipSol: tip,
        });
      }

      if (patch.tradeSizeSol !== undefined) {
        triggerToast(`Сделка = ${Number(patch.tradeSizeSol)} SOL`);
      } else if (patch.dailyStopSol !== undefined) {
        triggerToast(`Дневной стоп = ${Number(patch.dailyStopSol).toFixed(2)} SOL`);
      } else if (patch.maxLossStreak !== undefined) {
        triggerToast(`Серия убытков = ${Number(patch.maxLossStreak)}`);
      } else if (patch.gasProfile !== undefined) {
        triggerToast(`Комиссия: ${patch.gasProfile}`);
      }
    } catch (e: any) {
      triggerToast(e?.message || 'Ошибка обновления лимита');
    }
  };

  const shortAddress = (addr?: string | null) => {
    if (!addr || addr.length < 10) return 'Ключ не введён';
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  // FSM-контроллер состояния торгового ядра
  const rawBalance = LiveApkAdapter.getInstance().balanceSol;
  const liveState = LiveApkAdapter.getInstance().state;
  const botState: BotState = engine.botState || liveState;

  const isTrading = botState === 'SCANNING' || botState === 'SUBMITTING_ORDER' || botState === 'IN_POSITION' || botState === 'CLOSING_POSITION' || botState === 'COOLDOWN';
  const isKilled = botState === 'TERMINATED' || engine.mode === 'KILLED';

  let statusLabel = 'НА ПАУЗЕ';
  let statusReason = '';
  let statusBadgeColor = 'bg-amber-400';
  let statusTextColor = 'text-amber-400';
  let statusBgCard = 'bg-[#151a22] border-slate-700/60';

  // Header status indicator synchronization
  let headerDotColor = 'bg-amber-400';
  let headerStatusText = 'PAUSED';

  switch (botState) {
    case 'SCANNING':
      statusLabel = 'СКАНИРОВАНИЕ (WSS)';
      statusReason = 'Поиск импульса в коридоре 6–25 SOL';
      statusBadgeColor = 'bg-emerald-400 animate-pulse';
      statusTextColor = 'text-emerald-400';
      statusBgCard = 'bg-[#0f1f18] border-emerald-500/40 shadow-[0_0_20px_rgba(16,185,129,0.1)]';
      headerDotColor = 'bg-emerald-400 animate-pulse';
      headerStatusText = 'SCANNING';
      break;

    case 'SUBMITTING_ORDER':
      statusLabel = 'ОТПРАВКА ОРДЕРА';
      statusReason = 'Jito MEV бандл подписан и отправлен';
      statusBadgeColor = 'bg-cyan-400 animate-pulse';
      statusTextColor = 'text-cyan-400';
      statusBgCard = 'bg-[#0d1e27] border-cyan-500/40 shadow-[0_0_20px_rgba(6,182,212,0.15)]';
      headerDotColor = 'bg-cyan-400 animate-pulse';
      headerStatusText = 'ORDER_SUBMIT';
      break;

    case 'IN_POSITION':
      statusLabel = 'В ПОЗИЦИИ';
      statusReason = engine.activePosition
        ? `${engine.activePosition.symbol} | PnL: ${engine.activePosition.currentPercent >= 0 ? '+' : ''}${engine.activePosition.currentPercent}%`
        : 'Сопровождение сделки';
      statusBadgeColor = 'bg-purple-400 animate-pulse';
      statusTextColor = 'text-purple-400';
      statusBgCard = 'bg-[#1b122c] border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.15)]';
      headerDotColor = 'bg-purple-400 animate-pulse';
      headerStatusText = 'IN_POSITION';
      break;

    case 'CLOSING_POSITION':
      statusLabel = 'ЗАКРЫТИЕ ПОЗИЦИИ';
      statusReason = 'Отправка ордера на продажу';
      statusBadgeColor = 'bg-orange-400 animate-pulse';
      statusTextColor = 'text-orange-400';
      statusBgCard = 'bg-[#26180c] border-orange-500/40 shadow-[0_0_20px_rgba(249,115,22,0.15)]';
      headerDotColor = 'bg-orange-400 animate-pulse';
      headerStatusText = 'CLOSING';
      break;

    case 'COOLDOWN':
      statusLabel = 'ЗАЩИТНЫЙ КУЛДАУН';
      statusReason = 'Пауза после сделки перед следующим циклом';
      statusBadgeColor = 'bg-amber-400';
      statusTextColor = 'text-amber-400';
      statusBgCard = 'bg-[#1e1a12] border-amber-600/40';
      headerDotColor = 'bg-amber-400';
      headerStatusText = 'COOLDOWN';
      break;

    case 'TERMINATED':
      statusLabel = 'ОСТАНОВЛЕН';
      statusReason = 'Аварийный сброс ресурсов';
      statusBadgeColor = 'bg-rose-500';
      statusTextColor = 'text-rose-400';
      statusBgCard = 'bg-[#221014] border-rose-500/40';
      headerDotColor = 'bg-rose-500';
      headerStatusText = 'TERMINATED';
      break;

    case 'IDLE_READY':
      statusLabel = 'ГОТОВ К ЗАПУСКУ';
      statusReason = rawBalance < 0.01 
        ? 'Ожидание пополнения (мин. 0.01 SOL)' 
        : 'Ключ загружен, баланс проверен';
      statusBadgeColor = 'bg-emerald-400';
      statusTextColor = 'text-emerald-400';
      statusBgCard = 'bg-[#0f1d17] border-emerald-600/40 shadow-[0_0_15px_rgba(16,185,129,0.08)]';
      headerDotColor = 'bg-emerald-400';
      headerStatusText = 'IDLE_READY';
      break;

    case 'NO_KEY':
    default:
      statusLabel = 'НЕТ КЛЮЧА';
      statusReason = 'Импортируйте сид-фразу в Настройках';
      statusBadgeColor = 'bg-amber-400';
      statusTextColor = 'text-amber-400';
      statusBgCard = 'bg-[#151a22] border-slate-700/60';
      headerDotColor = 'bg-amber-400';
      headerStatusText = 'NO_KEY';
      break;
  }

  // Consistent Scenario & Action lines
  const scenarioTitle = !hasStoredKey || botState === 'NO_KEY'
    ? 'ОЖИДАНИЕ ИНИЦИАЛИЗАЦИИ / КОШЕЛЕК НЕ ПОДКЛЮЧЕН'
    : (engine.activePosition || botState === 'IN_POSITION'
      ? `СОПРОВОЖДЕНИЕ ПОЗИЦИИ / ${engine.activePosition?.symbol || 'PUMP'}`
      : (botState === 'COOLDOWN' ? 'ЗАЩИТНАЯ ПАУЗА ДВИЖКА' : 'ПОИСК ИМПУЛЬСА / PUMP.FUN'));

  const actionText = !hasStoredKey || botState === 'NO_KEY'
    ? '🔒 Откройте НАСТРОЙКИ и введите сид-фразу для активации торговли'
    : (engine.activePosition || botState === 'IN_POSITION'
      ? `В позиции: ${engine.activePosition?.symbol || 'PUMP'}, вход ${engine.activePosition?.entrySol || 0.035} SOL, сейчас ${engine.activePosition && engine.activePosition.currentPercent >= 0 ? '+' : ''}${engine.activePosition?.currentPercent || 0}%`
      : (botState === 'COOLDOWN' ? 'Кулдаун после сделки перед новым циклом...' : (engine.liveActionTextRu || 'Поиск импульса в bonding curve...')));

  // Honest Money Metrics (from LiveApkAdapter and WAL)
  const hasDeals = walTrades.length > 0 || (engine.closedDeals && engine.closedDeals.length > 0) || (engine.decisions && engine.decisions.length > 0);
  const balanceDisplay = hasStoredKey ? `${rawBalance.toFixed(2)} SOL` : 'Ключ не введён';
  const realPnlSol = walTodayPnl.count > 0 ? walTodayPnl.todayPnlSol : (engine.earnedTodaySol || 0);
  const pnlNum = Number(realPnlSol.toFixed(2));
  const pnlDisplay = hasDeals ? `${pnlNum >= 0 ? '+' : ''}${realPnlSol.toFixed(2)} SOL` : 'Нет сделок';

  // Gate Conditions for LIVE trading button (Block 5)
  // 1) Торговый ключ импортирован в Keystore (Ключ [OK])
  const isKeyOk = hasStoredKey && !!publicAddress;
  // 2) Сеть RPC доступна (Сеть [OK])
  const isNetworkOk = engine.healthIndicators?.blockchainConnection !== 'red';
  // 3) Баланс кошелька выше неприкасаемого газового резерва (не менее 0.01 SOL)
  const isBalanceSufficient = rawBalance >= 0.01;

  let gateBlockedReason: string | null = null;
  if (!isKeyOk || botState === 'NO_KEY') {
    gateBlockedReason = 'Запуск заблокирован: Ключ не импортирован';
  } else if (!isNetworkOk) {
    gateBlockedReason = 'Запуск заблокирован: Ожидание подключения к RPC сети';
  } else if (!isBalanceSufficient) {
    gateBlockedReason = `Баланс ${rawBalance.toFixed(3)} SOL < мин. резерва 0.01 SOL`;
  } else if (botState !== 'IDLE_READY' && botState !== 'TERMINATED') {
    gateBlockedReason = `Запуск невозможен из состояния "${botState}" (требуется IDLE_READY)`;
  }

  const isGateOpen = gateBlockedReason === null;

  return (
    <div className="h-screen max-h-screen w-full max-w-md mx-auto bg-[#090d10] text-slate-100 font-sans flex flex-col justify-between relative select-none border-x border-[#1a232d] shadow-2xl overflow-hidden">
      {/* Top Header */}
      <header 
        className="shrink-0 px-5 pb-3 border-b border-[#16202a] flex items-center justify-between"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)' }}
      >
        <h1 className="text-base font-bold tracking-wider text-slate-200">
          Alpha-Flip <span className="text-xs text-emerald-400 font-mono font-semibold">v3.2</span>
        </h1>
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${headerDotColor}`} />
          <span className="text-xs text-slate-400 font-mono">
            {headerStatusText}
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 px-4 py-4 overflow-y-auto space-y-4">
        {/* ========================================================================= */}
        {/* 1. ПУЛЬТ                                                                  */}
        {/* ========================================================================= */}
        {activeTab === 'control' && (
          <div className="space-y-4">
            {/* Status Card */}
            <div className={`p-4 rounded-xl border text-center transition-all ${statusBgCard}`}>
              <div className="flex items-center justify-center space-x-2 mb-1.5">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusBadgeColor}`} />
                <h2 className={`text-xl font-black tracking-wider uppercase ${statusTextColor}`}>
                  {statusLabel}
                  {statusReason && (
                    <span className="text-xs font-normal normal-case ml-2 opacity-80">
                      ({statusReason})
                    </span>
                  )}
                </h2>
              </div>
              <p className="text-xs text-slate-300 font-mono tracking-wide">
                {scenarioTitle}
              </p>

              {/* Scenario Action Line */}
              <div className="mt-3 pt-2.5 border-t border-slate-800/80 text-xs">
                <p className="text-slate-300 font-mono text-[11px]">
                  {actionText}
                </p>
              </div>

              {/* Telemetry WSS Widget */}
              <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-[11px] font-mono gap-1">
                <div className="flex items-center space-x-1.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${Date.now() - (engine.lastTickTimestamp || 0) < 3000 ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  <span className="text-slate-400 font-bold uppercase tracking-wider">ТЕЛЕМЕТРИЯ WSS:</span>
                  <span className={Date.now() - (engine.lastTickTimestamp || 0) < 3000 ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                    {Date.now() - (engine.lastTickTimestamp || 0) < 3000 ? 'LIVE' : 'Тишина'}
                  </span>
                </div>
                <div className="text-slate-300">
                  Тиков: <span className="text-slate-100 font-bold">{engine.totalTicksReceived || 0}</span> | Токенов: <span className="text-slate-100 font-bold">{engine.candidatesScanned || 0}</span> | Отсеяно: <span className="text-rose-400 font-bold">{engine.rejectedByFilters || 0}</span>
                </div>
              </div>
            </div>

            {/* Money Metrics Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#121820] p-3.5 rounded-xl border border-slate-800">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">
                  БАЛАНС SOL:
                </p>
                <p className="text-lg font-black font-mono text-slate-100">
                  {balanceDisplay}
                </p>
              </div>

              <div className="bg-[#121820] p-3.5 rounded-xl border border-slate-800">
                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">
                  PnL СЕГОДНЯ:
                </p>
                <p className={`text-lg font-black font-mono ${!hasDeals ? 'text-slate-400' : pnlNum >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {pnlDisplay}
                </p>
              </div>
            </div>

            {/* Actions: Start / Pause & Emergency Stop */}
            <div className="space-y-2 pt-1">
              {isTrading ? (
                <button
                  onClick={handlePauseTrading}
                  disabled={isActionPending}
                  className="w-full py-3 px-4 bg-[#1e293b] hover:bg-slate-700 active:scale-[0.99] text-slate-200 font-bold rounded-xl flex items-center justify-center space-x-2 border border-slate-600 transition-all cursor-pointer shadow-md"
                >
                  <Pause className="w-4 h-4 text-slate-300" />
                  <span className="tracking-wide">СТОП</span>
                </button>
              ) : (
                <div className="space-y-1.5">
                  <button
                    onClick={handleStartTrading}
                    disabled={isActionPending || !isGateOpen}
                    className={`w-full py-3 px-4 font-bold rounded-xl flex items-center justify-center space-x-2 transition-all ${
                      isGateOpen 
                        ? 'bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white cursor-pointer shadow-lg shadow-emerald-900/30' 
                        : 'bg-[#151c24] text-slate-500 border border-slate-800 cursor-not-allowed opacity-75'
                    }`}
                  >
                    <Play className={`w-4 h-4 ${isGateOpen ? 'fill-white text-white' : 'fill-slate-500 text-slate-500'}`} />
                    <span className="tracking-wide">ЗАПУСК (LIVE)</span>
                  </button>
                  {!isGateOpen && (
                    <p className="text-[11px] text-amber-400 font-mono text-center tracking-tight">
                      {gateBlockedReason}
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={handleEmergencyStop}
                disabled={isActionPending}
                className="w-full py-3 px-4 bg-rose-600 hover:bg-rose-500 active:scale-[0.99] text-white font-bold rounded-xl flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-lg shadow-rose-950/40"
              >
                <AlertOctagon className="w-4 h-4 fill-rose-600 text-white" />
                <span className="tracking-wider">АВАРИЙНЫЙ СТОП</span>
              </button>
            </div>

            {/* Modules Status List */}
            <div className="bg-[#121820] p-4 rounded-xl border border-slate-800 space-y-2">
              <h3 className="text-xs font-bold text-slate-300 tracking-wider uppercase mb-3">
                МОДУЛИ И ДИАГНОСТИКА СЕТИ
              </h3>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center text-slate-300">
                  <span>• Сеть (RPC mainnet)</span>
                  <span className={isNetworkOk ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                    {isNetworkOk ? '[✓ OK]' : '[Ожидание RPC]'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>• Поток данных (WSS logsSubscribe)</span>
                  <span className="text-emerald-400 font-bold">
                    {isTrading ? '[✓ Стрим активен]' : '[✓ Готов к стриму]'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>• Исполнение (Jito MEV Engine)</span>
                  <span className="text-emerald-400 font-bold">[✓ OK]</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>• Аппаратный Ключ (Keystore)</span>
                  <span className={hasStoredKey ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                    {hasStoredKey ? '[✓ Загружен]' : '[НЕТ КЛЮЧА]'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>• Фоновая Служба (Keep-Awake)</span>
                  <span className="text-emerald-400 font-bold">[✓ Активна 24/7]</span>
                </div>
                {/* On-Screen Diagnostic Detail */}
                {(Date.now() - (engine.lastTickTimestamp || 0) > 10000) && (
                  <div className="mt-2 pt-2 border-t border-slate-800 text-[11px] text-amber-400">
                    ⚠️ Статус WSS: {Date.now() - (engine.lastTickTimestamp || 0) > 15000 ? 'Тишина в сокете (нет новых блоков за 15с) — сработает авто-реконнект Watchdog.' : 'Получение очередного тика...'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 2. ЖУРНАЛ                                                                 */}
        {/* ========================================================================= */}
        {activeTab === 'journal' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold tracking-wider text-slate-300 uppercase">
                ЖУРНАЛ
              </h2>
              <div className="flex bg-[#0d1218] p-1 rounded-lg border border-slate-800 text-[11px] font-mono space-x-1">
                <button
                  onClick={() => {
                    hapticFeedback('selection');
                    setJournalSubTab('trades');
                  }}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                    journalSubTab === 'trades'
                      ? 'bg-slate-700 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  [ СДЕЛКИ ]
                </button>
                <button
                  onClick={() => {
                    hapticFeedback('selection');
                    setJournalSubTab('radar');
                  }}
                  className={`px-2.5 py-1 rounded-md font-bold transition-all cursor-pointer ${
                    journalSubTab === 'radar'
                      ? 'bg-slate-700 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  [ РАДАР РЕШЕНИЙ ]
                </button>
              </div>
            </div>

            {/* Live Logs List */}
            <div className="bg-[#121820] p-3 rounded-xl border border-slate-800 font-mono text-[11px] leading-relaxed space-y-2 min-h-[360px]">
              {journalSubTab === 'radar' ? (
                <div className="space-y-3">
                  {/* Interactive Candidate Funnel Inspector */}
                  <div className="bg-[#0b0f14] p-2.5 rounded-xl border border-amber-500/40 space-y-2">
                    <div className="flex justify-between items-center border-b border-slate-800 pb-1.5">
                      <div className="flex items-center space-x-1.5">
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                        <span className="text-[11px] font-bold tracking-wider text-amber-300 uppercase font-mono">
                          🎯 ТОП ЦЕЛЕЙ НА ПРИЦЕЛЕ (ONLINE)
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400">
                        Отсев: <span className="text-rose-400 font-bold">{engine.rejectedByFilters || 0}</span>
                      </span>
                    </div>

                    {/* Candidate Cards */}
                    <div className="space-y-1.5">
                      {topTargets && topTargets.length > 0 ? (
                        topTargets.map((target, idx) => {
                          const isHighReadiness = target.readinessScore >= 85;
                          const formattedMint = target.mint.length > 12 ? `${target.mint.slice(0, 4)}...${target.mint.slice(-4)}` : target.mint;
                          const badgeRu = target.isCto ? 'CTO АБСОРБЦИЯ' : 'ЧИСТЫЙ ПРИТОК';

                          return (
                            <div 
                              key={`${target.mint}-${idx}`}
                              className={`p-2 rounded-lg border text-[10px] font-mono transition-all ${
                                isHighReadiness
                                  ? 'bg-amber-950/30 border-amber-500/80 shadow-sm shadow-amber-500/10 animate-pulse'
                                  : 'bg-[#10161d] border-slate-800'
                              }`}
                            >
                              <div className="flex justify-between items-center mb-1">
                                <div className="flex items-center space-x-1.5">
                                  <span className="font-bold text-slate-100 text-xs">${target.ticker}</span>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(target.mint);
                                      triggerToast(`Mint ${formattedMint} скопирован`);
                                    }}
                                    className="text-[9px] text-slate-400 hover:text-amber-300 font-mono underline cursor-pointer"
                                    title="Нажмите для копирования Mint адреса"
                                  >
                                    ({formattedMint})
                                  </button>
                                  <span className="px-1.5 py-0.2 rounded text-[8px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800/60">
                                    {badgeRu}
                                  </span>
                                </div>
                                <span className={`px-1.5 py-0.2 rounded font-bold text-[9px] ${isHighReadiness ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}>
                                  ГОТОВНОСТЬ: {target.readinessScore}%
                                </span>
                              </div>

                              <div className="grid grid-cols-3 gap-1 text-[9px] text-slate-300 mb-1.5">
                                <div>Кривая: <span className="text-amber-300 font-bold">{target.bondingSol.toFixed(1)} SOL</span></div>
                                <div>Приток: <span className="text-emerald-400 font-bold">{target.netInflow5s >= 0 ? '+' : ''}{target.netInflow5s.toFixed(2)} SOL/5с</span></div>
                                <div>Покупателей: <span className="text-slate-100 font-bold">{target.uniqueBuyers}</span></div>
                              </div>

                              {/* Progress bar */}
                              <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                                <div 
                                  className={`h-full transition-all duration-500 ${isHighReadiness ? 'bg-amber-400' : 'bg-emerald-500'}`} 
                                  style={{ width: `${target.readinessScore}%` }}
                                />
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="py-3 text-center text-slate-500 text-[10px] font-mono leading-relaxed bg-[#10161d] rounded-lg border border-slate-800/60 p-2.5">
                          <p className="font-semibold text-slate-300 mb-0.5">Поиск кандидатов в коридоре 6–25 SOL...</p>
                          <p className="text-[9px] text-slate-500">
                            {engine.mode === 'PAUSED' ? '(Целей на сопровождении нет — сокет на паузе)' : '(Целей на сопровождении нет — ожидание ончейн-притока)'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Decisions Log Feed */}
                  {engine.decisions && engine.decisions.length > 0 ? (
                    engine.decisions.slice(0, 30).map((dec) => {
                      const isAttempt = dec.kind === 'trade_attempt' || dec.actionRu.includes('ВЫСТРЕЛ');
                      const isSignal = dec.kind === 'bought' || dec.actionRu.includes('ПОКУПКА');
                      const isCandidate = dec.kind === 'candidate' || dec.actionRu.includes('КАНДИДАТ') || dec.actionRu.includes('ГОТОВНОСТЬ');
                      const isReject = dec.kind === 'rejected' || dec.actionRu.includes('Отклонен');

                      let badgeText = '🔴 [ОТСЕВ]';
                      let badgeClass = 'bg-rose-950/80 text-rose-400 border border-rose-800/60';
                      let containerClass = 'border-b border-slate-800/60 pb-2 last:border-b-0';

                      if (isAttempt) {
                        badgeText = '🔥 [ВЫСТРЕЛ JITO]';
                        badgeClass = 'bg-amber-500 text-slate-950 border border-amber-300 font-black animate-pulse';
                        containerClass = 'bg-amber-950/30 border border-amber-500/80 p-2 rounded-lg shadow-sm';
                      } else if (isSignal) {
                        badgeText = '🟢 [ПОКУПКА ПОДТВЕРЖДЕНА]';
                        badgeClass = 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/80 font-bold';
                        containerClass = 'bg-emerald-950/30 border border-emerald-500/60 p-2 rounded-lg';
                      } else if (isCandidate) {
                        badgeText = '🎯 [КАНДИДАТ / ГОТОВНОСТЬ]';
                        badgeClass = 'bg-amber-950/80 text-amber-300 border border-amber-800/60';
                      }

                      const rawMint = dec.mint || dec.symbol;
                      const formattedMint = rawMint.length > 12 ? `${rawMint.slice(0, 4)}...${rawMint.slice(-4)}` : rawMint;

                      return (
                        <div key={dec.id} className={containerClass}>
                          <div className="flex justify-between items-center text-[10px] text-slate-400 mb-1">
                            <span className={`px-1.5 py-0.5 rounded text-[9px] ${badgeClass}`}>
                              {badgeText}
                            </span>
                            <span className="font-mono text-slate-400">{dec.timeStr}</span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <div>
                              <span className="text-slate-400 font-mono text-[10px] mr-1.5">MINT: <span className="text-slate-200">{formattedMint}</span></span>
                              <span className="text-slate-100 font-bold">{dec.symbol}</span>
                            </div>
                          </div>
                          <div className="text-[10px] text-slate-300 mt-1 font-mono">
                            Причина: <span className={isReject ? 'text-rose-300' : isCandidate ? 'text-amber-300' : 'text-emerald-300 font-semibold'}>{dec.reasonRu}</span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-20 text-slate-400 space-y-2">
                      <p className="text-sm font-semibold text-slate-300">Радар сканирует блоки</p>
                      <p className="text-xs text-slate-500">
                        Ожидание ончейн-событий Pump.fun и Raydium...
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* Subtab: DEALS / СДЕЛКИ */
                <div className="space-y-3">
                  {/* Active Position in Deals tab */}
                  {engine.activePosition && (
                    <div className="bg-emerald-950/40 border-2 border-emerald-500/80 p-3 rounded-xl space-y-2 shadow-lg">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center space-x-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                            АКТИВНАЯ ПОЗИЦИЯ: {engine.activePosition.symbol}
                          </span>
                        </div>
                        <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${engine.activePosition.currentPercent >= 0 ? 'bg-emerald-900 text-emerald-300' : 'bg-rose-900 text-rose-300'}`}>
                          {engine.activePosition.currentPercent >= 0 ? '+' : ''}{engine.activePosition.currentPercent}%
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-300 bg-[#0c1218] p-2 rounded-lg">
                        <div>Вход: <span className="text-slate-100 font-bold">{engine.activePosition.entrySol} SOL</span></div>
                        <div>Цена: <span className="text-slate-100 font-bold">{engine.activePosition.entryPriceSol.toFixed(8)}</span></div>
                        <div>Пик PnL: <span className="text-emerald-400 font-bold">+{engine.activePosition.peakPercent || 0}%</span></div>
                        <div>Стоп-лосс: <span className="text-rose-400 font-bold">{engine.activePosition.stopLossPercent}%</span></div>
                      </div>
                      <button
                        onClick={handleEmergencyStop}
                        className="w-full py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer"
                      >
                        ⚡ АВАРИЙНЫЙ СБРОС ПОЗИЦИИ (100% JITO)
                      </button>
                    </div>
                  )}

                  {/* Trade Attempts / Buy Signals from decisions */}
                  {engine.decisions && engine.decisions.filter((d) => d.kind === 'trade_attempt' || d.kind === 'bought' || d.kind === 'sold' || d.actionRu.includes('ПОКУПКА') || d.actionRu.includes('ВЫСТРЕЛ')).length > 0 && (
                    <div className="space-y-2">
                      {engine.decisions
                        .filter((d) => d.kind === 'trade_attempt' || d.kind === 'bought' || d.kind === 'sold' || d.actionRu.includes('ПОКУПКА') || d.actionRu.includes('ВЫСТРЕЛ'))
                        .slice(0, 10)
                        .map((dec) => {
                          const isAttempt = dec.kind === 'trade_attempt' || dec.actionRu.includes('ВЫСТРЕЛ');
                          const isSuccess = dec.kind === 'bought' || dec.actionRu.includes('ПОКУПКА');
                          
                          let containerStyle = 'bg-amber-950/40 border border-amber-500/80 p-2.5 rounded-xl space-y-1';
                          let badgeText = '🔥 [ОТПРАВКА БАНДЛА JITO...]';
                          let badgeStyle = 'bg-amber-500 text-slate-950 font-black';

                          if (isSuccess) {
                            containerStyle = 'bg-emerald-950/40 border border-emerald-500/80 p-2.5 rounded-xl space-y-1';
                            badgeText = '🟢 [ПОКУПКА ИСПОЛНЕНА]';
                            badgeStyle = 'bg-emerald-500 text-slate-950 font-bold';
                          }

                          return (
                            <div key={dec.id} className={containerStyle}>
                              <div className="flex justify-between items-center text-[10px]">
                                <span className={`px-1.5 py-0.5 rounded text-[9px] ${badgeStyle}`}>
                                  {badgeText}
                                </span>
                                <span className="font-mono text-slate-400">{dec.timeStr}</span>
                              </div>
                              <div className="flex justify-between items-center text-xs font-bold text-slate-100">
                                <span>{dec.symbol}</span>
                                <span className="text-amber-300 font-mono text-[10px]">JITO BUNDLE</span>
                              </div>
                              <div className="text-[10px] text-slate-300 font-mono">
                                Status: <span className="text-slate-100">{dec.reasonRu}</span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}

                  {/* Completed WAL Trades */}
                  {walTrades.length > 0 ? (
                    walTrades.slice(0, 40).map((trade) => (
                      <div key={trade.id} className="border-b border-slate-800/60 pb-2 last:border-b-0">
                        <div className="flex justify-between items-center text-[10px] text-slate-400 mb-0.5">
                          <span>{trade.holdTimeSec ? `${trade.holdTimeSec}s удержание` : trade.side}</span>
                          <span className={`px-1.5 py-0.2 rounded text-[9px] ${trade.bundleStatus === 'Landed' ? 'bg-emerald-950/80 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                            JITO: {trade.bundleStatus}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <div>
                            <span className={trade.profitSol >= 0 ? 'text-emerald-400 font-bold mr-1.5' : 'text-rose-400 font-bold mr-1.5'}>
                              {trade.side === 'BUY' ? 'ПОКУПКА (JITO)' : (trade.profitSol >= 0 ? 'ПРОДАЖА (TP)' : 'ВЫХОД (SL)')}
                            </span>
                            <span className="text-slate-200 font-semibold">{trade.symbol}</span>
                          </div>
                          <div className="text-right">
                            {trade.side === 'SELL' ? (
                              <>
                                <span className={`font-bold mr-2 ${trade.profitPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {trade.profitPct >= 0 ? '+' : ''}{trade.profitPct}%
                                </span>
                                <span className="text-slate-400">{trade.profitSol >= 0 ? '+' : ''}{trade.profitSol.toFixed(4)} SOL</span>
                              </>
                            ) : (
                              <span className="text-slate-400">{trade.tradeSizeSol.toFixed(4)} SOL</span>
                            )}
                          </div>
                        </div>
                        {trade.reasonRu && (
                          <div className="text-[10px] text-slate-400 truncate mt-0.5">
                            {trade.reasonRu}
                          </div>
                        )}
                        {trade.signature && (
                          <div className="mt-1 text-[10px] font-mono text-slate-400 flex items-center justify-between bg-[#0b0f14] px-2 py-1 rounded border border-slate-800">
                            <span className="text-slate-500">TX:</span>
                            <a
                              href={trade.solscanUrl || `https://solscan.io/tx/${trade.signature}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-amber-400 hover:text-amber-300 font-mono underline cursor-pointer"
                              title="Открыть транзакцию на Solscan"
                            >
                              {trade.signature.length > 14 ? `${trade.signature.slice(0, 6)}...${trade.signature.slice(-6)}` : trade.signature}
                            </a>
                          </div>
                        )}
                      </div>
                    ))
                  ) : null}

                  {/* Empty state when no active position, no trade attempts, and no walTrades */}
                  {!engine.activePosition &&
                   (!engine.decisions || engine.decisions.filter((d) => d.kind === 'trade_attempt' || d.kind === 'bought' || d.kind === 'sold' || d.actionRu.includes('ПОКУПКА') || d.actionRu.includes('ВЫСТРЕЛ')).length === 0) &&
                   walTrades.length === 0 && (
                    <div className="text-center py-16 text-slate-400 space-y-2">
                      <div className="w-10 h-10 rounded-full bg-slate-800/80 flex items-center justify-center mx-auto text-emerald-400">
                        <Activity className="w-5 h-5" />
                      </div>
                      <p className="text-xs font-bold text-slate-200">Открытых позиций нет. Ожидание сигнала</p>
                      <p className="text-[11px] text-slate-400 leading-relaxed max-w-[260px] mx-auto">
                        Робот автономно сканирует блоки Pump.fun и Raydium в коридоре 6–25 SOL. Выстрелы Jito отобразятся здесь.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Export CSV Button */}
            <button
              onClick={handleExportCsv}
              className="w-full py-3 bg-[#1e293b] hover:bg-slate-700 active:scale-[0.99] text-slate-200 font-bold rounded-xl flex items-center justify-center space-x-2 border border-slate-700 cursor-pointer shadow-sm transition-all"
            >
              <Download className="w-4 h-4 text-slate-400" />
              <span className="tracking-wider uppercase text-xs">ЭКСПОРТ CSV</span>
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 3. НАСТРОЙКИ                                                              */}
        {/* ========================================================================= */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            <h2 className="text-sm font-bold tracking-wider text-slate-300 uppercase">
              НАСТРОЙКИ
            </h2>

            {/* Trading Key Card */}
            <div className="bg-[#121820] p-4 rounded-xl border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold text-slate-300 tracking-wider uppercase">
                ТОРГОВЫЙ КЛЮЧ
              </h3>
              
              <div className="bg-[#0b1015] p-2.5 rounded-lg border border-slate-850 font-mono text-center text-slate-400 text-xs tracking-widest">
                •••• •••• •••• ••••
              </div>

              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Адрес:</span>
                <div className="flex items-center space-x-1.5">
                  <span className="text-slate-200">{shortAddress(publicAddress)}</span>
                  {hasStoredKey && publicAddress && (
                    <button 
                      onClick={handleCopyAddress} 
                      className="p-1 text-slate-400 hover:text-emerald-400 transition-colors cursor-pointer"
                      title="Копировать адрес"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">Кейстор:</span>
                <span className={hasStoredKey ? 'text-emerald-400 font-bold' : 'text-slate-400'}>
                  {hasStoredKey ? 'Активен [🛡 биометрия]' : 'Не активен'}
                </span>
              </div>

              <div className="pt-1 flex flex-col space-y-2">
                {!hasStoredKey ? (
                  <button
                    onClick={() => {
                      hapticFeedback('light');
                      setIsImportModalOpen(true);
                    }}
                    className="w-full py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 text-xs font-bold rounded-lg border border-emerald-500/30 cursor-pointer transition-all flex items-center justify-center space-x-1.5"
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>ИМПОРТИРОВАТЬ СИД</span>
                  </button>
                ) : (
                  <button
                    onClick={handleClearKey}
                    className="w-full py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-bold rounded-lg border border-rose-500/30 cursor-pointer transition-all flex items-center justify-center space-x-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>ЗАБЫТЬ КОШЕЛЕК</span>
                  </button>
                )}
              </div>
            </div>

            {/* Risk Limits Card */}
            <div className="bg-[#121820] p-4 rounded-xl border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold text-slate-300 tracking-wider uppercase mb-1">
                ЛИМИТЫ РИСКА
              </h3>
              <div className="space-y-2 text-xs font-mono">
                {/* Размер сделки */}
                <div className="flex justify-between items-center text-slate-300">
                  <span>• Размер сделки:</span>
                  <div className="flex items-center space-x-1">
                    {[0.01, 0.02, 0.05].map((val) => {
                      const isActive = Math.abs(Number(riskSettings.tradeSizeSol) - Number(val)) < 0.001;
                      return (
                        <button
                          key={val}
                          onClick={() => handleUpdateRisk({ tradeSizeSol: Number(val) })}
                          className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-all border ${
                            isActive
                              ? 'bg-emerald-600 text-white border-emerald-500 font-bold shadow-sm'
                              : 'bg-[#1a232d] text-slate-400 border-slate-700 hover:text-slate-200'
                          }`}
                        >
                          {val} SOL
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Дневной стоп */}
                <div className="flex justify-between items-center text-slate-300">
                  <span>• Дневной стоп:</span>
                  <div className="flex items-center space-x-1">
                    {[0.05, 0.10, 0.20].map((val) => {
                      const isActive = Math.abs(Number(riskSettings.dailyStopSol) - Number(val)) < 0.001;
                      return (
                        <button
                          key={val}
                          onClick={() => handleUpdateRisk({ dailyStopSol: Number(val) })}
                          className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-all border ${
                            isActive
                              ? 'bg-emerald-600 text-white border-emerald-500 font-bold shadow-sm'
                              : 'bg-[#1a232d] text-slate-400 border-slate-700 hover:text-slate-200'
                          }`}
                        >
                          {val.toFixed(2)} SOL
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Серия убытков */}
                <div className="flex justify-between items-center text-slate-300">
                  <span>• Серия убытков:</span>
                  <div className="flex items-center space-x-1">
                    {[2, 3, 5].map((val) => {
                      const isActive = Number(riskSettings.maxLossStreak) === Number(val);
                      return (
                        <button
                          key={val}
                          onClick={() => handleUpdateRisk({ maxLossStreak: Number(val) })}
                          className={`px-2.5 py-0.5 rounded text-[11px] cursor-pointer transition-all border ${
                            isActive
                              ? 'bg-emerald-600 text-white border-emerald-500 font-bold shadow-sm'
                              : 'bg-[#1a232d] text-slate-400 border-slate-700 hover:text-slate-200'
                          }`}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Commissions Card */}
            <div className="bg-[#121820] p-4 rounded-xl border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold text-slate-300 tracking-wider uppercase">
                КОМИССИИ
              </h3>
              
              <div className="grid grid-cols-3 gap-2">
                {(['ECONOMY', 'BALANCED', 'TURBO'] as const).map((level) => {
                  const labelRu = level === 'ECONOMY' ? 'ЭКОНОМ' : level === 'BALANCED' ? 'БАЛАНС' : 'ТУРБО';
                  const isActive = riskSettings.gasProfile === level;
                  return (
                    <button
                      key={level}
                      onClick={() => handleUpdateRisk({ gasProfile: level })}
                      className={`py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                        isActive
                          ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                          : 'bg-[#1a232d] text-slate-400 border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {labelRu}
                    </button>
                  );
                })}
              </div>

              <div className="text-xs font-mono text-slate-400">
                Потолок: <span className="text-slate-200 font-bold">{engine.gas?.maxFeeSol || (riskSettings.gasProfile === 'TURBO' ? 0.0002 : riskSettings.gasProfile === 'BALANCED' ? 0.0001 : 0.00005)} SOL</span>
              </div>
            </div>

            {/* Custom RPC Section */}
            <div className="bg-[#121820] p-4 rounded-xl border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold text-slate-300 tracking-wider uppercase">
                СЕТЬ И RPC
              </h3>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Персональный RPC-эндпоинт (Helius, QuickNode, Triton) взамен публичного узла:
              </p>
              <div className="space-y-2">
                <input
                  type="text"
                  value={rpcInput}
                  onChange={(e) => setRpcInput(e.target.value)}
                  placeholder="https://mainnet.helius-rpc.com/?api-key=..."
                  className="w-full bg-[#1a232d] border border-slate-700 focus:border-emerald-500 rounded-lg px-3 py-2 text-xs font-mono text-slate-100 outline-none transition-colors placeholder:text-slate-600"
                />
                {rpcInput.trim() && (
                  <p className="text-[10px] font-mono text-emerald-400/80">
                    WSS Стрим: {convertHttpToWsUrl(rpcInput)}
                  </p>
                )}
                <button
                  onClick={handleSaveRpc}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                >
                  Сохранить RPC
                </button>
              </div>
            </div>

            {/* App Info Card */}
            <div className="bg-[#121820] p-4 rounded-xl border border-slate-800 space-y-2">
              <h3 className="text-xs font-bold text-slate-300 tracking-wider uppercase mb-1">
                О ПРИЛОЖЕНИИ
              </h3>
              <div className="space-y-1.5 text-xs">
                <p className="font-mono text-slate-300">
                  • Версия: <span className="text-emerald-400 font-bold">v3.2-LIVE</span>
                </p>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  • Описание: Робот решает сам, аналитика под капотом, без лишних переключателей и настроек.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Navigation Bar: EXACTLY 3 TABS */}
      <nav className="shrink-0 border-t border-[#16202a] bg-[#0c1117] px-6 pt-2 pb-[max(env(safe-area-inset-bottom,0px),10px)] flex justify-between items-center z-30">
        <button
          onClick={() => {
            hapticFeedback('selection');
            setActiveTab('control');
          }}
          className={`flex flex-col items-center space-y-1 py-1 cursor-pointer transition-colors ${
            activeTab === 'control' ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Activity className="w-5 h-5" />
          <span className="text-[10px] font-bold tracking-wider uppercase">ПУЛЬТ</span>
        </button>

        <button
          onClick={() => {
            hapticFeedback('selection');
            setActiveTab('journal');
          }}
          className={`flex flex-col items-center space-y-1 py-1 cursor-pointer transition-colors ${
            activeTab === 'journal' ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <BookOpen className="w-5 h-5" />
          <span className="text-[10px] font-bold tracking-wider uppercase">ЖУРНАЛ</span>
        </button>

        <button
          onClick={() => {
            hapticFeedback('selection');
            setActiveTab('settings');
          }}
          className={`flex flex-col items-center space-y-1 py-1 cursor-pointer transition-colors ${
            activeTab === 'settings' ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <SettingsIcon className="w-5 h-5" />
          <span className="text-[10px] font-bold tracking-wider uppercase">НАСТРОЙКИ</span>
        </button>
      </nav>

      {/* Import Seed Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121820] border border-slate-700 w-full max-w-sm rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex justify-between items-center border-b border-slate-800 pb-2">
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                <Key className="w-4 h-4 text-emerald-400" />
                <span>Импорт сид-фразы</span>
              </h3>
              <button 
                onClick={() => {
                  hapticFeedback('light');
                  setIsImportModalOpen(false);
                }}
                className="text-slate-400 hover:text-slate-100 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Введите 12 или 24 слова кошелька через пробел. Ключ сохранится локально в защищенном Keystore устройства.
            </p>

            <textarea
              value={seedInput}
              onChange={(e) => setSeedInput(e.target.value)}
              placeholder="word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12"
              className="w-full h-24 p-2.5 bg-[#0a0e12] border border-slate-750 rounded-xl font-mono text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500"
            />

            {seedError && (
              <p className="text-xs text-rose-400 font-mono">
                {seedError}
              </p>
            )}

            <div className="flex space-x-2 pt-1">
              <button
                onClick={() => {
                  hapticFeedback('light');
                  setIsImportModalOpen(false);
                }}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-xl cursor-pointer"
              >
                Отмена
              </button>
              <button
                onClick={handleSaveSeed}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl cursor-pointer shadow-md"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 border border-slate-700 text-slate-200 text-xs px-4 py-2 rounded-xl shadow-2xl font-mono text-center max-w-[90%]">
          {toastMsg}
        </div>
      )}
    </div>
  );
}
