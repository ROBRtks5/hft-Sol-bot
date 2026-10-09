use crate::grpc::transport::AccountUpdateFrame;
use crate::types::{Mint, Pubkey};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

pub const MAX_UNRESOLVED_QUEUE_PER_ACCOUNT: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AccountIndexRole {
    BondingCurve,
    RaydiumPool,
    TokenMint,
    LpMint,
}

#[derive(Debug, Default)]
pub struct AccountToMintIndex {
    account_to_mint: HashMap<Pubkey, (Mint, AccountIndexRole)>,
    unresolved_account_queue: HashMap<Pubkey, VecDeque<AccountUpdateFrame>>,
    total_resolutions: u64,
    total_unresolved_queued: u64,
}

impl AccountToMintIndex {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_bonding_curve(&mut self, bonding_curve: Pubkey, mint: Mint) {
        self.account_to_mint
            .insert(bonding_curve, (mint, AccountIndexRole::BondingCurve));
        self.register_token_mint(mint);
        self.total_resolutions = self.total_resolutions.saturating_add(1);
    }

    pub fn register_raydium_pool(&mut self, pool: Pubkey, mint: Mint) {
        self.account_to_mint
            .insert(pool, (mint, AccountIndexRole::RaydiumPool));
        self.register_token_mint(mint);
        self.total_resolutions = self.total_resolutions.saturating_add(1);
    }

    pub fn register_token_mint(&mut self, mint: Mint) {
        self.account_to_mint
            .insert(mint, (mint, AccountIndexRole::TokenMint));
    }

    pub fn resolve_mint(&self, account: &Pubkey) -> Option<Mint> {
        self.account_to_mint.get(account).map(|(m, _)| *m)
    }

    pub fn get_role(&self, account: &Pubkey) -> Option<AccountIndexRole> {
        self.account_to_mint.get(account).map(|(_, r)| *r)
    }

    /// If an account update arrives before pool/curve creation was indexed, queue it safely
    pub fn queue_unresolved(&mut self, frame: AccountUpdateFrame) {
        self.total_unresolved_queued = self.total_unresolved_queued.saturating_add(1);
        let queue = self
            .unresolved_account_queue
            .entry(frame.pubkey)
            .or_insert_with(|| VecDeque::with_capacity(MAX_UNRESOLVED_QUEUE_PER_ACCOUNT));

        if queue.len() >= MAX_UNRESOLVED_QUEUE_PER_ACCOUNT {
            queue.pop_front(); // Bound memory by dropping oldest unmapped frame
        }
        queue.push_back(frame);
    }

    /// When mapping is registered, drain any pending frames waiting for this account
    pub fn drain_unresolved(&mut self, account: &Pubkey) -> Vec<AccountUpdateFrame> {
        self.unresolved_account_queue
            .remove(account)
            .map(|q| q.into_iter().collect())
            .unwrap_or_default()
    }

    pub fn unresolved_accounts_count(&self) -> usize {
        self.unresolved_account_queue.len()
    }

    pub fn total_indexed_mappings(&self) -> usize {
        self.account_to_mint.len()
    }
}
