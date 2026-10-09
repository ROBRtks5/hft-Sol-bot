use crate::types::Slot;

pub const DEFAULT_SCORE_HALF_LIFE_SLOTS: u64 = 150; // ~60 seconds at 400ms/slot

/// Replay-deterministic exponential score decay based on logical slots
#[derive(Debug, Clone, Copy)]
pub struct ScoreDecay {
    pub half_life_slots: u64,
}

impl Default for ScoreDecay {
    fn default() -> Self {
        Self {
            half_life_slots: DEFAULT_SCORE_HALF_LIFE_SLOTS,
        }
    }
}

impl ScoreDecay {
    pub fn new(half_life_slots: u64) -> Self {
        Self {
            half_life_slots: half_life_slots.max(1),
        }
    }

    /// Decay a score (0..=100) based on slot delta:
    /// decayed = initial * (0.5 ^ (elapsed_slots / half_life_slots))
    pub fn decay_u8(&self, initial_score: u8, elapsed_slots: u64) -> u8 {
        if elapsed_slots == 0 || initial_score == 0 {
            return initial_score;
        }

        let lambda = (elapsed_slots as f64) / (self.half_life_slots as f64);
        let factor = 0.5f64.powf(lambda);
        let decayed = (initial_score as f64 * factor).round() as u8;
        decayed.min(initial_score)
    }

    /// Decay using explicit current and recorded slots
    pub fn decay_from_slot(&self, initial_score: u8, score_slot: Slot, current_slot: Slot) -> u8 {
        let elapsed = current_slot.saturating_sub(score_slot);
        self.decay_u8(initial_score, elapsed)
    }
}
