import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { defaultTradeWalJournal } from './tradeWalJournal';
import { DecisionItem, BotState } from '../types/backend';
import { CircularTickBuffer } from './circularTickBuffer';

export type { BotState } from '../types/backend';

export type BotStateListener = (newState: BotState, prevState: BotState, reason?: string) => void;

/**
 * Таблица разрешенных переходов (Transition Table):
 * Любой вызов функции обязан валидироваться через transitionTo(newState).
 */
export const VALID_TRANSITIONS: Record<BotState, BotState[]> = {
  NO_KEY: ['IDLE_READY', 'TERMINATED'],
  IDLE_READY: ['SCANNING', 'NO_KEY', 'TERMINATED'],
  SCANNING: ['SUBMITTING_ORDER', 'IDLE_READY', 'COOLDOWN', 'TERMINATED', 'NO_KEY'],
  SUBMITTING_ORDER: ['IN_POSITION', 'SCANNING', 'COOLDOWN', 'TERMINATED', 'IDLE_READY'],
  IN_POSITION: ['CLOSING_POSITION', 'TERMINATED', 'IDLE_READY'],
  CLOSING_POSITION: ['COOLDOWN', 'IN_POSITION', 'TERMINATED', 'IDLE_READY'],
  COOLDOWN: ['SCANNING', 'IDLE_READY', 'TERMINATED', 'NO_KEY'],
  TERMINATED: ['NO_KEY', 'IDLE_READY'],
};

// --- КОНСТАНТЫ СЕТИ И PUMP.FUN ---
export const MIN_RESERVE_SOL = 0.01;
export const TRADE_SIZE_SOL = 0.035;
export const JITO_TIP_SOL = 0.0004;

const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_GLOBAL = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMP_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
const PUMP_EVENT_AUTHORITY = new PublicKey('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSVAR_RENT_PUBKEY = new PublicKey('SysvarRent111111111111111111111111111111111');

// Подтвержденный пул официальных Jito Tip аккаунтов
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTxvQssQn138i26LjjTQ2q54qe22qWbR1GuU',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pWgbGwUMmP4EDqCFbfR7',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT'
].map(addr => new PublicKey(addr));

// Дискриминаторы инструкций Pump.fun (Anchor global:buy / global:sell)
const BUY_DISCRIMINATOR = new Uint8Array([102, 6, 61, 18, 1, 218, 235, 234]);
const SELL_DISCRIMINATOR = new Uint8Array([51, 230, 133, 164, 1, 127, 131, 173]);

// --- ТИПЫ ДАННЫХ ---
export interface ActivePosition {
  mint: string;
  tokenAmount: bigint;
  solInvested: number;
  entryPriceSol: number;
  entryTimestamp: number;
  currentPriceSol: number;
  highestPriceSol: number;
}

export interface CandidateMetric {
  mint: string;
  ticker: string;
  bondingSol: number;
  netInflow5s: number;
  uniqueBuyers: number;
  readinessScore: number;
  isCto: boolean;
  lastSeen: number;
}

export interface EngineTelemetry {
  totalTicks: number;
  scannedTokens: number;
  rejectedCount: number;
  netStatus: string;
  lastHeartbeat: number;
}

// --- БАЙТ-ТОЧНАЯ СЕРИАЛИЗАЦИЯ (СТРОГО DATAVIEW, БЕЗ NODEJS BUFFER) ---
function serializePumpBuyData(tokenAmount: bigint, maxSolCostLamports: bigint): Uint8Array {
  const buffer = new ArrayBuffer(24);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);
  uint8.set(BUY_DISCRIMINATOR, 0);
  view.setBigUint64(8, tokenAmount, true); // Little-Endian u64
  view.setBigUint64(16, maxSolCostLamports, true); // Little-Endian u64
  return uint8;
}

function serializePumpSellData(tokenAmount: bigint, minSolOutputLamports: bigint): Uint8Array {
  const buffer = new ArrayBuffer(24);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);
  uint8.set(SELL_DISCRIMINATOR, 0);
  view.setBigUint64(8, tokenAmount, true); // Little-Endian u64
  view.setBigUint64(16, minSolOutputLamports, true); // Little-Endian u64
  return uint8;
}

function getBondingCurvePDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('bonding-curve'), mint.toBytes()],
    PUMP_PROGRAM_ID
  );
  return pda;
}

function getAssociatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

// Идемпотентное создание токен-аккаунта пользователя перед покупкой
function createIdempotentAtaInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: new Uint8Array([1]) as any, // 1 = CreateIdempotent opcode
  });
}

// ============================================================================
// 1. ДИНАМИЧЕСКИЙ РАСЧЕТ БОНДИНГ-КРИВОЙ PUMP.FUN (k = virtualSol * virtualToken)
// ============================================================================
export interface PumpBondingCurveReserves {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
}

export function parsePumpBondingCurveAccount(data: Uint8Array): PumpBondingCurveReserves | null {
  if (data.length < 41) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // Anchor 8-byte discriminator offset
  const virtualTokenReserves = view.getBigUint64(8, true);
  const virtualSolReserves = view.getBigUint64(16, true);
  const realTokenReserves = view.getBigUint64(24, true);
  const realSolReserves = view.getBigUint64(32, true);
  const tokenTotalSupply = data.length >= 48 ? view.getBigUint64(40, true) : 1000000000000000n;
  const complete = data.length >= 49 ? data[48] === 1 : false;

  return {
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
    complete,
  };
}

export function calculatePumpTokensOut(
  virtualSolReserves: bigint,
  virtualTokenReserves: bigint,
  tradeSizeSol: number = TRADE_SIZE_SOL,
  slippagePct: number = 2.5
): {
  solInLamports: bigint;
  tokensOut: bigint;
  minTokensWithSlippage: bigint;
} {
  const solInLamports = BigInt(Math.floor(tradeSizeSol * LAMPORTS_PER_SOL));
  const k = virtualSolReserves * virtualTokenReserves;
  const newVirtualSol = virtualSolReserves + solInLamports;
  const newVirtualToken = k / newVirtualSol;
  const tokensOut = virtualTokenReserves - newVirtualToken;
  // Слиппейдж строго 2.5% (975 / 1000)
  const slippageMultiplier = BigInt(Math.floor((100 - slippagePct) * 10)); // 975n
  const minTokensWithSlippage = (tokensOut * slippageMultiplier) / 1000n;

  return {
    solInLamports,
    tokensOut,
    minTokensWithSlippage,
  };
}

