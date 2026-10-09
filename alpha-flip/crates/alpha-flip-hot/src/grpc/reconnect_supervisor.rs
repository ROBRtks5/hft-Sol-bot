use crate::errors::{HotError, StateError};
use crate::types::Slot;
use std::time::Duration;
use tracing::{error, info, warn};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SupervisorState {
    Connected,
    Reconnecting,
    Disconnected,
    ReconciliationNeeded,
}

/// Manages stream reconnection, exponential backoff, and slot drift detection
#[derive(Debug, Clone)]
pub struct ReconnectSupervisor {
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
    pub backoff_multiplier: f64,
    pub max_tolerated_slot_lag: u64,
    pub reconciliation_threshold_slots: u64,

    current_attempt: u32,
    current_backoff: Duration,
    state: SupervisorState,
    total_reconnects: u64,
}

impl Default for ReconnectSupervisor {
    fn default() -> Self {
        Self::new(
            Duration::from_millis(100),
            Duration::from_millis(5000),
            2.0,
            25,  // 25 slots lag = ~10 seconds
            50,  // 50 slots lag = force reconciliation
        )
    }
}

impl ReconnectSupervisor {
    pub fn new(
        initial_backoff: Duration,
        max_backoff: Duration,
        backoff_multiplier: f64,
        max_tolerated_slot_lag: u64,
        reconciliation_threshold_slots: u64,
    ) -> Self {
        Self {
            initial_backoff,
            max_backoff,
            backoff_multiplier,
            max_tolerated_slot_lag,
            reconciliation_threshold_slots,
            current_attempt: 0,
            current_backoff: initial_backoff,
            state: SupervisorState::Disconnected,
            total_reconnects: 0,
        }
    }

    pub fn state(&self) -> SupervisorState {
        self.state
    }

    pub fn total_reconnects(&self) -> u64 {
        self.total_reconnects
    }

    pub fn current_attempt(&self) -> u32 {
        self.current_attempt
    }

    /// Calculate next backoff duration with exponential factor capped at max_backoff
    pub fn next_backoff_duration(&mut self) -> Duration {
        self.current_attempt = self.current_attempt.saturating_add(1);
        self.state = SupervisorState::Reconnecting;

        let backoff = self.current_backoff;
        let next_ms = (self.current_backoff.as_millis() as f64 * self.backoff_multiplier).round() as u64;
        self.current_backoff = Duration::from_millis(next_ms).min(self.max_backoff);

        warn!(
            attempt = self.current_attempt,
            backoff_ms = backoff.as_millis(),
            "Yellowstone gRPC reconnect scheduled"
        );
        backoff
    }

    /// Reset backoff back to initial upon successful stream stabilization
    pub fn record_success(&mut self) {
        if self.state == SupervisorState::Reconnecting {
            self.total_reconnects = self.total_reconnects.saturating_add(1);
            info!(
                total_reconnects = self.total_reconnects,
                "Yellowstone gRPC stream re-established successfully"
            );
        }
        self.current_attempt = 0;
        self.current_backoff = self.initial_backoff;
        self.state = SupervisorState::Connected;
    }

    pub fn record_failure(&mut self) {
        self.state = SupervisorState::Disconnected;
    }

    /// Detect if the stream has fallen dangerously behind cluster tip
    pub fn evaluate_slot_lag(
        &mut self,
        stream_slot: Slot,
        cluster_tip_slot: Slot,
    ) -> Result<u64, HotError> {
        let lag = cluster_tip_slot.saturating_sub(stream_slot);

        if lag >= self.reconciliation_threshold_slots {
            self.state = SupervisorState::ReconciliationNeeded;
            error!(
                stream_slot = stream_slot.as_u64(),
                cluster_tip = cluster_tip_slot.as_u64(),
                lag_slots = lag,
                "CRITICAL: Yellowstone gRPC stream exceeded reconciliation threshold! State resync required."
            );
            return Err(HotError::State(StateError::StaleSlot {
                event_slot: stream_slot.as_u64(),
                state_slot: cluster_tip_slot.as_u64(),
            }));
        }

        if lag > self.max_tolerated_slot_lag {
            warn!(
                stream_slot = stream_slot.as_u64(),
                cluster_tip = cluster_tip_slot.as_u64(),
                lag_slots = lag,
                "Yellowstone gRPC slot lag elevated"
            );
        }

        Ok(lag)
    }

    pub fn needs_reconciliation(&self) -> bool {
        self.state == SupervisorState::ReconciliationNeeded
    }
}
