use crate::types::{Lamports, Mint, TokenAmount};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tracing::{error, info, warn};

pub const DEFAULT_RESERVES_DRIFT_EPSILON: f64 = 0.01; // 1.0% allowable drift tolerance

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReservesDriftReport {
    pub mint: Mint,
    pub local_sol: Lamports,
    pub chain_sol: Lamports,
    pub drift_ratio: f64,
    pub resynced: bool,
}

#[derive(Debug, Default)]
pub struct ReconciliationMetrics {
    pub total_reconciliations: AtomicU64,
    pub drift_alerts_total: AtomicU64,
    pub resyncs_performed_total: AtomicU64,
}

pub struct ReconciliationEngine {
    drift_epsilon: f64,
    metrics: Arc<ReconciliationMetrics>,
}

impl Default for ReconciliationEngine {
    fn default() -> Self {
        Self::new(DEFAULT_RESERVES_DRIFT_EPSILON)
    }
}

impl ReconciliationEngine {
    pub fn new(drift_epsilon: f64) -> Self {
        Self {
            drift_epsilon,
            metrics: Arc::new(ReconciliationMetrics::default()),
        }
    }

    pub fn metrics(&self) -> Arc<ReconciliationMetrics> {
        self.metrics.clone()
    }

    /// Compare local virtual reserves against authoritative on-chain state snapshot
    pub fn verify_and_reconcile(
        &self,
        mint: Mint,
        local_sol: Lamports,
        chain_sol: Lamports,
        _local_token: TokenAmount,
        _chain_token: TokenAmount,
    ) -> Option<ReservesDriftReport> {
        self.metrics.total_reconciliations.fetch_add(1, Ordering::Relaxed);

        if local_sol.as_u64() == 0 || chain_sol.as_u64() == 0 {
            return None;
        }

        let diff = (local_sol.as_u64() as f64 - chain_sol.as_u64() as f64).abs();
        let drift_ratio = diff / chain_sol.as_u64() as f64;

        if drift_ratio > self.drift_epsilon {
            self.metrics.drift_alerts_total.fetch_add(1, Ordering::Relaxed);
            self.metrics.resyncs_performed_total.fetch_add(1, Ordering::Relaxed);

            warn!(
                mint = %mint,
                local_sol = local_sol.as_u64(),
                chain_sol = chain_sol.as_u64(),
                drift_percent = format!("{:.2}%", drift_ratio * 100.0),
                "RECONCILIATION DRIFT DETECTED: Chain snapshot out of sync with local hot reserves. Resyncing."
            );

            Some(ReservesDriftReport {
                mint,
                local_sol,
                chain_sol,
                drift_ratio,
                resynced: true,
            })
        } else {
            None
        }
    }
}
