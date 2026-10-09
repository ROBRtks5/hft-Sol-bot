use crate::types::Slot;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MarketScenario {
    FreshPump,
    RaydiumCTO,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimeStopReason {
    MaxHoldTimeoutExceeded {
        elapsed_slots: u64,
        max_slots: u64,
        scenario: MarketScenario,
    },
    StagnantPnLBand {
        elapsed_slots: u64,
        stagnant_threshold_slots: u64,
        current_pnl_bps: i32,
    },
}

#[derive(Debug, Clone)]
pub struct ScenarioTimeStopConfig {
    pub fresh_pump_max_hold_slots: u64, // e.g. 150 slots (~60s)
    pub fresh_pump_stagnant_slots: u64, // e.g. 75 slots (~30s)
    pub cto_max_hold_slots: u64,        // e.g. 450 slots (~180s)
    pub cto_stagnant_slots: u64,        // e.g. 225 slots (~90s)
    pub stagnant_lower_bps: i32,        // e.g. -100 bps (-1.0%)
    pub stagnant_upper_bps: i32,        // e.g. +200 bps (+2.0%)
}

impl Default for ScenarioTimeStopConfig {
    fn default() -> Self {
        Self {
            fresh_pump_max_hold_slots: 150, // 60s at 400ms
            fresh_pump_stagnant_slots: 75,  // 30s at 400ms
            cto_max_hold_slots: 450,        // 180s at 400ms
            cto_stagnant_slots: 225,        // 90s at 400ms
            stagnant_lower_bps: -100,
            stagnant_upper_bps: 200,
        }
    }
}

pub struct ScenarioTimeStop {
    pub config: ScenarioTimeStopConfig,
}

impl Default for ScenarioTimeStop {
    fn default() -> Self {
        Self {
            config: ScenarioTimeStopConfig::default(),
        }
    }
}

impl ScenarioTimeStop {
    pub fn new(config: ScenarioTimeStopConfig) -> Self {
        Self { config }
    }

    /// Evaluate whether time-stop triggers based on scenario and PnL stagnation
    pub fn check_time_stop(
        &self,
        opened_slot: Slot,
        current_slot: Slot,
        current_pnl_bps: i32,
        scenario: MarketScenario,
    ) -> Option<TimeStopReason> {
        let elapsed_slots = current_slot.saturating_sub(opened_slot);

        let (max_hold, stagnant_threshold) = match scenario {
            MarketScenario::FreshPump => (
                self.config.fresh_pump_max_hold_slots,
                self.config.fresh_pump_stagnant_slots,
            ),
            MarketScenario::RaydiumCTO => (
                self.config.cto_max_hold_slots,
                self.config.cto_stagnant_slots,
            ),
            MarketScenario::Custom => (
                self.config.fresh_pump_max_hold_slots,
                self.config.fresh_pump_stagnant_slots,
            ),
        };

        // 1. Hard maximum hold duration exceeded
        if elapsed_slots >= max_hold {
            return Some(TimeStopReason::MaxHoldTimeoutExceeded {
                elapsed_slots,
                max_slots: max_hold,
                scenario,
            });
        }

        // 2. Capital Velocity Invariant: Stagnant PnL within [-1.0%, +2.0%] for > stagnant_threshold
        if elapsed_slots >= stagnant_threshold
            && current_pnl_bps >= self.config.stagnant_lower_bps
            && current_pnl_bps <= self.config.stagnant_upper_bps
        {
            return Some(TimeStopReason::StagnantPnLBand {
                elapsed_slots,
                stagnant_threshold_slots: stagnant_threshold,
                current_pnl_bps,
            });
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scenario_time_stop_differs_fresh_vs_cto() {
        let ts = ScenarioTimeStop::default();
        let opened = Slot(1000);

        // At 100 slots elapsed (40s):
        // FreshPump: stagnant threshold is 75 slots -> triggers StagnantPnLBand if PnL is +0.5% (50 bps)
        let check_fresh = ts.check_time_stop(opened, Slot(1100), 50, MarketScenario::FreshPump);
        assert!(
            matches!(check_fresh, Some(TimeStopReason::StagnantPnLBand { .. })),
            "Fresh pump must time-out early on stagnation to maintain capital velocity"
        );

        // RaydiumCTO: stagnant threshold is 225 slots -> at 100 slots it is STILL within tolerance!
        let check_cto = ts.check_time_stop(opened, Slot(1100), 50, MarketScenario::RaydiumCTO);
        assert!(
            check_cto.is_none(),
            "CTO scenario gives position more room and should NOT trigger at 100 slots"
        );

        // At 460 slots elapsed (>450), CTO triggers MaxHoldTimeoutExceeded
        let check_cto_expired = ts.check_time_stop(opened, Slot(1460), 50, MarketScenario::RaydiumCTO);
        assert!(matches!(
            check_cto_expired,
            Some(TimeStopReason::MaxHoldTimeoutExceeded { .. })
        ));
    }
}
