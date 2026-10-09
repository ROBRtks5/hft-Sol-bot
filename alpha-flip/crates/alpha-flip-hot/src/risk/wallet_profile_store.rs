use crate::types::{Lamports, Pubkey, Slot};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const DEFAULT_MAX_WALLET_PROFILES: usize = 4096;
pub const DEFAULT_WALLET_TTL_SLOTS: u64 = 2500; // ~16.6 minutes

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WalletRiskProfile {
    pub pubkey: Pubkey,
    pub first_seen_slot: Slot,
    pub last_seen_slot: Slot,
    pub buy_count: u32,
    pub sell_count: u32,
    pub total_buy_sol: Lamports,
    pub total_sell_sol: Lamports,
    pub known_funder: Option<Pubkey>,
    pub is_smart_money: bool,
}

impl WalletRiskProfile {
    pub fn new(pubkey: Pubkey, current_slot: Slot) -> Self {
        Self {
            pubkey,
            first_seen_slot: current_slot,
            last_seen_slot: current_slot,
            buy_count: 0,
            sell_count: 0,
            total_buy_sol: Lamports::ZERO,
            total_sell_sol: Lamports::ZERO,
            known_funder: None,
            is_smart_money: false,
        }
    }

    pub fn age_slots(&self, current_slot: Slot) -> u64 {
        current_slot.saturating_sub(self.first_seen_slot)
    }
}

/// Bounded in-memory wallet profiling cache with LRU & TTL eviction
#[derive(Debug, Clone)]
pub struct WalletProfileStore {
    profiles: HashMap<Pubkey, WalletRiskProfile>,
    max_capacity: usize,
    ttl_slots: u64,
}

impl Default for WalletProfileStore {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_WALLET_PROFILES, DEFAULT_WALLET_TTL_SLOTS)
    }
}

impl WalletProfileStore {
    pub fn new(max_capacity: usize, ttl_slots: u64) -> Self {
        Self {
            profiles: HashMap::with_capacity(512),
            max_capacity,
            ttl_slots,
        }
    }

    pub fn get(&self, pubkey: &Pubkey) -> Option<&WalletRiskProfile> {
        self.profiles.get(pubkey)
    }

    pub fn get_or_create(&mut self, pubkey: Pubkey, current_slot: Slot) -> &mut WalletRiskProfile {
        self.profiles
            .entry(pubkey)
            .or_insert_with(|| WalletRiskProfile::new(pubkey, current_slot))
    }

    pub fn record_buy(&mut self, pubkey: Pubkey, current_slot: Slot, amount: Lamports) {
        let p = self.get_or_create(pubkey, current_slot);
        p.buy_count = p.buy_count.saturating_add(1);
        p.total_buy_sol += amount;
        p.last_seen_slot = current_slot;
    }

    pub fn record_sell(&mut self, pubkey: Pubkey, current_slot: Slot, amount: Lamports) {
        let p = self.get_or_create(pubkey, current_slot);
        p.sell_count = p.sell_count.saturating_add(1);
        p.total_sell_sol += amount;
        p.last_seen_slot = current_slot;
    }

    pub fn set_funder(&mut self, pubkey: Pubkey, funder: Pubkey, current_slot: Slot) {
        let p = self.get_or_create(pubkey, current_slot);
        p.known_funder = Some(funder);
    }

    pub fn len(&self) -> usize {
        self.profiles.len()
    }

    pub fn is_empty(&self) -> bool {
        self.profiles.is_empty()
    }

    pub fn prune(&mut self, current_slot: Slot) -> usize {
        let mut evicted = 0;

        // 1. Evict expired
        let expired: Vec<Pubkey> = self
            .profiles
            .iter()
            .filter(|(_, p)| current_slot.saturating_sub(p.last_seen_slot) > self.ttl_slots)
            .map(|(k, _)| *k)
            .collect();

        for k in expired {
            self.profiles.remove(&k);
            evicted += 1;
        }

        // 2. Evict overflow via LRU
        if self.profiles.len() > self.max_capacity {
            let mut candidates: Vec<(Pubkey, Slot)> = self
                .profiles
                .iter()
                .map(|(k, p)| (*k, p.last_seen_slot))
                .collect();

            candidates.sort_by_key(|(_, slot)| *slot);
            let excess = self.profiles.len().saturating_sub(self.max_capacity);
            for (k, _) in candidates.into_iter().take(excess) {
                self.profiles.remove(&k);
                evicted += 1;
            }
        }

        evicted
    }
}
