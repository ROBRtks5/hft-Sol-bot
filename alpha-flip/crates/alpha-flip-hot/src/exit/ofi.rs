use crate::events::TradeSide;
use crate::types::Slot;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TradeObservation {
    pub slot: Slot,
    pub side: TradeSide,
    pub volume_lamports: u64,
}

#[derive(Debug, Clone)]
pub struct OrderFlowImbalanceTracker {
    pub short_window_slots: u64,  // e.g. 37 slots (~15s)
    pub medium_window_slots: u64, // e.g. 75 slots (~30s)
    pub epsilon_lamports: f64,    // to prevent division by zero
    history: VecDeque<TradeObservation>,
    max_history_slots: u64,
}

impl Default for OrderFlowImbalanceTracker {
    fn default() -> Self {
        Self::new(37, 75)
    }
}

impl OrderFlowImbalanceTracker {
    pub fn new(short_window_slots: u64, medium_window_slots: u64) -> Self {
        let max_history_slots = medium_window_slots.max(short_window_slots) + 50;
        Self {
            short_window_slots,
            medium_window_slots,
            epsilon_lamports: 1_000_000.0, // 0.001 SOL
            history: VecDeque::with_capacity(500),
            max_history_slots,
        }
    }

    /// Record a trade from Yellowstone gRPC event stream
    pub fn record_trade(&mut self, slot: Slot, side: TradeSide, volume_lamports: u64) {
        self.history.push_back(TradeObservation {
            slot,
            side,
            volume_lamports,
        });

        // Prune old trades
        let min_retained_slot = slot.as_u64().saturating_sub(self.max_history_slots);
        while let Some(front) = self.history.front() {
            if front.slot.as_u64() < min_retained_slot {
                self.history.pop_front();
            } else {
                break;
            }
        }
    }

    /// Calculate normalized OFI: (buy - sell) / (buy + sell + epsilon)
    /// Returns value in [-1.0, 1.0]
    pub fn calculate_ofi(&self, current_slot: Slot, window_slots: u64) -> f64 {
        let min_slot = current_slot.as_u64().saturating_sub(window_slots);
        let mut buy_volume = 0.0;
        let mut sell_volume = 0.0;

        for obs in self.history.iter().rev() {
            if obs.slot.as_u64() < min_slot {
                break;
            }
            match obs.side {
                TradeSide::Buy => buy_volume += obs.volume_lamports as f64,
                TradeSide::Sell => sell_volume += obs.volume_lamports as f64,
            }
        }

        let delta = buy_volume - sell_volume;
        let denom = buy_volume + sell_volume + self.epsilon_lamports;
        (delta / denom).clamp(-1.0, 1.0)
    }

    /// Short-window OFI
    pub fn short_ofi(&self, current_slot: Slot) -> f64 {
        self.calculate_ofi(current_slot, self.short_window_slots)
    }

    /// Medium-window OFI
    pub fn medium_ofi(&self, current_slot: Slot) -> f64 {
        self.calculate_ofi(current_slot, self.medium_window_slots)
    }

    /// Returns true only if sustained sell pressure is observed across BOTH short and medium windows
    /// Avoids panic-selling on a single noisy transaction
    pub fn is_sustained_sell_pressure(&self, current_slot: Slot, threshold: f64) -> bool {
        let s_ofi = self.short_ofi(current_slot);
        let m_ofi = self.medium_ofi(current_slot);
        s_ofi < threshold && m_ofi < (threshold / 2.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ofi_calculation_and_sustained_pressure() {
        let mut tracker = OrderFlowImbalanceTracker::new(30, 60);

        // Record a series of buys
        for s in 100..110 {
            tracker.record_trade(Slot(s), TradeSide::Buy, 10_000_000);
        }
        let buy_ofi = tracker.calculate_ofi(Slot(115), 30);
        assert!(buy_ofi > 0.8, "Buy OFI must be strongly positive: got {}", buy_ofi);

        // One single noisy sell tick should NOT trigger sustained sell pressure
        tracker.record_trade(Slot(116), TradeSide::Sell, 20_000_000);
        assert!(
            !tracker.is_sustained_sell_pressure(Slot(116), -0.5),
            "Single noisy sell should NOT trigger sustained pressure"
        );

        // But sustained selling across next 20 slots SHOULD trigger it
        for s in 117..137 {
            tracker.record_trade(Slot(s), TradeSide::Sell, 15_000_000);
        }
        assert!(
            tracker.is_sustained_sell_pressure(Slot(137), -0.4),
            "Sustained selling should trigger confirmed OFI alert"
        );
    }
}
