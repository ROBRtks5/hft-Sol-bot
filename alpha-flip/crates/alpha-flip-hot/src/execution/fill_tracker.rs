use crate::errors::ExecutionError;
use crate::events::TradeSide;
use crate::types::{Pubkey, Signature, Slot};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FillStatus {
    Submitted,
    Landed { slot: u64, signature: Signature },
    Failed { reason: String },
    TimedOut,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InFlightOrder {
    pub bundle_id: String,
    pub mint: Pubkey,
    pub side: TradeSide,
    pub token_amount: u64,
    pub sol_amount: u64,
    pub submit_slot: Slot,
    pub submit_time_ms: u64,
    pub status: FillStatus,
}

pub struct FillTracker {
    orders: HashMap<String, InFlightOrder>,
    active_mints: HashMap<Pubkey, String>, // Mint -> BundleId
    timeout_ms: u64,
}

impl Default for FillTracker {
    fn default() -> Self {
        Self::new(5000) // 5s timeout
    }
}

impl FillTracker {
    pub fn new(timeout_ms: u64) -> Self {
        Self {
            orders: HashMap::new(),
            active_mints: HashMap::new(),
            timeout_ms,
        }
    }

    /// Register order and enforce strict idempotency (no double buy, no double sell)
    pub fn register_order(
        &mut self,
        bundle_id: String,
        mint: Pubkey,
        side: TradeSide,
        token_amount: u64,
        sol_amount: u64,
        slot: Slot,
        now_ms: u64,
    ) -> Result<(), ExecutionError> {
        if self.active_mints.contains_key(&mint) {
            return match side {
                TradeSide::Buy => Err(ExecutionError::DoubleBuyPrevented {
                    mint: mint.to_string(),
                }),
                TradeSide::Sell => Err(ExecutionError::DoubleSellPrevented {
                    mint: mint.to_string(),
                }),
            };
        }

        self.active_mints.insert(mint, bundle_id.clone());
        self.orders.insert(
            bundle_id.clone(),
            InFlightOrder {
                bundle_id,
                mint,
                side,
                token_amount,
                sol_amount,
                submit_slot: slot,
                submit_time_ms: now_ms,
                status: FillStatus::Submitted,
            },
        );

        Ok(())
    }

    /// Confirm that bundle landed on-chain
    pub fn mark_landed(
        &mut self,
        bundle_id: &str,
        slot: u64,
        signature: Signature,
    ) -> Option<InFlightOrder> {
        if let Some(order) = self.orders.get_mut(bundle_id) {
            order.status = FillStatus::Landed { slot, signature };
            self.active_mints.remove(&order.mint);
            Some(order.clone())
        } else {
            None
        }
    }

    /// Mark bundle as failed / rejected
    pub fn mark_failed(&mut self, bundle_id: &str, reason: String) -> Option<InFlightOrder> {
        if let Some(order) = self.orders.get_mut(bundle_id) {
            order.status = FillStatus::Failed { reason };
            self.active_mints.remove(&order.mint);
            Some(order.clone())
        } else {
            None
        }
    }

    /// Check and expire orders exceeding timeout
    pub fn check_timeouts(&mut self, now_ms: u64) -> Vec<String> {
        let mut timed_out = Vec::new();

        for (bundle_id, order) in self.orders.iter_mut() {
            if order.status == FillStatus::Submitted && now_ms.saturating_sub(order.submit_time_ms) >= self.timeout_ms {
                order.status = FillStatus::TimedOut;
                timed_out.push(bundle_id.clone());
            }
        }

        for bid in &timed_out {
            if let Some(order) = self.orders.get(bid) {
                self.active_mints.remove(&order.mint);
            }
        }

        timed_out
    }

    /// Invariant: Recalculate remaining balance before retrying sell
    pub fn verify_sell_balance(
        &self,
        current_balance: u64,
        attempted_sell: u64,
    ) -> Result<(), ExecutionError> {
        if current_balance < attempted_sell {
            Err(ExecutionError::InvalidRemainingBalance {
                remaining: current_balance,
                attempted: attempted_sell,
            })
        } else {
            Ok(())
        }
    }

    pub fn get_order(&self, bundle_id: &str) -> Option<&InFlightOrder> {
        self.orders.get(bundle_id)
    }

    pub fn is_mint_in_flight(&self, mint: &Pubkey) -> bool {
        self.active_mints.contains_key(mint)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fill_tracker_double_buy_prevention() {
        let mut tracker = FillTracker::default();
        let mint = Pubkey::new_unique();

        // 1. First buy registers OK
        assert!(tracker
            .register_order("b1".into(), mint, TradeSide::Buy, 100, 10, Slot(1), 1000)
            .is_ok());

        // 2. Second buy for same mint is rejected
        let res = tracker.register_order("b2".into(), mint, TradeSide::Buy, 100, 10, Slot(2), 1010);
        assert!(matches!(res, Err(ExecutionError::DoubleBuyPrevented { .. })));

        // 3. Landing b1 releases lock
        tracker.mark_landed("b1", 100, Signature::default());
        assert!(!tracker.is_mint_in_flight(&mint));

        // 4. Sell balance validation
        assert!(tracker.verify_sell_balance(100, 100).is_ok());
        assert!(tracker.verify_sell_balance(50, 100).is_err());
    }
}
