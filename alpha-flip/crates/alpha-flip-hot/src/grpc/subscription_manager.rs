use crate::grpc::transport::SubscriptionFilter;
use crate::types::Pubkey;
use std::collections::HashSet;
use std::str::FromStr;

/// Standard mainnet Solana program IDs monitored by Alpha-Flip
pub const PUMP_FUN_PROGRAM_ID: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
pub const RAYDIUM_AMM_V4_PROGRAM_ID: &str = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

/// Dynamic subscription registry managing active account and program filters
#[derive(Debug, Clone)]
pub struct SubscriptionManager {
    commitment: String,
    monitored_accounts: HashSet<Pubkey>,
    monitored_programs: HashSet<Pubkey>,
    filter_version: u64,
}

impl Default for SubscriptionManager {
    fn default() -> Self {
        Self::new("processed")
    }
}

impl SubscriptionManager {
    pub fn new(commitment: &str) -> Self {
        Self {
            commitment: commitment.to_string(),
            monitored_accounts: HashSet::new(),
            monitored_programs: HashSet::new(),
            filter_version: 0,
        }
    }

    /// Pre-populates with Raydium v4 and Pump.fun DEX program IDs
    pub fn with_default_dex_programs(commitment: &str) -> Self {
        let mut mgr = Self::new(commitment);
        if let Ok(pump) = Pubkey::from_str(PUMP_FUN_PROGRAM_ID) {
            mgr.subscribe_program_transactions(pump);
        }
        if let Ok(raydium) = Pubkey::from_str(RAYDIUM_AMM_V4_PROGRAM_ID) {
            mgr.subscribe_program_transactions(raydium);
        }
        mgr
    }

    /// Dynamically register a bonding curve or pool account for real-time state streaming
    pub fn subscribe_account(&mut self, pubkey: Pubkey) -> bool {
        let inserted = self.monitored_accounts.insert(pubkey);
        if inserted {
            self.filter_version = self.filter_version.saturating_add(1);
        }
        inserted
    }

    /// Dynamically remove an account once a flip is closed or pool is discarded
    pub fn unsubscribe_account(&mut self, pubkey: &Pubkey) -> bool {
        let removed = self.monitored_accounts.remove(pubkey);
        if removed {
            self.filter_version = self.filter_version.saturating_add(1);
        }
        removed
    }

    /// Subscribe to all transactions emitted by or invoking a specific program ID
    pub fn subscribe_program_transactions(&mut self, program_id: Pubkey) -> bool {
        let inserted = self.monitored_programs.insert(program_id);
        if inserted {
            self.filter_version = self.filter_version.saturating_add(1);
        }
        inserted
    }

    /// Unsubscribe from a program ID
    pub fn unsubscribe_program_transactions(&mut self, program_id: &Pubkey) -> bool {
        let removed = self.monitored_programs.remove(program_id);
        if removed {
            self.filter_version = self.filter_version.saturating_add(1);
        }
        removed
    }

    /// Generate the concrete filter to send over gRPC
    pub fn build_filter(&self) -> SubscriptionFilter {
        SubscriptionFilter {
            accounts: self.monitored_accounts.iter().copied().collect(),
            program_ids: self.monitored_programs.iter().copied().collect(),
            commitment: self.commitment.clone(),
        }
    }

    pub fn filter_version(&self) -> u64 {
        self.filter_version
    }

    pub fn account_count(&self) -> usize {
        self.monitored_accounts.len()
    }

    pub fn program_count(&self) -> usize {
        self.monitored_programs.len()
    }

    pub fn contains_account(&self, pubkey: &Pubkey) -> bool {
        self.monitored_accounts.contains(pubkey)
    }

    pub fn contains_program(&self, program_id: &Pubkey) -> bool {
        self.monitored_programs.contains(program_id)
    }
}
