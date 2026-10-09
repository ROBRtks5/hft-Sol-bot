use crate::events::MarketState;
use crate::state::buyer_set_store::BuyerSetStore;
use crate::state::market_state_machine::MarketStateMachine;
use crate::types::{Lamports, Mint, Pubkey, Slot, TokenAmount, WriteVersion};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TokenRuntime {
    pub mint: Mint,
    pub state: MarketState,
    pub bonding_curve: Option<Pubkey>,
    pub raydium_pool: Option<Pubkey>,
    pub virtual_sol_reserves: Lamports,
    pub virtual_token_reserves: TokenAmount,
    pub last_slot: Slot,
    pub last_write_version: WriteVersion,
    pub last_update_slot: Slot,
    pub buyers: BuyerSetStore,
    pub hot_cabal_score: u8,
    pub organic_score: u8,
    pub dev_proxy_risk: u8,
    pub smart_money_score: u8,
    pub has_transfer_hook: bool,
    pub mint_authority_revoked: bool,
    pub freeze_authority_revoked: bool,
    pub lp_locked_or_burned: Option<bool>,
}

pub type TokenState = TokenRuntime;

impl TokenRuntime {
    pub fn new(mint: Mint, initial_slot: Slot) -> Self {
        Self {
            mint,
            state: MarketState::Created,
            bonding_curve: None,
            raydium_pool: None,
            virtual_sol_reserves: Lamports::ZERO,
            virtual_token_reserves: TokenAmount::ZERO,
            last_slot: initial_slot,
            last_write_version: WriteVersion::ZERO,
            last_update_slot: initial_slot,
            buyers: BuyerSetStore::default(),
            hot_cabal_score: 0,
            organic_score: 50,
            dev_proxy_risk: 0,
            smart_money_score: 0,
            has_transfer_hook: false,
            mint_authority_revoked: false,
            freeze_authority_revoked: false,
            lp_locked_or_burned: None,
        }
    }

    /// INVARIANT 6: Deduplication logic for incoming account updates
    /// Accepts only if slot > last_slot OR (slot == last_slot && write_version > last_write_version)
    pub fn is_update_newer(&self, slot: Slot, write_version: WriteVersion) -> bool {
        if slot > self.last_slot {
            true
        } else if slot == self.last_slot {
            write_version > self.last_write_version
        } else {
            false
        }
    }

    /// INVARIANT 5: Can trade only if state is PumpCurveActive or RaydiumPoolActive
    pub fn can_trade(&self) -> bool {
        MarketStateMachine::can_trade(&self.state) && !self.has_transfer_hook
    }

    pub fn spot_price_lamports(&self) -> f64 {
        if self.virtual_token_reserves.as_u64() == 0 {
            0.0
        } else {
            self.virtual_sol_reserves.as_u64() as f64 / self.virtual_token_reserves.as_u64() as f64
        }
    }

    pub fn unique_buyers(&self) -> u32 {
        self.buyers.unique_buyers()
    }
}
