use crate::economics::amm_math::{
    calculate_spot_price, constant_product_swap_exact_in, constant_product_swap_exact_out,
};
use crate::errors::EconomicError;

pub const RAYDIUM_STANDARD_FEE_BPS: u16 = 25; // 0.25% standard AMM fee

pub trait RaydiumAmmEngine: Send + Sync {
    fn quote_buy(
        &self,
        sol_reserve_lamports: u64,
        token_reserve: u64,
        sol_in_lamports: u64,
        fee_bps: u16,
    ) -> Result<RaydiumBuyQuote, EconomicError>;

    fn quote_sell(
        &self,
        sol_reserve_lamports: u64,
        token_reserve: u64,
        tokens_in: u64,
        fee_bps: u16,
    ) -> Result<RaydiumSellQuote, EconomicError>;

    fn spot_price(&self, sol_reserve_lamports: u64, token_reserve: u64) -> f64;
}

#[derive(Debug, Clone, PartialEq)]
pub struct RaydiumBuyQuote {
    pub sol_in: u64,
    pub fee_lamports: u64,
    pub tokens_out: u64,
    pub spot_price_before: f64,
    pub spot_price_after: f64,
    pub effective_price: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RaydiumSellQuote {
    pub tokens_in: u64,
    pub fee_tokens: u64,
    pub sol_out_net: u64,
    pub spot_price_before: f64,
    pub spot_price_after: f64,
    pub effective_price: f64,
}

#[derive(Debug, Clone, Default)]
pub struct StandardRaydiumAmmEngine;

impl StandardRaydiumAmmEngine {
    pub fn new() -> Self {
        Self
    }
}

impl RaydiumAmmEngine for StandardRaydiumAmmEngine {
    fn spot_price(&self, sol_reserve_lamports: u64, token_reserve: u64) -> f64 {
        calculate_spot_price(sol_reserve_lamports, token_reserve)
    }

    fn quote_buy(
        &self,
        sol_reserve_lamports: u64,
        token_reserve: u64,
        sol_in_lamports: u64,
        fee_bps: u16,
    ) -> Result<RaydiumBuyQuote, EconomicError> {
        if sol_reserve_lamports == 0 || token_reserve == 0 {
            return Err(EconomicError::InsufficientLiquidity {
                reserve_lamports: sol_reserve_lamports,
                min_required: 1,
            });
        }
        if sol_in_lamports == 0 {
            return Err(EconomicError::SizeBelowMinimumFloor {
                size_lamports: 0,
                min_lamports: 1,
            });
        }

        let spot_price_before = self.spot_price(sol_reserve_lamports, token_reserve);

        let tokens_out = constant_product_swap_exact_in(
            sol_reserve_lamports,
            token_reserve,
            sol_in_lamports,
            fee_bps,
        )
        .ok_or(EconomicError::MathOverflow)?;

        if tokens_out == 0 {
            return Err(EconomicError::MathOverflow);
        }

        let fee_lamports = ((sol_in_lamports as u128 * fee_bps as u128) / 10_000) as u64;

        let new_sol_reserve = sol_reserve_lamports.saturating_add(sol_in_lamports);
        let new_token_reserve = token_reserve.saturating_sub(tokens_out);
        let spot_price_after = self.spot_price(new_sol_reserve, new_token_reserve);
        let effective_price = sol_in_lamports as f64 / tokens_out as f64;

        Ok(RaydiumBuyQuote {
            sol_in: sol_in_lamports,
            fee_lamports,
            tokens_out,
            spot_price_before,
            spot_price_after,
            effective_price,
        })
    }

    fn quote_sell(
        &self,
        sol_reserve_lamports: u64,
        token_reserve: u64,
        tokens_in: u64,
        fee_bps: u16,
    ) -> Result<RaydiumSellQuote, EconomicError> {
        if sol_reserve_lamports == 0 || token_reserve == 0 {
            return Err(EconomicError::InsufficientLiquidity {
                reserve_lamports: sol_reserve_lamports,
                min_required: 1,
            });
        }
        if tokens_in == 0 {
            return Err(EconomicError::SizeBelowMinimumFloor {
                size_lamports: 0,
                min_lamports: 1,
            });
        }

        let spot_price_before = self.spot_price(sol_reserve_lamports, token_reserve);

        let sol_out_net = constant_product_swap_exact_in(
            token_reserve,
            sol_reserve_lamports,
            tokens_in,
            fee_bps,
        )
        .ok_or(EconomicError::MathOverflow)?;

        if sol_out_net == 0 {
            return Err(EconomicError::MathOverflow);
        }

        let fee_tokens = ((tokens_in as u128 * fee_bps as u128) / 10_000) as u64;

        let new_token_reserve = token_reserve.saturating_add(tokens_in);
        let new_sol_reserve = sol_reserve_lamports.saturating_sub(sol_out_net);
        let spot_price_after = self.spot_price(new_sol_reserve, new_token_reserve);
        let effective_price = sol_out_net as f64 / tokens_in as f64;

        Ok(RaydiumSellQuote {
            tokens_in,
            fee_tokens,
            sol_out_net,
            spot_price_before,
            spot_price_after,
            effective_price,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_raydium_buy_and_sell() {
        let engine = StandardRaydiumAmmEngine::new();
        let sol_res = 50_000_000_000; // 50 SOL
        let token_res = 1_000_000_000_000; // 1M tokens

        let buy = engine
            .quote_buy(sol_res, token_res, 1_000_000_000, 25)
            .unwrap();
        assert!(buy.tokens_out > 0);
        assert!(buy.spot_price_after > buy.spot_price_before);

        let sell = engine
            .quote_sell(
                sol_res + 1_000_000_000,
                token_res - buy.tokens_out,
                buy.tokens_out,
                25,
            )
            .unwrap();
        assert!(sell.sol_out_net < 1_000_000_000); // 2x fee impact
    }
}
