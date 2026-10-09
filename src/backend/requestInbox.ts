/**
 * Local Request Inbox (Очередь критических пушей и запросов оператора)
 * 
 * Subsystem A для Stage 30 (Finding 1):
 * - Локальная приоритетная очередь карточек "Needs You", хранимая локально (survives app kill / reboot)
 * - Приоритеты: CRITICAL > WARN > INFO. Внутри одного приоритета — FIFO (старые первыми, ничего не зависает)
 * - Не затирает непрочитанные пуши! Показывается самая срочная карточка, счетчик "Осталось в очереди: N"
 * - Защита от шторма алертов: одинаковые алерты склеиваются, обновляя timestamp и счетчик повторов
 * - Защита от протухания: запросы на повышение риска (promotions) старше 5 минут автоматически отклоняются
 * - Чистые действия на русском языке
 */

import { NeedsYouCard } from '../types/backend';

export interface QueuedNeedsYouCard extends NeedsYouCard {
  queuedAt: number;
  expiresAt?: number;
  repeatCount?: number;
  dedupKey?: string;
  sourceRu?: string;
}

const STORAGE_KEY = 'alpha_flip_request_inbox_v1';

export class RequestInboxManager {
  private queue: QueuedNeedsYouCard[] = [];
  private lastAlertTimestamp: Map<string, number> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as QueuedNeedsYouCard[];
        if (Array.isArray(parsed)) {
          const now = Date.now();
          // Отсеиваем только явно протухшие по expiresAt
          this.queue = parsed.filter(item => !item.expiresAt || item.expiresAt > now);
        }
      }
    } catch {
      this.queue = [];
    }
  }

  private saveToStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch {
      // Игнорируем ошибки квоты
    }
  }

  /**
   * Чистка протухших запросов (например, предложения эволюции старше 5 минут)
   */
  public purgeExpired(): number {
    const now = Date.now();
    const initialLen = this.queue.length;
    this.queue = this.queue.filter(item => {
      if (item.expiresAt && item.expiresAt <= now) {
        return false;
      }
      return true;
    });
    if (this.queue.length !== initialLen) {
      this.saveToStorage();
    }
    return initialLen - this.queue.length;
  }

  /**
   * Добавить карточку в очередь с дедупликацией и защитой от шторма
   */
  public push(card: Omit<QueuedNeedsYouCard, 'queuedAt'> & { queuedAt?: number }): boolean {
    this.purgeExpired();

    const now = Date.now();
    const dedupKey = card.dedupKey || card.id;

    // Анти-шторм: если одинаковое уведомление пришло менее 2 секунд назад, склеиваем
    const lastSeen = this.lastAlertTimestamp.get(dedupKey) || 0;
    if (now - lastSeen < 2000) {
      const existing = this.queue.find(q => (q.dedupKey || q.id) === dedupKey);
      if (existing) {
        existing.repeatCount = (existing.repeatCount || 1) + 1;
        existing.queuedAt = now;
        this.saveToStorage();
        return false;
      }
    }
    this.lastAlertTimestamp.set(dedupKey, now);

    // Если карточка с таким id уже в очереди — обновляем ее данные
    const existingIndex = this.queue.findIndex(q => (q.dedupKey || q.id) === dedupKey);
    const item: QueuedNeedsYouCard = {
      ...card,
      dedupKey,
      queuedAt: card.queuedAt || now,
      repeatCount: existingIndex >= 0 ? (this.queue[existingIndex].repeatCount || 1) + 1 : 1,
    };

    if (existingIndex >= 0) {
      this.queue[existingIndex] = item;
    } else {
      this.queue.push(item);
    }

    this.sortQueue();
    this.saveToStorage();
    return true;
  }

  /**
   * Сортировка:
   * CRITICAL (вес 3) > WARN (вес 2) > INFO (вес 1)
   * Внутри одинакового приоритета — по возрастанию queuedAt (FIFO: старые первыми)
   */
  private sortQueue(): void {
    const priorityWeight: Record<string, number> = {
      CRITICAL: 3,
      WARN: 2,
      INFO: 1,
    };

    this.queue.sort((a, b) => {
      const weightA = priorityWeight[a.severity] || 1;
      const weightB = priorityWeight[b.severity] || 1;
      if (weightA !== weightB) {
        return weightB - weightA; // Высший приоритет первым
      }
      return a.queuedAt - b.queuedAt; // Старые первыми (FIFO)
    });
  }

  /**
   * Получить текущую самую срочную карточку (без удаления)
   */
  public peek(): QueuedNeedsYouCard | null {
    this.purgeExpired();
    return this.queue.length > 0 ? this.queue[0] : null;
  }

  /**
   * Разрешить или закрыть карточку по id
   */
  public resolve(id: string): boolean {
    const initialLen = this.queue.length;
    this.queue = this.queue.filter(q => q.id !== id && q.dedupKey !== id);
    if (this.queue.length !== initialLen) {
      this.saveToStorage();
      return true;
    }
    return false;
  }

  /**
   * Закрыть текущую карточку во главе очереди
   */
  public pop(): QueuedNeedsYouCard | null {
    this.purgeExpired();
    if (this.queue.length === 0) return null;
    const item = this.queue.shift()!;
    this.saveToStorage();
    return item;
  }

  /**
   * Очистить всю очередь (например, при полном сбросе)
   */
  public clear(): void {
    this.queue = [];
    this.lastAlertTimestamp.clear();
    this.saveToStorage();
  }

  /**
   * Общее число карточек в очереди
   */
  public count(): number {
    this.purgeExpired();
    return this.queue.length;
  }

  /**
   * Получить список всех карточек в очереди (для инспекции или детального экрана)
   */
  public getAll(): QueuedNeedsYouCard[] {
    this.purgeExpired();
    return [...this.queue];
  }
}

export const defaultRequestInbox = new RequestInboxManager();
