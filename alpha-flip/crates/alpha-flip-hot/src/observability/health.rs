use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tokio::time::Instant;

use crate::observability::metrics::MetricsRegistry;
use crate::orchestrator::OperatingMode;
use crate::types::Lamports;

/// Comprehensive health check summary for Alpha-Flip Hot Path.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    pub status: HealthState,
    pub mode: OperatingMode,
    pub grpc_connected: bool,
    pub slot_lag: u64,
    pub current_slot: u64,
    pub blockhash_fresh: bool,
    pub wallet_balance_sol: f64,
    pub wallet_balance_floor_sol: f64,
    pub wallet_healthy: bool,
    pub open_positions_count: usize,
    pub unresolved_recovery: bool,
    pub state_drift_detected: bool,
    pub kill_switch_active: bool,
    pub landed_rate_pct: f64,
    pub last_checked_epoch_ms: u64,
    pub error_reasons: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthState {
    Healthy,
    Degraded,
    Unhealthy,
    Killed,
}

pub struct HealthChecker {
    registry: Arc<MetricsRegistry>,
    operating_mode: OperatingMode,
    wallet_floor: Lamports,
    max_tolerated_slot_lag: u64,
}

impl HealthChecker {
    pub fn new(
        registry: Arc<MetricsRegistry>,
        operating_mode: OperatingMode,
        wallet_floor: Lamports,
        max_tolerated_slot_lag: u64,
    ) -> Self {
        Self {
            registry,
            operating_mode,
            wallet_floor,
            max_tolerated_slot_lag,
        }
    }

    /// Evaluates system components and computes a consolidated health status.
    pub fn evaluate(
        &self,
        current_wallet_balance: Lamports,
        blockhash_fresh: bool,
        unresolved_recovery: bool,
        open_positions: usize,
    ) -> HealthStatus {
        let grpc_conn = self.registry.grpc_connected.load(Ordering::Relaxed) == 1;
        let lag = self.registry.slot_lag.load(Ordering::Relaxed);
        let curr_slot = self.registry.current_slot.load(Ordering::Relaxed);
        let drift = self.registry.reconciliation_drift_detected.load(Ordering::Relaxed) == 1;
        let killed = self.registry.kill_switch_active.load(Ordering::Relaxed) == 1;
        let landed_rate_bps = self.registry.landed_rate_bps.load(Ordering::Relaxed);

        let wallet_healthy = current_wallet_balance >= self.wallet_floor;
        let mut errors = Vec::new();

        if killed {
            errors.push("Emergency kill switch is ACTIVE".to_string());
        }
        if !grpc_conn {
            errors.push("Yellowstone gRPC stream disconnected".to_string());
        }
        if lag > self.max_tolerated_slot_lag {
            errors.push(format!("Slot lag exceeds threshold: {} > {}", lag, self.max_tolerated_slot_lag));
        }
        if !blockhash_fresh {
            errors.push("Latest blockhash is stale (> 150 slots old)".to_string());
        }
        if !wallet_healthy {
            errors.push(format!(
                "Wallet balance ({:.4} SOL) fell below safety floor ({:.4} SOL)",
                current_wallet_balance.as_sol(),
                self.wallet_floor.as_sol()
            ));
        }
        if unresolved_recovery {
            errors.push("Unresolved journal recovery pending manual audit".to_string());
        }
        if drift {
            errors.push("Critical state drift detected between local journal and on-chain balance".to_string());
        }

        let overall_state = if killed {
            HealthState::Killed
        } else if !grpc_conn || drift || unresolved_recovery || !wallet_healthy {
            HealthState::Unhealthy
        } else if lag > self.max_tolerated_slot_lag || !blockhash_fresh || landed_rate_bps < 3_000 {
            HealthState::Degraded
        } else {
            HealthState::Healthy
        };

        HealthStatus {
            status: overall_state,
            mode: self.operating_mode,
            grpc_connected: grpc_conn,
            slot_lag: lag,
            current_slot: curr_slot,
            blockhash_fresh,
            wallet_balance_sol: current_wallet_balance.as_sol(),
            wallet_balance_floor_sol: self.wallet_floor.as_sol(),
            wallet_healthy,
            open_positions_count: open_positions,
            unresolved_recovery,
            state_drift_detected: drift,
            kill_switch_active: killed,
            landed_rate_pct: (landed_rate_bps as f64) / 100.0,
            last_checked_epoch_ms: chrono::Utc::now().timestamp_millis() as u64,
            error_reasons: errors,
        }
    }
}
