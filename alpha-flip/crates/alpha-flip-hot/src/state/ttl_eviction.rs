use crate::state::token_runtime::TokenRuntime;
use crate::types::{Mint, Pubkey, Slot};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const DEFAULT_MAX_ACTIVE_TOKENS: usize = 500;
pub const DEFAULT_MAX_WALLET_PROFILES: usize = 2000;
pub const DEFAULT_TOKEN_TTL_SLOTS: u64 = 1500; // ~10 minutes
pub const DEFAULT_WALLET_TTL_SLOTS: u64 = 3000; // ~20 minutes

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WalletProfile {
    pub pubkey: Pubkey,
    pub first_seen_slot: Slot,
    pub last_seen_slot: Slot,
    pub recent_buy_count: u32,
    pub recent_sell_count: u32,
    pub total_buy_sol: crate::types::Lamports,
    pub total_sell_sol: crate::types::Lamports,
    pub cabal_risk: u8,
    pub smart_money_score: u8,
    pub avg_hold_time_slots: u32,
    pub dump_aggression: u8,
    pub funding_sources_count: u16,
    pub ttl_slots: u64,
}

impl WalletProfile {
    pub fn new(pubkey: Pubkey, current_slot: Slot, ttl_slots: u64) -> Self {
        Self {
            pubkey,
            first_seen_slot: current_slot,
            last_seen_slot: current_slot,
            recent_buy_count: 0,
            recent_sell_count: 0,
            total_buy_sol: crate::types::Lamports::ZERO,
            total_sell_sol: crate::types::Lamports::ZERO,
            cabal_risk: 0,
            smart_money_score: 0,
            avg_hold_time_slots: 0,
            dump_aggression: 0,
            funding_sources_count: 1,
            ttl_slots,
        }
    }

    pub fn is_expired(&self, current_slot: Slot) -> bool {
        current_slot.saturating_sub(self.last_seen_slot) > self.ttl_slots
    }
}

/// Enforces bounded memory limits and TTL eviction across tokens and wallet profiles
#[derive(Debug, Clone)]
pub struct TtlEvictionManager {
    pub max_active_tokens: usize,
    pub max_wallet_profiles: usize,
    pub token_ttl_slots: u64,
    pub wallet_ttl_slots: u64,
}

impl Default for TtlEvictionManager {
    fn default() -> Self {
        Self::new(
            DEFAULT_MAX_ACTIVE_TOKENS,
            DEFAULT_MAX_WALLET_PROFILES,
            DEFAULT_TOKEN_TTL_SLOTS,
            DEFAULT_WALLET_TTL_SLOTS,
        )
    }
}

impl TtlEvictionManager {
    pub fn new(
        max_active_tokens: usize,
        max_wallet_profiles: usize,
        token_ttl_slots: u64,
        wallet_ttl_slots: u64,
    ) -> Self {
        Self {
            max_active_tokens,
            max_wallet_profiles,
            token_ttl_slots,
            wallet_ttl_slots,
        }
    }

    /// Prune expired tokens or evict least recently updated tokens if capacity exceeded
    pub fn prune_tokens(
        &self,
        tokens: &mut HashMap<Mint, TokenRuntime>,
        current_slot: Slot,
        active_position_mint: Option<&Mint>,
    ) -> usize {
        let mut evicted = 0;

        // 1. Evict based on TTL expiration
        let expired_mints: Vec<Mint> = tokens
            .iter()
            .filter(|(mint, runtime)| {
                // NEVER evict currently open active trading position!
                if let Some(pos_mint) = active_position_mint {
                    if *mint == pos_mint {
                        return false;
                    }
                }
                current_slot.saturating_sub(runtime.last_update_slot) > self.token_ttl_slots
            })
            .map(|(m, _)| *m)
            .collect();

        for m in expired_mints {
            tokens.remove(&m);
            evicted += 1;
        }

        // 2. Capacity overflow eviction (LRU based on last_update_slot)
        if tokens.len() > self.max_active_tokens {
            let mut candidates: Vec<(Mint, Slot)> = tokens
                .iter()
                .filter(|(m, _)| {
                    if let Some(pos_mint) = active_position_mint {
                        *m != pos_mint
                    } else {
                        true
                    }
                })
                .map(|(m, r)| (*m, r.last_update_slot))
                .collect();

            // Sort by oldest last_update_slot first
            candidates.sort_by_key(|(_, slot)| *slot);

            let overflow = tokens.len().saturating_sub(self.max_active_tokens);
            for (m, _) in candidates.into_iter().take(overflow) {
                tokens.remove(&m);
                evicted += 1;
            }
        }

        evicted
    }

    /// Prune expired wallet profiles
    pub fn prune_wallets(
        &self,
        wallets: &mut HashMap<Pubkey, WalletProfile>,
        current_slot: Slot,
    ) -> usize {
        let mut evicted = 0;

        let expired_wallets: Vec<Pubkey> = wallets
            .iter()
            .filter(|(_, p)| p.is_expired(current_slot))
            .map(|(w, _)| *w)
            .collect();

        for w in expired_wallets {
            wallets.remove(&w);
            evicted += 1;
        }

        if wallets.len() > self.max_wallet_profiles {
            let mut candidates: Vec<(Pubkey, Slot)> = wallets
                .iter()
                .map(|(w, p)| (*w, p.last_seen_slot))
                .collect();

            candidates.sort_by_key(|(_, slot)| *slot);
            let overflow = wallets.len().saturating_sub(self.max_wallet_profiles);
            for (w, _) in candidates.into_iter().take(overflow) {
                wallets.remove(&w);
                evicted += 1;
            }
        }

        evicted
    }
}
