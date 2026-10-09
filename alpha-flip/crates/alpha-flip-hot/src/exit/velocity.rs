use crate::types::Slot;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PriceObservation {
    pub slot: Slot,
    pub price: f64,
}

#[derive(Debug, Clone)]
pub struct PriceVelocityTracker {
    pub window_slots: u64,
    pub ema_alpha: f64,
    history: VecDeque<PriceObservation>,
    current_ema: Option<f64>,
}

impl Default for PriceVelocityTracker {
    fn default() -> Self {
        Self::new(25, 0.2) // ~10 seconds window, EMA alpha 0.2
    }
}

impl PriceVelocityTracker {
    pub fn new(window_slots: u64, ema_alpha: f64) -> Self {
        Self {
            window_slots,
            ema_alpha: ema_alpha.clamp(0.01, 1.0),
            history: VecDeque::with_capacity(128),
            current_ema: None,
        }
    }

    /// Record new reserve-derived price point
    pub fn record_price(&mut self, slot: Slot, price: f64) {
        if price <= 0.0 {
            return;
        }

        // Update EMA
        self.current_ema = match self.current_ema {
            Some(prev_ema) => Some(self.ema_alpha * price + (1.0 - self.ema_alpha) * prev_ema),
            None => Some(price),
        };

        self.history.push_back(PriceObservation { slot, price });

        // Retain only samples within 2x window slots
        let min_slot = slot.as_u64().saturating_sub(self.window_slots * 2);
        while let Some(front) = self.history.front() {
            if front.slot.as_u64() < min_slot {
                self.history.pop_front();
            } else {
                break;
            }
        }
    }

    /// Linear slope / velocity (price change per slot) over the window
    pub fn price_slope(&self, current_slot: Slot) -> f64 {
        if self.history.len() < 2 {
            return 0.0;
        }

        let min_slot = current_slot.as_u64().saturating_sub(self.window_slots);
        let oldest = self
            .history
            .iter()
            .find(|obs| obs.slot.as_u64() >= min_slot)
            .unwrap_or_else(|| self.history.front().unwrap());

        let newest = self.history.back().unwrap();

        let slot_delta = newest.slot.as_u64().saturating_sub(oldest.slot.as_u64());
        if slot_delta == 0 {
            0.0
        } else {
            (newest.price - oldest.price) / (slot_delta as f64)
        }
    }

    /// Percentage price change over the window
    pub fn pct_change(&self, current_slot: Slot) -> f64 {
        if self.history.len() < 2 {
            return 0.0;
        }

        let min_slot = current_slot.as_u64().saturating_sub(self.window_slots);
        let oldest = self
            .history
            .iter()
            .find(|obs| obs.slot.as_u64() >= min_slot)
            .unwrap_or_else(|| self.history.front().unwrap());

        let newest = self.history.back().unwrap();
        if oldest.price <= 0.0 {
            0.0
        } else {
            (newest.price - oldest.price) / oldest.price
        }
    }

    /// Combined velocity decay condition:
    /// Requires ALL three conditions:
    /// 1. Negative price slope (downward momentum)
    /// 2. Negative OFI (sell order flow dominates)
    /// 3. Recent sell cluster (at least `min_sell_cluster_count` consecutive sells)
    ///
    /// Guard: never triggers on a single noisy tick
    pub fn is_velocity_decay_confirmed(
        &self,
        current_slot: Slot,
        ofi: f64,
        recent_consecutive_sells: u32,
        min_sell_cluster_count: u32,
    ) -> bool {
        // Need at least 3 historical price points to avoid single-tick noise
        if self.history.len() < 3 {
            return false;
        }

        let slope = self.price_slope(current_slot);
        let pct = self.pct_change(current_slot);

        let slope_negative = slope < -1e-12 || pct < -0.015; // >1.5% drop or negative slope
        let ofi_negative = ofi < -0.35;                      // clear seller dominance
        let cluster_detected = recent_consecutive_sells >= min_sell_cluster_count;

        slope_negative && ofi_negative && cluster_detected
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_velocity_tracker_and_decay_confirmation() {
        let mut tracker = PriceVelocityTracker::new(20, 0.2);

        // 1. Initial uptrend
        tracker.record_price(Slot(100), 0.000100);
        tracker.record_price(Slot(105), 0.000105);
        tracker.record_price(Slot(110), 0.000110);
        assert!(tracker.price_slope(Slot(110)) > 0.0);

        // Single downward tick with 1 sell does NOT trigger decay
        tracker.record_price(Slot(111), 0.000109);
        assert!(!tracker.is_velocity_decay_confirmed(Slot(111), -0.4, 1, 3));

        // 2. Multi-tick confirmed sell-off
        tracker.record_price(Slot(112), 0.000105);
        tracker.record_price(Slot(115), 0.000098);
        tracker.record_price(Slot(118), 0.000090);

        assert!(
            tracker.is_velocity_decay_confirmed(Slot(118), -0.55, 3, 3),
            "Confirmed negative slope + negative OFI + sell cluster must trigger decay"
        );
    }
}
