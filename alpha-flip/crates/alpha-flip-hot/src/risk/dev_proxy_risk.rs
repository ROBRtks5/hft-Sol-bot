use crate::types::Pubkey;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DevProxyState {
    pub dev_wallet: Pubkey,
    pub known_proxies: HashSet<Pubkey>,
    pub tokens_transferred_to_proxies: u64,
    pub total_initial_supply: u64,
    pub cold_path_flag_active: bool,
    pub dev_balance: u64,
}

impl DevProxyState {
    pub fn new(dev_wallet: Pubkey, total_initial_supply: u64) -> Self {
        Self {
            dev_wallet,
            known_proxies: HashSet::new(),
            tokens_transferred_to_proxies: 0,
            total_initial_supply: total_initial_supply.max(1),
            cold_path_flag_active: false,
            dev_balance: 0,
        }
    }

    /// Record a token transfer originating from dev wallet
    pub fn record_transfer_from_dev(&mut self, to: Pubkey, amount: u64, is_market_pool: bool) {
        if is_market_pool {
            return; // Transfers directly into the bonding curve or AMM pool are normal LP adds
        }

        // Material transfer to non-market private address = PROXY DISTRIBUTION!
        self.known_proxies.insert(to);
        self.tokens_transferred_to_proxies =
            self.tokens_transferred_to_proxies.saturating_add(amount);
    }

    pub fn set_cold_flag(&mut self, active: bool) {
        self.cold_path_flag_active = active;
    }

    /// Calculate dev proxy risk (0..=100).
    /// CRITICAL INVARIANT: Even if dev_balance is 0, transferring tokens to proxies causes HIGH RISK!
    pub fn calculate_risk_score(&self) -> u8 {
        let mut score: u32 = 0;

        // Ratio of supply moved to shadow proxies
        let proxy_ratio = (self.tokens_transferred_to_proxies as f64)
            / (self.total_initial_supply as f64);

        if proxy_ratio > 0.05 {
            score = score.saturating_add(85); // >5% distributed to proxies is extreme cabal/dump risk
        } else if proxy_ratio > 0.02 {
            score = score.saturating_add(60);
        } else if proxy_ratio > 0.005 {
            score = score.saturating_add(35);
        }

        // Cold path advisory override
        if self.cold_path_flag_active {
            score = score.saturating_add(50);
        }

        // Direct dev balance risk
        let dev_direct_ratio = (self.dev_balance as f64) / (self.total_initial_supply as f64);
        if dev_direct_ratio > 0.10 {
            score = score.saturating_add(40);
        }

        score.min(100) as u8
    }
}