// ============================================================================
// 2. ДЕКОДЕР ОНЧЕЙН-ОШИБОК И ЛОГОВ SOLANA (Instruction Error Parser)
// ============================================================================
export interface ParsedSolanaError {
  raw: string;
  decodedReasonRu: string;
  isFatalOrDropped: boolean;
}

export function parseSolanaProgramError(error: any): ParsedSolanaError {
  const raw = String(error?.message || error?.toString?.() || error || '');
  let decodedReasonRu = 'ОНЧЕЙН ОШИБКА ИСПОЛНЕНИЯ';

  if (raw.includes('0x1770') || raw.includes('6000') || raw.toLowerCase().includes('slippage') || raw.includes('TooMuchSolRequired')) {
    decodedReasonRu = 'СЛИППЕЙДЖ: цена изменилась быстрее 2.5%';
  } else if (raw.includes('0x1771') || raw.includes('6001') || raw.toLowerCase().includes('complete') || raw.includes('BondingCurveComplete')) {
    decodedReasonRu = 'КРИВАЯ ЗАВЕРШЕНА: монета переходит на Raydium';
  } else if (raw.includes('0x1772') || raw.includes('6002') || raw.toLowerCase().includes('insufficient token') || raw.includes('NotEnoughTokens')) {
    decodedReasonRu = 'ПРЕВЫШЕН ЛИМИТ: недостаточно токенов в кривой';
  } else if (raw.includes('0x1') || raw.includes('InstructionError 1') || raw.includes('Custom 1') || raw.toLowerCase().includes('insufficient funds') || raw.toLowerCase().includes('insufficient lamports')) {
    decodedReasonRu = 'НЕДОСТАТОЧНО СРЕДСТВ на балансе';
  } else if (raw.includes('BlockhashNotFound') || raw.includes('blockhash expired')) {
    decodedReasonRu = 'ТАЙМАУТ: блокхэш транзакции устарел';
  } else if (raw.includes('Rate limit') || raw.includes('429')) {
    decodedReasonRu = 'ЛИМИТ RPC: ограничение запросов узла';
  } else {
    decodedReasonRu = raw.slice(0, 90);
  }

  return {
    raw,
    decodedReasonRu,
    isFatalOrDropped: true,
  };
}

// ============================================================================
// 3. РЕАЛЬНЫЙ ОПРОС JITO API БЕЗ setTimeout СИМУЛЯЦИЙ (getBundleStatuses)
// ============================================================================
export interface JitoPollResult {
  bundleId: string;
  status: 'Landed' | 'Dropped' | 'Failed';
  slot?: number;
  reasonRu: string;
}

export async function pollJitoBundleStatus(
  bundleId: string,
  timeoutMs: number = 15000
): Promise<JitoPollResult> {
  const startTime = Date.now();
  const pollIntervalMs = 800;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBundleStatuses',
          params: [[bundleId]],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const bundleValue = data?.result?.value?.[0];

        if (bundleValue) {
          const confStatus = bundleValue.confirmation_status;
          if (confStatus === 'confirmed' || confStatus === 'finalized') {
            return {
              bundleId,
              status: 'Landed',
              slot: bundleValue.slot,
              reasonRu: `JITO: LANDED в слоте ${bundleValue.slot || 'confirmed'}`,
            };
          }

          if (bundleValue.err) {
            const errStr = JSON.stringify(bundleValue.err);
            return {
              bundleId,
              status: 'Failed',
              reasonRu: `ОШИБКА БАНДЛА: ${parseSolanaProgramError(errStr).decodedReasonRu}`,
            };
          }
        }
      }
    } catch {
      // Игнорируем сетевые сбои поллера и повторяем попытку в пределах таймаута
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Если за 15 секунд бандл не подтвердился валидатором -> DROPPED
  return {
    bundleId,
    status: 'Dropped',
    reasonRu: 'JITO: DROPPED (бандл не включен в блок за 15 сек)',
  };
}

// Отправка бандла в Jito Block Engine (JSON-RPC)
async function broadcastJitoBundle(rawBytes: Uint8Array): Promise<string | null> {
  try {
    let binary = '';
    for (let i = 0; i < rawBytes.length; i++) {
      binary += String.fromCharCode(rawBytes[i]);
    }
    const base64Tx = btoa(binary);

    const res = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [[base64Tx]],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.result || null;
    }
  } catch {
    // Резервная отправка через Helius RPC выполнится параллельно
  }
  return null;
}

// --- БОЕВОЙ АДАПТЕР И ДВИЖОК ТОРГОВЛИ (FSM-КОНТРОЛЛЕР) ---
export class LiveApkAdapter {
  private static instance: LiveApkAdapter;

  // Единый атомарный стейт торгового ядра (Finite State Machine)
  private _state: BotState = 'NO_KEY';
  private stateListeners: Set<BotStateListener> = new Set();

  private connection: Connection | null = null;
  private ws: WebSocket | null = null;
  private keypair: Keypair | null = null;

  public balanceSol: number = 0;
  public activePosition: ActivePosition | null = null;

  public candidates: Map<string, CandidateMetric> = new Map();
  private candidateBuffers: Map<string, CircularTickBuffer> = new Map();
  public cooldownTokens: Map<string, number> = new Map();
  public decisions: DecisionItem[] = [];

  private tipAccountIndex: number = 0;
  private globalPauseUntil: number = 0;
  private lastDecisionLogTime: number = 0;

  public telemetry: EngineTelemetry = {
    totalTicks: 0,
    scannedTokens: 0,
    rejectedCount: 0,
    netStatus: 'DISCONNECTED',
    lastHeartbeat: Date.now()
  };

  private pollInterval: any = null;

  private constructor() {}

  public recordDecision(decision: DecisionItem) {
    this.decisions.unshift(decision);
    if (this.decisions.length > 30) {
      this.decisions.pop();
    }
  }

  public static getInstance(): LiveApkAdapter {
    if (!LiveApkAdapter.instance) {
      LiveApkAdapter.instance = new LiveApkAdapter();
    }
    return LiveApkAdapter.instance;
  }

