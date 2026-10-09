use crate::types::{Lamports, Pubkey, Slot};
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};

pub const DEFAULT_MAX_BUYERS_PER_TOKEN: usize = 512;
pub const MAX_RECENT_SELLERS_TRACKED: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SellerRecord {
    pub seller: Pubkey,
    pub slot: Slot,
    pub sol_amount: Lamports,
    pub is_dev_or_proxy: bool,
    pub is_smart_money: bool,
}

/// Tracks distinct buyers, repeated purchases, and recent dump sellers for a token
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BuyerSetStore {
    buyers: HashSet<Pubkey>,
    unique_buyers_count: u32,
    total_buy_txs: u32,
    total_sell_txs: u32,
    max_buyers_capacity: usize,
    recent_sellers: VecDeque<SellerRecord>,
}

impl Default for BuyerSetStore {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_BUYERS_PER_TOKEN)
    }
}

impl BuyerSetStore {
    pub fn new(max_buyers_capacity: usize) -> Self {
        Self {
            buyers: HashSet::with_capacity(64),
            unique_buyers_count: 0,
            total_buy_txs: 0,
            total_sell_txs: 0,
            max_buyers_capacity,
            recent_sellers: VecDeque::with_capacity(MAX_RECENT_SELLERS_TRACKED),
        }
    }

    /// Record a successful BUY.
    /// Returns `true` if this wallet is a NEW unique buyer, `false` if it was already recorded.
    pub fn record_buy(&mut self, trader: Pubkey) -> bool {
        self.total_buy_txs = self.total_buy_txs.saturating_add(1);

        if self.buyers.contains(&trader) {
            return false;
        }

        if self.buyers.len() < self.max_buyers_capacity {
            self.buyers.insert(trader);
        }

        self.unique_buyers_count = self.unique_buyers_count.saturating_add(1);
        true
    }

    /// Record a SELL.
    /// Sells NEVER increase unique_buyers count!
    pub fn record_sell(
        &mut self,
        seller: Pubkey,
        slot: Slot,
        sol_amount: Lamports,
        is_dev_or_proxy: bool,
        is_smart_money: bool,
    ) {
        self.total_sell_txs = self.total_sell_txs.saturating_add(1);

        if self.recent_sellers.len() >= MAX_RECENT_SELLERS_TRACKED {
            self.recent_sellers.pop_front();
        }

        self.recent_sellers.push_back(SellerRecord {
            seller,
            slot,
            sol_amount,
            is_dev_or_proxy,
            is_smart_money,
        });
    }

    pub fn unique_buyers(&self) -> u32 {
        self.unique_buyers_count
    }

    pub fn total_buy_txs(&self) -> u32 {
        self.total_buy_txs
    }

    pub fn total_sell_txs(&self) -> u32 {
        self.total_sell_txs
    }

    pub fn contains_buyer(&self, trader: &Pubkey) -> bool {
        self.buyers.contains(trader)
    }

    pub fn recent_sellers(&self) -> &VecDeque<SellerRecord> {
        &self.recent_sellers
    }

    pub fn has_recent_dev_dump(&self) -> bool {
        self.recent_sellers.iter().any(|s| s.is_dev_or_proxy)
    }
}
