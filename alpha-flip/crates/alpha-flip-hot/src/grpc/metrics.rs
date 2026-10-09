use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

/// Lock-free metrics tracking Yellowstone gRPC ingestion performance and health
#[derive(Debug, Default)]
pub struct GrpcMetrics {
    pub grpc_connected: AtomicBool,
    pub grpc_reconnects_total: AtomicU64,
    pub grpc_slot_lag: AtomicU64,
    pub grpc_messages_total: AtomicU64,
    pub account_updates_total: AtomicU64,
    pub transaction_events_total: AtomicU64,
    pub slot_updates_total: AtomicU64,
    pub channel_queue_depth: AtomicU64,
    pub replay_records_written: AtomicU64,
    pub dropped_events_total: AtomicU64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrpcMetricsSnapshot {
    pub is_connected: bool,
    pub reconnects_total: u64,
    pub slot_lag: u64,
    pub messages_total: u64,
    pub account_updates_total: u64,
    pub transaction_events_total: u64,
    pub slot_updates_total: u64,
    pub channel_queue_depth: u64,
    pub replay_records_written: u64,
    pub dropped_events_total: u64,
}

impl GrpcMetrics {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn set_connected(&self, connected: bool) {
        self.grpc_connected.store(connected, Ordering::Relaxed);
    }

    pub fn inc_reconnects(&self) {
        self.grpc_reconnects_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn set_slot_lag(&self, lag: u64) {
        self.grpc_slot_lag.store(lag, Ordering::Relaxed);
    }

    pub fn inc_messages(&self) {
        self.grpc_messages_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_account_updates(&self) {
        self.account_updates_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_transaction_events(&self) {
        self.transaction_events_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_slot_updates(&self) {
        self.slot_updates_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn set_queue_depth(&self, depth: u64) {
        self.channel_queue_depth.store(depth, Ordering::Relaxed);
    }

    pub fn inc_replay_records(&self) {
        self.replay_records_written.fetch_add(1, Ordering::Relaxed);
    }

    pub fn inc_dropped_events(&self) {
        self.dropped_events_total.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> GrpcMetricsSnapshot {
        GrpcMetricsSnapshot {
            is_connected: self.grpc_connected.load(Ordering::Relaxed),
            reconnects_total: self.grpc_reconnects_total.load(Ordering::Relaxed),
            slot_lag: self.grpc_slot_lag.load(Ordering::Relaxed),
            messages_total: self.grpc_messages_total.load(Ordering::Relaxed),
            account_updates_total: self.account_updates_total.load(Ordering::Relaxed),
            transaction_events_total: self.transaction_events_total.load(Ordering::Relaxed),
            slot_updates_total: self.slot_updates_total.load(Ordering::Relaxed),
            channel_queue_depth: self.channel_queue_depth.load(Ordering::Relaxed),
            replay_records_written: self.replay_records_written.load(Ordering::Relaxed),
            dropped_events_total: self.dropped_events_total.load(Ordering::Relaxed),
        }
    }
}