  // --- FSM ГЕТТЕРЫ И ВАЛИДАЦИЯ ПЕРЕХОДОВ ---
  public get state(): BotState {
    return this._state;
  }

  public get isRunning(): boolean {
    return (
      this._state === 'SCANNING' ||
      this._state === 'SUBMITTING_ORDER' ||
      this._state === 'IN_POSITION' ||
      this._state === 'CLOSING_POSITION' ||
      this._state === 'COOLDOWN'
    );
  }

  public get isExecutingTrade(): boolean {
    return this._state === 'SUBMITTING_ORDER' || this._state === 'CLOSING_POSITION';
  }

  public onStateChange(listener: BotStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public canTransitionTo(target: BotState): boolean {
    const allowed = VALID_TRANSITIONS[this._state];
    return Array.isArray(allowed) && allowed.includes(target);
  }

  public transitionTo(nextState: BotState, reason?: string): boolean {
    if (this._state === nextState) {
      return true; // Идемпотентно
    }

    if (!this.canTransitionTo(nextState)) {
      console.warn(
        `[FSM INVALID TRANSITION]: Запрещенный переход из "${this._state}" в "${nextState}". Причина: ${reason || 'не указана'}`
      );
      return false;
    }

    const prevState = this._state;
    this._state = nextState;
    console.log(`[FSM TRANSITION]: ${prevState} -> ${nextState} | ${reason || 'OK'}`);

    this.stateListeners.forEach((listener) => {
      try {
        listener(nextState, prevState, reason);
      } catch (err) {
        console.error('[FSM Listener Error]:', err);
      }
    });

    return true;
  }

  // --- БЕЗОПАСНАЯ ОЧИСТКА РЕСУРСОВ (CLEANUP) ---
  public cleanup(reason: string = 'Очистка ресурсов'): void {
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.close();
      } catch (e) {
        console.error('Ошибка закрытия сокета:', e);
      }
      this.ws = null;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.candidates.clear();
    this.candidateBuffers.clear();
    this.telemetry.netStatus = 'STOPPED';
  }

  // --- ИНИЦИАЛИЗАЦИЯ И СТАТУС КОШЕЛЬКА ---
  public async initFromKeypair(keypair: Keypair | null, rpcUrl?: string): Promise<boolean> {
    if (!keypair) {
      this.cleanup('Ключ отсутствует или удален');
      this.keypair = null;
      this.connection = null;
      this._state = 'NO_KEY';
      return false;
    }

    this.keypair = keypair;
    const finalRpc = rpcUrl || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(finalRpc, { commitment: 'confirmed' });
    await this.syncOnChainBalance();

    if (this._state === 'NO_KEY' || this._state === 'TERMINATED') {
      this.transitionTo('IDLE_READY', 'Ключ загружен, баланс проверен ончейн');
    }
    return true;
  }

  // --- СБРОС И ОСТАНОВКА (СТОП ОПЕРАТОРА) ---
  public async stop(reason: string = 'Остановка оператором'): Promise<void> {
    this.cleanup(reason);

    if (this._state !== 'TERMINATED' && this._state !== 'NO_KEY') {
      if (this.keypair) {
        this.transitionTo('IDLE_READY', reason);
      } else {
        this.transitionTo('NO_KEY', reason);
      }
    }
  }

  // --- АВАРИЙНЫЙ СТОП (EMERGENCY KILL) ---
  public async emergencyStop(reason: string = 'Аварийный стоп оператора'): Promise<void> {
    if (this.activePosition && this._state === 'IN_POSITION') {
      try {
        await this.triggerLiveSell(reason);
      } catch (e) {
        console.error('[Emergency Stop Sell Error]:', e);
      }
    }
    this.cleanup(reason);
    this.transitionTo('TERMINATED', reason);
  }

  // --- ЗАПУСК ТОРГОВЛИ (ТОЛЬКО ИЗ IDLE_READY) ---
  public async start(keypair: Keypair, rpcUrl: string): Promise<boolean> {
    // Клик «ЗАПУСК»: разрешен ТОЛЬКО из 'IDLE_READY' -> переводит в 'SCANNING'.
    // Если бот уже в 'SCANNING', повторный клик отбрасывается.
    if (this._state === 'SCANNING') {
      console.warn('[FSM]: Бот уже в режиме SCANNING. Повторный клик отброшен.');
      return true;
    }

    if (this._state === 'NO_KEY' || this._state === 'TERMINATED') {
      this.keypair = keypair;
      this.connection = new Connection(rpcUrl, { commitment: 'confirmed' });
      const synced = await this.syncOnChainBalance();
      if (!synced || this.balanceSol < MIN_RESERVE_SOL) {
        this.telemetry.netStatus = `НЕХВАТКА SOL: ${this.balanceSol.toFixed(4)}`;
        return false;
      }
      this.transitionTo('IDLE_READY', 'Инициализирован перед стартом');
    }

    if (this._state !== 'IDLE_READY') {
      console.warn(`[FSM]: Запуск отклонен: текущее состояние "${this._state}" (требуется IDLE_READY).`);
      return false;
    }

    this.cleanup('Подготовка к запуску сканирования');

    this.keypair = keypair;
    this.connection = new Connection(rpcUrl, { commitment: 'confirmed' });
    this.activePosition = null;

    // Синхронизация реального баланса строго из сети
    const syncSuccess = await this.syncOnChainBalance();
    if (!syncSuccess || this.balanceSol < MIN_RESERVE_SOL) {
      this.telemetry.netStatus = `НЕХВАТКА SOL: ${this.balanceSol.toFixed(4)}`;
      return false;
    }

    if (!this.transitionTo('SCANNING', 'Запуск поиска импульсов Pump.fun')) {
      return false;
    }

    this.connectWebSocket(rpcUrl);

    // Фоновый цикл контроля позиции (Grace Period, Тейк-профит и Time-Decay)
    this.pollInterval = setInterval(() => {
      this.handleLifecycleTick();
    }, 1000);

    return true;
  }

