import {
  ClosedDealItem,
  DecisionItem,
  TransactionTrackingRecord,
} from '../types/backend';

/**
 * Боевой буфер сделок Alpha-Flip v3.2 (Solana Mainnet).
 * Любые синтетические и моковые сделки исключены.
 * Записи поступают исключительно из ончейн-транзакций.
 */

export const SIMULATION_CLOSED_DEALS: ClosedDealItem[] = [];
export const SIMULATION_DECISIONS: DecisionItem[] = [];
export const SIMULATION_ACTIVE_TRANSACTIONS: TransactionTrackingRecord[] = [];
