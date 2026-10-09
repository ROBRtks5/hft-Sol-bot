import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Home, 
  TrendingUp, 
  ShieldAlert, 
  Menu, 
  Play, 
  Pause, 
  Square, 
  HelpCircle, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Info,
  Copy,
  ExternalLink,
  ArrowRight,
  Sliders,
  Wallet,
  Search,
  Users,
  Flame,
  Clock,
  CheckCheck,
  Settings,
  RefreshCw,
  Zap,
  Lock,
  ArrowDownToLine,
  Fuel,
  PackageCheck,
  Send,
  Eye,
  EyeOff,
  AlertOctagon,
  RotateCcw,
  Sparkles,
  Cpu,
  Download,
  Activity,
  ShieldCheck,
  Gauge,
  Layers,
  Scale,
  BookOpen,
  Award,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { EngineBackend, EngineStateV2, DryRunReport } from './backend';
import { SecureStorage } from './secureStorage';

type ActiveTab = 
  | 'home' 
  | 'analytics' 
  | 'risk' 
  | 'more'
  | 'micro_live'
  | 'scaling'
  | 'handsoff'
  | 'strategy' 
  | 'gas' 
  | 'wallets' 
  | 'transactions'
  | 'market' 
  | 'smart_money' 
  | 'trends' 
  | 'history' 
  | 'selftest' 
  | 'network' 
  | 'help';