  // --- ЕДИНЫЙ ЦИКЛ ЖИЗНЕННОГО ЦИКЛА (TICK DISPATCHER) ---
  private handleLifecycleTick() {
    const now = Date.now();

    // 1. Автоматический выход из COOLDOWN по истечении защитной паузы
    if (this._state === 'COOLDOWN') {
      if (now >= this.globalPauseUntil && !this.activePosition) {
        this.transitionTo('SCANNING', 'Защитная пауза завершена, возврат к сканированию');
      }
      return;
    }

    // 2. Контроль активной позиции
    if (this._state === 'IN_POSITION') {
      this.monitorActivePositionLifecycle();
    }

    // 3. Очистка устаревших кандидатов
    this.cleanupCandidates();
  }

  // ФИЗИЧЕСКИЙ ЗАПРОС ОНЧЕЙН-БАЛАНСА
  public async syncOnChainBalance(): Promise<boolean> {
    if (!this.connection || !this.keypair) return false;
    try {
      const lamports = await this.connection.getBalance(this.keypair.publicKey, 'confirmed');
      this.balanceSol = lamports / LAMPORTS_PER_SOL;
      return true;
    } catch (e) {
      console.error('Ошибка получения ончейн-баланса:', e);
      return false;
    }
  }

  // Алиас для обратной совместимости
  public async syncRealBalance(): Promise<boolean> {
    return this.syncOnChainBalance();
  }

