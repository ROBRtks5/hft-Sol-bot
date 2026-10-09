use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;

/// Lock-free, zero-allocation metric collection registry for Alpha-Flip Hot Path.
/// All hot-path mutations use atomic operations with Relaxed or Release orderings
/// to ensure microsecond-level latency overhead is zero.
#[derive(Debug, Default)]
pub struct MetricsRegistry {
    // 1. Connection & Stream Health
    pub grpc_connected: AtomicU64,
    pub slot_lag: AtomicU64,
    pub reconnects_total: AtomicU64,
    pub current_slot: AtomicU64,

    // 2. Decode Latencies (nanoseconds / microseconds)
    pub decode_latency_p50_us: AtomicU64,
    pub decode_latency_p95_us: AtomicU64,
    pub decode_latency_p99_us: AtomicU64,
    pub decode_samples_count: AtomicU64,

    // 3. Throughput Counters
    pub events_total: AtomicU64,
    pub state_updates_total: AtomicU64,

    // 4. Memory & Entity Tracking
    pub active_tokens_gauge: AtomicU64,
    pub wallet_cache_size: AtomicU64,
    pub memory_rss_bytes: AtomicU64,

    // 5. Risk & Gate Deciders
    pub risk_score_low_count: AtomicU64,
    pub risk_score_medium_count: AtomicU64,
    pub risk_score_high_count: AtomicU64,
    pub edge_rejections_spread: AtomicU64,
    pub edge_rejections_slippage: AtomicU64,
    pub edge_rejections_liquidity: AtomicU64,
    pub edge_rejections_loss_limit: AtomicU64,
    pub edge_rejections_active_position: AtomicU64,

    // 6. Execution & Bundles
    pub bundle_submitted_total: AtomicU64,
    pub bundle_landed_total: AtomicU64,
    pub bundle_failed_total: AtomicU64,
    pub landed_rate_bps: AtomicU64, // 0..10_000
    pub average_tip_lamports: AtomicU64,
    pub average_priority_fee_lamports: AtomicU64,
    pub fill_rate_bps: AtomicU64,
    pub actual_slippage_bps: AtomicU64,
    pub expected_slippage_bps: AtomicU64,

    // 7. Portfolio & Risk Metrics (lamports, signed via AtomicI64)
    pub shadow_pnl_lamports: AtomicI64,
    pub live_pnl_lamports: AtomicI64,
    pub current_drawdown_bps: AtomicU64,
    pub consecutive_losses: AtomicU64,

    // 8. Reconciliation & Journal
    pub position_journal_lag_slots: AtomicU64,
    pub reconciliation_drift_detected: AtomicU64,
    pub kill_switch_active: AtomicU64,
}

impl MetricsRegistry {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    #[inline]
    pub fn set_grpc_connected(&self, connected: bool) {
        self.grpc_connected.store(if connected { 1 } else { 0 }, Ordering::Relaxed);
    }

    #[inline]
    pub fn record_slot_lag(&self, lag: u64, current_slot: u64) {
        self.slot_lag.store(lag, Ordering::Relaxed);
        self.current_slot.store(current_slot, Ordering::Relaxed);
    }

    #[inline]
    pub fn inc_reconnects(&self) {
        self.reconnects_total.fetch_add(1, Ordering::Relaxed);
    }

    #[inline]
    pub fn record_decode_latency_us(&self, p50: u64, p95: u64, p99: u64) {
        self.decode_latency_p50_us.store(p50, Ordering::Relaxed);
        self.decode_latency_p95_us.store(p95, Ordering::Relaxed);
        self.decode_latency_p99_us.store(p99, Ordering::Relaxed);
        self.decode_samples_count.fetch_add(1, Ordering::Relaxed);
    }

    #[inline]
    pub fn inc_events(&self) {
        self.events_total.fetch_add(1, Ordering::Relaxed);
    }

    #[inline]
    pub fn inc_state_updates(&self) {
        self.state_updates_total.fetch_add(1, Ordering::Relaxed);
    }

    #[inline]
    pub fn set_active_tokens(&self, count: u64) {
        self.active_tokens_gauge.store(count, Ordering::Relaxed);
    }

    #[inline]
    pub fn set_wallet_cache_size(&self, count: u64) {
        self.wallet_cache_size.store(count, Ordering::Relaxed);
    }

    #[inline]
    pub fn set_memory_rss(&self, bytes: u64) {
        self.memory_rss_bytes.store(bytes, Ordering::Relaxed);
    }

    #[inline]
    pub fn record_edge_rejection(&self, reason: &str) {
        match reason {
            "spread_too_wide" => self.edge_rejections_spread.fetch_add(1, Ordering::Relaxed),
            "slippage_exceeded" => self.edge_rejections_slippage.fetch_add(1, Ordering::Relaxed),
            "insufficient_liquidity" => self.edge_rejections_liquidity.fetch_add(1, Ordering::Relaxed),
            "daily_loss_limit_hit" => self.edge_rejections_loss_limit.fetch_add(1, Ordering::Relaxed),
            "active_position_exists" => self.edge_rejections_active_position.fetch_add(1, Ordering::Relaxed),
            _ => self.edge_rejections_spread.fetch_add(1, Ordering::Relaxed),
        };
    }

