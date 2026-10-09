use crate::types::{Lamports, Mint, Pubkey, Signature, Slot, TokenAmount};
use serde::{Deserialize, Serialize};

/// High-level market state of a token lifecycle
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum MarketState {
    Created,
    PumpCurveActive { bonding_curve: Pubkey },
    Graduating { expected_pool: Option<Pubkey> },
    RaydiumPoolActive { pool: Pubkey },
    Stale,
    Blacklisted { reason: String },
}

impl Default for MarketState {
    fn default() -> Self {
        MarketState::Created
    }
}

impl MarketState {
    pub fn is_tradable(&self) -> bool {
        matches!(
            self,
            MarketState::PumpCurveActive { .. } | MarketState::RaydiumPoolActive { .. }
        )
    }

    pub fn is_blacklisted(&self) -> bool {
        matches!(self, MarketState::Blacklisted { .. })
    }
}

/// Trade direction
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TradeSide {
    Buy,
    Sell,
}

impl std::fmt::Display for TradeSide {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TradeSide::Buy => write!(f, "BUY"),
            TradeSide::Sell => write!(f, "SELL"),
        }
    }
}

/// Normalized trade event parsed from Raydium or Pump.fun log-gated decoders
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TradeEvent {
    pub mint: Mint,
    pub side: TradeSide,
    pub trader: Pubkey,
    pub sol_amount: Lamports,
    pub token_amount: TokenAmount,
    pub slot: Slot,
    pub signature: Signature,
    pub program_id: Pubkey,
    pub is_direct: bool,
    pub router: Option<Pubkey>,
    pub success: bool,
}

impl TradeEvent {
    pub fn price_in_lamports_per_token(&self) -> f64 {
        if self.token_amount.as_u64() == 0 {
            0.0
        } else {
            self.sol_amount.as_u64() as f64 / self.token_amount.as_u64() as f64
        }
    }
}