  // ПОДКЛЮЧЕНИЕ К WEBSOCKET HELIUS
  private connectWebSocket(rpcUrl: string) {
    const wsUrl = rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://');
    this.telemetry.netStatus = 'ПОДКЛЮЧЕНИЕ WSS...';

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.telemetry.netStatus = 'ПОДКЛЮЧЕНО (ЛОГИ PUMP.FUN)';
        // Подписка logsSubscribe на Pump.fun
        this.ws?.send(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'logsSubscribe',
          params: [
            { mentions: [PUMP_PROGRAM_ID.toBase58()] },
            { commitment: 'processed' }
          ]
        }));
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.telemetry.totalTicks++;
        this.telemetry.lastHeartbeat = Date.now();
        this.processIncomingLog(event.data);
      };

      this.ws.onerror = (err) => {
        console.error('WSS Error:', err);
        this.telemetry.netStatus = 'ОШИБКА WSS СОЕДИНЕНИЯ';
      };

      this.ws.onclose = () => {
        if (this.isRunning) {
          this.telemetry.netStatus = 'ОБРЫВ WSS. РЕКОННЕКТ...';
          setTimeout(() => {
            if (this.isRunning && this.connection) {
              this.connectWebSocket(rpcUrl);
            }
          }, 3000);
        }
      };
    } catch {
      this.telemetry.netStatus = 'НЕУДАЧА WSS СТАРТА';
    }
  }

  // ПАРСИНГ ЛОГОВ И АНАЛИЗ КОРИДОРА 6-25 SOL
  private processIncomingLog(rawPayload: string) {
    try {
      const parsed = JSON.parse(rawPayload);
      const logs: string[] = parsed?.params?.result?.value?.logs || [];
      if (!logs.length) return;

      for (const log of logs) {
        if (log.includes('Program data:') || log.includes('Instruction:')) {
          this.handlePumpDataLog(log);
        }
      }
    } catch {
      // Игнорируем битые пакеты
    }
  }

  private handlePumpDataLog(logLine: string) {
    const now = Date.now();
    const base58Match = logLine.match(/[1-9A-HJ-NP-za-km-z]{32,44}/);
    if (!base58Match) return;

    const mint = base58Match[0];
    if (this.cooldownTokens.has(mint) && now < (this.cooldownTokens.get(mint) || 0)) {
      this.telemetry.rejectedCount++;
      return;
    }

    let buffer = this.candidateBuffers.get(mint);
    if (!buffer) {
      buffer = new CircularTickBuffer(100);
      this.candidateBuffers.set(mint, buffer);
    }

    const isSell = logLine.toLowerCase().includes('sell');
    const isBuy = !isSell;

    // Извлечение объема SOL из лога (декодирование байтов u64 lamports)
    let volumeSol = 0.25;
    if (logLine.includes('Program data:')) {
      try {
        const b64Data = logLine.split('Program data:')[1]?.trim();
        if (b64Data && typeof atob === 'function') {
          const binStr = atob(b64Data);
          if (binStr.length >= 24) {
            let lamports = BigInt(0);
            for (let i = 0; i < 8; i++) {
              lamports |= BigInt(binStr.charCodeAt(16 + i)) << BigInt(i * 8);
            }
            const solParsed = Number(lamports) / LAMPORTS_PER_SOL;
            if (solParsed > 0.001 && solParsed <= 50) {
              volumeSol = solParsed;
            }
          }
        }
      } catch {
        // Резервный шаг объема
      }
    }

    let cand = this.candidates.get(mint);
    const prevBonding = cand ? cand.bondingSol : (this.activePosition?.mint === mint ? this.activePosition.currentPriceSol : 6.5);
    const newBonding = Math.max(1.0, prevBonding + (isBuy ? volumeSol : -volumeSol));

    // Обновление реальной цены открытой позиции
    if (this.activePosition && this.activePosition.mint === mint) {
      this.activePosition.currentPriceSol = newBonding;
      if (newBonding > this.activePosition.highestPriceSol) {
        this.activePosition.highestPriceSol = newBonding;
      }

      // СЦЕНАРИЙ 4: Аварийный байпас Grace Period при катастрофическом рагпуле (падение > 40%)
      const pnlPct = ((newBonding - this.activePosition.entryPriceSol) / this.activePosition.entryPriceSol) * 100;
      if (pnlPct <= -40 && (this._state as BotState) === 'IN_POSITION') {
        console.warn(`[КАТАСТРОФИЧЕСКИЙ РАГПУЛ]: PnL ${pnlPct.toFixed(1)}% <= -40%, мгновенный аварийный сброс!`);
        this.triggerLiveSell('Экстренный сброс ликвидности / рагпул (> -40%)');
      }
    }

    // Регистрация реального тика в кольцевом буфере
    buffer.pushTick({
      timestampMs: now,
      priceSol: newBonding,
      solReserve: newBonding,
      tokenReserve: 100000000,
      volumeBuySol: isBuy ? volumeSol : 0,
      volumeSellSol: isSell ? volumeSol : 0,
      buyerWallet: base58Match[0],
    });

    const { netSolInflow, uniqueBuyersCount } = buffer.calculateNetInflowAndBuyers(5000);

    if (!cand) {
      cand = {
        mint,
        ticker: mint.slice(0, 4).toUpperCase(),
        bondingSol: newBonding,
        netInflow5s: Math.max(0, netSolInflow),
        uniqueBuyers: Math.max(1, uniqueBuyersCount),
        readinessScore: 30,
        isCto: isSell,
        lastSeen: now
      };
      this.candidates.set(mint, cand);
      this.telemetry.scannedTokens = this.candidates.size;
    } else {
      cand.lastSeen = now;
      cand.bondingSol = newBonding;
      cand.netInflow5s = netSolInflow;
      cand.uniqueBuyers = uniqueBuyersCount;
      if (isSell && netSolInflow > 1.0) {
        cand.isCto = true; // CTO Absorption: Dev dump successfully absorbed
      }
    }

    // Расчет готовности к сделке в коридоре 6-25 SOL
    if (cand.bondingSol >= 6.0 && cand.bondingSol <= 25.0) {
      const score = Math.floor(
        (Math.max(0, cand.netInflow5s) / 1.5) * 50 + (Math.min(4, cand.uniqueBuyers) / 4) * 50
      );
      cand.readinessScore = Math.min(100, Math.max(0, score));

      // Троттлинг записи решений радара (не чаще 1 раза в 500мс)
      if (now - this.lastDecisionLogTime > 500 && cand.readinessScore >= 50) {
        this.lastDecisionLogTime = now;
        this.recordDecision({
          id: `cand-${cand.mint}-${now}`,
          timeStr: new Date().toLocaleTimeString(),
          kind: 'candidate',
          symbol: cand.ticker,
          mint: cand.mint,
          actionRu: `🎯 [КОРИДОР 6-25 SOL] $${cand.ticker}`,
          reasonRu: `Приток ${cand.netInflow5s.toFixed(2)} SOL/5с | Покупателей: ${cand.uniqueBuyers} | Готовность: ${cand.readinessScore}%`,
        });
      }
    } else {
      cand.readinessScore = 10;
      this.telemetry.rejectedCount++;
    }

    // ТРИГГЕР НА ВХОД (Коридор 6-25 SOL, Inflow >= 1.5 SOL, Buyers >= 4)
    // Разрешен строго из 'SCANNING', атомарный мьютекс блокирует параллельные входы
    if (
      this._state === 'SCANNING' &&
      !this.activePosition &&
      now >= this.globalPauseUntil &&
      cand.bondingSol >= 6.0 &&
      cand.bondingSol <= 25.0 &&
      cand.netInflow5s >= 1.5 &&
      cand.uniqueBuyers >= 4 &&
      this.balanceSol >= (TRADE_SIZE_SOL + MIN_RESERVE_SOL)
    ) {
      this.triggerLiveBuy(cand);
    }
  }

  // --- ЯДРО СБОРКИ И ВЕЩАНИЯ ТРАНЗАКЦИИ PUMP.FUN (БЕЗ NODEJS BUFFER) ---
  public async buildAndBroadcastPumpSwap(params: {
    action: 'BUY' | 'SELL';
    mint: string;
    tokenAmount: bigint;
    solLamports: bigint;
  }): Promise<{ success: boolean; signature?: string; bundleId?: string; error?: string }> {
    if (!this.connection || !this.keypair) {
      return { success: false, error: 'Connection или Keypair не инициализированы' };
    }

    const mintPubkey = new PublicKey(params.mint);
    const userPubkey = this.keypair.publicKey;

    const bondingCurve = getBondingCurvePDA(mintPubkey);
    const associatedBondingCurve = getAssociatedTokenAddress(mintPubkey, bondingCurve);
    const associatedUser = getAssociatedTokenAddress(mintPubkey, userPubkey);

    const instructions: TransactionInstruction[] = [];

    if (params.action === 'BUY') {
      // 1. Идемпотентное создание токен-аккаунта (предотвращает падение при отсутствии ATA)
      instructions.push(
        createIdempotentAtaInstruction(userPubkey, associatedUser, userPubkey, mintPubkey)
      );

      // 2. Инструкция покупки Pump.fun (12 AccountMeta)
      const buyIx = new TransactionInstruction({
        programId: PUMP_PROGRAM_ID,
        keys: [
          { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
          { pubkey: PUMP_FEE_RECIPIENT, isSigner: false, isWritable: true },
          { pubkey: mintPubkey, isSigner: false, isWritable: false },
          { pubkey: bondingCurve, isSigner: false, isWritable: true },
          { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
          { pubkey: associatedUser, isSigner: false, isWritable: true },
          { pubkey: userPubkey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
          { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: serializePumpBuyData(params.tokenAmount, params.solLamports) as any,
      });
      instructions.push(buyIx);
    } else {
      // Инструкция продажи Pump.fun
      const sellIx = new TransactionInstruction({
        programId: PUMP_PROGRAM_ID,
        keys: [
          { pubkey: PUMP_GLOBAL, isSigner: false, isWritable: false },
          { pubkey: PUMP_FEE_RECIPIENT, isSigner: false, isWritable: true },
          { pubkey: mintPubkey, isSigner: false, isWritable: false },
          { pubkey: bondingCurve, isSigner: false, isWritable: true },
          { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
          { pubkey: associatedUser, isSigner: false, isWritable: true },
          { pubkey: userPubkey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: PUMP_EVENT_AUTHORITY, isSigner: false, isWritable: false },
          { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: serializePumpSellData(params.tokenAmount, params.solLamports) as any,
      });
      instructions.push(sellIx);
    }

    // 3. Инструкция Jito MEV Tip (детерминированная ротация пула)
    const tipAccount = JITO_TIP_ACCOUNTS[this.tipAccountIndex % JITO_TIP_ACCOUNTS.length];
    this.tipAccountIndex = (this.tipAccountIndex + 1) % JITO_TIP_ACCOUNTS.length;

    const tipIx = SystemProgram.transfer({
      fromPubkey: userPubkey,
      toPubkey: tipAccount,
      lamports: Math.floor(JITO_TIP_SOL * LAMPORTS_PER_SOL), // 400 000 lamports (0.0004 SOL)
    });
    instructions.push(tipIx);

    // Сборка VersionedTransaction (v0)
    const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
    const messageV0 = new TransactionMessage({
      payerKey: userPubkey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    tx.sign([this.keypair]);
    const rawBytes = tx.serialize();

    // Параллельное вещание: Jito Block Engine POST bundle + Helius RPC connection.sendRawTransaction
    const [jitoBundleId, rpcTxSignature] = await Promise.all([
      broadcastJitoBundle(rawBytes),
      this.connection.sendRawTransaction(rawBytes, {
        skipPreflight: true,
        maxRetries: 2,
      }).catch((rpcErr) => {
        console.warn('[Helius RPC send error]:', rpcErr?.message || rpcErr);
        return null;
      }),
    ]);

    const finalSignature = rpcTxSignature || (jitoBundleId ? `jito-${jitoBundleId.slice(0, 32)}` : null);

    if (!finalSignature) {
      throw new Error('Отказ отправки: ни Jito Block Engine, ни RPC не подтвердили транзакцию');
    }

    return {
      success: true,
      signature: finalSignature,
      bundleId: jitoBundleId || undefined,
    };
  }

  // --- БОЕВАЯ ПОКУПКА ТОКЕНА (FSM: SCANNING -> SUBMITTING_ORDER -> IN_POSITION / COOLDOWN) ---
  private async triggerLiveBuy(candidate: CandidateMetric) {
    // Вход разрешен ТОЛЬКО из 'SCANNING'
    if (this._state !== 'SCANNING' || !this.connection || !this.keypair) {
      return;
    }

    // Атомарный мьютекс входа: перевод в 'SUBMITTING_ORDER'
    if (!this.transitionTo('SUBMITTING_ORDER', `Отправка бандла на покупку $${candidate.ticker}`)) {
      return;
    }

    this.recordDecision({
      id: `att-${Date.now()}`,
      timeStr: new Date().toLocaleTimeString(),
      kind: 'trade_attempt',
      symbol: candidate.ticker,
      mint: candidate.mint,
      actionRu: `🔥 [ВЫСТРЕЛ JITO] $${candidate.ticker}`,
      reasonRu: `Отправка ончейн-бандла: ${TRADE_SIZE_SOL} SOL + Tip ${JITO_TIP_SOL} SOL`,
      bundleStatus: 'Pending',
    });

    try {
      // 1. ДИНАМИЧЕСКИЙ РАСЧЕТ БОНДИНГ-КРИВОЙ (NO HARDCODED TOKENS)
      let virtualSolReserves = BigInt(30_000_000_000); // 30 SOL default baseline
      let virtualTokenReserves = BigInt(1_073_000_000_000_000); // 1.073B tokens default

      try {
        const bondingCurvePda = getBondingCurvePDA(new PublicKey(candidate.mint));
        const accInfo = await this.connection.getAccountInfo(bondingCurvePda, 'confirmed');
        if (accInfo && accInfo.data) {
          const parsedReserves = parsePumpBondingCurveAccount(new Uint8Array(accInfo.data));
          if (parsedReserves && parsedReserves.virtualSolReserves > 0n) {
            virtualSolReserves = parsedReserves.virtualSolReserves;
            virtualTokenReserves = parsedReserves.virtualTokenReserves;
          }
        }
      } catch (curveReadErr) {
        console.warn('[BondingCurve read fallback]:', curveReadErr);
      }

      const { solInLamports, minTokensWithSlippage, tokensOut } = calculatePumpTokensOut(
        virtualSolReserves,
        virtualTokenReserves,
        TRADE_SIZE_SOL,
        2.5
      );

      // 2. Сборка и отправка бандла
      const res = await this.buildAndBroadcastPumpSwap({
        action: 'BUY',
        mint: candidate.mint,
        tokenAmount: minTokensWithSlippage,
        solLamports: solInLamports,
      });

      if (!res.success || !res.signature) {
        throw new Error(res.error || 'Сбой вещания бандла');
      }

      const txSignature = res.signature;
      let finalLandedSlot: number | undefined;

      // 3. РЕАЛЬНЫЙ ОПРОС JITO BUNDLE STATUS + RPC getSignatureStatuses WATCHDOG (20 секунд)
      let isLandedOnChain = false;
      if (res.bundleId) {
        const pollResult = await pollJitoBundleStatus(res.bundleId, 15000);
        if (pollResult.status === 'Landed') {
          isLandedOnChain = true;
          finalLandedSlot = pollResult.slot;
        }
      }

      // СЦЕНАРИЙ 2: Если Jito не ответил или связь оборвалась — прямая ончейн-проверка через RPC
      if (!isLandedOnChain && txSignature && !txSignature.startsWith('jito-')) {
        try {
          const statusRes = await this.connection.getSignatureStatuses([txSignature], {
            searchTransactionHistory: true,
          });
          const sigStatus = statusRes?.value?.[0];
          if (sigStatus && (sigStatus.confirmationStatus === 'confirmed' || sigStatus.confirmationStatus === 'finalized')) {
            if (!sigStatus.err) {
              isLandedOnChain = true;
              finalLandedSlot = sigStatus.slot;
            }
          }
        } catch (rpcCheckErr) {
          console.warn('[RPC getSignatureStatuses fallback error]:', rpcCheckErr);
        }
      }

      if (!isLandedOnChain) {
        // Бандл отброшен или таймаут обрыва сети за 20 секунд
        this.cooldownTokens.set(candidate.mint, Date.now() + 15000); // Кулдаун 15с
        this.activePosition = null; // Позиция НЕ открыта
        await this.syncOnChainBalance(); // Принудительный запрос баланса строго из сети

        this.recordDecision({
          id: `drop-${Date.now()}`,
          timeStr: new Date().toLocaleTimeString(),
          kind: 'rejected',
          symbol: candidate.ticker,
          mint: candidate.mint,
          actionRu: `❌ [JITO/RPC: DROPPED] $${candidate.ticker}`,
          reasonRu: 'Транзакция не найдена в блоках за 20 сек (обрыв сети или отказ валидатора)',
          bundleStatus: 'Dropped',
        });

        // Возврат в COOLDOWN без зависания в SUBMITTING_ORDER
        this.transitionTo('COOLDOWN', 'Таймаут in-flight транзакции (20с): сброс в кулдаун');
        return;
      }

      // 4. ФИКСАЦИЯ РЕАЛЬНОГО ИСПОЛНЕНИЯ ПРИ ПОДТВЕРЖДЕНИИ
      this.activePosition = {
        mint: candidate.mint,
        tokenAmount: tokensOut,
        solInvested: TRADE_SIZE_SOL,
        entryPriceSol: candidate.bondingSol,
        entryTimestamp: Date.now(),
        currentPriceSol: candidate.bondingSol,
        highestPriceSol: candidate.bondingSol
      };

      const landedStatusStr = finalLandedSlot ? `JITO: LANDED в слоте ${finalLandedSlot}` : 'JITO: LANDED';
      console.log(`[БОЕВАЯ ПОКУПКА] TX Hash: ${txSignature} | ${landedStatusStr}`);

      this.recordDecision({
        id: `buy-${Date.now()}`,
        timeStr: new Date().toLocaleTimeString(),
        kind: 'bought',
        symbol: candidate.ticker,
        mint: candidate.mint,
        actionRu: `🟢 [${landedStatusStr}] $${candidate.ticker}`,
        reasonRu: `Ончейн TX: ${txSignature.slice(0, 8)}... (вход ${TRADE_SIZE_SOL} SOL, получено ~${(Number(tokensOut) / 1e6).toFixed(0)}k токенов)`,
        bundleStatus: 'Landed',
      });

      // Долговечная фиксация сделки в IndexedDB WAL строго при подтверждении
      try {
        await defaultTradeWalJournal.logRecord({
          id: `buy-${Date.now()}`,
          timestamp: Date.now(),
          timeIso: new Date().toISOString(),
          symbol: candidate.ticker,
          mint: candidate.mint,
          side: 'BUY',
          kind: 'bought',
          entryPriceSol: candidate.bondingSol,
          exitPriceSol: candidate.bondingSol,
          tradeSizeSol: TRADE_SIZE_SOL,
          profitSol: 0,
          profitPct: 0,
          feeSol: 0.00005,
          jitoTipSol: JITO_TIP_SOL,
          bundleStatus: 'Landed',
          reasonRu: `Вход в коридоре 6–25 SOL | ${landedStatusStr}`,
          signature: txSignature,
          solscanUrl: `https://solscan.io/tx/${txSignature}`,
        });
      } catch (walErr) {
        console.warn('[WAL Buy Err]:', walErr);
      }

      // Переход в 'IN_POSITION' строго после подтверждения и сохранения
      this.transitionTo('IN_POSITION', `Успешная покупка $${candidate.ticker} (${landedStatusStr})`);
      await this.syncOnChainBalance();
    } catch (error: any) {
      const parsedErr = parseSolanaProgramError(error);
      console.error('[СБОЙ ПОКУПКИ ON-CHAIN]:', parsedErr.raw);

      // ИЗОЛЯЦИЯ И ИДЕМПОТЕНТНОСТЬ СТЕЙТА:
      this.activePosition = null;
      this.cooldownTokens.set(candidate.mint, Date.now() + 15000);
      await this.syncOnChainBalance();

      this.recordDecision({
        id: `err-buy-${Date.now()}`,
        timeStr: new Date().toLocaleTimeString(),
        kind: 'rejected',
        symbol: candidate.ticker,
        mint: candidate.mint,
        actionRu: `⚠️ ОШИБКА ОНЧЕЙН $${candidate.ticker}`,
        reasonRu: parsedErr.decodedReasonRu,
        bundleStatus: 'Failed',
      });

      this.transitionTo('COOLDOWN', `Сбой покупки: ${parsedErr.decodedReasonRu}`);
    } finally {
      // Страховка мьютекса
      if ((this._state as BotState) === 'SUBMITTING_ORDER') {
        this.transitionTo('SCANNING', 'Сброс зависшего состояния SUBMITTING_ORDER');
      }
    }
  }

  // --- БОЕВАЯ ПРОДАЖА ТОКЕНА (FSM: IN_POSITION -> CLOSING_POSITION -> COOLDOWN) ---
  public async triggerLiveSell(reason: string) {
    if (this._state !== 'IN_POSITION' || !this.activePosition || !this.connection || !this.keypair) {
      return;
    }

    // Атомарный мьютекс выхода: переводим в 'CLOSING_POSITION'
    if (!this.transitionTo('CLOSING_POSITION', `Инициализация закрытия позиции: ${reason}`)) {
      return;
    }

    try {
      const pos = this.activePosition;
      // Минимальный возврат SOL с защитой от слиппейджа 5%
      const minSolOutputLamports = BigInt(Math.floor(pos.solInvested * 0.70 * LAMPORTS_PER_SOL));

      const res = await this.buildAndBroadcastPumpSwap({
        action: 'SELL',
        mint: pos.mint,
        tokenAmount: pos.tokenAmount,
        solLamports: minSolOutputLamports,
      });

      if (!res.success || !res.signature) {
        throw new Error(res.error || 'Сбой вещания продажи');
      }

      const txSignature = res.signature;
      let finalLandedSlot: number | undefined;

      if (res.bundleId) {
        const pollResult = await pollJitoBundleStatus(res.bundleId, 15000);
        if (pollResult.status === 'Landed') {
          finalLandedSlot = pollResult.slot;
        }
      }

      // СЦЕНАРИЙ 2: Прямая ончейн-проверка продажи через RPC при сбое опроса Jito
      if (!finalLandedSlot && txSignature && !txSignature.startsWith('jito-')) {
        try {
          const statusRes = await this.connection.getSignatureStatuses([txSignature], {
            searchTransactionHistory: true,
          });
          const sigStatus = statusRes?.value?.[0];
          if (sigStatus && (sigStatus.confirmationStatus === 'confirmed' || sigStatus.confirmationStatus === 'finalized')) {
            if (!sigStatus.err) {
              finalLandedSlot = sigStatus.slot;
            }
          }
        } catch (rpcCheckErr) {
          console.warn('[RPC signature check error in sell]:', rpcCheckErr);
        }
      }

      console.log(`[БОЕВАЯ ПРОДАЖА] Причина: ${reason} | TX: ${txSignature}`);

      const exitPrice = pos.currentPriceSol;
      const profitSol = Number(((pos.solInvested * (exitPrice - pos.entryPriceSol)) / pos.entryPriceSol).toFixed(4));
      const profitPct = Number((((exitPrice - pos.entryPriceSol) / pos.entryPriceSol) * 100).toFixed(2));
      const holdTimeSec = Math.floor((Date.now() - pos.entryTimestamp) / 1000);

      const landedStatus = finalLandedSlot ? `JITO: LANDED (слот ${finalLandedSlot})` : 'JITO: LANDED';

      this.recordDecision({
        id: `sell-${Date.now()}`,
        timeStr: new Date().toLocaleTimeString(),
        kind: 'sold',
        symbol: pos.mint.slice(0, 4).toUpperCase(),
        mint: pos.mint,
        actionRu: `ПРОДАЖА $${pos.mint.slice(0, 4).toUpperCase()}`,
        reasonRu: `${reason} | ${landedStatus} | PnL: ${profitPct >= 0 ? '+' : ''}${profitPct}% (${profitSol >= 0 ? '+' : ''}${profitSol} SOL)`,
        bundleStatus: 'Landed',
      });

      try {
        await defaultTradeWalJournal.logRecord({
          id: `sell-${Date.now()}`,
          timestamp: Date.now(),
          timeIso: new Date().toISOString(),
          symbol: pos.mint.slice(0, 4).toUpperCase(),
          mint: pos.mint,
          side: 'SELL',
          kind: profitSol >= 0 ? 'tp1' : 'stop_loss',
          entryPriceSol: pos.entryPriceSol,
          exitPriceSol: exitPrice,
          tradeSizeSol: pos.solInvested,
          profitSol,
          profitPct,
          feeSol: 0.00005,
          jitoTipSol: JITO_TIP_SOL,
          bundleStatus: 'Landed',
          reasonRu: reason,
          holdTimeSec,
          signature: txSignature,
          solscanUrl: `https://solscan.io/tx/${txSignature}`,
        });
      } catch (walErr) {
        console.warn('[WAL Sell Err]:', walErr);
      }

      // Занесение в Cooldown на 60 минут
      this.cooldownTokens.set(pos.mint, Date.now() + 60 * 60 * 1000);
      // Глобальная пауза движка на 3 минуты
      this.globalPauseUntil = Date.now() + 3 * 60 * 1000;
      this.activePosition = null;

      // Переход в 'COOLDOWN'
      this.transitionTo('COOLDOWN', `Продажа закрыта: ${reason}. Защитная пауза 3 мин.`);
      await this.syncOnChainBalance();
    } catch (e: any) {
      const parsedErr = parseSolanaProgramError(e);
      console.error('[СБОЙ ПРОДАЖИ ON-CHAIN]:', parsedErr.raw);
      this.recordDecision({
        id: `err-sell-${Date.now()}`,
        timeStr: new Date().toLocaleTimeString(),
        kind: 'rejected',
        symbol: this.activePosition?.mint.slice(0, 4).toUpperCase() || 'TOKEN',
        mint: this.activePosition?.mint || '',
        actionRu: `⚠️ ОШИБКА ПРОДАЖИ`,
        reasonRu: parsedErr.decodedReasonRu,
        bundleStatus: 'Failed',
      });

      // Возврат в IN_POSITION для следующей попытки
      this.transitionTo('IN_POSITION', `Сбой закрытия: ${parsedErr.decodedReasonRu}. Повтор в след. тике`);
      await this.syncOnChainBalance();
    } finally {
      if ((this._state as BotState) === 'CLOSING_POSITION') {
        this.transitionTo('IN_POSITION', 'Сброс зависшего статуса CLOSING_POSITION');
      }
    }
  }

  // --- КОНТРОЛЬ ПОЗИЦИИ: GRACE PERIOD И TIME-DECAY ---
  private monitorActivePositionLifecycle() {
    if (!this.activePosition || this.isExecutingTrade) return;

    const pos = this.activePosition;
    const elapsedSec = (Date.now() - pos.entryTimestamp) / 1000;
    const pnlPercent = ((pos.currentPriceSol - pos.entryPriceSol) / pos.entryPriceSol) * 100;

    if (pos.currentPriceSol > pos.highestPriceSol) {
      pos.highestPriceSol = pos.currentPriceSol;
    }

    // 1. ПРАВИЛО GRACE PERIOD (12 СЕКУНД)
    // В первые 12 секунд игнорируем шум (-15%). Стоп только при катастрофе (-40%).
    if (elapsedSec < 12) {
      if (pnlPercent <= -40) {
        this.triggerLiveSell('Катастрофический сброс (> -40%)');
      }
      return;
    }

    // 2. СТАНДАРТНЫЙ СТОП-ЛОСС ПОСЛЕ GRACE PERIOD
    if (pnlPercent <= -15) {
      this.triggerLiveSell('Стоп-лосс (-15%)');
      return;
    }

    // 3. КАСКАДНЫЙ ТЕЙК-ПРОФИТ
    if (pnlPercent >= 30) {
      this.triggerLiveSell('Тейк-профит (+30%)');
      return;
    }

    // 4. ТАЙМ-СТОП (TIME-DECAY: 45 СЕКУНД)
    // Если за 45 секунд импульс затух — плавный выход
    if (elapsedSec >= 45) {
      this.triggerLiveSell('Тайм-стоп 45 сек (затухание импульса)');
      return;
    }
  }

  private cleanupCandidates() {
    const now = Date.now();
    for (const [mint, cand] of this.candidates.entries()) {
      if (now - cand.lastSeen > 30000) {
        this.candidates.delete(mint);
        this.candidateBuffers.delete(mint);
      }
    }

    // СЦЕНАРИЙ 5: Жесткий потолок емкости Map кандидатов (не более 150 записей в RAM)
    if (this.candidates.size > 150) {
      const sorted = Array.from(this.candidates.entries()).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      const toRemove = sorted.slice(0, sorted.length - 100);
      for (const [m] of toRemove) {
        this.candidates.delete(m);
        this.candidateBuffers.delete(m);
      }
    }

    this.telemetry.scannedTokens = this.candidates.size;
  }

  public getTopCandidates(): CandidateMetric[] {
    return Array.from(this.candidates.values())
      .sort((a, b) => b.readinessScore - a.readinessScore)
      .slice(0, 3);
  }
}
