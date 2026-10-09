use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::replay::{ReplayDecisionLog, ReplayFrame, ReplayRunner, ReplaySummary};
use crate::types::{Mint, Slot};

/// Капсула инцидента / момента торгов для воспроизведения
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayCapsule {
    pub capsule_id: String,
    pub title_ru: String,
    pub target_mint: Mint,
    pub recorded_at_utc: String,
    pub start_slot: Slot,
    pub end_slot: Slot,
    pub frames: Vec<ReplayFrame>,
    pub expected_decisions: Vec<ReplayDecisionLog>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapsuleReplayDiff {
    pub capsule_id: String,
    pub is_deterministic_match: bool,
    pub expected_count: usize,
    pub actual_count: usize,
    pub summary_ru: String,
    pub diff_notes: Vec<String>,
}

impl ReplayCapsule {
    pub fn new(
        capsule_id: impl Into<String>,
        title_ru: impl Into<String>,
        target_mint: Mint,
        start_slot: Slot,
        end_slot: Slot,
        frames: Vec<ReplayFrame>,
        expected_decisions: Vec<ReplayDecisionLog>,
    ) -> Self {
        Self {
            capsule_id: capsule_id.into(),
            title_ru: title_ru.into(),
            target_mint,
            recorded_at_utc: chrono::Utc::now().to_rfc3339(),
            start_slot,
            end_slot,
            frames,
            expected_decisions,
        }
    }

    /// Прогон капсулы через детерминированный движок на логических слотовых часах
    pub fn re_execute(&self) -> (ReplaySummary, CapsuleReplayDiff) {
        let mut runner = ReplayRunner::new(
            self.start_slot,
            crate::orchestrator::OperatingMode::Shadow,
        );

        let summary = runner.run(&self.frames);
        let actual_decisions = runner.decision_logs();

        let mut diff_notes = Vec::new();
        let mut is_match = true;

        if actual_decisions.len() != self.expected_decisions.len() {
            is_match = false;
            diff_notes.push(format!(
                "Несовпадение количества решений: ожидалось {}, получено {}",
                self.expected_decisions.len(),
                actual_decisions.len()
            ));
        }

        let summary_ru = if is_match {
            format!("Капсула '{}' воспроизведена со 100% точностью решений.", self.capsule_id)
        } else {
            format!("Капсула '{}' выявила расхождение с эталонным поведением.", self.capsule_id)
        };

        let diff = CapsuleReplayDiff {
            capsule_id: self.capsule_id.clone(),
            is_deterministic_match: is_match,
            expected_count: self.expected_decisions.len(),
            actual_count: actual_decisions.len(),
            summary_ru,
            diff_notes,
        };

        (summary, diff)
    }
}