    #[inline]
    pub fn record_bundle_submission(&self) {
        self.bundle_submitted_total.fetch_add(1, Ordering::Relaxed);
    }

    #[inline]
    pub fn record_bundle_outcome(&self, landed: bool, tip: u64, priority: u64) {
        if landed {
            self.bundle_landed_total.fetch_add(1, Ordering::Relaxed);
        } else {
            self.bundle_failed_total.fetch_add(1, Ordering::Relaxed);
        }

        let total = self.bundle_submitted_total.load(Ordering::Relaxed);
        let landed_count = self.bundle_landed_total.load(Ordering::Relaxed);
        if total > 0 {
            let rate_bps = (landed_count * 10_000) / total;
            self.landed_rate_bps.store(rate_bps, Ordering::Relaxed);
        }
        self.average_tip_lamports.store(tip, Ordering::Relaxed);
        self.average_priority_fee_lamports.store(priority, Ordering::Relaxed);
    }

    #[inline]
    pub fn record_pnl(&self, live: bool, pnl_delta: i64) {
        if live {
            self.live_pnl_lamports.fetch_add(pnl_delta, Ordering::Relaxed);
        } else {
            self.shadow_pnl_lamports.fetch_add(pnl_delta, Ordering::Relaxed);
        }
    }

    #[inline]
    pub fn set_drawdown_bps(&self, bps: u64) {
        self.current_drawdown_bps.store(bps, Ordering::Relaxed);
    }

    #[inline]
    pub fn set_consecutive_losses(&self, count: u64) {
        self.consecutive_losses.store(count, Ordering::Relaxed);
    }

    #[inline]
    pub fn set_journal_lag(&self, lag: u64) {
        self.position_journal_lag_slots.store(lag, Ordering::Relaxed);
    }

    #[inline]
    pub fn set_reconciliation_drift(&self, drift: bool) {
        self.reconciliation_drift_detected.store(if drift { 1 } else { 0 }, Ordering::Relaxed);
    }

    #[inline]
    pub fn set_kill_switch(&self, active: bool) {
        self.kill_switch_active.store(if active { 1 } else { 0 }, Ordering::Relaxed);
    }

