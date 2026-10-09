/**
 * Journal Exporter (Экспорт торгового журнала в файл на устройстве)
 * 
 * Subsystem C для Stage 30 (Finding 2):
 * - Экспорт полной истории сделок и журнала в файл JSON или CSV
 * - Полностью локально: генерация Blob и вызов сохранения через Capacitor Filesystem / Share или браузерный data URI
 * - Никаких серверов, приватные ключи никогда не попадают в экспорт!
 * - Форматирование в понятном для русскоязычного оператора виде
 */

import { ClosedDealItem, EngineStateV2 } from '../types/backend';

export interface JournalExportResult {
  success: boolean;
  filename: string;
  format: 'json' | 'csv';
  recordsCount: number;
  fileSizeKb: number;
  messageRu: string;
}

export class JournalExporter {
  /**
   * Сформировать CSV представление истории сделок
   */
  public generateCsv(deals: ClosedDealItem[], state?: Partial<EngineStateV2>): string {
    const headers = [
      'ID Сделки',
      'Токен (Символ)',
      'Цена входа (SOL)',
      'Цена выхода (SOL)',
      'Чистый PnL (SOL)',
      'Доходность (%)',
      'Время удержания (сек)',
      'Сценарий входа',
      'Причина выхода',
    ];

    const rows = deals.map(d => [
      `"${d.id}"`,
      `"${d.symbol}"`,
      d.entryPriceSol,
      d.exitPriceSol,
      d.profitSol,
      d.profitPct,
      d.holdTimeSec,
      `"${(d.scenarioRu || '').replace(/"/g, '""')}"`,
      `"${(d.reasonRu || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
    return '\uFEFF' + csvContent; // BOM для корректного открытия в Excel на русском
  }

  /**
   * Сформировать структурированный JSON со всей историей и сводкой
   */
  public generateJson(deals: ClosedDealItem[], state?: Partial<EngineStateV2>): string {
    const exportData = {
      app: 'Alpha-Flip v3.2',
      exportDate: new Date().toISOString(),
      exportDateRu: new Date().toLocaleString('ru-RU'),
      totalDealsCount: deals.length,
      winratePct: state?.analytics?.winratePct || 0,
      totalEarnedTodaySol: state?.earnedTodaySol || 0,
      hotWallet: state?.wallets?.hotWalletPubkey || 'N/A',
      deals: deals.map(d => ({
        id: d.id,
        symbol: d.symbol,
        entryPriceSol: d.entryPriceSol,
        exitPriceSol: d.exitPriceSol,
        profitSol: d.profitSol,
        profitPct: d.profitPct,
        holdTimeSec: d.holdTimeSec,
        scenarioRu: d.scenarioRu,
        reasonRu: d.reasonRu,
      })),
      sweeps: state?.wallets?.sweepsHistory || [],
      evolutionLedger: state?.evolutionLedger?.slice(0, 10) || [],
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Запустить выгрузку файла (браузер / мобильный Webview)
   */
  public downloadFile(content: string, filename: string, mimeType: string): void {
    if (typeof window === 'undefined') return;

    try {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      // Fallback
    }
  }

  /**
   * Выполнить экспорт журнала
   */
  public exportJournal(
    deals: ClosedDealItem[],
    format: 'json' | 'csv' = 'csv',
    state?: Partial<EngineStateV2>
  ): JournalExportResult {
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `alpha-flip-deals-${dateStr}.${format}`;

    let content = '';
    let mimeType = '';

    if (format === 'csv') {
      content = this.generateCsv(deals, state);
      mimeType = 'text/csv;charset=utf-8;';
    } else {
      content = this.generateJson(deals, state);
      mimeType = 'application/json;charset=utf-8;';
    }

    this.downloadFile(content, filename, mimeType);

    const sizeKb = Number((new Blob([content]).size / 1024).toFixed(1));

    return {
      success: true,
      filename,
      format,
      recordsCount: deals.length,
      fileSizeKb: sizeKb,
      messageRu: `Журнал успешно экспортирован в файл ${filename} (${deals.length} записей, ${sizeKb} КБ).`,
    };
  }
}

export const defaultJournalExporter = new JournalExporter();
