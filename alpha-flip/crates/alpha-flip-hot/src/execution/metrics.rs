use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Default)]
pub struct ExecutionMetrics {
    pub bundle_submitted_total: AtomicU64,
    pub bundle_landed_total: AtomicU64,
    pub bundle_failed_total: AtomicU64,
    pub total_tips_paid: AtomicU64,
    pub total_priority_fees_paid: AtomicU64,
    pub blockhash_stale_count: AtomicU64,
    pub cu_exceeded_count: AtomicU64,
    pub execution_budget_used: AtomicU64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionMetricsSnapshot {
    pub bundle_submitted_total: u64,
    pub bundle_landed_total: u64,
    pub bundle_failed_total: u64,
    pub landed_rate: f64,
    pub average_tip: u64,
    pub average_priority_fee: u64,
    pub blockhash_stale_count: u64,
    pub cu_exceeded_count: u64,
    pub execution_budget_used: u64,
}

impl ExecutionMetrics {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_submission(&self, tip_lamports: u64, priority_fee_lamports: u64) {
        self.bundle_submitted_total.fetch_add(1, Ordering::Relaxed);
        self.total_tips_paid.fetch_add(tip_lamports, Ordering::Relaxed);
        self.total_priority_fees_paid.fetch_add(priority_fee_lamports, Ordering::Relaxed);
        self.execution_budget_used.fetch_add(tip_lamports + priority_fee_lamports, Ordering::Relaxed);
    }

    pub fn record_landed(&self) {
        self.bundle_landed_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_failed(&self) {
        self.bundle_failed_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_stale_blockhash(&self) {
        self.blockhash_stale_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_cu_exceeded(&self) {
        self.cu_exceeded_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn landed_rate(&self) -> f64 {
        let submitted = self.bundle_submitted_total.load(Ordering::Relaxed);
        let landed = self.bundle_landed_total.load(Ordering::Relaxed);
        if submitted == 0 {
            1.0
        } else {
            landed as f64 / submitted as f64
        }
    }

    pub fn average_tip(&self) -> u64 {
        let submitted = self.bundle_submitted_total.load(Ordering::Relaxed);
        if submitted == 0 {
            0
        } else {
            self.total_tips_paid.load(Ordering::Relaxed) / submitted
        }
    }

    pub fn average_priority_fee(&self) -> u64 {
        let submitted = self.bundle_submitted_total.load(Ordering::Relaxed);
        if submitted == 0 {
            0
        } else {
            self.total_priority_fees_paid.load(Ordering::Relaxed) / submitted
        }
    }

    pub fn snapshot(&self) -> ExecutionMetricsSnapshot {
        ExecutionMetricsSnapshot {
            bundle_submitted_total: self.bundle_submitted_total.load(Ordering::Relaxed),
            bundle_landed_total: self.bundle_landed_total.load(Ordering::Relaxed),
            bundle_failed_total: self.bundle_failed_total.load(Ordering::Relaxed),
            landed_rate: self.landed_rate(),
            average_tip: self.average_tip(),
            average_priority_fee: self.average_priority_fee(),
            blockhash_stale_count: self.blockhash_stale_count.load(Ordering::Relaxed),
            cu_exceeded_count: self.cu_exceeded_count.load(Ordering::Relaxed),
            execution_budget_used: self.execution_budget_used.load(Ordering::Relaxed),
        }
    }
}
