use crate::types::{Pubkey, Slot};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SmartMoneyDumpSignal {
    None,
    AccelerateLadder {
        distinct_sellers: usize,
        total_dumped_lamports: u64,
    },
    EmergencyDump {
        distinct_sellers: usize,
        total_dumped_lamports: u64,
        reason: String,
    },
}

#[derive(Debug, Clone)]
pub struct SmartMoneyDumpDetector {
    smart_money_registry: HashSet<Pubkey>,
    sells_by_wallet: HashMap<Pubkey, u64>, // Wallet -> total lamports dumped
    total_dumped_lamports: u64,
    accelerate_count_threshold: usize,
    emergency_count_threshold: usize,
    emergency_volume_threshold_lamports: u64,
}

impl Default for SmartMoneyDumpDetector {
    fn default() -> Self {
        Self {
            smart_money_registry: HashSet::new(),
            sells_by_wallet: HashMap::new(),
            total_dumped_lamports: 0,
            accelerate_count_threshold: 1,
            emergency_count_threshold: 2,
            emergency_volume_threshold_lamports: 5_000_000_000, // 5.0 SOL smart money dump
        }
    }
}

impl SmartMoneyDumpDetector {
    pub fn new(
        smart_money_wallets: Vec<Pubkey>,
        accelerate_count: usize,
        emergency_count: usize,
        emergency_volume: u64,
    ) -> Self {
        Self {
            smart_money_registry: smart_money_wallets.into_iter().collect(),
            sells_by_wallet: HashMap::new(),
            total_dumped_lamports: 0,
            accelerate_count_threshold: accelerate_count,
            emergency_count_threshold: emergency_count,
            emergency_volume_threshold_lamports: emergency_volume,
        }
    }

    pub fn register_smart_wallet(&mut self, wallet: Pubkey) {
        self.smart_money_registry.insert(wallet);
    }

    pub fn is_smart_wallet(&self, wallet: &Pubkey) -> bool {
        self.smart_money_registry.contains(wallet)
    }

    /// Record a sell transaction. If seller is in smart money registry, record metrics.
    pub fn record_sell(
        &mut self,
        _slot: Slot,
        seller: &Pubkey,
        volume_lamports: u64,
    ) -> SmartMoneyDumpSignal {
        if !self.smart_money_registry.contains(seller) {
            return SmartMoneyDumpSignal::None;
        }

        let entry = self.sells_by_wallet.entry(*seller).or_insert(0);
        *entry = entry.saturating_add(volume_lamports);
        self.total_dumped_lamports = self.total_dumped_lamports.saturating_add(volume_lamports);

        let distinct_sellers = self.sells_by_wallet.len();

        if distinct_sellers >= self.emergency_count_threshold
            || self.total_dumped_lamports >= self.emergency_volume_threshold_lamports
        {
            SmartMoneyDumpSignal::EmergencyDump {
                distinct_sellers,
                total_dumped_lamports: self.total_dumped_lamports,
                reason: format!(
                    "Smart money dump: {} distinct whales dumped {} lamports",
                    distinct_sellers, self.total_dumped_lamports
                ),
            }
        } else if distinct_sellers >= self.accelerate_count_threshold {
            SmartMoneyDumpSignal::AccelerateLadder {
                distinct_sellers,
                total_dumped_lamports: self.total_dumped_lamports,
            }
        } else {
            SmartMoneyDumpSignal::None
        }
    }

    pub fn reset_position(&mut self) {
        self.sells_by_wallet.clear();
        self.total_dumped_lamports = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_smart_money_dump_detection() {
        let whale1 = Pubkey::new_unique();
        let whale2 = Pubkey::new_unique();
        let regular_trader = Pubkey::new_unique();

        let mut detector = SmartMoneyDumpDetector::new(vec![whale1, whale2], 1, 2, 5_000_000_000);

        // Regular sell ignored
        let sig0 = detector.record_sell(Slot(100), &regular_trader, 10_000_000_000);
        assert_eq!(sig0, SmartMoneyDumpSignal::None);

        // First smart money sell triggers AccelerateLadder
        let sig1 = detector.record_sell(Slot(101), &whale1, 1_000_000_000);
        assert!(matches!(sig1, SmartMoneyDumpSignal::AccelerateLadder { .. }));

        // Second distinct smart money sell triggers EmergencyDump
        let sig2 = detector.record_sell(Slot(102), &whale2, 2_000_000_000);
        assert!(matches!(sig2, SmartMoneyDumpSignal::EmergencyDump { .. }));
    }
}