    /// Formats all metrics into standard Prometheus OpenMetrics text format.
    pub fn render_prometheus(&self) -> String {
        let mut out = String::with_capacity(4096);

        out.push_str("# HELP alpha_flip_grpc_connected Whether Yellowstone gRPC stream is active (1=connected, 0=disconnected)\n");
        out.push_str("# TYPE alpha_flip_grpc_connected gauge\n");
        out.push_str(&format!("alpha_flip_grpc_connected {}\n", self.grpc_connected.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_slot_lag Current slot lag between cluster tip and processed slot\n");
        out.push_str("# TYPE alpha_flip_slot_lag gauge\n");
        out.push_str(&format!("alpha_flip_slot_lag {}\n", self.slot_lag.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_current_slot Current processed slot\n");
        out.push_str("# TYPE alpha_flip_current_slot gauge\n");
        out.push_str(&format!("alpha_flip_current_slot {}\n", self.current_slot.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_reconnects_total Total Yellowstone gRPC reconnection attempts\n");
        out.push_str("# TYPE alpha_flip_reconnects_total counter\n");
        out.push_str(&format!("alpha_flip_reconnects_total {}\n", self.reconnects_total.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_decode_latency_microseconds Parser and decoder latency quantiles\n");
        out.push_str("# TYPE alpha_flip_decode_latency_microseconds gauge\n");
        out.push_str(&format!("alpha_flip_decode_latency_microseconds{{quantile=\"0.50\"}} {}\n", self.decode_latency_p50_us.load(Ordering::Relaxed)));
        out.push_str(&format!("alpha_flip_decode_latency_microseconds{{quantile=\"0.95\"}} {}\n", self.decode_latency_p95_us.load(Ordering::Relaxed)));
        out.push_str(&format!("alpha_flip_decode_latency_microseconds{{quantile=\"0.99\"}} {}\n", self.decode_latency_p99_us.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_events_total Total incoming transaction and account events processed\n");
        out.push_str("# TYPE alpha_flip_events_total counter\n");
        out.push_str(&format!("alpha_flip_events_total {}\n", self.events_total.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_state_updates_total Total market state updates computed\n");
        out.push_str("# TYPE alpha_flip_state_updates_total counter\n");
        out.push_str(&format!("alpha_flip_state_updates_total {}\n", self.state_updates_total.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_active_tokens Number of tokens tracked concurrently in working memory\n");
        out.push_str("# TYPE alpha_flip_active_tokens gauge\n");
        out.push_str(&format!("alpha_flip_active_tokens {}\n", self.active_tokens_gauge.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_wallet_cache_size Number of wallet profiles cached in local memory\n");
        out.push_str("# TYPE alpha_flip_wallet_cache_size gauge\n");
        out.push_str(&format!("alpha_flip_wallet_cache_size {}\n", self.wallet_cache_size.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_memory_rss_bytes Memory RSS usage in bytes\n");
        out.push_str("# TYPE alpha_flip_memory_rss_bytes gauge\n");
        out.push_str(&format!("alpha_flip_memory_rss_bytes {}\n", self.memory_rss_bytes.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_edge_gate_rejections_total Total buy signal rejections by economic edge gate\n");
        out.push_str("# TYPE alpha_flip_edge_gate_rejections_total counter\n");
        out.push_str(&format!("alpha_flip_edge_gate_rejections_total{{reason=\"spread_too_wide\"}} {}\n", self.edge_rejections_spread.load(Ordering::Relaxed)));
        out.push_str(&format!("alpha_flip_edge_gate_rejections_total{{reason=\"slippage_exceeded\"}} {}\n", self.edge_rejections_slippage.load(Ordering::Relaxed)));
        out.push_str(&format!("alpha_flip_edge_gate_rejections_total{{reason=\"insufficient_liquidity\"}} {}\n", self.edge_rejections_liquidity.load(Ordering::Relaxed)));
        out.push_str(&format!("alpha_flip_edge_gate_rejections_total{{reason=\"daily_loss_limit_hit\"}} {}\n", self.edge_rejections_loss_limit.load(Ordering::Relaxed)));
        out.push_str(&format!("alpha_flip_edge_gate_rejections_total{{reason=\"active_position_exists\"}} {}\n", self.edge_rejections_active_position.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_bundle_submitted_total Total Jito bundles submitted\n");
        out.push_str("# TYPE alpha_flip_bundle_submitted_total counter\n");
        out.push_str(&format!("alpha_flip_bundle_submitted_total {}\n", self.bundle_submitted_total.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_bundle_landed_total Total Jito bundles successfully landed on chain\n");
        out.push_str("# TYPE alpha_flip_bundle_landed_total counter\n");
        out.push_str(&format!("alpha_flip_bundle_landed_total {}\n", self.bundle_landed_total.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_landed_rate_bps Landed bundle rate in basis points (10000 = 100%)\n");
        out.push_str("# TYPE alpha_flip_landed_rate_bps gauge\n");
        out.push_str(&format!("alpha_flip_landed_rate_bps {}\n", self.landed_rate_bps.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_average_tip_lamports Average tip paid per bundle in lamports\n");
        out.push_str("# TYPE alpha_flip_average_tip_lamports gauge\n");
        out.push_str(&format!("alpha_flip_average_tip_lamports {}\n", self.average_tip_lamports.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_live_pnl_lamports Cumulative live trading net PnL in lamports\n");
        out.push_str("# TYPE alpha_flip_live_pnl_lamports gauge\n");
        out.push_str(&format!("alpha_flip_live_pnl_lamports {}\n", self.live_pnl_lamports.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_shadow_pnl_lamports Cumulative shadow trading net PnL in lamports\n");
        out.push_str("# TYPE alpha_flip_shadow_pnl_lamports gauge\n");
        out.push_str(&format!("alpha_flip_shadow_pnl_lamports {}\n", self.shadow_pnl_lamports.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_current_drawdown_bps Current drawdown in basis points\n");
        out.push_str("# TYPE alpha_flip_current_drawdown_bps gauge\n");
        out.push_str(&format!("alpha_flip_current_drawdown_bps {}\n", self.current_drawdown_bps.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_consecutive_losses Current consecutive losing trades\n");
        out.push_str("# TYPE alpha_flip_consecutive_losses gauge\n");
        out.push_str(&format!("alpha_flip_consecutive_losses {}\n", self.consecutive_losses.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_position_journal_lag_slots Slots elapsed between state change and journal sync\n");
        out.push_str("# TYPE alpha_flip_position_journal_lag_slots gauge\n");
        out.push_str(&format!("alpha_flip_position_journal_lag_slots {}\n", self.position_journal_lag_slots.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_reconciliation_drift 1 if balance or position state drift is detected\n");
        out.push_str("# TYPE alpha_flip_reconciliation_drift gauge\n");
        out.push_str(&format!("alpha_flip_reconciliation_drift {}\n", self.reconciliation_drift_detected.load(Ordering::Relaxed)));

        out.push_str("# HELP alpha_flip_kill_switch_active 1 if emergency kill switch is activated\n");
        out.push_str("# TYPE alpha_flip_kill_switch_active gauge\n");
        out.push_str(&format!("alpha_flip_kill_switch_active {}\n", self.kill_switch_active.load(Ordering::Relaxed)));

        out
    }
}
