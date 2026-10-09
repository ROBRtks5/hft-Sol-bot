use crate::types::Pubkey;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Minimum holding duration in slots (~20 seconds) before smart money is considered organic rather than a toxic sniper/dump risk
pub const MIN_SAFE_HOLD_SLOTS: u32 = 50;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SmartMoneyProfile {
    pub pubkey: Pubkey,
    pub score: u8,
    pub confidence: f32,
    pub avg_hold_time_slots: u32,
    pub dump_aggression: u8,
    pub cabal_overlap: u8,
    pub winrate: f32,
    pub realized_pnl_estimate: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SmartMoneyAssessment {
    pub is_smart_money: bool,
    pub is_quick_dump_risk: bool,
    pub quality_score: u8,
    pub reason: String,
}

#[derive(Debug, Default, Clone)]
pub struct SmartMoneyRegistry {
    profiles: HashMap<Pubkey, SmartMoneyProfile>,
}

impl SmartMoneyRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, profile: SmartMoneyProfile) {
        self.profiles.insert(profile.pubkey, profile);
    }

    pub fn get(&self, pubkey: &Pubkey) -> Option<&SmartMoneyProfile> {
        self.profiles.get(pubkey)
    }

    /// Assess whether a trader represents true organic smart money or a short-fuse dump threat
    pub fn assess_buyer(&self, pubkey: &Pubkey) -> SmartMoneyAssessment {
        let profile = match self.profiles.get(pubkey) {
            Some(p) => p,
            None => {
                return SmartMoneyAssessment {
                    is_smart_money: false,
                    is_quick_dump_risk: false,
                    quality_score: 0,
                    reason: "Standard retail trader".to_string(),
                };
            }
        };

        // If hold time is very short (< 50 slots = ~20s) or dump aggression is high (> 65),
        // this is a high-speed scalper / dump risk, NOT a bullish signal!
        let is_quick_dump_risk =
            profile.avg_hold_time_slots < MIN_SAFE_HOLD_SLOTS || profile.dump_aggression > 65;

        let quality_score = if is_quick_dump_risk {
            // Penalize quality score: toxic sniper
            profile.score.saturating_sub(40)
        } else {
            profile.score
        };

        let reason = if is_quick_dump_risk {
            format!(
                "Smart money detected but flagged as TOXIC DUMP RISK: avg hold {} slots, aggression {}",
                profile.avg_hold_time_slots, profile.dump_aggression
            )
        } else {
            format!(
                "Quality patient smart money: winrate {:.1}%, score {}",
                profile.winrate * 100.0,
                profile.score
            )
        };

        SmartMoneyAssessment {
            is_smart_money: true,
            is_quick_dump_risk,
            quality_score,
            reason,
        }
    }
}
