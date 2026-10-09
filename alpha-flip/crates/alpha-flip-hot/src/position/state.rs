use crate::errors::PositionInvariantError;
use crate::types::{Lamports, Mint, Signature, Slot, TokenAmount};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PositionExitState {
    Open,
    PartialExitTier1,
    PartialExitTier2,
    ExitingFull,
    FullyExited,
    ExitFailed,
}

impl Default for PositionExitState {
    fn default() -> Self {
        PositionExitState::Open
    }
}

/// In-flight single active position state (Enforces strict 1-position capital velocity)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PositionState {
    pub mint: Mint,
    pub entry_price: f64,
    pub entry_sol: Lamports,
    pub token_amount: TokenAmount,
    pub remaining_token_amount: TokenAmount,
    pub opened_slot: Slot,
    pub tier1_done: bool,
    pub tier2_done: bool,
    pub exit_state: PositionExitState,
    pub pending_signatures: Vec<Signature>,
}

impl PositionState {
    pub fn new(
        mint: Mint,
        entry_price: f64,
        entry_sol: Lamports,
        token_amount: TokenAmount,
        opened_slot: Slot,
        initial_sig: Signature,
    ) -> Result<Self, PositionInvariantError> {
        let pos = Self {
            mint,
            entry_price,
            entry_sol,
            token_amount,
            remaining_token_amount: token_amount,
            opened_slot,
            tier1_done: false,
            tier2_done: false,
            exit_state: PositionExitState::Open,
            pending_signatures: vec![initial_sig],
        };
        pos.validate_invariants()?;
        Ok(pos)
    }

    /// INVARIANT CHECK: Remaining tokens can never exceed initially acquired tokens
    pub fn validate_invariants(&self) -> Result<(), PositionInvariantError> {
        if self.remaining_token_amount.as_u64() > self.token_amount.as_u64() {
            return Err(PositionInvariantError::RemainingExceedsTotal {
                remaining: self.remaining_token_amount.as_u64(),
                total: self.token_amount.as_u64(),
            });
        }
        if self.entry_price <= 0.0 {
            return Err(PositionInvariantError::NonPositiveEntryPrice(self.entry_price));
        }
        Ok(())
    }

    pub fn record_partial_exit(
        &mut self,
        tokens_sold: TokenAmount,
        sig: Signature,
    ) -> Result<(), PositionInvariantError> {
        if tokens_sold > self.remaining_token_amount {
            return Err(PositionInvariantError::SellAmountExceedsRemaining {
                sell: tokens_sold.as_u64(),
                remaining: self.remaining_token_amount.as_u64(),
            });
        }
        self.remaining_token_amount -= tokens_sold;
        self.pending_signatures.push(sig);

        if self.remaining_token_amount.as_u64() == 0 {
            self.exit_state = PositionExitState::FullyExited;
        } else if !self.tier1_done {
            self.tier1_done = true;
            self.exit_state = PositionExitState::PartialExitTier1;
        } else if !self.tier2_done {
            self.tier2_done = true;
            self.exit_state = PositionExitState::PartialExitTier2;
        }

        self.validate_invariants()?;
        Ok(())
    }

    pub fn is_open(&self) -> bool {
        self.exit_state != PositionExitState::FullyExited && self.remaining_token_amount.as_u64() > 0
    }
}
