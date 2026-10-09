use crate::types::Slot;
use std::sync::atomic::{AtomicU64, Ordering};

/// Solana average slot duration in milliseconds (~400ms nominal)
pub const NOMINAL_SLOT_DURATION_MS: u64 = 400;

/// Replay-deterministic logical clock tracking slot progression
#[derive(Debug)]
pub struct SlotClock {
    current_slot: AtomicU64,
}

impl Default for SlotClock {
    fn default() -> Self {
        Self {
            current_slot: AtomicU64::new(0),
        }
    }
}

impl SlotClock {
    pub fn new(initial_slot: Slot) -> Self {
        Self {
            current_slot: AtomicU64::new(initial_slot.as_u64()),
        }
    }

    #[inline]
    pub fn current_slot(&self) -> Slot {
        Slot(self.current_slot.load(Ordering::Relaxed))
    }

    /// Advance clock monotonically. Ignores older slots.
    pub fn advance_to(&self, new_slot: Slot) -> Slot {
        self.current_slot
            .fetch_max(new_slot.as_u64(), Ordering::SeqCst);
        self.current_slot()
    }

    #[inline]
    pub fn slots_to_approx_millis(delta_slots: u64) -> u64 {
        delta_slots.saturating_mul(NOMINAL_SLOT_DURATION_MS)
    }

    #[inline]
    pub fn millis_to_approx_slots(millis: u64) -> u64 {
        if NOMINAL_SLOT_DURATION_MS == 0 {
            0
        } else {
            millis / NOMINAL_SLOT_DURATION_MS
        }
    }

    #[inline]
    pub fn elapsed_slots(&self, since: Slot) -> u64 {
        self.current_slot().saturating_sub(since)
    }

    #[inline]
    pub fn elapsed_approx_millis(&self, since: Slot) -> u64 {
        Self::slots_to_approx_millis(self.elapsed_slots(since))
    }
}
