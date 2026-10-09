use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EmergencyReason {
    SmartMoneyDump { reason: String },
    DevProxyDump { reason: String },
    AdverseSelectionSpike { reason: String },
    LiquidityCollapse { reserve_lamports: u64, drop_pct: u8 },
    GrpcStateDrift { reason: String },
    ExecutionFailureInPosition { reason: String },
    HardStopLossHit { current_pnl_bps: i32, max_loss_bps: i32 },
}

#[derive(Debug, Clone)]
pub struct EmergencyExitEngine {
    pub hard_stop_loss_bps: i32,        // e.g. -350 bps (-3.5%)
    pub min_liquidity_reserve_sol: f64, // e.g. 5.0 SOL floor
    pub max_liquidity_drop_pct: u8,     // e.g. 35% sudden pool collapse
}

impl Default for EmergencyExitEngine {
    fn default() -> Self {
        Self {
            hard_stop_loss_bps: -350, // -3.5% stop loss invariant
            min_liquidity_reserve_sol: 5.0,
            max_liquidity_drop_pct: 35,
        }
    }
}

impl EmergencyExitEngine {
    pub fn new(hard_stop_bps: i32, min_liq_sol: f64, max_liq_drop_pct: u8) -> Self {
        Self {
            hard_stop_loss_bps: hard_stop_bps,
            min_liquidity_reserve_sol: min_liq_sol,
            max_liquidity_drop_pct,
        }
    }

    /// Evaluates all emergency tripwires
    /// Returns Some(EmergencyReason) if ANY tripwire is breached
    pub fn check_emergency_tripwires(
        &self,
        current_pnl_bps: i32,
        current_pool_sol_reserves: u64,
        peak_pool_sol_reserves: u64,
        dev_dump_detected: bool,
        smart_money_dump_reason: Option<String>,
        adverse_selection_reason: Option<String>,
        grpc_state_drift_detected: bool,
        execution_failure_in_position: bool,
    ) -> Option<EmergencyReason> {
        // 1. Dev / Proxy dump detected
        if dev_dump_detected {
            return Some(EmergencyReason::DevProxyDump {
                reason: "Dev or proxy wallet transferred / dumped tokens".to_string(),
            });
        }

        // 2. Smart money dump detected
        if let Some(reason) = smart_money_dump_reason {
            return Some(EmergencyReason::SmartMoneyDump { reason });
        }

        // 3. Adverse selection spike
        if let Some(reason) = adverse_selection_reason {
            return Some(EmergencyReason::AdverseSelectionSpike { reason });
        }

        // 4. Hard stop loss breach
        if current_pnl_bps <= self.hard_stop_loss_bps {
            return Some(EmergencyReason::HardStopLossHit {
                current_pnl_bps,
                max_loss_bps: self.hard_stop_loss_bps,
            });
        }

        // 5. Liquidity collapse
        let min_reserve_lamports = (self.min_liquidity_reserve_sol * 1_000_000_000.0) as u64;
        if current_pool_sol_reserves < min_reserve_lamports {
            return Some(EmergencyReason::LiquidityCollapse {
                reserve_lamports: current_pool_sol_reserves,
                drop_pct: 100,
            });
        }
        if peak_pool_sol_reserves > 0 {
            let drop_pct = (peak_pool_sol_reserves.saturating_sub(current_pool_sol_reserves) as u128
                * 100
                / peak_pool_sol_reserves as u128) as u8;
            if drop_pct >= self.max_liquidity_drop_pct {
                return Some(EmergencyReason::LiquidityCollapse {
                    reserve_lamports: current_pool_sol_reserves,
                    drop_pct,
                });
            }
        }

        // 6. gRPC state drift
        if grpc_state_drift_detected {
            return Some(EmergencyReason::GrpcStateDrift {
                reason: "gRPC event sequence gap or out-of-order slot drift detected".to_string(),
            });
        }

        // 7. Execution failure while holding open position
        if execution_failure_in_position {
            return Some(EmergencyReason::ExecutionFailureInPosition {
                reason: "Transaction bundle dropped or reverted while position open".to_string(),
            });
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_emergency_tripwires_stop_loss_and_dev_dump() {
        let engine = EmergencyExitEngine::default();

        // Safe condition
        let safe = engine.check_emergency_tripwires(
            150,
            20_000_000_000,
            20_000_000_000,
            false,
            None,
            None,
            false,
            false,
        );
        assert!(safe.is_none());

        // Stop loss hit (-3.6% <= -3.5%)
        let sl = engine.check_emergency_tripwires(
            -360,
            20_000_000_000,
            20_000_000_000,
            false,
            None,
            None,
            false,
            false,
        );
        assert!(matches!(sl, Some(EmergencyReason::HardStopLossHit { .. })));

        // Dev dump overrides
        let dev = engine.check_emergency_tripwires(
            500, // even if profitable!
            20_000_000_000,
            20_000_000_000,
            true,
            None,
            None,
            false,
            false,
        );
        assert!(matches!(dev, Some(EmergencyReason::DevProxyDump { .. })));
    }
}
