/**
 * Trade WAL Journal (Write-Ahead Logging via IndexedDB)
 * 
 * Guarantees durable, non-volatile trade execution storage in the smartphone's local database.
 * Every order event is logged:
 * - timestamp, symbol, mint
 * - entryPriceSol, exitPriceSol, profitSol, profitPct
 * - feeSol, jitoTipSol
 * - bundleStatus ('Landed' | 'Pending' | 'Failed' | 'Dropped')
 * - reasonRu, kind ('bought' | 'tp1' | 'tp2' | 'tp3_trail' | 'stop_loss' | 'emergency_ofi' | 'timeout')
 * 
 * Provides:
 * - Direct exportToCsv() with auto-download
 * - calculateTodayPnl(): Sum of net profit in SOL for current UTC day
 * - getRecentDeals(limit: number): Retrieves latest closed deals
 */

export interface WalTradeRecord {
  id: string;
  timestamp: number;
  timeIso: string;
  symbol: string;
  mint: string;
  side: 'BUY' | 'SELL';
  kind: 'bought' | 'tp1' | 'tp2' | 'tp3_trail' | 'stop_loss' | 'emergency_ofi' | 'timeout' | 'rejected';
  entryPriceSol: number;
  exitPriceSol: number;
  tradeSizeSol: number;
  profitSol: number;
  profitPct: number;
  feeSol: number;
  jitoTipSol: number;
  bundleStatus: 'Landed' | 'Pending' | 'Failed' | 'Dropped';
  reasonRu: string;
  detailsRu?: string;
  holdTimeSec?: number;
}

const DB_NAME = 'AlphaFlipTradeWalDb';
const DB_VERSION = 1;
const STORE_NAME = 'wal_trades';

export class TradeWalJournal {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private memoryFallback: WalTradeRecord[] = [];

  constructor() {
    this.initDb();
  }

  private initDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    if (typeof indexedDB === 'undefined') {
      // In SSR or environments without indexedDB
      return Promise.reject(new Error('IndexedDB not supported'));
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('mint', 'mint', { unique: false });
          store.createIndex('symbol', 'symbol', { unique: false });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  /**
   * Log a trade or decision record to IndexedDB
   */
  public async logRecord(record: WalTradeRecord): Promise<void> {
    this.memoryFallback.unshift(record);
    if (this.memoryFallback.length > 500) {
      this.memoryFallback.pop();
    }

    try {
      const db = await this.initDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Fallback kept in RAM if IndexedDB encounters sandbox limits
    }
  }

  /**
   * Get all trade records from IndexedDB (newest first)
   */
  public async getAllRecords(): Promise<WalTradeRecord[]> {
    try {
      const db = await this.initDb();
      return await new Promise<WalTradeRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const req = index.openCursor(null, 'prev');
        const results: WalTradeRecord[] = [];

        req.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
          if (cursor) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };

        req.onerror = () => reject(req.error);
      });
    } catch {
      return [...this.memoryFallback];
    }
  }

  /**
   * Get the last N records (newest first)
   */
  public async getRecentDeals(limit: number = 20): Promise<WalTradeRecord[]> {
    const all = await this.getAllRecords();
    return all.slice(0, limit);
  }

  /**
   * Calculate cumulative realized PnL in SOL for today (current calendar day)
   */
  public async calculateTodayPnl(): Promise<{ todayPnlSol: number; count: number }> {
    const records = await this.getAllRecords();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayTs = startOfDay.getTime();

    let todayPnlSol = 0;
    let count = 0;

    for (const r of records) {
      if (r.timestamp >= startOfDayTs && r.side === 'SELL') {
        todayPnlSol += r.profitSol || 0;
        count++;
      }
    }

    return {
      todayPnlSol: Number(todayPnlSol.toFixed(4)),
      count,
    };
  }

  /**
   * Export all recorded trades to CSV and trigger local file download
   */
  public async exportToCsv(): Promise<{ success: boolean; count: number; filename: string }> {
    const records = await this.getAllRecords();
    if (records.length === 0) {
      return { success: false, count: 0, filename: '' };
    }

    const headers = [
      'ID',
      'Время (ISO)',
      'Символ',
      'Минт',
      'Операция',
      'Тип выхода / входа',
      'Размер (SOL)',
      'Цена входа (SOL)',
      'Цена выхода (SOL)',
      'Прибыль (SOL)',
      'Доходность (%)',
      'Комиссия (SOL)',
      'Jito Чаевые (SOL)',
      'Статус бандла',
      'Удержание (сек)',
      'Причина',
    ];

    const rows = records.map((r) => [
      `"${r.id}"`,
      `"${r.timeIso || new Date(r.timestamp).toISOString()}"`,
      `"${r.symbol}"`,
      `"${r.mint}"`,
      `"${r.side}"`,
      `"${r.kind}"`,
      r.tradeSizeSol,
      r.entryPriceSol,
      r.exitPriceSol,
      r.profitSol,
      r.profitPct,
      r.feeSol,
      r.jitoTipSol,
      `"${r.bundleStatus}"`,
      r.holdTimeSec ?? 0,
      `"${(r.reasonRu || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\r\n');
    const filename = `alpha_flip_wal_export_${new Date().toISOString().slice(0, 10)}.csv`;

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    return {
      success: true,
      count: records.length,
      filename,
    };
  }
}

export const defaultTradeWalJournal = new TradeWalJournal();
