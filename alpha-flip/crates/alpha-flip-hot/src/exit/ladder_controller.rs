use crate::errors::ExitError;
use crate::types::TokenAmount;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TierStatus {
    Pending,
    Executing,
    Filled,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LadderTierConfig {
    pub tier_index: u8,
    pub target_profit_bps: i32, // e.g. 3000 = +30.0%
    pub sell_share_pct: u8,     // percentage of INITIAL position, e.g. 50%
}

#[derive(Debug, Clone)]
pub struct LadderController {
    pub tier1: LadderTierConfig,
    pub tier2: LadderTierConfig,
    pub tier1_status: TierStatus,
    pub tier2_status: TierStatus,
    pub initial_tokens: TokenAmount,
    pub remaining_tokens: TokenAmount,
}

impl LadderController {
    pub fn new(
        initial_tokens: TokenAmount,
        tier1_profit_bps: i32, // e.g. +3000 bps (+30%)
        tier1_pct: u8,         // e.g. 50%
        tier2_profit_bps: i32, // e.g. +6000 bps (+60%)
        tier2_pct: u8,         // e.g. 30%
    ) -> Self {
        Self {
            tier1: LadderTierConfig {
                tier_index: 1,
                target_profit_bps: tier1_profit_bps,
                sell_share_pct: tier1_pct,
            },
            tier2: LadderTierConfig {
                tier_index: 2,
                target_profit_bps: tier2_profit_bps,
                sell_share_pct: tier2_pct,
            },
            tier1_status: TierStatus::Pending,
            tier2_status: TierStatus::Pending,
            initial_tokens,
            remaining_tokens: initial_tokens,
        }
    }

    /// Check if Tier 1 target has been reached
    pub fn is_tier1_triggered(&self, current_pnl_bps: i32) -> bool {
        self.tier1_status == TierStatus::Pending && current_pnl_bps >= self.tier1.target_profit_bps
    }

    /// Check if Tier 2 target has been reached
    pub fn is_tier2_triggered(&self, current_pnl_bps: i32) -> bool {
        // Can trigger if Tier 1 is filled or executing and target reached
        (self.tier2_status == TierStatus::Pending)
            && current_pnl_bps >= self.tier2.target_profit_bps
    }

    /// Calculate exact token amount to sell for a given tier
    /// INVARIANT: Can NEVER sell more than remaining token balance
    pub fn calculate_tier_sell_amount(&self, tier_index: u8) -> Result<TokenAmount, ExitError> {
        let pct = match tier_index {
            1 => self.tier1.sell_share_pct,
            2 => self.tier2.sell_share_pct,
            3 => {
                // Tier 3 is the remaining balance
                return Ok(self.remaining_tokens);
            }
            _ => {
                return Err(ExitError::TierAlreadyExecuted { tier: tier_index });
            }
        };

        let calculated_raw = (self.initial_tokens.as_u64() as u128 * pct as u128 / 100) as u64;
        let tokens_to_sell = TokenAmount::new(calculated_raw);

        if tokens_to_sell > self.remaining_tokens {
            // Cannot sell more than remaining; clamp to remaining
            Ok(self.remaining_tokens)
        } else {
            Ok(tokens_to_sell)
        }
    }

    /// Update status after sell execution succeeds
    pub fn mark_tier_filled(&mut self, tier_index: u8, sold: TokenAmount) -> Result<(), ExitError> {
        if sold > self.remaining_tokens {
            return Err(ExitError::ExceedsRemainingBalance {
                requested: sold.as_u64(),
                remaining: self.remaining_tokens.as_u64(),
            });
        }

        self.remaining_tokens -= sold;

        match tier_index {
            1 => self.tier1_status = TierStatus::Filled,
            2 => self.tier2_status = TierStatus::Filled,
            _ => {}
        }

        Ok(())
    }

    pub fn mark_tier_executing(&mut self, tier_index: u8) {
        match tier_index {
            1 => self.tier1_status = TierStatus::Executing,
            2 => self.tier2_status = TierStatus::Executing,
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ladder_controller_tracks_remaining_and_caps() {
        let total = TokenAmount::new(1_000_000_000); // 1B tokens
        let mut ladder = LadderController::new(total, 3000, 50, 6000, 30);

        // Check tier 1 at +25%: not triggered
        assert!(!ladder.is_tier1_triggered(2500));
        // Check tier 1 at +30%: triggered
        assert!(ladder.is_tier1_triggered(3000));

        let t1_sell = ladder.calculate_tier_sell_amount(1).unwrap();
        assert_eq!(t1_sell.as_u64(), 500_000_000); // 50%

        ladder.mark_tier_filled(1, t1_sell).unwrap();
        assert_eq!(ladder.remaining_tokens.as_u64(), 500_000_000);

        // Tier 2 triggered at +65%
        assert!(ladder.is_tier2_triggered(6500));
        let t2_sell = ladder.calculate_tier_sell_amount(2).unwrap();
        assert_eq!(t2_sell.as_u64(), 300_000_000); // 30% of initial

        ladder.mark_tier_filled(2, t2_sell).unwrap();
        assert_eq!(ladder.remaining_tokens.as_u64(), 200_000_000); // 20% remains

        // Tier 3 sells exact remainder (200M)
        let t3_sell = ladder.calculate_tier_sell_amount(3).unwrap();
        assert_eq!(t3_sell.as_u64(), 200_000_000);

        // Invariant: cannot sell more than remaining
        assert!(ladder
            .mark_tier_filled(3, TokenAmount::new(250_000_000))
            .is_err());
    }
}
