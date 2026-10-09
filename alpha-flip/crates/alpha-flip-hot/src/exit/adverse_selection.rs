use crate::types::Slot;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AdverseSelectionReason {
    ImmediatePostBuyDump {
        slots_since_buy: u64,
        dump_volume_lamports: u64,
    },
    BuySellRatioReversal {
        consecutive_sells: u32,
        sell_volume_lamports: u64,
    },
    LiquidityDrainAheadOfPrice {
        reserve_drop_pct: u8,
        price_drop_pct: u8,
    },
    CabalScoreSurge {
        entry_cabal_score: u8,
        current_cabal_score: u8,
    },
}

#[derive(Debug, Clone)]
pub struct AdverseSelectionDetector {
    pub post_buy_window_slots: u64,           // e.g. 10 slots (~4 seconds)
    pub immediate_dump_volume_threshold: u64, // e.g. 2.0 SOL dump
    pub reversal_consecutive_sells: u32,      // e.g. >= 4 consecutive sells
    pub cabal_surge_threshold: u8,            // e.g. score jumped by >= 35 or above 70
}

impl Default for AdverseSelectionDetector {
    fn default() -> Self {
        Self {
            post_buy_window_slots: 12,
            immediate_dump_volume_threshold: 2_000_000_000, // 2.0 SOL
            reversal_consecutive_sells: 4,
            cabal_surge_threshold: 30,
        }
    }
}

impl AdverseSelectionDetector {
    pub fn new(
        post_buy_window_slots: u64,
        immediate_dump_volume: u64,
        reversal_sells: u32,
        cabal_surge: u8,
    ) -> Self {
        Self {
            post_buy_window_slots,
            immediate_dump_volume_threshold: immediate_dump_volume,
            reversal_consecutive_sells: reversal_sells,
            cabal_surge_threshold: cabal_surge,
        }
    }

    /// Check if toxic / adverse selection flow is occurring immediately post-fill
    pub fn evaluate_adverse_selection(
        &self,
        bought_slot: Slot,
        current_slot: Slot,
        recent_sell_volume_lamports: u64,
        consecutive_sells: u32,
        reserve_sol_drop_pct: u8,
        price_drop_pct: u8,
        entry_cabal_score: u8,
        current_cabal_score: u8,
    ) -> Option<AdverseSelectionReason> {
        let elapsed_slots = current_slot.saturating_sub(bought_slot);

        // 1. Immediate post-buy dump (whales or bots dumping into our fill)
        if elapsed_slots <= self.post_buy_window_slots
            && recent_sell_volume_lamports >= self.immediate_dump_volume_threshold
        {
            return Some(AdverseSelectionReason::ImmediatePostBuyDump {
                slots_since_buy: elapsed_slots,
                dump_volume_lamports: recent_sell_volume_lamports,
            });
        }

        // 2. Buy/sell ratio reversal: sudden barrage of consecutive sells
        if consecutive_sells >= self.reversal_consecutive_sells && recent_sell_volume_lamports > 1_000_000_000 {
            return Some(AdverseSelectionReason::BuySellRatioReversal {
                consecutive_sells,
                sell_volume_lamports: recent_sell_volume_lamports,
            });
        }

        // 3. Liquidity falling faster than price (pool drain / rug pull)
        if reserve_sol_drop_pct >= 25 && reserve_sol_drop_pct > price_drop_pct + 15 {
            return Some(AdverseSelectionReason::LiquidityDrainAheadOfPrice {
                reserve_drop_pct: reserve_sol_drop_pct,
                price_drop_pct,
            });
        }

        // 4. Cabal score surged dramatically after our entry (co-ordinated dump setup)
        if current_cabal_score.saturating_sub(entry_cabal_score) >= self.cabal_surge_threshold
            || current_cabal_score >= 75
        {
            return Some(AdverseSelectionReason::CabalScoreSurge {
                entry_cabal_score,
                current_cabal_score,
            });
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_adverse_selection_detection() {
        let detector = AdverseSelectionDetector::default();
        let buy_slot = Slot(100);

        // Scenario 1: Immediate post-buy dump 4 slots after entry
        let res1 = detector.evaluate_adverse_selection(
            buy_slot,
            Slot(104),
            2_500_000_000, // 2.5 SOL dump
            1,
            5,
            2,
            15,
            20,
        );
        assert!(matches!(
            res1,
            Some(AdverseSelectionReason::ImmediatePostBuyDump { .. })
        ));

        // Scenario 2: Cabal score surge from 15 to 65
        let res2 = detector.evaluate_adverse_selection(
            buy_slot,
            Slot(150),
            100_000_000,
            1,
            0,
            0,
            15,
            65,
        );
        assert!(matches!(
            res2,
            Some(AdverseSelectionReason::CabalScoreSurge { .. })
        ));
    }
}
