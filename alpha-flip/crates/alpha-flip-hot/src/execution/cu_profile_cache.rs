use crate::types::{Pubkey, Slot};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SwapInstructionType {
    PumpBuy,
    PumpSell,
    RaydiumBuy,
    RaydiumSell,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CUProfileKey {
    pub program_id: Pubkey,
    pub instruction_type: SwapInstructionType,
    pub creates_ata: bool,
    pub uses_lookup_table: bool,
    pub is_token_2022: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CUProfile {
    pub base_units: u32,
    pub safety_margin_pct: u8, // e.g. 25%
    pub last_updated_slot: Slot,
}

impl CUProfile {
    pub fn compute_limit(&self) -> u32 {
        let margin = (self.base_units as u64 * self.safety_margin_pct as u64) / 100;
        let total = self.base_units as u64 + margin;
        if total > 1_400_000 {
            1_400_000 // Solana per-transaction limit
        } else {
            total as u32
        }
    }
}

pub struct CUProfileCache {
    profiles: HashMap<CUProfileKey, CUProfile>,
    default_safety_margin_pct: u8,
}

impl Default for CUProfileCache {
    fn default() -> Self {
        Self::new(25)
    }
}

impl CUProfileCache {
    pub fn new(default_safety_margin_pct: u8) -> Self {
        Self {
            profiles: HashMap::new(),
            default_safety_margin_pct,
        }
    }

    /// Fast lookup in microsecond hot path
    pub fn get_cu_limit(&self, key: &CUProfileKey) -> u32 {
        if let Some(profile) = self.profiles.get(key) {
            profile.compute_limit()
        } else {
            // Conservative heuristic defaults
            let mut base = match key.instruction_type {
                SwapInstructionType::PumpBuy => 75_000,
                SwapInstructionType::PumpSell => 65_000,
                SwapInstructionType::RaydiumBuy => 135_000,
                SwapInstructionType::RaydiumSell => 125_000,
            };

            if key.creates_ata {
                base += 28_000; // Rent & init account overhead
            }
            if key.is_token_2022 {
                base += 15_000; // Extension decoding
            }

            let margin = (base * self.default_safety_margin_pct as u32) / 100;
            base + margin
        }
    }

    /// Invalidate or boost profile when a ComputeBudgetExceeded error is detected
    pub fn record_budget_exceeded(&mut self, key: &CUProfileKey) {
        let entry = self.profiles.entry(key.clone()).or_insert_with(|| CUProfile {
            base_units: 120_000,
            safety_margin_pct: self.default_safety_margin_pct,
            last_updated_slot: Slot::ZERO,
        });

        // Boost base units by 25% to prevent recurrence
        entry.base_units = (entry.base_units as u64 * 125 / 100).min(1_000_000) as u32;
    }

    /// Offline reprofiling hook (not called in hot loop)
    pub fn offline_reprofiling_hook(&mut self, key: CUProfileKey, profiled_units: u32, slot: Slot) {
        self.profiles.insert(
            key,
            CUProfile {
                base_units: profiled_units,
                safety_margin_pct: self.default_safety_margin_pct,
                last_updated_slot: slot,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cu_profile_cache() {
        let mut cache = CUProfileCache::new(20);
        let key = CUProfileKey {
            program_id: Pubkey::new_unique(),
            instruction_type: SwapInstructionType::PumpBuy,
            creates_ata: true,
            uses_lookup_table: false,
            is_token_2022: false,
        };

        let initial_limit = cache.get_cu_limit(&key);
        assert!(initial_limit > 100_000);

        // Offline profiling hook updates exact usage
        cache.offline_reprofiling_hook(key.clone(), 80_000, Slot(500));
        let profiled_limit = cache.get_cu_limit(&key);
        assert_eq!(profiled_limit, 96_000); // 80k + 20%

        // Exceeded error increases limit
        cache.record_budget_exceeded(&key);
        let boosted = cache.get_cu_limit(&key);
        assert!(boosted > profiled_limit);
    }
}