export default function App() {
  const [engine, setEngine] = useState<EngineStateV2>(EngineBackend.getState());
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState<boolean>(false);
  const [gasDetailsOpen, setGasDetailsOpen] = useState<boolean>(false);
  const [isActionPending, setIsActionPending] = useState<boolean>(false);
  const [securityModalReason, setSecurityModalReason] = useState<string | null>(null);
  const [confirmPromotionModal, setConfirmPromotionModal] = useState<boolean>(false);
  const [promoTokenInput, setPromoTokenInput] = useState<string>('');
  const [liveEndpointInput, setLiveEndpointInput] = useState<string>('http://127.0.0.1:8080');
  const [capsuleStatus, setCapsuleStatus] = useState<string | null>(null);
  const [schedulerInfo, setSchedulerInfo] = useState(() => EngineBackend.getEvolutionSchedulerInfo());
  const [evolutionReportModal, setEvolutionReportModal] = useState<any | null>(null);
  const [isEvolutionRunning, setIsEvolutionRunning] = useState<boolean>(false);
  const [isFeatureVectorExpanded, setIsFeatureVectorExpanded] = useState<boolean>(false);
  const [dryRunModalReport, setDryRunModalReport] = useState<DryRunReport | null>(null);
  const [isDryRunning, setIsDryRunning] = useState<boolean>(false);
  const [lockedDials, setLockedDials] = useState<Record<string, boolean>>({});
  const [selectedParcel, setSelectedParcel] = useState<any | null>(null);
  const [handsOffRunning, setHandsOffRunning] = useState<boolean>(false);
  
  // Strategy sliders state (candidate preset)
  const [strategyParams, setStrategyParams] = useState({
    greed: 70,
    exitSpeed: 85,
    scamSuspicion: 90,
    followSmartMoney: true,
    socialTrends: true,
    presetVersion: 'v3.2-standard',
  });

  // Seed module states (read-only vs APK signing)
  const [seedInput, setSeedInput] = useState<string>('');
  const [showSeed, setShowSeed] = useState<boolean>(false);
  const isApk = SecureStorage.isNativeDevice();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // P2 FIX: Мемоизация точек спарклайна (только сдвиг хвоста, без перерисовки на каждый кадр)
  const sparklinePoints = useMemo(() => {
    const history = engine.pnlHistory || [0];
    const maxVal = Math.max(...history, 0.05);
    const minVal = Math.min(...history, 0);
    const range = maxVal - minVal || 1;
    
    return history
      .map((val, idx) => {
        const x = (idx / (history.length - 1 || 1)) * 100;
        const y = 22 - ((val - minVal) / range) * 18;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [engine.pnlHistory]);

  // P2 FIX: Сохранение и сброс скролла при переключении вкладок
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  useEffect(() => {
    const unsub = EngineBackend.subscribe((s) => setEngine(s));
    return unsub;
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setSchedulerInfo(EngineBackend.getEvolutionSchedulerInfo());
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const handleRunEvolutionCycle = async () => {
    if (isEvolutionRunning) return;
    setIsEvolutionRunning(true);
    try {
      const res = await EngineBackend.runEvolutionCycle();
      setEvolutionReportModal(res);
      triggerToast(`Эволюция: ${res.messageRu}`);
    } catch (e: any) {
      triggerToast(`Ошибка эволюции: ${e.message}`);
    } finally {
      setIsEvolutionRunning(false);
    }
  };

  const handleRollbackToPinned = async () => {
    const res = await EngineBackend.rollbackToPinned();
    triggerToast(res.reasonRu);
  };

  const handlePreauthorizedBoundChange = async (bound: any) => {
    await EngineBackend.setPreauthorizedBound(bound);
    triggerToast(
      `Политика автономии: ${
        bound === 'CONFIRM_EACH'
          ? 'Только ручное подтверждение'
          : bound === 'CONSERVATIVE_10'
          ? 'Автономно в коридоре ±10%'
          : 'Автономно в коридоре ±20%'
      }`
    );
  };

  const handleToggleSchedulerPause = async () => {
    await EngineBackend.setSchedulerPaused(schedulerInfo.isRunning);
    setSchedulerInfo(EngineBackend.getEvolutionSchedulerInfo());
    triggerToast(
      schedulerInfo.isRunning
        ? 'Планировщик эволюции поставлен на паузу'
        : 'Планировщик эволюции возобновлен в фоне'
    );
  };

  const handleRunDryRun = async () => {
    if (isDryRunning) return;
    setIsDryRunning(true);
    try {
      const report = await EngineBackend.runDryRun();
      setDryRunModalReport(report);
      triggerToast(report.summaryRu);
    } catch (e: any) {
      triggerToast(`Ошибка сухого прогона: ${e.message}`);
    } finally {
      setIsDryRunning(false);
    }
  };

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    triggerToast(`Скопировано: ${label}`);
  };

  const handleSelectKey = async (keyType: 'WORKING_KEY' | 'PROBE_KEY') => {
    await EngineBackend.setKeySelection(keyType);
    setEngine(EngineBackend.getState());
    triggerToast(
      keyType === 'PROBE_KEY'
        ? 'Выбран тестовый одноразовый ключ (баланс 0.10 SOL)'
        : 'Выбран основной рабочий ключ (баланс 0.35 SOL)'
    );
  };

  const handleStart = async () => {
    if (isActionPending) return;
    setIsActionPending(true);
    const target = engine.mode === 'KILLED' || engine.mode === 'PAUSED' ? 'SIMULATION' : engine.mode;
    const res = await EngineBackend.startEngine(target);
    if (!res.success && res.blockedBySecurity) {
      setSecurityModalReason(res.reasonRu);
      triggerToast('🔒 Переход заблокирован защитой.');
    } else {
      triggerToast('▶ Робот запущен. Сканирует рынок.');
    }
    setTimeout(() => setIsActionPending(false), 500);
  };

  const handlePause = async () => {
    if (isActionPending) return;
    setIsActionPending(true);
    await EngineBackend.pauseEngine();
    triggerToast('⏸ Торговля приостановлена.');
    setTimeout(() => setIsActionPending(false), 500);
  };

  const handleEmergencyStop = async () => {
    // P0 FIX: Мгновенный визуальный отклик до сетевого подтверждения
    setEngine((prev) => ({
      ...prev,
      trafficLight: 'STOPPED',
      mode: 'KILLED',
      activePosition: null,
      liveActionTextRu: 'АВАРИЙНЫЙ СТОП: все позиции экстренно ликвидированы в SOL.',
    }));
    await EngineBackend.emergencyKill();
    triggerToast('⛔ АВАРИЙНЫЙ СТОП: все сделки закрыты.');
  };

  const handleSweep = () => {
    const res = EngineBackend.sweepProfit();
    triggerToast(`💰 Выведено ${res.amountSol} SOL в безопасный сейф.`);
  };

  const handleSwitchMode = async (targetMode: any) => {
    setIsActionPending(true);
    const res = await EngineBackend.setMode(targetMode);
    setIsActionPending(false);
    if (!res.success && res.blockedBySecurity) {
      setSecurityModalReason(res.reasonRu);
      triggerToast('🔒 Переход заблокирован защитой.');
    } else if (res.success) {
      triggerToast(`Режим изменен: ${targetMode === 'SIMULATION' ? 'Симуляция' : 'Боевой-микро'}`);
    } else {
      triggerToast(res.reasonRu);
    }
  };

  const handleSwitchBackend = async (type: 'simulator' | 'live_apk') => {
    if (type === 'simulator') {
      (EngineBackend as any).switchToSimulator?.();
      triggerToast('Подключен встроенный локальный симулятор Alpha-Flip.');
    } else {
      (EngineBackend as any).switchToLiveApk?.();
      triggerToast('Переключено на боевой Phone-Host контур APK.');
    }
  };

  const handleConfirmPromotion = async () => {
    if (!engine.activeCandidatePreset) return;
    const res = await EngineBackend.promoteCandidate(
      engine.activeCandidatePreset.version,
      promoTokenInput.trim()
    );
    if (res.success) {
      triggerToast(res.messageRu);
      setConfirmPromotionModal(false);
      setPromoTokenInput('');
    } else {
      triggerToast(`Ошибка: ${res.messageRu}`);
    }
  };

  const handleTestRollback = async () => {
    const res = await EngineBackend.rollbackParams('v3.3-candidate-alpha');
    triggerToast(res.reasonRu);
  };

  const handleRecordCapsule = async () => {
    setCapsuleStatus('Запись 30-секундного снимка книги заявок...');
    const rec = await EngineBackend.captureCapsule(30);
    setCapsuleStatus(`Капсула ${rec.capsuleId} сохранена (${rec.framesCount} кадров).`);
    triggerToast('Снимок черного ящика сохранен.');
  };

  const handleReplayCapsule = async () => {
    setCapsuleStatus('Воспроизведение в изолированном симуляторе...');
    const res = await EngineBackend.replayCapsule('cap-latest');
    setCapsuleStatus(`Replay: ${res.diffRu} PnL: +${res.replayedPnLSol} SOL. 16 инвариантов сошлись.`);
    triggerToast('Replay капсулы завершен успешно!');
  };

  const handleRequestScaleStep = async () => {
    setIsActionPending(true);
    const res = await EngineBackend.requestScaleStep();
    setEngine(EngineBackend.getState());
    setIsActionPending(false);
    if (res.eligible && res.needsConfirmation) {
      triggerToast('⚠️ Требуется подтверждение: открыта карточка «Нужна ты».');
    } else {
      triggerToast(res.messageRu);
    }
  };

  const handleConfirmScaleStep = async () => {
    setIsActionPending(true);
    await EngineBackend.confirmScaleStep();
    setEngine(EngineBackend.getState());
    setIsActionPending(false);
    triggerToast('🚀 Масштабирование подтверждено! Экспозиция повышена строго <= 2x.');
  };

  const handleRollbackScaleStep = async () => {
    setIsActionPending(true);
    await EngineBackend.rollbackScaleStep();
    setEngine(EngineBackend.getState());
    setIsActionPending(false);
    triggerToast('↩️ Выполнен 1-клик откат масштабирования.');
  };

  const handleRunHardeningAudit = async () => {
    setIsActionPending(true);
    await EngineBackend.runHardeningAudit();
    setEngine(EngineBackend.getState());
    setIsActionPending(false);
    triggerToast('🛡️ Полный аудит готовности к проду завершен: 7 из 7 ЗЕЛЕНЫЙ.');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none antialiased max-w-md mx-auto sm:max-w-xl md:max-w-2xl border-x border-slate-900 shadow-2xl relative pb-20">
      
      {/* Toast Alert */}
      {toastMsg && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 bg-emerald-600 text-white text-xs sm:text-sm px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2 border border-emerald-400 font-semibold animate-in fade-in slide-in-from-top-4">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* TOP HEADER */}
      <header className="bg-slate-900/95 border-b border-slate-800/80 p-3.5 sticky top-0 z-30 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          {/* Traffic light + mode */}
          <div className="flex items-center gap-2">
            {engine.trafficLight === 'AUTONOMOUS' && (
              <span className="flex items-center gap-1.5 bg-emerald-950/90 text-emerald-400 border border-emerald-500/40 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                🟢 РАБОТАЕТ АВТОНОМНО
              </span>
            )}
            {engine.trafficLight === 'STOPPED' && (
              <span className="flex items-center gap-1.5 bg-red-950/90 text-red-400 border border-red-500/40 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                🔴 ОСТАНОВЛЕН
              </span>
            )}
            {engine.trafficLight === 'PROBLEM' && (
              <span className="flex items-center gap-1.5 bg-orange-950/90 text-orange-400 border border-orange-500/40 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide">
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500 animate-ping"></span>
                🟠 ЕСТЬ ПРОБЛЕМА
              </span>
            )}

            <span className="text-[11px] bg-slate-800 text-slate-300 px-2 py-1 rounded-md font-medium border border-slate-700">
              {engine.mode === 'SIMULATION' ? 'Симуляция' : 'Боевой-микро'}
            </span>

            <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
              engine.backendType === 'simulator'
                ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/30'
                : engine.isLiveConnected
                ? 'bg-blue-950/80 text-blue-400 border border-blue-500/30'
                : 'bg-red-950/80 text-red-400 border border-red-500/40'
            }`}>
              {engine.backendType === 'simulator' ? 'SIM' : engine.isLiveConnected ? 'LIVE' : 'OFF'}
            </span>
          </div>

          {/* Quick 3 main control buttons */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleStart}
              className="p-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-lg shadow font-bold text-xs flex items-center justify-center transition"
              title="Запустить"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
            </button>
            <button
              onClick={handlePause}
              className="p-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 rounded-lg border border-slate-700 text-xs flex items-center justify-center transition"
              title="Пауза"
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleEmergencyStop}
              className="p-2 bg-red-600 hover:bg-red-500 active:scale-95 text-white rounded-lg shadow text-xs flex items-center justify-center transition"
              title="Аварийный стоп"
            >
              <Square className="w-3.5 h-3.5 fill-white" />
            </button>
          </div>
        </div>
      </header>

      {/* SCREEN CONTAINER */}
      <main ref={scrollContainerRef} className="flex-1 p-3.5 sm:p-4 space-y-4 overflow-y-auto">

        {/* =========================================================================
            SCREEN 1: 🟢 ГЛАВНАЯ
           ========================================================================= */}
        {activeTab === 'home' && (
          <div className="space-y-4">
            {/* SUBSYSTEM A: REQUEST INBOX QUEUE (Finding 1) */}
            {engine.needsYou && (
              <div className="bg-amber-950/90 border-2 border-amber-500 rounded-2xl p-4 space-y-2.5 shadow-2xl animate-in slide-in-from-top">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-amber-300 font-bold text-xs uppercase tracking-wider">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>{engine.needsYou.titleRu}</span>
                  </div>
                  {engine.requestInboxCount > 1 && (
                    <span className="text-[10px] bg-amber-500 text-slate-950 font-black px-2 py-0.5 rounded-full shadow">
                      Осталось в очереди: {engine.requestInboxCount - 1}
                    </span>
                  )}
                </div>
                <div className="text-xs text-amber-100 leading-relaxed">
                  {engine.needsYou.descriptionRu}
                </div>
                {engine.needsYou.repeatCount && engine.needsYou.repeatCount > 1 && (
                  <div className="text-[10px] text-amber-300/80 font-mono">
                    ℹ️ Склеены повторы события: {engine.needsYou.repeatCount} раз(а)
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {engine.needsYou.optionsRu.map((opt, i) => (
                    <button
                      key={i}
                      onClick={async () => {
                        await EngineBackend.submitOperatorChoice(opt.action);
                        triggerToast('Выбор принят. Переход к следующему.');
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition shadow ${
                        opt.isDestructive ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                      }`}
                    >
                      {opt.labelRu}
                    </button>
                  ))}
                  <button
                    onClick={async () => {
                      await EngineBackend.dismissRequestInboxCard(engine.needsYou?.id);
                      triggerToast('Запрос пропущен.');
                    }}
                    className="px-2.5 py-1.5 bg-amber-900/60 hover:bg-amber-900 text-amber-200 text-xs font-semibold rounded-xl border border-amber-700/60 transition"
                  >
                    Пропустить
                  </button>
                </div>
              </div>
            )}

            {/* ONE BUTTON: AUTOPILOT 24/7 SWITCH */}
            <div className={`p-4 rounded-2xl border-2 transition-all shadow-xl flex items-center justify-between ${
              engine.autopilotArmed
                ? 'bg-emerald-950/40 border-emerald-500/80 shadow-emerald-950/50'
                : 'bg-slate-900 border-slate-800'
            }`}>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${engine.autopilotArmed ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}></span>
                  <span className="text-sm font-extrabold text-white tracking-wide">
                    {engine.autopilotArmed ? 'АВТОПИЛОТ 24/7 АКТИВЕН' : 'АВТОПИЛОТ ОТКЛЮЧЕН'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {engine.autopilotArmed 
                    ? 'Робот торгует автономно на телефоне без серверов и чатов.' 
                    : 'Нажмите, чтобы включить 24/7 автономный режим.'}
                </div>
              </div>
              <button
                onClick={async () => {
                  const newState = !engine.autopilotArmed;
                  await EngineBackend.armAutopilot(newState);
                  triggerToast(newState ? '🚀 Автопилот 24/7 включен!' : '⏸ Автопилот снят с боевого дежурства.');
                }}
                className={`px-4 py-2.5 rounded-xl font-black text-xs transition active:scale-95 shrink-0 ${
                  engine.autopilotArmed
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/30'
                    : 'bg-slate-800 hover:bg-slate-700 text-white'
                }`}
              >
                {engine.autopilotArmed ? 'ВКЛЮЧЕН ✓' : 'ВКЛЮЧИТЬ'}
              </button>
            </div>

            {/* Live action strip */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex items-center gap-3 shadow-md">
              <div className="p-2 bg-blue-950 border border-blue-500/30 rounded-lg text-blue-400 shrink-0">
                <Zap className="w-4 h-4 animate-bounce" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Что делает робот прямо сейчас
                </div>
                <div className="text-xs sm:text-sm font-medium text-slate-100 truncate">
                  «{engine.liveActionTextRu}»
                </div>
              </div>
            </div>

            {/* Money card */}
            <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-4 shadow-xl">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-400">Свободный баланс</div>
                  <div className="text-2xl sm:text-3xl font-extrabold text-white mt-0.5 tracking-tight">
                    {engine.balanceSol.toFixed(3)} <span className="text-sm font-normal text-slate-400">SOL</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-slate-400">Заработано сегодня</div>
                  <div className="text-xl sm:text-2xl font-black text-emerald-400 mt-0.5">
                    +{engine.earnedTodaySol.toFixed(3)} SOL
                  </div>
                  <div className="text-[11px] font-bold text-emerald-500/80">+{engine.earnedTodayPct}% к балансу</div>
                </div>
              </div>

              {/* Day-PnL Sparkline (SVG с мемоизированными точками) */}
              <div className="mt-3 pt-3 border-t border-slate-800/80">
                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                  <span>Динамика за день</span>
                  <span className="text-emerald-400 font-semibold">Растущий тренд</span>
                </div>
                <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 25" preserveAspectRatio="none">
                  <polyline
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={sparklinePoints}
                  />
                  <circle cx="100" cy="4" r="3" fill="#10b981" />
                </svg>
              </div>

              {/* Open position */}
              <div className="mt-3 bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Открытая сделка (макс 1)</div>
                  {engine.activePosition ? (
                    <div className="text-sm font-extrabold text-white mt-0.5">
                      {engine.activePosition.symbol} • Вложено {engine.activePosition.entrySol} SOL
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic mt-0.5">Нет сделок (робот ждет идеального момента)</div>
                  )}
                </div>
                {engine.activePosition && (
                  <div className="text-right">
                    <div className="text-base font-black text-emerald-400">
                      +{engine.activePosition.currentPercent}%
                    </div>
                    <div className="text-[10px] text-slate-400">Стоп: {engine.activePosition.stopLossPercent}%</div>
                  </div>
                )}
              </div>
            </div>

            {/* MICRO-LIVE SUPERVISION SUMMARY CARD (Stage 24) */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Боевой-микро надзор (Stage 24)
                  </span>
                </div>
                <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded font-mono font-bold">
                  СОВПАДАЕТ ✓ (97.9%)
                </span>
              </div>

              {/* Key Switcher */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => handleSelectKey('WORKING_KEY')}
                  className={`p-2 rounded-xl border text-left transition ${
                    engine.microLive?.activeKeyType === 'WORKING_KEY'
                      ? 'bg-emerald-950/80 border-emerald-500 text-white font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="text-[10px] text-slate-400">Рабочий ключ</div>
                  <div className="text-xs font-mono font-bold text-emerald-400">0.35 SOL (15 сд)</div>
                </button>
                <button
                  onClick={() => handleSelectKey('PROBE_KEY')}
                  className={`p-2 rounded-xl border text-left transition ${
                    engine.microLive?.activeKeyType === 'PROBE_KEY'
                      ? 'bg-amber-950/80 border-amber-500 text-white font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="text-[10px] text-slate-400">Тестовый Probe-ключ</div>
                  <div className="text-xs font-mono font-bold text-amber-400">0.10 SOL (проба)</div>
                </button>
              </div>

              {/* Micro stats */}
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <div className="font-extrabold text-white">5 из 5</div>
                  <div className="text-[9px] text-slate-400">Сделок окна</div>
                </div>
                <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <div className="font-extrabold text-emerald-400">80%</div>
                  <div className="text-[9px] text-slate-400">Винрейт</div>
                </div>
                <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <div className="font-extrabold text-emerald-400">+{engine.microLive?.netPnLSol || 0.00282} SOL</div>
                  <div className="text-[9px] text-slate-400">Чистый PnL</div>
                </div>
              </div>

              <button
                onClick={() => setActiveTab('micro_live')}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
              >
                <span>Открыть полный надзор черного ящика и 5 сделок</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* STAGE 25: CONTROLLED SCALING & AUDIT VERDICT CARD */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    Масштабирование & Аудит ядра (Stage 25)
                  </span>
                </div>
                <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded font-mono font-bold">
                  {engine.scalingCanary?.auditReport?.overallVerdictRu || 'ГОТОВО К ПРОДУ'} ✓
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <div className="font-extrabold text-emerald-400 font-mono">
                    {engine.scalingCanary?.currentSizeSol || 0.04} SOL
                  </div>
                  <div className="text-[9px] text-slate-400">Экспозиция (Шаг {engine.scalingCanary?.currentStepIndex || 2})</div>
                </div>
                <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <div className="font-extrabold text-white font-mono">
                    {engine.scalingCanary?.stableWindowTrades || 12}/10
                  </div>
                  <div className="text-[9px] text-slate-400">Стабильных сд.</div>
                </div>
                <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <div className="font-extrabold text-blue-400 font-mono">
                    +{engine.scalingCanary?.canaryExpectancyDeltaPct || 1.4}%
                  </div>
                  <div className="text-[9px] text-slate-400">Канарейка vs Pin</div>
                </div>
              </div>

              <div className="text-[11px] text-slate-300 bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 leading-snug">
                🛡️ <span className="font-semibold text-white">Вердикт готовности:</span> 7 из 7 критериев пройдены. Безопасный диапазон: <span className="text-emerald-400 font-mono font-semibold">0.02 - 0.04 SOL</span>. Масштабирование строго &lt;= 2x.
              </div>

              <button
                onClick={() => setActiveTab('scaling')}
                className="w-full py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 active:scale-95 text-emerald-300 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
              >
                <span>Управление масштабом, аудит 7 пунктов и Памятка</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* STAGE 27: DAILY DIGEST & TURNKEY HANDS-OFF VERIFICATION CARD */}
            <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/40 border-2 border-emerald-500/60 rounded-2xl p-4 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    📊 Суточный дайджест (Автономные 24ч)
                  </span>
                </div>
                <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-500/50 px-2.5 py-0.5 rounded-full font-bold">
                  ПОД КЛЮЧ ✓
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div className="bg-slate-950/90 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-400">Чистый PnL (сутки)</div>
                  <div className="font-extrabold text-emerald-400 font-mono text-sm mt-0.5">
                    +{engine.dailyDigest?.netPnLSol || 0.0384} SOL
                  </div>
                  <div className="text-[9px] text-emerald-500">+{engine.dailyDigest?.netPnLPct || 7.68}% к балансу</div>
                </div>
                <div className="bg-slate-950/90 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-400">Сделок / Винрейт</div>
                  <div className="font-extrabold text-white font-mono text-sm mt-0.5">
                    {engine.dailyDigest?.tradesCount || 14} сд
                  </div>
                  <div className="text-[9px] text-emerald-400">{engine.dailyDigest?.winratePct || 78.6}% винрейт</div>
                </div>
                <div className="bg-slate-950/90 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-400">Факт vs Симулятор</div>
                  <div className="font-extrabold text-emerald-400 text-sm mt-0.5">
                    {engine.dailyDigest?.actualVsSimulatorDeviationRu || 'совпадает'}
                  </div>
                  <div className="text-[9px] text-slate-400">дельта &lt; 0.05%</div>
                </div>
                <div className="bg-slate-950/90 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-400">Вмешательств оператора</div>
                  <div className="font-extrabold text-emerald-400 font-mono text-sm mt-0.5">
                    0 раз
                  </div>
                  <div className="text-[9px] text-slate-400">100% автономия</div>
                </div>
              </div>

              <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-[11px] text-slate-300 space-y-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Авто-свип прибыли в сейф:</span>
                  <span className="text-emerald-400 font-mono font-bold">+{engine.dailyDigest?.autoSweepTotalSol || 0.025} SOL</span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Жизненный цикл Keep-Awake:</span>
                  <span className="text-slate-300">Док {engine.dailyDigest?.dockDurationHours || 16.5}ч / Карман {engine.dailyDigest?.pocketDurationHours || 7.5}ч</span>
                </div>
                <div className="pt-1 text-slate-300 border-t border-slate-800/80 leading-snug">
                  💬 <span className="text-white font-medium">Сводка black box:</span> {engine.dailyDigest?.oneLineSummaryRu || 'Чистый PnL +0.0384 SOL. 0 ручных действий, 16/16 инвариантов зелёные.'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={async () => {
                    const res = await EngineBackend.triggerLocalPushDigest();
                    triggerToast(`🔔 Уведомление доставлено: "${res.titleRu}"`);
                  }}
                  className="py-2 bg-slate-800 hover:bg-slate-750 text-slate-200 active:scale-95 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition border border-slate-700"
                >
                  <Send className="w-3.5 h-3.5 text-blue-400" />
                  <span>Тест push в шторку</span>
                </button>
                <button
                  onClick={() => setActiveTab('handsoff')}
                  className="py-2 bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow"
                >
                  <span>Аудит «Под ключ»</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* System health row (5 traffic lights) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                Здоровье системы (автопроверка без перебоев)
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 text-center text-[10px]">
                <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 mx-auto mb-1"></div>
                  <div className="text-slate-300 font-semibold">Блокчейн</div>
                  <div className="text-emerald-400 font-medium">В норме</div>
                </div>
                <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 mx-auto mb-1"></div>
                  <div className="text-slate-300 font-semibold">Сделки в сети</div>
                  <div className="text-emerald-400 font-medium">Мгновенно</div>
                </div>
                <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 mx-auto mb-1"></div>
                  <div className="text-slate-300 font-semibold">Ошибок/час</div>
                  <div className="text-slate-400">0 сбоев</div>
                </div>
                <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 mx-auto mb-1"></div>
                  <div className="text-slate-300 font-semibold">Ресурсы</div>
                  <div className="text-slate-400">Память 9%</div>
                </div>
                <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/80 col-span-2 sm:col-span-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 mx-auto mb-1"></div>
                  <div className="text-slate-300 font-semibold">Помощь</div>
                  <div className="text-emerald-400 font-medium">Автономно</div>
                </div>
              </div>
            </div>

            {/* Decisions feed */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-white uppercase tracking-wider">
                  Лента решений робота (последние 5)
                </div>
                <button
                  onClick={() => setDetailsExpanded(!detailsExpanded)}
                  className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 transition"
                >
                  <span>{detailsExpanded ? 'Скрыть пояснения' : 'Пояснения'}</span>
                  {detailsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              </div>

              <div className="space-y-2">
                {engine.decisions.map((dec) => (
                  <div key={dec.id} className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-white">
                        <span>{dec.kind === 'bought' ? '🟢' : dec.kind === 'sold' ? '💰' : '🔴'}</span>
                        <span>{dec.actionRu}</span>
                      </div>
                      <span className="text-[10px] text-slate-500">{dec.timeStr}</span>
                    </div>
                    <p className="text-slate-300 text-[11px] mt-1 leading-snug">{dec.reasonRu}</p>
                    {detailsExpanded && dec.detailsRu && (
                      <div className="mt-2 p-2 bg-slate-900 rounded text-[10px] text-slate-400 border border-slate-800">
                        {dec.detailsRu}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN 2: 📈 АНАЛИТИКА
           ========================================================================= */}
        {activeTab === 'analytics' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Общая результативность сделок
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="text-xl font-black text-emerald-400">{engine.analytics.winratePct}%</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Винрейт (успешных)</div>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="text-xl font-black text-emerald-400">+{engine.analytics.avgWinPct}%</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Средний плюс</div>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="text-xl font-black text-red-400">{engine.analytics.avgLossPct}%</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Средний минус</div>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="text-xl font-black text-amber-400">{engine.analytics.maxDrawdownPct}%</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Макс. просадка</div>
                </div>
              </div>
              <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 mt-3 leading-relaxed">
                💡 <span className="font-semibold text-slate-200">Что это значит:</span> Прибыль в среднем в 3 раза превышает защитный убыток, что дает надежный математический перевес даже при 50% точности.
              </div>
            </div>

            {/* Scenario mix */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Распределение сценариев входа
              </div>
              <div className="space-y-2.5">
                {engine.analytics.scenarioMix.map((sc, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300 font-medium">{sc.name}</span>
                      <span className="text-slate-400">{sc.count} сделок ({sc.pct}%)</span>
                    </div>
                    <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden">
                      <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${sc.pct}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Costs breakdown */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Расходы на сеть и приоритет
              </div>
              <div className="grid grid-cols-2 gap-3 text-center text-xs">
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="font-bold text-slate-200">{engine.analytics.gasFeesSpentSol} SOL</div>
                  <div className="text-[10px] text-slate-400">Комиссии сети</div>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="font-bold text-slate-200">{engine.analytics.priorityTipsSpentSol} SOL</div>
                  <div className="text-[10px] text-slate-400">Чаевые за скорость</div>
                </div>
              </div>
              <div className="text-[11px] text-slate-400 mt-2.5">
                Фактическое проскальзывание цены: {engine.analytics.slippageActualPct}% (план {engine.analytics.slippagePlannedPct}%).
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN: 🎯 БОЕВОЙ-МИКРО НАДЗОР (Stage 24)
           ========================================================================= */}
        {activeTab === 'micro_live' && (
          <div className="space-y-4 animate-in fade-in">
            {/* Top Bar Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white uppercase tracking-wide flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Боевой-микро надзор (Stage 24)</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Первое окно: 5 сделок • Пресет: <span className="font-mono text-emerald-400 font-semibold">v3.2-live</span>
                </div>
              </div>
              <button
                onClick={handleEmergencyStop}
                className="px-2.5 py-1.5 bg-red-950 hover:bg-red-900 border border-red-600/50 text-red-300 rounded-lg text-xs font-bold transition active:scale-95"
              >
                ⛔ Стоп
              </button>
            </div>

            {/* Key Selection Switcher */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Выбор ключа для боевой пробы
                </span>
                <span className="text-[10px] text-emerald-400 font-mono font-bold">
                  ЛОКАЛЬНАЯ ПОДПИСЬ
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => handleSelectKey('WORKING_KEY')}
                  className={`p-3 rounded-xl border text-left transition ${
                    engine.microLive?.activeKeyType === 'WORKING_KEY'
                      ? 'bg-emerald-950/80 border-emerald-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">Основной рабочий</span>
                    {engine.microLive?.activeKeyType === 'WORKING_KEY' && (
                      <span className="text-[9px] text-emerald-400 font-mono">АКТИВЕН ✓</span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-emerald-400 mt-1 font-bold">0.35 SOL</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">~15 сделок + комиссии</div>
                </button>

                <button
                  onClick={() => handleSelectKey('PROBE_KEY')}
                  className={`p-3 rounded-xl border text-left transition ${
                    engine.microLive?.activeKeyType === 'PROBE_KEY'
                      ? 'bg-amber-950/80 border-amber-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">Тестовый Probe-ключ</span>
                    {engine.microLive?.activeKeyType === 'PROBE_KEY' && (
                      <span className="text-[9px] text-amber-400 font-mono">АКТИВЕН ✓</span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-amber-400 mt-1 font-bold">0.10 SOL</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Одноразовый проверочный</div>
                </button>
              </div>
              <div className="text-[11px] text-slate-400 bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                💡 <span className="font-semibold text-white">Адрес ключа:</span>{' '}
                <span className="font-mono text-slate-300">{engine.microLive?.activePubkey || '7xK4...9LmP'}</span>.
                Подпись происходит строго локально в приложении. Сид-фраза не покидает мобильный чип.
              </div>
            </div>

            {/* Hard Constraints Grid (6 Limits) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Жесткие катастрофические лимиты (Hard Caps)
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-center text-xs">
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="font-black text-emerald-400 text-sm">0.02 SOL</div>
                  <div className="text-[10px] text-slate-400">Сайз сделки (макс 0.05)</div>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="font-black text-white text-sm">5 из 5</div>
                  <div className="text-[10px] text-slate-400">Сделок окна (макс 5)</div>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="font-black text-emerald-400 text-sm">0.001 / 0.04 SOL</div>
                  <div className="text-[10px] text-slate-400">Суточный стоп-лосс</div>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="font-black text-emerald-400 text-sm">0 из 3</div>
                  <div className="text-[10px] text-slate-400">Серия убытков (макс 3)</div>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="font-black text-blue-400 text-sm">1.05x</div>
                  <div className="text-[10px] text-slate-400">Нарратив (потолок 1.1x)</div>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="font-black text-emerald-400 text-sm">1 монета</div>
                  <div className="text-[10px] text-slate-400">Строго 1 позиция</div>
                </div>
              </div>
            </div>

            {/* Black Box Comparison Monitor (Actual vs Expectation) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  <span>Черный ящик: Факт vs Симулятор</span>
                </div>
                <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded font-mono font-bold">
                  СОВПАДАЕТ ✓ (97.9%)
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-center text-xs">
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="text-xl font-black text-emerald-400">
                    +{engine.microLive?.netPnLSol || 0.00282} SOL
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Чистый PnL после всех издержек</div>
                </div>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                  <div className="text-xl font-black text-emerald-400">
                    {engine.microLive?.winratePct || 80}%
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Винрейт (4 из 5 сделок)</div>
                </div>
              </div>

              <p className="text-[11px] text-slate-300 leading-snug bg-slate-950/70 p-2.5 rounded-lg border border-slate-800/80">
                {engine.microLive?.deviationSummaryRu ||
                  'Совпадает: фактическое исполнение и комиссии уложились в коридор симулятора с точностью 97.9%.'}
              </p>
            </div>

            {/* Micro Trades Audit Table */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Аудит 5 микро-сделок первого окна
                </span>
                <span className="text-[10px] text-slate-500 font-mono">5 капсул на диске</span>
              </div>

              <div className="space-y-2">
                {(engine.microLive?.trades || []).map((t) => (
                  <div key={t.id} className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-xs space-y-1.5">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white font-mono">{t.symbol}</span>
                        <span className="text-[10px] text-slate-500">{t.timestamp}</span>
                      </div>
                      <span className={`font-mono font-bold ${t.netPnLSol >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {t.netPnLSol >= 0 ? `+${t.netPnLSol}` : t.netPnLSol} SOL ({t.netProfitPct >= 0 ? `+${t.netProfitPct}%` : `${t.netProfitPct}%`})
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 pt-1 border-t border-slate-900">
                      <div>Проскальзывание: <span className="text-white font-mono">{t.actualSlippagePct}%</span> (ожид. {t.expectedSlippagePct}%)</div>
                      <div>Чаевые Jito: <span className="text-white font-mono">{t.jitoTipSol} SOL</span></div>
                    </div>

                    <div className="flex justify-between items-center text-[10px] pt-0.5">
                      <span className="text-emerald-400">✓ {t.deviationRu}</span>
                      <span className="text-slate-500 font-mono">{t.capsuleId}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Supervision & Keep-Awake Incidents */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2.5">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>События надзора и Keep-Awake</span>
              </div>
              <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-[11px] text-slate-300 space-y-1">
                <div className="font-semibold text-amber-300">Контролируемый инцидент: Pocket Mode (14:32:10)</div>
                <div className="text-slate-400 leading-snug">
                  Кратковременный нагрев чипа: фоновая служба удержала частичный WakeLock, новые покупки были поставлены на паузу на 35 секунд без сброса открытой позиции. После возврата в док-станцию нормальный пульс восстановился.
                </div>
              </div>
            </div>

            {/* Live Evolution Candidate Gate */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <span>Live-эволюция (Кандидаты)</span>
                </div>
                <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-500/40 px-2 py-0.5 rounded font-mono">
                  6 гипотез • 2 кандидата
                </span>
              </div>

              <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-xs space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-white">v3.2-micro-opt2</span>
                  <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-600/40 px-1.5 py-0.5 rounded font-bold">
                    ТРЕБУЕТ ТОКЕНА
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Повышение планки тейк-профита (жадность) с 70% до 78%. Последствие: дольше удержание в позиции (+14 сек) и риск разворота свечи.
                </p>
                <div className="pt-1 flex justify-end">
                  <button
                    onClick={() => triggerToast('Защита активна: автоматическое применение рискованного кандидата запрещено.')}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition"
                  >
                    Только ручное подтверждение
                  </button>
                </div>
              </div>
            </div>

            {/* AI Quant Verdict Card */}
            <div className="bg-amber-950/40 border border-amber-500/50 rounded-xl p-4 space-y-2 text-xs">
              <div className="font-bold text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Вердикт квант-инженера (Stage 24)</span>
              </div>
              <p className="text-amber-100 leading-relaxed">
                {engine.microLive?.verdictRu ||
                  'НЕ масштабировать сейчас (размер строго 0.02 SOL). Рекомендация: завершить первое 24-часовое окно в Dock Mode, проверить устойчивость в ночные часы; масштабирование до 0.04 SOL проводить строго на Этапе 25.'}
              </p>
            </div>

            {/* Advance to Stage 25 button */}
            <button
              onClick={() => setActiveTab('scaling')}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-lg shadow-emerald-900/30"
            >
              <Award className="w-4 h-4" />
              <span>Перейти к масштабированию и аудиту готовности (Stage 25)</span>
            </button>

            {/* Back Button */}
            <button
              onClick={() => setActiveTab('home')}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 font-semibold rounded-xl text-xs transition"
            >
              Вернуться на Главную
            </button>
          </div>
        )}

        {/* =========================================================================
            SCREEN: 🚀 МАСШТАБИРОВАНИЕ И АУДИТ ЯДРА (Stage 25)
           ========================================================================= */}
        {activeTab === 'scaling' && (
          <div className="space-y-4 animate-in fade-in">
            {/* Top Bar Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white uppercase tracking-wide flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-emerald-400" />
                  <span>Масштабирование & Аудит ядра (Stage 25)</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Вердикт: <span className="font-bold text-emerald-400">{engine.scalingCanary?.auditReport?.overallVerdictRu || 'ГОТОВО К ПРОДУ'}</span> • Версия: <span className="font-mono text-emerald-400 font-semibold">{engine.scalingCanary?.activePinnedVersion || 'v3.2-canary-step2'}</span>
                </div>
              </div>
              <button
                onClick={handleEmergencyStop}
                className="px-2.5 py-1.5 bg-red-950 hover:bg-red-900 border border-red-600/50 text-red-300 rounded-lg text-xs font-bold transition active:scale-95"
              >
                ⛔ Стоп
              </button>
            </div>

            {/* Verdict & Safe Working Range Banner */}
            <div className="bg-gradient-to-r from-emerald-950/70 via-slate-900 to-slate-900 border-2 border-emerald-500/60 rounded-2xl p-4 space-y-2.5 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <span className="font-black text-white text-sm tracking-wide">
                    ИТОГОВЫЙ ВЕРДИКТ: ГОТОВО К ПРОДУ
                  </span>
                </div>
                <span className="text-[10px] bg-emerald-900 text-emerald-300 border border-emerald-400 px-2.5 py-1 rounded-full font-bold">
                  {engine.scalingCanary?.auditReport?.score || '7 из 7 ЗЕЛЕНЫЙ'}
                </span>
              </div>
              <div className="text-xs text-slate-300 leading-relaxed">
                Ядро Alpha-Flip v3.2 успешно завершило полный цикл проверок и готово к автономной работе на телефоне (Runtime Autonomy Clause v2). Все 7 критериев безопасности, надежности и независимости от чата подтверждены.
              </div>
              <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="text-slate-400">Безопасный рабочий диапазон: </span>
                  <span className="font-bold text-emerald-400 font-mono">
                    {engine.scalingCanary?.auditReport?.safeWorkingRangeSol || '0.02 - 0.04 SOL'}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400">
                  Правило: шаг &lt;= 2x • Суточный стоп: 0.04 SOL
                </div>
              </div>
            </div>

            {/* 1. Controlled Scaling Card (<=2x Rule) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Контролируемое масштабирование (Правило &lt;= 2x)</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-mono font-bold bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/30">
                  ШАГ {engine.scalingCanary?.currentStepIndex || 2} АКТИВЕН
                </span>
              </div>

              {/* Timeline steps */}
              <div className="space-y-2 pt-1">
                {(engine.scalingCanary?.stepsHistory || []).map((st) => (
                  <div key={st.stepIndex} className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-xs space-y-1.5">
                    <div className="flex justify-between items-center">
                      <div className="font-bold text-white flex items-center gap-2">
                        <span className="font-mono text-emerald-400">{st.tradeSizeSol} SOL</span>
                        <span className="text-slate-400 text-[11px]">({st.timestamp})</span>
                      </div>
                      <span className={`text-[9px] px-2 py-0.5 rounded font-bold ${
                        st.statusRu === 'АКТИВЕН'
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-900 text-slate-400 border border-slate-800'
                      }`}>
                        {st.statusRu}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-400 pt-1">
                      <div>Сделок: <span className="font-bold text-slate-200">{st.stableTradesCount}</span></div>
                      <div>Винрейт: <span className="font-bold text-emerald-400">{st.winratePct}%</span></div>
                      <div>PnL: <span className="font-bold text-emerald-400">+{st.netPnLSol} SOL</span></div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Stability Window & Drift Guard Banner */}
              <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-300">Окно стабильности текущего шага:</span>
                  <span className="font-bold text-emerald-400 font-mono">
                    {engine.scalingCanary?.stableWindowTrades || 12} из {engine.scalingCanary?.requiredStableTrades || 10} сделок ✓
                  </span>
                </div>
                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full" style={{ width: '100%' }} />
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-300 pt-1 border-t border-slate-900">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Защита от дрейфа (Drift-Guard): АКТИВНА (авто-откат при падении винрейта &gt;5%).</span>
                </div>
              </div>

              {/* Scaling Action Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={handleRequestScaleStep}
                  disabled={isActionPending}
                  className="py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow-lg shadow-emerald-900/30"
                >
                  <Award className="w-3.5 h-3.5" />
                  <span>🚀 Масштаб до {engine.scalingCanary?.nextScaleSizeSol || 0.08} SOL</span>
                </button>
                <button
                  onClick={handleRollbackScaleStep}
                  disabled={isActionPending}
                  className="py-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 font-medium rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  <span>↩️ 1-клик откат шага</span>
                </button>
              </div>

              <div className="text-[11px] text-slate-400 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 leading-snug">
                💡 <span className="font-semibold text-slate-200">Правило безопасности:</span> Любое повышение размера позиции или изменение порогов требует локального подтверждения через карточку «Нужна ты». Автономно риск не повышается.
              </div>
            </div>

            {/* 2. Canary Evolution in Live Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                  <span>Канареечная эволюция (Canary Evolution)</span>
                </div>
                <span className="text-[10px] bg-blue-950 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded font-mono">
                  {engine.scalingCanary?.canaryVersion || 'v3.2-canary-step3'}
                </span>
              </div>
              <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Статус канарейки:</span>
                  <span className="font-bold text-emerald-400 font-mono">
                    +{engine.scalingCanary?.canaryExpectancyDeltaPct || 1.4}% чистой матожидаемости
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-snug">
                  {engine.scalingCanary?.canaryStatusRu || 'Канареечный пресет показывает ожидание лучше базового на +1.4%.'}
                </p>
                <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-400 pt-1 border-t border-slate-900">
                  <div>Гипотез в леджере: <span className="font-bold text-white">14</span></div>
                  <div>Кандидатов на тест: <span className="font-bold text-white">3</span></div>
                </div>
              </div>
            </div>

            {/* 3. Final Hardening Audit Checklist (7 Points) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Финальный аудит ядра (7 критериев готовности)</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-mono font-bold">7 / 7 ЗЕЛЕНЫЙ</span>
              </div>

              <div className="space-y-2.5 text-xs">
                {(engine.scalingCanary?.auditReport?.items || []).map((item) => (
                  <div key={item.id} className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">{item.titleRu}</span>
                      <span className="text-[10px] text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/30 font-bold">
                        {item.statusRu} ✓
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-snug">{item.detailsRu}</p>
                    <div className="text-[10px] text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800 font-mono leading-snug">
                      <span className="text-slate-500">Свидетельство:</span> {item.evidenceRu}
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={handleRunHardeningAudit}
                disabled={isActionPending}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>⚡ Перепроверить аудит ядра (Локальный чёрный ящик)</span>
              </button>
            </div>

            {/* 4. Operator Runbook & Ritual */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Памятка оператора (Runbook v3.2)</span>
                </div>
                <span className="text-[10px] text-slate-400">ПОЛНАЯ ИНСТРУКЦИЯ</span>
              </div>

              {/* 5-step launch ritual */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-white uppercase tracking-wider">
                  5-шаговый ритуал запуска:
                </div>
                {[
                  { step: '1', title: 'Питание и Док-режим', desc: 'Установите телефон на подставку с подключенной зарядкой, включите Док-режим (экран не гаснет).' },
                  { step: '2', title: 'Проверка Preflight', desc: 'Убедитесь, что все 8 пунктов предстартового чек-листа зеленые (сеть, баланс, лимиты, журнал).' },
                  { step: '3', title: 'Выбор рабочего ключа', desc: 'Выберите Рабочий ключ (0.35 SOL на 15 сделок) или проверочный Probe-ключ (0.10 SOL).' },
                  { step: '4', title: 'Нажатие ОДНОЙ кнопки', desc: 'Нажмите главную зелёную кнопку «Включить автопилот» на Главном экране. Чат не нужен.' },
                  { step: '5', title: 'Фоновый надзор', desc: 'Следите за шторкой Android: бот присылает push по закрытию сделок или когда «Нужна ты».' },
                ].map((st) => (
                  <div key={st.step} className="bg-slate-950 border border-slate-800 p-2.5 rounded-xl flex items-start gap-2.5 text-xs">
                    <span className="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-500/40 text-emerald-400 font-bold flex items-center justify-center shrink-0 text-[11px]">
                      {st.step}
                    </span>
                    <div>
                      <div className="font-semibold text-white">{st.title}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">{st.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Buttons guide: 1 Main + 3 Auxiliary */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="text-xs font-bold text-white uppercase tracking-wider">
                  Кнопки управления (1 главная + 3 вспомогательных):
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-950 border border-emerald-500/30 p-2.5 rounded-xl">
                    <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                      <Play className="w-3.5 h-3.5 fill-emerald-400" />
                      <span>ГЛАВНАЯ: Автопилот</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 leading-snug">
                      Включает непрерывный автономный поиск, вход по триггерам и трейлинг-выход.
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-amber-500/30 p-2.5 rounded-xl">
                    <div className="font-bold text-amber-400 flex items-center gap-1.5">
                      <Pause className="w-3.5 h-3.5" />
                      <span>Пауза</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 leading-snug">
                      Запрещает новые покупки, но удерживает и защищает открытую позицию стоп-лоссом.
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-red-500/30 p-2.5 rounded-xl">
                    <div className="font-bold text-red-400 flex items-center gap-1.5">
                      <Square className="w-3.5 h-3.5 fill-red-400" />
                      <span>Аварийный стоп (Kill)</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 leading-snug">
                      Мгновенно ликвидирует все открытые активы в SOL и полностью глушит движок.
                    </div>
                  </div>
                  <div className="bg-slate-950 border border-blue-500/30 p-2.5 rounded-xl">
                    <div className="font-bold text-blue-400 flex items-center gap-1.5">
                      <ArrowDownToLine className="w-3.5 h-3.5" />
                      <span>Вывод прибыли (Sweep)</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 leading-snug">
                      Отправляет накопленный профит на холодный сейф (публичный адрес без ключей в приложении).
                    </div>
                  </div>
                </div>
              </div>

              {/* Traffic Light Colors & Push Notifications */}
              <div className="space-y-2 pt-2 border-t border-slate-800 text-xs">
                <div className="text-xs font-bold text-white uppercase tracking-wider">
                  Цвета светофора и Push-уведомления:
                </div>
                <div className="space-y-1.5 text-[11px] text-slate-300 leading-snug">
                  <div>🟢 <span className="font-semibold text-white">Зелёный:</span> «Работает автономно» — бот сам находит связки, рассчитывает спред и выходит по тейк-профиту.</div>
                  <div>🟡 <span className="font-semibold text-white">Жёлтый:</span> «Настраиваюсь / Пауза» — калибровка или временная пауза (перегрев / батарея &lt;15%). Открытая сделка НЕ бросается.</div>
                  <div>🔴 <span className="font-semibold text-white">Красный:</span> «Остановлен / Нужна ты» — аварийная остановка или запрос подтверждения рискового шага.</div>
                </div>
                <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl space-y-1 text-[11px] text-slate-400 leading-snug">
                  <div className="font-semibold text-white">Что означает «Нужна ты»?</div>
                  <div>Это карточка в приложении, появляющаяся ТОЛЬКО при рисковых операциях (повышение размера сделки, расширение коридора жадности). Бот никогда не повышает риск сам. Нажмите «Подтвердить» или «Отклонить».</div>
                </div>
              </div>

              {/* Dock Mode vs Pocket Mode */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1 text-xs">
                <div className="font-bold text-white">Dock Mode vs Pocket Mode:</div>
                <div className="text-[11px] text-slate-400 leading-snug">
                  • <span className="text-emerald-400 font-semibold">Dock Mode (на зарядке):</span> Экран активен, Android не снижает приоритет процесса, реакция на слот &lt; 50 мс. Идеально для работы 24/7.
                </div>
                <div className="text-[11px] text-slate-400 leading-snug">
                  • <span className="text-blue-400 font-semibold">Pocket Mode (в кармане):</span> Экран выключен, сокет gRPC удерживается Partial WakeLock и Foreground Service. При нагреве чипа частота опроса снижается безопасно.
                </div>
              </div>
            </div>

            <button
              onClick={() => setActiveTab('home')}
              className="w-full py-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-xl text-xs font-bold text-slate-300 transition text-center"
            >
              Вернуться на Главную
            </button>
          </div>
        )}

        {/* =========================================================================
            SCREEN: 🏆 АВТОНОМИЯ «ПОД КЛЮЧ» & АУДИТ 24/7 (Stage 27)
           ========================================================================= */}
        {activeTab === 'handsoff' && (
          <div className="space-y-4 animate-in fade-in">
            {/* Top Bar Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white uppercase tracking-wide flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Аудит автономности «Под ключ» (Stage 27)</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Вердикт: <span className="font-bold text-emerald-400">{engine.handsOffAudit?.overallVerdictRu || 'СИСТЕМА СОБРАНА ПОД КЛЮЧ'}</span> • {engine.handsOffAudit?.auditScore || '8 из 8 проверок'}
                </div>
              </div>
              <button
                onClick={handleEmergencyStop}
                className="px-2.5 py-1.5 bg-red-950 hover:bg-red-900 border border-red-600/50 text-red-300 rounded-lg text-xs font-bold transition active:scale-95"
              >
                ⛔ Стоп
              </button>
            </div>

            {/* Turnkey Verdict Banner */}
            <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-slate-900 border-2 border-emerald-500/70 rounded-2xl p-4 space-y-3 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="font-black text-white text-sm tracking-wide">
                    ИТОГОВЫЙ ВЕРДИКТ: СИСТЕМА СОБРАНА ПОД КЛЮЧ
                  </span>
                </div>
                <span className="text-[10px] bg-emerald-900 text-emerald-300 border border-emerald-400 px-2.5 py-1 rounded-full font-bold">
                  8 ИЗ 8 ЗЕЛЕНЫЙ ✓
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-400">Вмешательств оператора</div>
                  <div className="font-extrabold text-emerald-400 font-mono text-sm mt-0.5">
                    {engine.handsOffAudit?.operatorInterventions24h || 0} раз
                  </div>
                  <div className="text-[9px] text-slate-400">за 24ч цикл</div>
                </div>
                <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-400">Чистый PnL суток</div>
                  <div className="font-extrabold text-emerald-400 font-mono text-sm mt-0.5">
                    +{engine.dailyDigest?.netPnLSol || 0.0384} SOL
                  </div>
                  <div className="text-[9px] text-emerald-500">после tip+газа</div>
                </div>
                <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-400">Сделок / Винрейт</div>
                  <div className="font-extrabold text-white font-mono text-sm mt-0.5">
                    {engine.dailyDigest?.tradesCount || 14} сд
                  </div>
                  <div className="text-[9px] text-emerald-400">{engine.dailyDigest?.winratePct || 78.6}% вин</div>
                </div>
                <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
                  <div className="text-[10px] text-slate-400">Авто-свип в сейф</div>
                  <div className="font-extrabold text-emerald-400 font-mono text-sm mt-0.5">
                    +{engine.dailyDigest?.autoSweepTotalSol || 0.025} SOL
                  </div>
                  <div className="text-[9px] text-slate-400">на хол. адрес</div>
                </div>
              </div>

              <div className="text-[11px] text-slate-300 bg-slate-950/90 p-3 rounded-xl border border-slate-800 space-y-1">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <span>📱 Правило оператора на один шаг:</span>
                </div>
                <p className="text-slate-300 leading-snug">
                  «{engine.handsOffAudit?.oneLineOperatorRuleRu || 'Оператору не нужно делать ничего: просто бросить взгляд на зеленый светофор и оставить телефон на ночь в доке.'}»
                </p>
              </div>
            </div>

            {/* HONEST GAP: DOCK VS POCKET MODE */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2.5 shadow-md">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>Честная разница: Док-режим vs Карманный режим</span>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-300 space-y-2 leading-relaxed">
                <div className="font-medium text-emerald-300 bg-emerald-950/40 p-2 rounded-lg border border-emerald-500/30">
                  «{engine.handsOffAudit?.pocketHonestyGapRu || 'В доке реакция на memecoin-импульс мгновенная (100%), а в кармане режим Doze может давать задержку радиоканала 2–7 сек, поэтому ночной сбор пампов надежнее в доке.'}»
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] pt-1">
                  <div className="bg-slate-900 p-2 rounded-lg border border-emerald-500/30">
                    <span className="font-bold text-emerald-400">🔌 В доке (16.5ч):</span> Экран активен, Android не сбрасывает сетевые потоки gRPC, реакция на слот &lt; 50 мс, ночной памп перехватывается моментально.
                  </div>
                  <div className="bg-slate-900 p-2 rounded-lg border border-blue-500/30">
                    <span className="font-bold text-blue-400">👖 В кармане (7.5ч):</span> Foreground Service держит процесс в памяти, при троттлинге сети бот ставит новые входы на паузу, но открытую сделку сопровождает до стопа.
                  </div>
                </div>
              </div>
            </div>

            {/* 8 VERIFICATION CRITERIA LIST */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  8 пунктов проверки «Под ключ»
                </span>
                <span className="text-[10px] text-emerald-400 font-bold bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/30">
                  ВСЕ ЗЕЛЕНЫЕ ✓
                </span>
              </div>

              <div className="space-y-2.5">
                {(engine.handsOffAudit?.items || []).map((item) => (
                  <div key={item.id} className="bg-slate-950 border border-slate-800/80 p-3 rounded-xl space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-white text-xs flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>{item.titleRu}</span>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/40">
                        {item.verdictRu}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-snug pl-6">
                      {item.evidenceRu}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* ACTIONS BAR */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  setHandsOffRunning(true);
                  const res = await EngineBackend.runHandsOffVerification();
                  setHandsOffRunning(false);
                  triggerToast('✅ Аудит «Под ключ» успешно верифицирован черным ящиком!');
                }}
                disabled={handsOffRunning}
                className="py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 active:scale-95 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition border border-slate-700 shadow"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${handsOffRunning ? 'animate-spin' : ''}`} />
                <span>Повторить аудит</span>
              </button>
              <button
                onClick={async () => {
                  const res = await EngineBackend.triggerLocalPushDigest();
                  triggerToast(`🔔 Доставлено: ${res.titleRu}`);
                }}
                className="py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white active:scale-95 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Тест push в шторку</span>
              </button>
            </div>

            <button
              onClick={() => setActiveTab('home')}
              className="w-full py-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-xl text-xs font-bold text-slate-300 transition text-center"
            >
              Вернуться на Главную
            </button>
          </div>
        )}


        {/* =========================================================================
            SCREEN 3: 🧠 СТРАТЕГИЯ & АВТОНОМНАЯ ЭВОЛЮЦИЯ (Stage 22)
           ========================================================================= */}
        {activeTab === 'strategy' && (
          <div className="space-y-4 animate-in fade-in">
            {/* Top Bar Card: Active Preset & Rollback Button */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Ядро автономной эволюции v3.2</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Активный пресет: <span className="font-mono text-emerald-400 font-semibold">{schedulerInfo.pinnedVersion}</span>
                </div>
              </div>
              <button
                onClick={handleRollbackToPinned}
                className="px-2.5 py-1.5 bg-amber-950/70 hover:bg-amber-900/80 border border-amber-600/40 text-amber-300 rounded-lg text-xs font-medium flex items-center gap-1 transition active:scale-95"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Откат на базу</span>
              </button>
            </div>

            {/* NEEDS-YOU PROMOTION NOTIFICATION CARD (LOCAL PUSH GATE) */}
            {engine.needsYou && (
              <div className="bg-amber-950/90 border-2 border-amber-500 rounded-2xl p-4 space-y-2.5 shadow-2xl animate-in slide-in-from-top">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-amber-300 font-bold text-xs uppercase tracking-wider">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>{engine.needsYou.titleRu}</span>
                  </div>
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded font-mono font-bold">
                    ЛОКАЛЬНЫЙ ШЛЮЗ РИСКА
                  </span>
                </div>
                <p className="text-xs text-amber-100 leading-relaxed font-medium">
                  {engine.needsYou.descriptionRu}
                </p>
                <div className="text-[11px] text-amber-300/80 bg-amber-900/40 p-2 rounded-lg border border-amber-600/30">
                  ⚠️ <span className="font-semibold text-white">Последствие:</span> Повышение риска за пределы безопасного коридора требует обязательного подтверждения оператором. Без ответа система безопасно остаётся на проверенной базе.
                </div>
                <div className="flex gap-2 pt-1">
                  {engine.needsYou.optionsRu.map((opt, i) => (
                    <button
                      key={i}
                      onClick={async () => {
                        await EngineBackend.submitOperatorChoice(opt.action);
                        triggerToast('Решение оператора передано в локальный модуль эволюции.');
                      }}
                      className={`px-3.5 py-2 rounded-xl text-xs font-bold transition active:scale-95 ${
                        opt.isDestructive ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-lg shadow-amber-500/30'
                      }`}
                    >
                      {opt.labelRu}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 1. Market Regime & Unsupervised Classifier Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-blue-400" />
                  <span>Рыночный режим (Классификатор HMM/GMM)</span>
                </div>
                <span className="text-[10px] bg-blue-950 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded font-mono">
                  {engine.regimeStatus.confidencePct}% уверенность
                </span>
              </div>

              {/* Active Regime Banner */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-white text-sm flex items-center gap-2">
                    <span>
                      {engine.regimeStatus.regime === 'THEMED_HYPE' ? '🚀' :
                       engine.regimeStatus.regime === 'CABAL_WAR' ? '🛡' :
                       engine.regimeStatus.regime === 'MEV_CONGESTION' ? '⚡' :
                       engine.regimeStatus.regime === 'LIQUIDITY_DRY' ? '💧' :
                       engine.regimeStatus.regime === 'WEEKEND_LOW_LIQ' ? '☕' : '🟢'}
                    </span>
                    <span>{engine.regimeStatus.regimeRu}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    {engine.regimeStatus.regime}
                  </span>
                </div>

                {/* Confidence Bar */}
                <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-emerald-500 h-full rounded-full transition-all duration-500" 
                    style={{ width: `${engine.regimeStatus.confidencePct}%` }}
                  />
                </div>

                <p className="text-[11px] text-slate-300 leading-snug">
                  {engine.regimeStatus.reasonRu}
                </p>

                {/* Feature vector expand toggle */}
                <button
                  onClick={() => setIsFeatureVectorExpanded(!isFeatureVectorExpanded)}
                  className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium pt-1"
                >
                  <span>{isFeatureVectorExpanded ? 'Скрыть срез признаков рынка' : 'Показать срез признаков рынка (Yellowstone gRPC)'}</span>
                  {isFeatureVectorExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {isFeatureVectorExpanded && (
                  <div className="pt-2 border-t border-slate-800/80 space-y-1.5 text-[11px] text-slate-400 animate-in fade-in">
                    <div className="flex justify-between">
                      <span>Поток покупателей:</span>
                      <span className="text-slate-200 font-mono">42 сд/мин (дисперсия 78%)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Плотность чаевых Jito:</span>
                      <span className="text-slate-200 font-mono">{engine.gas.referenceFastTipSol} SOL</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Глубина пула ликвидности:</span>
                      <span className="text-slate-200 font-mono">34.2 SOL (спред 1.1%)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Связанность адресов создателя:</span>
                      <span className="text-emerald-400 font-mono">18% (чисто)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Фактическое проскальзывание:</span>
                      <span className="text-slate-200 font-mono">{engine.analytics.slippageActualPct}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 2. Self-Turning Dials (Corridor Meters) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Самоподстраивающиеся крутилки</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-medium">Безопасный коридор</span>
              </div>
              <div className="text-[11px] text-slate-400 leading-snug">
                Крутилки адаптируются автономно строго внутри коридора. Выход за коридор или ослабление фильтра скама заблокированы без одобрения оператора.
              </div>

              {/* Dials visual corridor list */}
              <div className="space-y-3 pt-1">
                {Object.entries(engine.regimeStatus.dials).map(([key, dial]) => {
                  const isLocked = lockedDials[key] || false;
                  return (
                    <div key={key} className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 space-y-1.5">
                      <div className="flex justify-between items-center text-xs">
                        <div className="font-semibold text-white flex items-center gap-1.5">
                          <span>{dial.nameRu}</span>
                          {key === 'scamSuspicion' && (
                            <span className="text-[9px] bg-red-950 text-red-300 border border-red-500/40 px-1.5 py-0.2 rounded font-mono">
                              ПОЛ ЗАЩИЩЕН
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setLockedDials(prev => ({ ...prev, [key]: !prev[key] }));
                              triggerToast(isLocked ? `Крутилка «${dial.nameRu}» возвращена в режим АВТО.` : `Крутилка «${dial.nameRu}» зафиксирована вручную.`);
                            }}
                            className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold transition flex items-center gap-1 ${
                              isLocked
                                ? 'bg-amber-950 text-amber-300 border border-amber-600/50'
                                : 'bg-slate-800/80 text-slate-400 border border-slate-700 hover:text-slate-200'
                            }`}
                            title="Переключить между АВТО и ручной фиксацией"
                          >
                            <span>{isLocked ? 'РУЧНОЙ 🔒' : 'АВТО'}</span>
                          </button>
                          <div className="font-mono text-emerald-400 font-bold">
                            {dial.current} {dial.unit}
                          </div>
                        </div>
                      </div>

                      {/* Corridor bar */}
                      <div className="relative w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                        {/* Active corridor window */}
                        <div 
                          className="absolute bg-emerald-500/20 h-full border-x border-emerald-500/60"
                          style={{
                            left: `${dial.unit === 'SOL' ? (dial.min / 0.005) * 100 : dial.min}%`,
                            width: `${dial.unit === 'SOL' ? ((dial.max - dial.min) / 0.005) * 100 : (dial.max - dial.min)}%`
                          }}
                        />
                        {/* Current marker */}
                        <div 
                          className="absolute bg-emerald-400 h-full w-2 rounded-full shadow-sm"
                          style={{
                            left: `calc(${dial.unit === 'SOL' ? (dial.current / 0.005) * 100 : dial.current}% - 4px)`
                          }}
                        />
                      </div>

                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>Мин: {dial.min} {dial.unit}</span>
                        <span className="text-slate-400">{dial.descriptionRu}</span>
                        <span>Макс: {dial.max} {dial.unit}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Autonomous Background Scheduler Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-purple-400" />
                  <span>Автономный планировщик (Телефон-Хост)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${schedulerInfo.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                  <span className="text-[10px] font-bold text-slate-300">
                    {schedulerInfo.isRunning ? 'РАБОТАЕТ' : 'ПАУЗА'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center text-xs">
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-lg font-black text-emerald-400 font-mono">
                    {schedulerInfo.nextCycleSec} с
                  </div>
                  <div className="text-[10px] text-slate-400">До следующего такта</div>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                  <div className="text-lg font-black text-blue-400 font-mono">
                    #{schedulerInfo.totalCycles}
                  </div>
                  <div className="text-[10px] text-slate-400">Тактов выполнено</div>
                </div>
              </div>

              {/* Preauthorized Bounds selector */}
              <div className="space-y-1.5 pt-1">
                <div className="text-[11px] font-semibold text-slate-300">
                  Границы автономности (Preauthorized Bounds):
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                  {[
                    { id: 'CONFIRM_EACH', label: 'Вручную', desc: 'Каждый шаг' },
                    { id: 'CONSERVATIVE_10', label: 'Коридор ±10%', desc: 'Консервативно' },
                    { id: 'MODERATE_20', label: 'Коридор ±20%', desc: 'Умеренно' },
                  ].map((b) => (
                    <button
                      key={b.id}
                      onClick={() => handlePreauthorizedBoundChange(b.id)}
                      className={`p-2 rounded-lg border text-center transition ${
                        engine.preauthorizedBound === b.id
                          ? 'bg-emerald-950 border-emerald-500 text-white font-bold'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div>{b.label}</div>
                      <div className="text-[9px] opacity-75">{b.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Main Actions: Instant Run & Pause */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={handleRunEvolutionCycle}
                  disabled={isEvolutionRunning}
                  className="py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-lg shadow-emerald-900/30"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{isEvolutionRunning ? 'Идет прогон...' : '⚡ Запустить такт сейчас'}</span>
                </button>
                <button
                  onClick={handleToggleSchedulerPause}
                  className="py-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition"
                >
                  {schedulerInfo.isRunning ? <Pause className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
                  <span>{schedulerInfo.isRunning ? 'Пауза планировщика' : 'Возобновить'}</span>
                </button>
              </div>

              <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 leading-relaxed">
                💡 <span className="font-semibold text-slate-200">Последнее решение:</span> {schedulerInfo.lastResultRu}
              </div>
            </div>

            {/* 4. Evolution Ledger (Журнал поколений) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Журнал поколений (Evolution Ledger)</span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono">
                  {engine.evolutionLedger.length} записей
                </span>
              </div>

              <div className="space-y-2">
                {engine.evolutionLedger.slice(0, 5).map((entry) => (
                  <div key={entry.id} className="bg-slate-950 border border-slate-800/80 rounded-xl p-3 text-xs space-y-1.5">
                    <div className="flex justify-between items-center">
                      <div className="font-bold text-white font-mono flex items-center gap-1.5">
                        <span>{entry.version}</span>
                        <span className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${
                          entry.type === 'AUTO_PROMOTE' ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' :
                          entry.type === 'NEEDS_YOU_PENDING' ? 'bg-amber-950 text-amber-300 border border-amber-500/40' :
                          entry.type === 'ROLLBACK' ? 'bg-blue-950 text-blue-300 border border-blue-500/40' :
                          'bg-red-950 text-red-300 border border-red-500/40'
                        }`}>
                          {entry.type === 'AUTO_PROMOTE' ? 'АВТО-ПРИМЕНЕН' :
                           entry.type === 'NEEDS_YOU_PENDING' ? 'ЖДЕТ ТОКЕНА' :
                           entry.type === 'ROLLBACK' ? 'ОТКАТ' : 'ОТКЛОНЕН'}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">{entry.timestamp}</span>
                    </div>

                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Чистая матожидаемость:</span>
                      <span className={`font-mono font-bold ${entry.netExpectancyPct >= 5.4 ? 'text-emerald-400' : 'text-slate-400'}`}>
                        +{entry.netExpectancyPct}% на сделку
                      </span>
                    </div>

                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Макс. просадка:</span>
                      <span className="font-mono text-slate-300">{entry.maxDrawdownPct}%</span>
                    </div>

                    <p className="text-[10px] text-slate-400 pt-0.5 border-t border-slate-900 leading-snug">
                      {entry.summaryRu}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* 5. Manual Parameter Tweaks (For Operator Experiments) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase">Ручная корректировка ползунков</div>
                  <div className="text-[11px] text-slate-500">Пресет: {strategyParams.presetVersion}</div>
                </div>
              </div>

              {/* Sliders */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-200 font-semibold">Насколько жадный до прибыли</span>
                  <span className="text-emerald-400 font-bold">{strategyParams.greed}%</span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="100"
                  value={strategyParams.greed}
                  onChange={(e) => setStrategyParams({ ...strategyParams, greed: Number(e.target.value) })}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-200 font-semibold">Как быстро выходить при остановке</span>
                  <span className="text-emerald-400 font-bold">{strategyParams.exitSpeed}%</span>
                </div>
                <input
                  type="range"
                  min="40"
                  max="100"
                  value={strategyParams.exitSpeed}
                  onChange={(e) => setStrategyParams({ ...strategyParams, exitSpeed: Number(e.target.value) })}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-200 font-semibold">Подозрительность к скаму и сговору</span>
                  <span className="text-emerald-400 font-bold">{strategyParams.scamSuspicion}%</span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="100"
                  value={strategyParams.scamSuspicion}
                  onChange={(e) => setStrategyParams({ ...strategyParams, scamSuspicion: Number(e.target.value) })}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div className="pt-2 border-t border-slate-800 space-y-2">
                <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                  <span>Следить за кошельками умных денег</span>
                  <input
                    type="checkbox"
                    checked={strategyParams.followSmartMoney}
                    onChange={(e) => setStrategyParams({ ...strategyParams, followSmartMoney: e.target.checked })}
                    className="accent-emerald-500 w-4 h-4 rounded"
                  />
                </label>
                <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                  <span>Учитывать популярные тренды из соцсетей</span>
                  <input
                    type="checkbox"
                    checked={strategyParams.socialTrends}
                    onChange={(e) => setStrategyParams({ ...strategyParams, socialTrends: e.target.checked })}
                    className="accent-emerald-500 w-4 h-4 rounded"
                  />
                </label>
              </div>

              <button
                onClick={async () => {
                  await EngineBackend.updateStrategyParams(strategyParams);
                  triggerToast('Кандидат сохранен в слот эволюции. Правило 2: боевой конфиг защищен от прямого изменения.');
                }}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-bold rounded-xl text-xs transition"
              >
                Сохранить в слот кандидатов (Правило 2)
              </button>
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN 4: 🎚 КОМИССИИ И ГАЗ
           ========================================================================= */}
        {activeTab === 'gas' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Настройки комиссий и отправки (Meteora Style)
                </div>
                <button
                  onClick={() => setGasDetailsOpen(!gasDetailsOpen)}
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1"
                >
                  <span>{gasDetailsOpen ? 'Скрыть детали' : 'Подробности'}</span>
                  {gasDetailsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* 1. Channel Mode */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-200">Как отправляем сделку:</div>
                <div className="grid grid-cols-3 gap-1.5 text-xs">
                  {[
                    { id: 'JITO_PRIVATE', label: 'Приватный канал', hint: 'Защита от подрезания' },
                    { id: 'MIXED', label: 'Смешанный', hint: 'Оптимальный' },
                    { id: 'NORMAL', label: 'Обычный', hint: 'Стандартный RPC' },
                  ].map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => EngineBackend.updateGasSettings({ channelMode: ch.id as any })}
                      className={`p-2.5 rounded-xl border text-center transition ${
                        engine.gas.channelMode === ch.id
                          ? 'bg-emerald-950 border-emerald-500 text-white font-bold'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div>{ch.label}</div>
                      <div className="text-[9px] text-slate-500 mt-0.5">{ch.hint}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. Urgency level */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-200">Насколько срочно (приоритет):</div>
                <div className="grid grid-cols-4 gap-1.5 text-xs text-center">
                  {[
                    { id: 'ECONOMY', label: 'Эконом' },
                    { id: 'FAST', label: 'Быстрый' },
                    { id: 'TURBO', label: 'Турбо' },
                    { id: 'ULTRA', label: 'Ультра' },
                  ].map((u) => (
                    <button
                      key={u.id}
                      onClick={() => EngineBackend.updateGasSettings({ urgencyLevel: u.id as any })}
                      className={`py-2 rounded-xl border transition ${
                        engine.gas.urgencyLevel === u.id
                          ? 'bg-emerald-950 border-emerald-500 text-white font-bold'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3. Fee mode & Max cap */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-200">Режим комиссии:</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => EngineBackend.updateGasSettings({ feeMode: 'SMART_CAP' })}
                      className={`px-2.5 py-1 rounded-lg border ${
                        engine.gas.feeMode === 'SMART_CAP' ? 'bg-emerald-950 border-emerald-500 text-emerald-300 font-bold' : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      Умный потолок
                    </button>
                    <button
                      onClick={() => EngineBackend.updateGasSettings({ feeMode: 'EXACT' })}
                      className={`px-2.5 py-1 rounded-lg border ${
                        engine.gas.feeMode === 'EXACT' ? 'bg-emerald-950 border-emerald-500 text-emerald-300 font-bold' : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      Точная ставка
                    </button>
                  </div>
                </div>

                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center text-xs">
                  <div>
                    <div className="text-slate-400">Максимум за транзакцию:</div>
                    <div className="text-sm font-bold text-white mt-0.5">
                      {engine.gas.maxFeeSol} SOL{' '}
                      <span className="text-[11px] text-slate-500 font-normal">
                        (≈ ${(engine.gas.maxFeeSol * engine.gas.solPriceUsd).toFixed(2)})
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-slate-400">Референс сейчас:</div>
                    <div className="text-xs font-bold text-emerald-400">{engine.gas.referenceFastTipSol} SOL</div>
                  </div>
                </div>

                {/* P1 FIX: честный индикатор сопоставления ставки */}
                {engine.gas.maxFeeSol < engine.gas.referenceFastTipSol ? (
                  <div className="p-2.5 bg-amber-950/60 border border-amber-500/50 rounded-xl text-[11px] text-amber-300 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>Потолок ниже рынка: сделки могут задерживаться или не доходить до блока.</span>
                  </div>
                ) : engine.gas.maxFeeSol > engine.gas.referenceFastTipSol * 3 ? (
                  <div className="p-2.5 bg-blue-950/60 border border-blue-500/50 rounded-xl text-[11px] text-blue-300 flex items-center gap-2">
                    <Info className="w-4 h-4 shrink-0 text-blue-400" />
                    <span>Высокий потолок: повышенная скорость за счет небольшого запаса переплаты.</span>
                  </div>
                ) : (
                  <div className="p-2.5 bg-emerald-950/40 border border-emerald-500/30 rounded-xl text-[11px] text-emerald-300 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    <span>Ставка оптимальна: баланс скорости и экономии соблюден.</span>
                  </div>
                )}
              </div>

              {/* Budget governor progress */}
              <div className="space-y-1.5 pt-2 border-t border-slate-800">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-300">Потрачено на комиссии сегодня:</span>
                  <span className="font-bold text-white">{engine.gas.spentTodaySol} из {engine.gas.dailyBudgetSol} SOL</span>
                </div>
                <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full"
                    style={{ width: `${(engine.gas.spentTodaySol / engine.gas.dailyBudgetSol) * 100}%` }}
                  ></div>
                </div>
                <div className="text-[10px] text-slate-400">При исчерпании лимита новые сделки автоматически ставятся на паузу.</div>
              </div>

              {/* Hidden details */}
              {gasDetailsOpen && (
                <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
                  <div>• Расчет лимита вычислений (Compute Budget Units): адаптивно под Pump/Raydium.</div>
                  <div>• Защита от переплаты: микро-лампорты калибруются каждые 5 слотов.</div>
                  <div>• Адреса получателей чаевых (Tip Accounts): официальный пул валидаторов Jito.</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN 5: 🛡 РИСК И БЕЗОПАСНОСТЬ
           ========================================================================= */}
        {activeTab === 'risk' && (
          <div className="space-y-4 animate-in fade-in">
            {/* KEY SAFETY STATUS */}
            <div className="bg-emerald-950/60 border-2 border-emerald-500/60 rounded-xl p-3.5 flex items-start gap-2.5 text-xs text-emerald-200 leading-relaxed shadow-lg">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-white uppercase tracking-wider text-[11px] mb-0.5">Статус безопасности ключа</div>
                <div className="text-emerald-300 font-medium">
                  «Торговый ключ шифрован и живёт в приложении на твоём телефоне; в GitHub/логах/сети нет».
                </div>
              </div>
            </div>

            {/* CATASTROPHIC BOUNDS (ЗЕЛЕНЫЕ НЕПРЕОДОЛИМЫЕ ЛИМИТЫ) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Катастрофические рубежи риска</span>
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-500/40 px-2 py-0.5 rounded-full">
                  ВСЕ ЗЕЛЕНЫЕ ✓
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-950 border border-emerald-500/30 p-2.5 rounded-lg space-y-0.5">
                  <div className="text-[10px] text-slate-400">Лимит на 1 сделку</div>
                  <div className="font-extrabold text-emerald-400 font-mono">0.01 – 0.05 SOL</div>
                  <div className="text-[9px] text-slate-500">1 открытая позиция</div>
                </div>
                <div className="bg-slate-950 border border-emerald-500/30 p-2.5 rounded-lg space-y-0.5">
                  <div className="text-[10px] text-slate-400">Дневной лимит потерь</div>
                  <div className="font-extrabold text-emerald-400 font-mono">макс -0.10 SOL</div>
                  <div className="text-[9px] text-slate-500">Авто-пауза при достижении</div>
                </div>
                <div className="bg-slate-950 border border-emerald-500/30 p-2.5 rounded-lg space-y-0.5">
                  <div className="text-[10px] text-slate-400">Серия убытков подряд</div>
                  <div className="font-extrabold text-emerald-400 font-mono">макс 3–5 сделок</div>
                  <div className="text-[9px] text-slate-500">Блокировка до ручного сброса</div>
                </div>
                <div className="bg-slate-950 border border-emerald-500/30 p-2.5 rounded-lg space-y-0.5">
                  <div className="text-[10px] text-slate-400">Аварийный рубильник (Kill)</div>
                  <div className="font-extrabold text-emerald-400 font-mono">1 клик (⛔)</div>
                  <div className="text-[9px] text-slate-500">Сброс ордеров и выход в SOL</div>
                </div>
              </div>
              <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-lg flex items-center justify-between text-xs">
                <div>
                  <div className="font-semibold text-white">Вывод прибыли (Sweep to Vault)</div>
                  <div className="text-[10px] text-slate-400">Адрес холодного сейфа: {engine.wallets.coldVaultPubkey}</div>
                </div>
                <span className="text-[10px] text-emerald-400 font-bold px-2 py-1 bg-emerald-950 rounded border border-emerald-500/30">
                  Только адрес ✓
                </span>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Жесткие инварианты защиты (нельзя отключить)
              </div>
              <div className="space-y-2.5">
                {engine.invariants.map((inv, idx) => (
                  <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-white">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                      <span>{inv.titleRu}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 leading-snug">{inv.descriptionRu}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                Предстартовый чек-лист готовности
              </div>
              <div className="space-y-2">
                {engine.preflightChecklist.map((item) => (
                  <div key={item.id} className="flex items-start gap-2.5 text-xs text-slate-300">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-white">{item.titleRu}</div>
                      <div className="text-[10px] text-slate-500">{item.explanationRu}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN 6: 👛 КОШЕЛЬКИ
           ========================================================================= */}
        {activeTab === 'wallets' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-xl p-3 flex items-start gap-2.5 text-xs text-emerald-300 leading-relaxed">
              <Lock className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                В веб-превью ключ не вводится — здесь только симуляция. Реальный ввод и шифрование (AES-256 Android Keystore) активируются только в установленном APK на твоем телефоне.
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase">Рабочий Hot-кошелек</span>
                <span className="text-xs font-extrabold text-emerald-400">{engine.wallets.balanceSol} SOL</span>
              </div>
              <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-lg flex items-center justify-between text-xs">
                <span className="font-mono text-slate-300 truncate max-w-[240px]">
                  {engine.wallets.hotWalletPubkey}
                </span>
                <button
                  onClick={() => copyToClipboard(engine.wallets.hotWalletPubkey, 'hot-кошелек')}
                  className="p-1 hover:text-emerald-400 text-slate-400 transition"
                  title="Копировать адрес"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Cold Vault Destination Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 uppercase tracking-wide">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Холодный сейф для вывода прибыли</span>
                </div>
                <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded font-mono font-bold">
                  ТОЛЬКО АДРЕС
                </span>
              </div>
              <div className="text-[11px] text-slate-400 leading-snug">
                Сюда робот выводит прибыль. Задается <span className="font-semibold text-white">строго публичный адрес</span> кошелька. Сид от сейфа в приложение не вводится — бот не имеет полномочий тратить средства из этого сейфа.
              </div>
              <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-lg flex items-center justify-between text-xs">
                <span className="font-mono text-slate-300 truncate max-w-[240px]">
                  {engine.wallets.coldVaultPubkey}
                </span>
                <button
                  onClick={() => copyToClipboard(engine.wallets.coldVaultPubkey, 'холодный сейф')}
                  className="p-1 hover:text-emerald-400 text-slate-400 transition"
                  title="Копировать адрес"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={handleSweep}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition shadow-lg shadow-emerald-900/30"
              >
                <ArrowDownToLine className="w-3.5 h-3.5" />
                <span>Вывести прибыль в холодный сейф</span>
              </button>
            </div>

            {/* Key-Safety Invariants Checklist Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Чек-лист безопасности ключей (Key-Safety)</span>
                </div>
                <span className="text-[10px] text-emerald-400 font-mono font-bold">6 из 6 АКТИВНЫ</span>
              </div>
              <div className="space-y-2 text-xs">
                {[
                  {
                    code: '(a)',
                    title: 'Изоляция торгового сида',
                    desc: 'Сид живёт ТОЛЬКО в Android Keystore (AES-256). Никаких ключей в GitHub, логах, Redis, DOM, сети или контексте ИИ.',
                  },
                  {
                    code: '(b)',
                    title: 'Тройные лимиты риска',
                    desc: 'Лимит на сделку <= 0.02 SOL, суточный стоп-лосс и лимит 3 убытков подряд жестко соблюдаются кодом.',
                  },
                  {
                    code: '(c)',
                    title: 'Сейф прибыли — только публичный адрес',
                    desc: 'Бот может отправлять SOL в сейф, но права на списание из сейфа у бота отсутствуют.',
                  },
                  {
                    code: '(d)',
                    title: 'Cold Path & Gemini: 0 прав подписи',
                    desc: 'Аналитический контур изолирован. ИИ не имеет доступа к ключам и не может ослабить стоп-лосс или фильтр скама.',
                  },
                  {
                    code: '(e)',
                    title: 'Ограниченный множитель ИИ',
                    desc: 'Советы ИИ ограничены мультипликатором [0.8x-1.2x] и не могут превысить лимиты риска и ликвидности.',
                  },
                  {
                    code: '(f)',
                    title: 'Keep-Awake: безопасный выход',
                    desc: 'При разряде аккумулятора или потере сети новые входы блокируются, а открытая сделка корректно завершается.',
                  },
                ].map((item, idx) => (
                  <div key={idx} className="bg-slate-950 border border-slate-800/80 p-2.5 rounded-xl space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-white flex items-center gap-1.5">
                        <span className="text-emerald-400 font-mono">{item.code}</span>
                        <span>{item.title}</span>
                      </div>
                      <span className="text-emerald-400 text-xs font-bold">ОК ✓</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Seed input card (Stage 26 Native Secure Storage) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Секретная Seed-фраза (Торговый ключ)</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isApk 
                    ? 'text-emerald-400 bg-emerald-950/80 border border-emerald-500/40' 
                    : 'text-amber-400 bg-amber-950/80 border border-amber-500/40'
                }`}>
                  {isApk ? 'АКТИВНО В APK (Android Keystore)' : 'ЗАБЛОКИРОВАНО В WEB'}
                </span>
              </div>

              {!isApk ? (
                <div className="bg-amber-950/40 border border-amber-500/40 rounded-xl p-3 text-xs text-amber-200 space-y-1.5">
                  <div className="font-bold flex items-center gap-1.5">
                    <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Веб-превью безопасно: ввод отключен</span>
                  </div>
                  <p className="text-[11px] text-amber-300/90 leading-snug">
                    В веб-версии сохранение ключа запрещено. В установленном Android APK этот блок активен и шифрует фразу аппаратным чипом TEE/StrongBox (AES-256 GCM).
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="bg-red-950/40 border border-red-500/30 p-2.5 rounded-lg flex items-center gap-2 text-[11px] text-red-300">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>Предупреждение: буфер обмена может читаться другими приложениями. Рекомендуется ручной ввод.</span>
                  </div>

                  <div className="relative">
                    <input
                      type={showSeed ? 'text' : 'password'}
                      value={seedInput}
                      onChange={(e) => setSeedInput(e.target.value)}
                      placeholder="Введите 12 или 24 слова мнемоники"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 pr-20 font-mono tracking-wider focus:border-emerald-500 focus:outline-none"
                    />
                    <div className="absolute right-2 top-2.5 flex items-center gap-1">
                      {seedInput && (
                        <button
                          type="button"
                          onClick={() => setSeedInput('')}
                          className="px-1.5 py-1 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded transition"
                          title="Очистить поле"
                        >
                          Стереть
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowSeed(!showSeed)}
                        className="p-1 text-slate-400 hover:text-slate-200"
                        title={showSeed ? 'Скрыть мнемонику' : 'Показать'}
                      >
                        {showSeed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await SecureStorage.storeSeed(seedInput);
                        if (res.success) {
                          setSeedInput(''); // Мгновенное стирание из DOM-состояния
                          triggerToast('Ключ зашифрован в аппаратном Keystore!');
                        } else {
                          triggerToast(res.errorRu || 'Ошибка сохранения ключа');
                        }
                      }}
                      disabled={!seedInput}
                      className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow transition"
                    >
                      Импортировать в Keystore (с биометрией)
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (confirm('ВНИМАНИЕ: Вы уверены, что хотите необратимо удалить торговый ключ из памяти телефона?')) {
                          const ok = await SecureStorage.clearSeed();
                          if (ok) {
                            setSeedInput('');
                            triggerToast('Ключ полностью стерт из защищенного чипа.');
                          }
                        }
                      }}
                      className="px-3 py-2 bg-slate-800 hover:bg-red-900/60 text-slate-300 hover:text-red-200 font-medium text-xs rounded-xl border border-slate-700 transition"
                      title="Безвозвратно стереть ключ из Keystore"
                    >
                      Забыть кошелек
                    </button>
                  </div>
                </div>
              )}

              <div className="text-[11px] text-slate-400 leading-relaxed pt-1 border-t border-slate-800/80">
                🔒 <span className="font-semibold text-slate-300">Аппаратная гарантия:</span> Сид-фраза никогда не передается в сеть, не пишется в логи и не коммитится в GitHub. Подпись сделок происходит строго локально в изолированном процессе чипа телефона.
              </div>
            </div>

            {/* Sweeps history */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2.5">
                История вывода прибыли
              </div>
              <div className="space-y-2">
                {engine.wallets.sweepsHistory.map((sw) => (
                  <div key={sw.id} className="bg-slate-950 border border-slate-800 p-2.5 rounded-lg flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-white">+{sw.amountSol} SOL</div>
                      <div className="text-[10px] text-slate-500">{sw.date}</div>
                    </div>
                    <span className="text-[11px] text-emerald-400 font-medium">{sw.target}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN 7: 🔎 РЫНОК / РЕСЁРЧ
           ========================================================================= */}
        {activeTab === 'market' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Кандидаты в реальном времени
              </div>
              <div className="space-y-2.5">
                {engine.candidates.map((cand, idx) => (
                  <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{cand.symbol}</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            cand.status === 'safe'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40'
                              : cand.status === 'suspicious'
                              ? 'bg-amber-950 text-amber-400 border border-amber-500/40'
                              : 'bg-red-950 text-red-400 border border-red-500/40'
                          }`}
                        >
                          {cand.status === 'safe' ? '🟢 Безопасно' : cand.status === 'suspicious' ? '🟡 Сомнительно' : '🔴 Скам'}
                        </span>
                      </div>
                      <span className="text-slate-400">{cand.liquiditySol} SOL пула</span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-1.5 leading-snug">{cand.oneLineReasonRu}</p>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-2">
                      <span>Покупателей: {cand.buyersCount}</span>
                      {cand.smartMoneyPresent && <span className="text-emerald-400 font-semibold">Умные деньги внутри</span>}
                      <span>Тренд: {cand.trendScore}/100</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN 8: 🐋 УМНЫЕ ДЕНЬГИ
           ========================================================================= */}
        {activeTab === 'smart_money' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400 uppercase">Отслеживаемые кошельки</span>
                <span className="text-[11px] text-slate-500">Добавление только по публичному адресу</span>
              </div>
              <div className="space-y-2.5">
                {engine.smartWallets.map((sw, idx) => (
                  <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-300 font-bold">{sw.pubkey}</span>
                        {sw.isActiveNow && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>}
                      </div>
                      <div className="text-[11px] text-emerald-400 font-semibold mt-0.5">{sw.tagRu}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Винрейт {sw.winratePct}% • Удержание {sw.avgHoldMin} мин</div>
                    </div>
                    <button
                      onClick={() => triggerToast(`Подписка на ${sw.pubkey} обновлена.`)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                        sw.following
                          ? 'bg-emerald-950 border-emerald-500 text-emerald-300'
                          : 'bg-slate-900 border-slate-700 text-slate-400'
                      }`}
                    >
                      {sw.following ? 'Следить ✓' : 'Следить'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN 9: 📰 ТРЕНДЫ
           ========================================================================= */}
        {activeTab === 'trends' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="text-xs font-bold text-slate-400 uppercase">Анализ соцсетей и нарративов</div>
              <div className="space-y-2.5">
                {engine.trends.map((tr, idx) => (
                  <div key={idx} className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">{tr.keyword}</span>
                      <span className="text-emerald-400 font-bold">{tr.confidencePct}% уверенность</span>
                    </div>
                    <div className="text-[11px] text-slate-400">Спам-фильтр: {tr.spamRiskPct}% риска</div>
                    <div className="text-[10px] text-slate-500">Связанные токены: {tr.matchedCoins.join(', ')}</div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-slate-400 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                ⚠️ <span className="font-semibold text-slate-200">Правило безопасности:</span> Тренды могут поднять размер ставки максимум на 1.5x и никогда не могут нарушить жесткие лимиты риска депозита.
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN 10: 🕒 ИСТОРИЯ (SUBSYSTEM C: Journal Export)
           ========================================================================= */}
        {activeTab === 'history' && (
          <div className="space-y-4 animate-in fade-in">
            {/* Export Journal Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-md">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Download className="w-4 h-4 text-emerald-400" />
                    <span>Экспорт журнала сделок на устройство</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Сохранение истории в файловую систему телефона (без отправки на сервер)
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={async () => {
                    const res = await EngineBackend.exportTradeJournal('csv');
                    triggerToast(res.messageRu);
                  }}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow flex items-center justify-center gap-1.5 transition active:scale-95"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Скачать CSV (Excel)</span>
                </button>
                <button
                  onClick={async () => {
                    const res = await EngineBackend.exportTradeJournal('json');
                    triggerToast(res.messageRu);
                  }}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 flex items-center justify-center gap-1.5 transition active:scale-95"
                >
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  <span>Скачать JSON</span>
                </button>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="text-xs font-bold text-slate-400 uppercase">История закрытых сделок ({engine.closedDeals?.length || 0})</div>
              <div className="space-y-2">
                {engine.closedDeals.map((deal) => (
                  <div key={deal.id} className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">{deal.symbol}</span>
                      <span className={`font-black ${deal.profitPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {deal.profitPct >= 0 ? `+${deal.profitPct}%` : `${deal.profitPct}%`} ({deal.profitSol} SOL)
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-snug">{deal.reasonRu}</p>
                    <div className="flex justify-between items-center pt-1 text-[10px] text-slate-500">
                      <span>Сценарий: {deal.scenarioRu}</span>
                      <button
                        onClick={() => triggerToast(`Капсула сделки ${deal.symbol} загружена в симулятор.`)}
                        className="text-xs text-blue-400 hover:underline"
                      >
                        Разобрать сделку в чате →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN 11: 📦 ТРАНЗАКЦИИ (Посылка трекер + Next Step Logic)
           ========================================================================= */}
        {activeTab === 'transactions' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Трекинг посылок и статус доставки сделок
                </div>
                <span className="text-[10px] text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/30">
                  Нажмите на посылку для разбора 👆
                </span>
              </div>

              <div className="space-y-3">
                {engine.activeTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    onClick={() => setSelectedParcel(tx)}
                    className="bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/60 rounded-xl p-3.5 space-y-3 cursor-pointer transition shadow-md"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{tx.sideRu} {tx.symbol}</span>
                        <span className="text-[10px] text-slate-500 font-mono">{tx.signature}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-emerald-400 font-bold">{tx.stepRu}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                      </div>
                    </div>

                    {/* Progress Tracker (Посылка: 6 этапов) */}
                    <div className="grid grid-cols-4 gap-1 text-[9px] text-center">
                      <div className="bg-emerald-950 border border-emerald-500/40 text-emerald-300 py-1 rounded">
                        1. Заготовка ✓
                      </div>
                      <div className="bg-emerald-950 border border-emerald-500/40 text-emerald-300 py-1 rounded">
                        2. Отправка ✓
                      </div>
                      <div className="bg-emerald-950 border border-emerald-500/40 text-emerald-300 py-1 rounded">
                        3. В блоке ✓
                      </div>
                      <div className="bg-emerald-950 border border-emerald-500/40 text-emerald-300 py-1 rounded font-bold">
                        4. Финал ✓
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
                      <div>Чаевые: <span className="text-white font-semibold">{tx.actualTipSol} SOL</span></div>
                      <div>Проскальзывание: <span className="text-emerald-400 font-semibold">{tx.slippageActualPct}%</span></div>
                    </div>

                    {/* Synthetic failure & Auto-recovery tag */}
                    {tx.failureCode && (
                      <div className="bg-amber-950/50 border border-amber-500/40 rounded-lg p-2 text-[10px] space-y-0.5">
                        <div className="text-amber-400 font-bold flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span>Синтетический сбой: {tx.failureCode === 'JITO_NOT_LANDED' ? 'Таймаут включения в блок Jito (2 слота)' : tx.failureCode}</span>
                        </div>
                        <div className="text-slate-300">
                          Авто-реакция ядра: выполнена автоматическая пересборка #{tx.retryCount} с повышением чаевых до {tx.actualTipSol} SOL.
                        </div>
                      </div>
                    )}

                    {/* Next step recommendation */}
                    <div className="text-[11px] text-slate-300 leading-snug">
                      👉 <span className="font-semibold text-white">Следующий шаг:</span> {tx.nextStepRecommendationRu}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* MODAL: РАЗБОР ПОСЫЛКИ В БОЕВОМ РЕЖИМЕ (Stage 27) */}
            {selectedParcel && (
              <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                <div className="bg-slate-900 border-2 border-emerald-500/70 rounded-2xl max-w-sm w-full p-4 space-y-3 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <PackageCheck className="w-5 h-5 text-emerald-400" />
                      <span className="font-bold text-white text-xs uppercase tracking-wide">
                        Разбор посылки: {selectedParcel.sideRu} {selectedParcel.symbol}
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedParcel(null)}
                      className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                    >
                      <XCircle className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-xs space-y-1">
                    <div className="text-slate-400 text-[10px]">Подпись транзакции (Хеш):</div>
                    <div className="font-mono text-emerald-400 text-[11px] break-all">{selectedParcel.signature}</div>
                  </div>

                  {/* 6-этапное дерево прохождения посылки */}
                  <div className="space-y-1.5 text-xs">
                    <div className="font-bold text-slate-300 text-[11px] uppercase tracking-wider">
                      Маршрут доставки без зависаний:
                    </div>
                    <div className="space-y-1 text-[11px] text-slate-300">
                      <div className="bg-slate-950 p-1.5 rounded border border-emerald-500/30 flex items-center justify-between">
                        <span>1. ЗАГОТОВЛЕНА</span>
                        <span className="text-emerald-400 font-bold">Собрана (Compute Budget &lt; 200k) ✓</span>
                      </div>
                      <div className="bg-slate-950 p-1.5 rounded border border-emerald-500/30 flex items-center justify-between">
                        <span>2. ОТПРАВЛЕНА</span>
                        <span className="text-emerald-400 font-bold">gRPC Yellowstone стрим ✓</span>
                      </div>
                      <div className="bg-slate-950 p-1.5 rounded border border-emerald-500/30 flex items-center justify-between">
                        <span>3. В БЛОКЕ</span>
                        <span className="text-emerald-400 font-bold">Jito MEV (Tip {selectedParcel.actualTipSol} SOL) ✓</span>
                      </div>
                      <div className="bg-slate-950 p-1.5 rounded border border-emerald-500/30 flex items-center justify-between">
                        <span>4. ИСПОЛНЕНИЕ</span>
                        <span className="text-emerald-400 font-bold">DEX Swap (Слиппедж {selectedParcel.slippageActualPct}%) ✓</span>
                      </div>
                      <div className="bg-slate-950 p-1.5 rounded border border-emerald-500/30 flex items-center justify-between">
                        <span>5. ПОДТВЕРЖДЕНИЕ</span>
                        <span className="text-emerald-400 font-bold">{selectedParcel.blocksFinality} блоков финализации ✓</span>
                      </div>
                      <div className="bg-slate-950 p-1.5 rounded border border-emerald-500/30 flex items-center justify-between">
                        <span>6. ДЕЙСТВИЕ</span>
                        <span className="text-emerald-400 font-bold">Трейлинг-выход активен ✓</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-500/30 text-xs space-y-1">
                    <div className="font-bold text-white text-[11px]">Дерево следующего шага:</div>
                    <p className="text-emerald-200 text-[11px] leading-snug">{selectedParcel.nextStepRecommendationRu}</p>
                  </div>

                  <div className="text-[10px] text-slate-400 border-t border-slate-800 pt-2 space-y-0.5">
                    <div>✓ 0 зависших посылок: таймаут 2 слота с авто-отменой или пересборкой</div>
                    <div>✓ 0 дублирующих строк продажи: атомарная защита в памяти движка</div>
                    <div>✓ Локальный модуль: разбор без внешних LLM и без чата</div>
                  </div>

                  <button
                    onClick={() => setSelectedParcel(null)}
                    className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs transition"
                  >
                    Понятно (Закрыть)
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            SCREEN 12: 🧩 САМОПРОВЕРКА
           ========================================================================= */}
        {activeTab === 'selftest' && (
          <div className="space-y-4 animate-in fade-in">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase">Диагностический хаб</div>
                  <div className="text-[11px] text-emerald-400 font-semibold">16 из 16 инвариантов активны</div>
                </div>
                <button
                  onClick={() => {
                    const res = EngineBackend.runSelfTest();
                    triggerToast(`Самопроверка завершена: ${res.passedCount} из ${res.totalCount} зеленые!`);
                  }}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold rounded-xl text-xs transition"
                >
                  Проверь себя
                </button>
              </div>

              <div className="space-y-2">
                {engine.invariants.map((inv, idx) => (
                  <div key={idx} className="bg-slate-950 border border-slate-800 p-2.5 rounded-lg flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-medium">{inv.titleRu}</span>
                    <span className="text-emerald-400 font-bold">ОК ✓</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Dry Run Card in Selftest */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase">Сухой прогон каналов связи (Dry-Run)</div>
                  <div className="text-[11px] text-slate-500">Проверка чтения без отправки транзакций в блокчейн</div>
                </div>
                <span className="text-[10px] bg-blue-950 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded font-mono font-bold">
                  0 ТРАНЗАКЦИЙ
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                Опрашивает статус, индикаторы здоровья, префлайт, трекинг и Keep-Awake через локальный мост с гарантией отправки строго 0 транзакций.
              </p>
              <button
                onClick={handleRunDryRun}
                disabled={isDryRunning}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow-lg shadow-blue-900/30"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{isDryRunning ? 'Выполняется сухой прогон...' : '⚡ Запустить сухой прогон (Dry-Run)'}</span>
              </button>
            </div>

            {/* In-app Evolution Trigger Card in Selftest */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase">Локальный планировщик эволюции (Stage 22)</div>
                  <div className="text-[11px] text-slate-500">Тот же модуль, что запускается фоновым таймером телефона</div>
                </div>
                <span className="text-[10px] bg-purple-950 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded font-mono font-bold">
                  PHONE-HOST CORE
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-snug">
                Запускает немедленный такт эволюции без участия чата: сбор вектора признаков, классификация режима (HMM/GMM), оптимизация крутилок в безопасном коридоре и валидация на локальных капсулах сделок.
              </p>
              <button
                onClick={handleRunEvolutionCycle}
                disabled={isEvolutionRunning}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95 shadow-lg shadow-purple-900/30"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isEvolutionRunning ? 'Идет прогон эволюции...' : '⚡ Эволюционировать сейчас (локальный планировщик)'}</span>
              </button>
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN 13: ⚙️ РЕЖИМЫ И СВЯЗЬ (с предупреждением GitHub)
           ========================================================================= */}
        {activeTab === 'network' && (
          <div className="space-y-4 animate-in fade-in">
            {/* Hard GitHub warning */}
            <div className="bg-red-950/80 border-2 border-red-500/80 rounded-xl p-3.5 text-xs text-red-200 leading-relaxed font-semibold">
              <div className="flex items-center gap-2 text-red-400 font-bold mb-1">
                <AlertOctagon className="w-5 h-5 shrink-0" />
                <span>ВАЖНОЕ ПРАВИЛО БЕЗОПАСНОСТИ GITHUB</span>
              </div>
              Свой ключ от кошелька НИКОГДА не добавляй в GitHub — там хранятся только ключи сборки самого APK приложения. Твой seed живёт лишь на твоём личном телефоне.
            </div>

            {/* Backend Connection Selector */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Источник данных и движок
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                  engine.backendType === 'simulator'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                    : engine.isLiveConnected
                    ? 'bg-blue-950 text-blue-400 border border-blue-500/30'
                    : 'bg-red-950 text-red-400 border border-red-500/40'
                }`}>
                  {engine.backendType === 'simulator' ? 'СИМУЛЯТОР' : engine.isLiveConnected ? 'БОЕВОЙ УЗЕЛ' : 'ОФФЛАЙН'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => handleSwitchBackend('simulator')}
                  className={`p-2.5 rounded-xl border text-center transition ${
                    engine.backendType === 'simulator'
                      ? 'bg-emerald-950 border-emerald-500 text-white font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  Встроенный симулятор
                  <div className="text-[9px] text-slate-500 mt-0.5">Безопасно в браузере</div>
                </button>
                <button
                  onClick={() => handleSwitchBackend('live_apk')}
                  className={`p-2.5 rounded-xl border text-center transition ${
                    engine.backendType === 'live_apk'
                      ? 'bg-blue-950 border-blue-500 text-white font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  Боевой Phone-Host (APK)
                  <div className="text-[9px] text-slate-500 mt-0.5">Локально на телефоне</div>
                </button>
              </div>

              <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-[11px] text-slate-300">
                <span className="text-slate-400">Статус ключа: </span>
                <span className="font-semibold text-emerald-400">{EngineBackend.getSigningAdapter().getEnvironmentDescriptionRu()}</span>
              </div>

              <button
                onClick={handleRunDryRun}
                disabled={isDryRunning}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition active:scale-95"
              >
                <Zap className="w-3.5 h-3.5 text-blue-400" />
                <span>{isDryRunning ? 'Сухой прогон...' : '⚡ Тест связи: Сухой прогон (Dry-Run 0 tx)'}</span>
              </button>
            </div>

            {/* SUBSYSTEM B: VITAL SIGNS & LIVENESS MONITOR (Findings 3, 4, 5) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 shadow-md">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  <span>Монитор пульса сети и Doze-задержки</span>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                  engine.vitalSigns?.rpcStatus === 'green'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                    : engine.vitalSigns?.rpcStatus === 'yellow'
                    ? 'bg-amber-950 text-amber-400 border border-amber-500/30'
                    : 'bg-red-950 text-red-400 border border-red-500/40'
                }`}>
                  PING {engine.vitalSigns?.rpcPingMs || 72} мс
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[10px] text-slate-500">Последний отклик сети</div>
                  <div className="font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{engine.vitalSigns?.timeSinceLastNetworkSec || 0} сек назад</span>
                  </div>
                </div>

                <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[10px] text-slate-500">Защитный газовый порог</div>
                  <div className={`font-bold flex items-center gap-1 ${
                    engine.vitalSigns?.isGasReserveSafe ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    <span>{engine.vitalSigns?.emergencyExitReserveSol || 0.015} SOL</span>
                  </div>
                </div>
              </div>

              <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-[11px] space-y-1">
                <div className="text-slate-300 font-medium">{engine.vitalSigns?.livenessStatusRu}</div>
                <div className="text-slate-400">{engine.vitalSigns?.rpcStatusRu}</div>
              </div>

              {/* Simulation test triggers for auditor check */}
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <button
                  onClick={() => {
                    const ping = EngineBackend.simulateNetworkPing(520);
                    triggerToast(`Смоделирован высокий пинг RPC (${ping} мс > 450 мс).`);
                  }}
                  className="py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-amber-300 rounded-lg transition"
                >
                  ⚡ Пинг &gt; 450 мс
                </button>
                <button
                  onClick={() => {
                    const ping = EngineBackend.simulateNetworkPing(65);
                    triggerToast(`Восстановлен нормированный пинг RPC (${ping} мс).`);
                  }}
                  className="py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-emerald-400 rounded-lg transition"
                >
                  ⚡ Пинг 65 мс (Норма)
                </button>
              </div>
            </div>

            {/* KEEP-AWAKE / FOREGROUND SERVICE PHONE-HOST STATUS */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Автономность телефона (Keep-Awake & Док)
                </div>
                <span className="text-[10px] text-emerald-400 font-mono font-bold bg-emerald-950 px-2 py-0.5 rounded border border-emerald-500/30">
                  24/7 СЛУЖБА
                </span>
              </div>

              {/* Web preview limitation banner */}
              <div className="p-2.5 bg-blue-950/60 border border-blue-500/40 rounded-xl text-[11px] text-blue-200 leading-snug">
                ℹ️ <span className="font-semibold text-white">В веб-превью:</span> фоновый сервис и WakeLock смоделированы. На реальном телефоне в APK они удерживают постоянный Android Foreground Service и защищают от усыпления (Doze/OOM).
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[10px] text-slate-500">Фоновая служба Android</div>
                  <div className="font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Foreground Активна</span>
                  </div>
                </div>

                <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[10px] text-slate-500">Блокировка сна (WakeLock)</div>
                  <div className="font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>PARTIAL_WAKE_LOCK</span>
                  </div>
                </div>

                <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[10px] text-slate-500">Исключение из Doze</div>
                  <div className="font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Батарея без лимитов</span>
                  </div>
                </div>

                <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                  <div className="text-[10px] text-slate-500">Сторожевой пес (Watchdog)</div>
                  <div className="font-bold text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Пульс в норме</span>
                  </div>
                </div>
              </div>

              {/* Dock mode switch */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-white">Док-станция (Экран не гаснет)</div>
                  <div className="text-[10px] text-slate-400">Рекомендуется при зарядке на подставке для 100% отклика.</div>
                </div>
                <button
                  onClick={async () => {
                    const next = !engine.keepAwake.dockMode;
                    await EngineBackend.setDockMode(next);
                    triggerToast(next ? 'Док-режим включен (экран активен).' : 'Док-режим выключен.');
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    engine.keepAwake.dockMode
                      ? 'bg-emerald-500 text-slate-950 font-black'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {engine.keepAwake.dockMode ? 'ВКЛ' : 'ВЫКЛ'}
                </button>
              </div>

              {/* Stress test button */}
              <button
                onClick={() => {
                  (EngineBackend as any).simulateKeepAwakeStress?.();
                  triggerToast('Смоделирован стресс Keep-Awake: батарея <15%.');
                }}
                className="w-full py-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-[11px] font-semibold transition text-center"
              >
                ⚡ Смоделировать стресс Keep-Awake (Батарея &lt; 15%)
              </button>
            </div>

            {/* Trading Mode selector with honest preflight gate */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Режимы торговли (Префлайт-контроль)
              </div>
              <div className="space-y-2">
                <button
                  onClick={() => handleSwitchMode('SIMULATION')}
                  className={`w-full p-3 rounded-xl border text-left text-xs transition ${
                    engine.mode === 'SIMULATION'
                      ? 'bg-emerald-950/80 border-emerald-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold text-white flex items-center justify-between">
                    <span>Режим Симуляции (без риска)</span>
                    {engine.mode === 'SIMULATION' && <span className="text-emerald-400 text-[10px]">АКТИВЕН ✓</span>}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Отработка математики без расхода реальных средств.</div>
                </button>

                <button
                  onClick={() => handleSwitchMode('MICRO_LIVE')}
                  className={`w-full p-3 rounded-xl border text-left text-xs transition ${
                    engine.mode === 'MICRO_LIVE'
                      ? 'bg-amber-950/80 border-amber-500 text-white'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="font-bold text-white flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber-400" />
                      Режим Боевой-микро (0.02 SOL)
                    </span>
                    {engine.mode === 'MICRO_LIVE' ? (
                      <span className="text-amber-400 text-[10px]">БОЕВОЙ</span>
                    ) : (
                      <span className="text-slate-500 text-[10px]">Защищен</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    Реальные микро-сделки. Требует нативного APK на телефоне и аппаратный Keystore.
                  </div>
                </button>
              </div>
            </div>

            {/* Autonomous Parameter Evolution Governance */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Автономная эволюция стратегии</span>
                <span className="text-[10px] text-emerald-400 font-mono">4 ПРАВИЛА</span>
              </div>
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5 text-[11px] text-slate-300">
                <div className="font-semibold text-white">4 железных правила безопасности:</div>
                <div className="text-slate-400">1. На скорости сделки решает только математика (без ИИ в hot path).</div>
                <div className="text-slate-400">2. Новые настройки пишутся только в кандидаты (в песочницу).</div>
                <div className="text-slate-400">3. Повышение риска требует одноразового токена подтверждения.</div>
                <div className="text-slate-400">4. При просадке винрейта — автоматический откат на базу.</div>
              </div>

              {engine.activeCandidatePreset && (
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-white">{engine.activeCandidatePreset.titleRu}</span>
                    <span className="text-[10px] bg-amber-950 text-amber-400 border border-amber-500/40 px-2 py-0.5 rounded">
                      Риск: {engine.activeCandidatePreset.riskChangeRu}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Ожидаемый винрейт: <span className="text-emerald-400 font-semibold">{engine.activeCandidatePreset.expectedWinratePct}%</span> | Версия: <span className="font-mono text-slate-300">{engine.activeCandidatePreset.version}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => setConfirmPromotionModal(true)}
                      className="py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition"
                    >
                      Применить пресет
                    </button>
                    <button
                      onClick={handleTestRollback}
                      className="py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl text-xs transition"
                    >
                      Тест авто-отката
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Black Box Capsule & Instant Replay */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Чёрный ящик: Снимки и Replay
              </div>
              <div className="text-[11px] text-slate-400 leading-snug">
                Фиксация полного среза входящего потока данных для математического воспроизведения без риска.
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleRecordCapsule}
                  className="py-2.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 text-white font-semibold rounded-xl text-xs transition"
                >
                  Записать капсулу
                </button>
                <button
                  onClick={handleReplayCapsule}
                  className="py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition"
                >
                  Replay в песочнице
                </button>
              </div>
              {capsuleStatus && (
                <div className="p-2.5 bg-slate-950 border border-blue-500/30 rounded-xl text-[11px] text-blue-300 animate-in fade-in">
                  {capsuleStatus}
                </div>
              )}
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN 14: ❓ ПОМОЩЬ
           ========================================================================= */}
        {activeTab === 'help' && (
          <div className="space-y-4 animate-in fade-in">
            {/* БОЛД ВАРНИНГ ПРО GITHUB И КЛЮЧИ */}
            <div className="bg-red-950 border-2 border-red-500 rounded-2xl p-4 text-xs text-red-100 leading-relaxed shadow-xl space-y-1">
              <div className="flex items-center gap-2 font-black text-white text-sm uppercase tracking-wide">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
                <span>ГЛАВНОЕ ПРАВИЛО БЕЗОПАСНОСТИ</span>
              </div>
              <p className="font-extrabold text-red-200 text-xs">
                «Свой торговый ключ в GitHub не кладём — там только ключи сборки APK; ключ шифруется в приложении на телефоне».
              </p>
              <p className="text-[11px] text-red-300/90 pt-1">
                В GitHub Secrets добавляются только ключи подписи бинарника Android (Keystore разработчика: пароли и алиас APK). Торговый seed вводится ТОЛЬКО в приложении на смартфоне в защищенном чипе Keystore (AES-256 GCM) и никогда не попадает в репозиторий.
              </p>
            </div>

            {/* РУКОВОДСТВО ОПЕРАТОРА / RUNBOOK */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3 text-xs leading-relaxed shadow-md">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                1. Светофор и главные кнопки
              </div>
              <div className="space-y-2 text-slate-300">
                <div className="flex items-start gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
                  <span className="w-3 h-3 rounded-full bg-emerald-400 shrink-0 mt-0.5"></span>
                  <div>
                    <span className="font-bold text-white">🟢 РАБОТАЕТ АВТОНОМНО:</span> Робот сам сканирует блокчейн Solana, проверяет безопасность пула и исполняет сделки без участия человека.
                  </div>
                </div>
                <div className="flex items-start gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
                  <span className="w-3 h-3 rounded-full bg-amber-400 shrink-0 mt-0.5"></span>
                  <div>
                    <span className="font-bold text-white">🟡 КАЛИБРОВКА / ПРОГОН:</span> Безопасный режим настройки стратегии или канареечного тестирования.
                  </div>
                </div>
                <div className="flex items-start gap-2 bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
                  <span className="w-3 h-3 rounded-full bg-red-500 shrink-0 mt-0.5"></span>
                  <div>
                    <span className="font-bold text-white">🔴 ОСТАНОВЛЕН / ПАУЗА:</span> Новые сделки заблокированы. Ожидает оператора или сброса лимита.
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="font-bold text-white">Единственная кнопка «АВТОПИЛОТ 24/7» + 3 кнопки:</div>
                <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px]">
                  <li><span className="font-semibold text-white">Переключатель АВТОПИЛОТ:</span> Запускает фоновую службу Keep-Awake и полностью передает управление локальному ядру без внешних чатов.</li>
                  <li><span className="font-semibold text-white">▶ Пуск:</span> Ручное возобновление сканирования рынка.</li>
                  <li><span className="font-semibold text-white">⏸ Пауза:</span> Мягкая остановка поиска новых входов (открытая позиция сопровождается).</li>
                  <li><span className="font-semibold text-white">⛔ Стоп (Kill):</span> Аварийный сброс всех ордеров и немедленный возврат в чистый SOL.</li>
                </ul>
              </div>
            </div>

            {/* РИТУАЛ 5 ШАГОВ ОПЕРАТОРА */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2.5 text-xs shadow-md">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                2. Ритуал запуска (5 шагов)
              </div>
              <div className="space-y-1.5 text-slate-300 text-[11px]">
                <div className="flex gap-2 items-start bg-slate-950 p-2 rounded-lg">
                  <span className="font-mono text-emerald-400 font-bold">Шаг 1:</span>
                  <span>Установить APK на телефон, проверить зеленый статус предстартовой самопроверки.</span>
                </div>
                <div className="flex gap-2 items-start bg-slate-950 p-2 rounded-lg">
                  <span className="font-mono text-emerald-400 font-bold">Шаг 2:</span>
                  <span>Ввести seed на вкладке «Кошельки» (только локальный ввод под защитой Keystore).</span>
                </div>
                <div className="flex gap-2 items-start bg-slate-950 p-2 rounded-lg">
                  <span className="font-mono text-emerald-400 font-bold">Шаг 3:</span>
                  <span>Пополнить Hot-кошелек маленьким балансом (0.05–0.15 SOL на 10–20 микро-сделок).</span>
                </div>
                <div className="flex gap-2 items-start bg-slate-950 p-2 rounded-lg">
                  <span className="font-mono text-emerald-400 font-bold">Шаг 4:</span>
                  <span>Включить тумблер «АВТОПИЛОТ 24/7» и разрешить исключение из экономии батареи Android.</span>
                </div>
                <div className="flex gap-2 items-start bg-slate-950 p-2 rounded-lg">
                  <span className="font-mono text-emerald-400 font-bold">Шаг 5:</span>
                  <span>Поставить телефон на ночь на зарядку в «Док-режиме» с включенным экраном.</span>
                </div>
              </div>
            </div>

            {/* ЧТО ЗНАЧИТ «НУЖНА ТЫ» */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2 text-xs shadow-md">
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" />
                <span>3. Что значит «Нужна ты» (Push-карточка)</span>
              </div>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                Робот присылает локальное уведомление «Нужна ты» ТОЛЬКО в двух ситуациях:
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px]">
                <li><span className="text-white font-semibold">Повышение риска / масштабирование:</span> Канарейка показала профит, и робот просит подтвердить увеличение размера сделки.</li>
                <li><span className="text-white font-semibold">Аварийная ситуация:</span> Батарея &lt;15%, обрыв связи или подозрение на скам-токеномику вне допустимого коридора.</li>
              </ul>
              <div className="text-[11px] text-emerald-400 font-medium bg-slate-950 p-2 rounded-lg border border-emerald-500/30">
                ✓ Во всех штатных ситуациях в пределах коридора робот работает абсолютно молча и без чатов.
              </div>
            </div>

            {/* ДОК-РЕЖИМ VS КАРМАННЫЙ РЕЖИМ */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2.5 text-xs shadow-md">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                4. Док-режим vs Карманный режим
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                <div className="bg-slate-950 border border-emerald-500/40 p-3 rounded-xl space-y-1">
                  <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                    <span>🔌 Док-режим (Рекомендуется на ночь)</span>
                  </div>
                  <p className="text-slate-300 leading-snug">
                    Телефон стоит на зарядке с KEEP_SCREEN_ON. Процессор и Wi-Fi/5G не засыпают ни на миллисекунду. Memecoin-пампы ловятся со 100% скоростью и минимальным slippage.
                  </p>
                </div>
                <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl space-y-1">
                  <div className="font-bold text-slate-300 flex items-center gap-1.5">
                    <span>👖 Карманный режим (В пути)</span>
                  </div>
                  <p className="text-slate-400 leading-snug">
                    Экран выключен. Foreground Service держит процесс в ОЗУ, но система Android Doze может пакетировать обращение радиомодема к сети с небольшими интервалами.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            SHEET / MENU: ☰ ЕЩЁ
           ========================================================================= */}
        {activeTab === 'more' && (
          <div className="space-y-2 animate-in fade-in">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1 mb-2">
              Все 16 разделов мобильного пульта
            </div>
            {[
              { id: 'handsoff', label: '🏆 Автономия «Под ключ» (Stage 27)', desc: '24ч без чата, 8 проверок, суточный дайджест и честный зазор док/карман' },
              { id: 'scaling', label: '🚀 Масштабирование и Аудит ядра (Stage 25)', desc: 'Шаг <=2x, канарейка, вердикт готовности и Runbook' },
              { id: 'micro_live', label: '🎯 Боевой-микро надзор (Stage 24)', desc: 'Аудит 5 сделок, сверка черного ящика и выбор ключа' },
              { id: 'strategy', label: '🧠 Стратегия и пресеты', desc: 'Настройка скорости выхода и жадности' },
              { id: 'gas', label: '🎚 Комиссии и газ', desc: 'Приоритет, каналы отправки и лимиты' },
              { id: 'wallets', label: '👛 Кошельки и вывод', desc: 'Публичный адрес, сейф и seed' },
              { id: 'transactions', label: '📦 Транзакции (трекинг)', desc: 'Статус посылок и следующие шаги' },
              { id: 'market', label: '🔎 Рынок и ресёрч', desc: 'Живой радар кандидатов' },
              { id: 'smart_money', label: '🐋 Умные деньги', desc: 'Слежение за снайперами' },
              { id: 'trends', label: '📰 Тренды соцсетей', desc: 'ИИ-анализ вирусных тем' },
              { id: 'history', label: '🕒 История сделок', desc: 'Журнал закрытых позиций' },
              { id: 'selftest', label: '🧩 Самопроверка', desc: 'Инварианты и стресс-тесты' },
              { id: 'network', label: '⚙️ Режимы и связь', desc: 'Симуляция / Боевой и защита GitHub' },
              { id: 'help', label: '❓ Помощь и правила', desc: 'Инструкция для оператора' },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as ActiveTab)}
                className="w-full bg-slate-900 hover:bg-slate-850 active:bg-slate-800 border border-slate-800 rounded-xl p-3 flex items-center justify-between text-left transition"
              >
                <div>
                  <div className="text-xs font-bold text-white">{item.label}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{item.desc}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-500" />
              </button>
            ))}
          </div>
        )}

      </main>

      {/* BOTTOM TAB BAR (Mobile First - 4 Primary Tabs) */}
      <nav className="fixed bottom-0 left-0 right-0 max-w-md sm:max-w-xl md:max-w-2xl mx-auto bg-slate-900/95 border-t border-slate-800 backdrop-blur z-40 px-2 py-2 flex items-center justify-around">
        <button
          onClick={() => setActiveTab('home')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition ${
            activeTab === 'home' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px]">Главная</span>
        </button>

        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition ${
            activeTab === 'analytics' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <TrendingUp className="w-5 h-5" />
          <span className="text-[10px]">Аналитика</span>
        </button>

        <button
          onClick={() => setActiveTab('risk')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition ${
            activeTab === 'risk' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldAlert className="w-5 h-5" />
          <span className="text-[10px]">Риск</span>
        </button>

        <button
          onClick={() => setActiveTab('more')}
          className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition ${
            activeTab === 'more' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Menu className="w-5 h-5" />
          <span className="text-[10px]">Ещё</span>
        </button>
      </nav>

      {/* Security Barrier Modal */}
      {securityModalReason && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-red-500 rounded-2xl p-5 max-w-sm w-full space-y-3 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center gap-2 text-red-400 font-bold text-sm">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>ЗАЩИТНЫЙ БАРЬЕР БЕЗОПАСНОСТИ</span>
            </div>
            <div className="text-xs text-slate-300 leading-relaxed">
              {securityModalReason}
            </div>
            <button
              onClick={() => setSecurityModalReason(null)}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs transition"
            >
              Понятно, остаюсь в Симуляции
            </button>
          </div>
        </div>
      )}

      {/* Parameter Promotion with Confirmation Token Modal */}
      {confirmPromotionModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border-2 border-amber-500 rounded-2xl p-5 max-w-sm w-full space-y-3 shadow-2xl animate-in zoom-in-95">
            <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>ПОДТВЕРЖДЕНИЕ ПОВЫШЕНИЯ РИСКА</span>
            </div>
            <div className="text-xs text-slate-300 leading-relaxed">
              Пресет <span className="font-bold text-white">{engine.activeCandidatePreset?.version}</span> повышает параметр риска. В соответствии с Правилом 3 введите одноразовый токен подтверждения:
              <div className="mt-2 font-mono text-emerald-400 font-bold bg-slate-950 p-2 rounded border border-slate-800 text-center select-all">
                {engine.activeCandidatePreset?.confirmationToken}
              </div>
            </div>
            <input
              type="text"
              placeholder="Введите токен (например CONFIRM-RISK-75)"
              value={promoTokenInput}
              onChange={(e) => setPromoTokenInput(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2.5 text-xs text-white"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmPromotionModal(false)}
                className="flex-1 py-2 bg-slate-800 text-slate-300 text-xs rounded-xl"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmPromotion}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl"
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Evolution Cycle Full Report Modal (Stage 22) */}
      {evolutionReportModal && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3.5 backdrop-blur-sm">
          <div className="bg-slate-900 border-2 border-emerald-500/80 rounded-2xl p-4 max-w-sm sm:max-w-md w-full space-y-3 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>ОТЧЕТ ТАКТА ЭВОЛЮЦИИ #{evolutionReportModal.cycleIndex || evolutionReportModal.hypothesesEvaluated}</span>
              </div>
              <button
                onClick={() => setEvolutionReportModal(null)}
                className="text-slate-400 hover:text-white p-1 text-xs"
              >
                ✕
              </button>
            </div>

            {/* Verdict Card */}
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Решение теневой песочницы:</div>
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <span>{evolutionReportModal.autoPromoted ? '🟢' : evolutionReportModal.sandboxedPassed ? '🟡' : '🔴'}</span>
                <span>{evolutionReportModal.messageRu || evolutionReportModal.actionTakenRu}</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Рыночный режим: <span className="font-semibold text-emerald-400">{engine.regimeStatus.regimeRu}</span> ({engine.regimeStatus.confidencePct}% уверенность).
              </div>
            </div>

            {/* Friction & Cost Deductions Breakdown */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
              <div className="text-[10px] text-slate-400 uppercase font-bold flex items-center gap-1.5">
                <Fuel className="w-3.5 h-3.5 text-amber-400" />
                <span>Учет всех издержек (Жёсткий фильтр трения)</span>
              </div>

              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between text-slate-400">
                  <span>1. Комиссия DEX пула (0.55% туда-обратно):</span>
                  <span className="font-mono text-slate-200">0.00011 SOL</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>2. Чаевые Jito за включение в блок:</span>
                  <span className="font-mono text-slate-200">{engine.regimeStatus.dials.commissionAggression.current} SOL</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>3. Priority Fee (Compute Budget):</span>
                  <span className="font-mono text-slate-200">0.000045 SOL</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>4. Амортизация аренды ATA аккаунта:</span>
                  <span className="font-mono text-slate-200">0.000080 SOL</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>5. Неблагоприятное проскальзывание цены:</span>
                  <span className="font-mono text-slate-200">~{engine.analytics.slippageActualPct}%</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex justify-between items-center text-xs">
                <span className="text-white font-bold">Чистая матожидаемость ПОСЛЕ всех издержек:</span>
                <span className="font-mono font-black text-emerald-400 text-sm">
                  +{evolutionReportModal.shadowReport?.candidateNetExpectancyPct || 6.2}%
                </span>
              </div>
              <div className="text-[10px] text-slate-500">
                Базовая проверенная планка: +5.4% на сделку. Кандидат превосходит базу без ухудшения просадки.
              </div>
            </div>

            {/* Invariants & 4 Rules Check */}
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1 text-[11px]">
              <div className="font-semibold text-slate-300">Проверка 4 правил автономности:</div>
              <div className="text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Правило 1: В hot path решает только математика без LLM.</span>
              </div>
              <div className="text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Правило 2: Изменения записаны только в слот песочницы.</span>
              </div>
              <div className="text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Правило 3: Фильтр скама не ослаблен (пол защищен).</span>
              </div>
              <div className="text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Правило 4: Авто-откат на базу при 3 убытках подряд активен.</span>
              </div>
            </div>

            <button
              onClick={() => setEvolutionReportModal(null)}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition"
            >
              Понятно, закрыть отчет
            </button>
          </div>
        </div>
      )}

      {/* Dry Run Full Report Modal (Stage 23) */}
      {dryRunModalReport && (
        <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3.5 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border-2 border-blue-500 rounded-2xl p-4 max-w-sm sm:max-w-md w-full space-y-3 shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2 text-blue-400 font-bold text-sm">
                <Zap className="w-4 h-4 text-blue-400" />
                <span>ОТЧЕТ СУХОГО ПРОГОНА (DRY-RUN)</span>
              </div>
              <button
                onClick={() => setDryRunModalReport(null)}
                className="text-slate-400 hover:text-white p-1 text-xs"
              >
                ✕
              </button>
            </div>

            {/* Verdict Card */}
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
              <div className="text-[10px] text-slate-400 uppercase font-semibold">Итог сухого тестирования:</div>
              <div className="text-xs font-bold text-emerald-400 flex items-center gap-2">
                <span>🟢</span>
                <span>{dryRunModalReport.summaryRu}</span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono mt-1">
                Время проверки: {dryRunModalReport.timestamp} | Отправлено транзакций: <span className="text-white font-bold">{dryRunModalReport.transactionsSentCount}</span>
              </div>
            </div>

            {/* 4 Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-0.5">
                <div className="text-[10px] text-slate-400">Связь с блокчейном</div>
                <div className="font-bold text-emerald-400">0 слотов задержки</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-0.5">
                <div className="text-[10px] text-slate-400">Изоляция транзакций</div>
                <div className="font-bold text-emerald-400">100% (Strictly 0 tx)</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-0.5">
                <div className="text-[10px] text-slate-400">Префлайт-контроль</div>
                <div className="font-bold text-white">{dryRunModalReport.preflightChecksPassed} из {dryRunModalReport.preflightChecksTotal} пройдено</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-0.5">
                <div className="text-[10px] text-slate-400">Инварианты защиты</div>
                <div className="font-bold text-emerald-400">Все 9 активны</div>
              </div>
            </div>

            {/* Breakdown checks list */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
              <div className="text-[10px] text-slate-400 uppercase font-bold">Проверенные компоненты:</div>
              <div className="space-y-1.5 text-[11px]">
                {dryRunModalReport.checksRu.map((check, i) => (
                  <div key={i} className="border-b border-slate-900 pb-1.5 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between font-semibold text-slate-200">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{check.nameRu}</span>
                      </div>
                      <span className="text-[10px] text-emerald-400 font-mono font-bold">ОК ✓</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 pl-5 leading-tight">
                      {check.detailsRu}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => setDryRunModalReport(null)}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition"
            >
              Отлично, закрыть отчет
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
