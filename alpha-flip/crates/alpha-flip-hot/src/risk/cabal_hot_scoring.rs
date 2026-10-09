use crate::risk::wallet_profile_store::WalletProfileStore;
use crate::types::{Lamports, Pubkey, Slot};
use std::collections::{HashMap, HashSet};

pub const DEFAULT_FUNDING_GRAPH_TTL_SLOTS: u64 = 2000; // ~13.3 minutes
pub const NEW_WALLET_AGE_SLOTS_THRESHOLD: u64 = 300; // ~2 minutes

/// Bounded rolling local funding edge cache (funder -> recipients)
#[derive(Debug, Clone)]
pub struct RollingFundingGraph {
    funder_to_recipients: HashMap<Pubkey, (HashSet<Pubkey>, Slot)>,
    recipient_to_funder: HashMap<Pubkey, Pubkey>,
    ttl_slots: u64,
    max_funders_capacity: usize,
}

impl Default for RollingFundingGraph {
    fn default() -> Self {
        Self::new(DEFAULT_FUNDING_GRAPH_TTL_SLOTS, 2048)
    }
}

impl RollingFundingGraph {
    pub fn new(ttl_slots: u64, max_funders_capacity: usize) -> Self {
        Self {
            funder_to_recipients: HashMap::with_capacity(256),
            recipient_to_funder: HashMap::with_capacity(1024),
            ttl_slots,
            max_funders_capacity,
        }
    }

    pub fn record_funding(&mut self, funder: Pubkey, recipient: Pubkey, slot: Slot) {
        self.recipient_to_funder.insert(recipient, funder);

        let entry = self
            .funder_to_recipients
            .entry(funder)
            .or_insert_with(|| (HashSet::new(), slot));

        entry.0.insert(recipient);
        entry.1 = slot;

        if self.funder_to_recipients.len() > self.max_funders_capacity {
            let oldest = self
                .funder_to_recipients
                .iter()
                .min_by_key(|(_, (_, s))| *s)
                .map(|(k, _)| *k);

            if let Some(old_funder) = oldest {
                self.funder_to_recipients.remove(&old_funder);
            }
        }
    }

    pub fn get_funder(&self, recipient: &Pubkey) -> Option<Pubkey> {
        self.recipient_to_funder.get(recipient).copied()
    }

    /// Calculate shared funding ratio across a set of buyer wallets:
    /// Returns 0.0 (all unique funders) to 1.0 (all funded by the same cluster)
    pub fn shared_funding_ratio(&self, wallets: &[Pubkey]) -> f64 {
        if wallets.len() < 2 {
            return 0.0;
        }

        let mut funder_counts: HashMap<Pubkey, usize> = HashMap::new();
        let mut funded_count = 0;

        for w in wallets {
            if let Some(funder) = self.recipient_to_funder.get(w) {
                *funder_counts.entry(*funder).or_insert(0) += 1;
                funded_count += 1;
            }
        }

        if funded_count < 2 {
            return 0.0;
        }

        let max_from_single_funder = funder_counts.values().copied().max().unwrap_or(0);
        max_from_single_funder as f64 / wallets.len() as f64
    }

    pub fn prune(&mut self, current_slot: Slot) {
        self.funder_to_recipients
            .retain(|_, (_, s)| current_slot.saturating_sub(*s) <= self.ttl_slots);
    }
}

pub struct HotCabalScorer;

impl HotCabalScorer {
    /// Compute Hot Cabal Score (0..=100) using purely streaming heuristics without blocking RPC
    pub fn score(
        buyers: &[Pubkey],
        buy_amounts: &[Lamports],
        buy_slots: &[Slot],
        wallet_store: &WalletProfileStore,
        funding_graph: &RollingFundingGraph,
        current_slot: Slot,
    ) -> u8 {
        if buyers.is_empty() {
            return 0;
        }

        let mut penalty: u32 = 0;

        // 1. Shared funding edge concentration
        let shared_ratio = funding_graph.shared_funding_ratio(buyers);
        if shared_ratio > 0.60 {
            penalty = penalty.saturating_add(65);
        } else if shared_ratio > 0.35 {
            penalty = penalty.saturating_add(40);
        } else if shared_ratio > 0.15 {
            penalty = penalty.saturating_add(20);
        }

        // 2. High ratio of brand new wallets (younger than 300 slots)
        let mut new_wallets_count = 0;
        for w in buyers {
            if let Some(profile) = wallet_store.get(w) {
                if profile.age_slots(current_slot) < NEW_WALLET_AGE_SLOTS_THRESHOLD {
                    new_wallets_count += 1;
                }
            } else {
                new_wallets_count += 1; // Unseen before = brand new wallet
            }
        }

        let new_wallet_ratio = new_wallets_count as f64 / buyers.len() as f64;
        if new_wallet_ratio > 0.80 && buyers.len() >= 10 {
            penalty = penalty.saturating_add(35);
        } else if new_wallet_ratio > 0.50 {
            penalty = penalty.saturating_add(15);
        }

        // 3. Same-slot buy clustering (bot bundle entry)
        if buy_slots.len() >= 4 {
            let mut slot_counts: HashMap<Slot, usize> = HashMap::new();
            for s in buy_slots {
                *slot_counts.entry(*s).or_insert(0) += 1;
            }
            let max_in_same_slot = slot_counts.values().copied().max().unwrap_or(0);
            if max_in_same_slot >= 10 {
                penalty = penalty.saturating_add(30);
            } else if max_in_same_slot >= 5 {
                penalty = penalty.saturating_add(15);
            }
        }

        // 4. Uniform buy size chunking (e.g. all bot wallets buying exact same 0.25 SOL)
        if buy_amounts.len() >= 5 {
            let amounts_f64: Vec<f64> = buy_amounts.iter().map(|a| a.as_u64() as f64).collect();
            let mean = amounts_f64.iter().sum::<f64>() / amounts_f64.len() as f64;
            let variance = amounts_f64
                .iter()
                .map(|v| (v - mean).powi(2))
                .sum::<f64>()
                / amounts_f64.len() as f64;
            let std_dev = variance.sqrt();
            let cv = if mean > 0.0 { std_dev / mean } else { 1.0 };

            // Coefficient of variation < 0.05 indicates automated identical bot chunk sizes
            if cv < 0.05 {
                penalty = penalty.saturating_add(25);
            }
        }

        penalty.min(100) as u8
    }
}
