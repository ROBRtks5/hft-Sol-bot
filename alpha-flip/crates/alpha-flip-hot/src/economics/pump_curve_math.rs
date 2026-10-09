use crate::errors::EconomicError;

/// Standard Pump.fun virtual bonding curve constants
pub const PUMP_INITIAL_VIRTUAL_SOL: u64 = 30_000_000_000; // 30 SOL in lamports
pub const PUMP_INITIAL_VIRTUAL_TOKEN: u64 = 1_073_000_000_000_000; // 1.073B tokens (6 decimals)
pub const PUMP_INITIAL_REAL_TOKEN: u64 = 793_100_000_000_000; // 793.1M available tokens
pub const PUMP_FEE_BPS: u16 = 100; // 1.0% protocol fee

pub trait PumpCurveEngine: Send + Sync {
    fn quote_buy(
        &self,
        virtual_sol: u64,
        virtual_token: u64,
        sol_in_lamports: u64,
    ) -> Result<PumpBuyQuote, EconomicError>;

    fn quote_sell(
        &self,
        virtual_sol: u64,
        virtual_token: u64,
        tokens_in: u64,
    ) -> Result<PumpSellQuote, EconomicError>;

    fn spot_price(&self, virtual_sol: u64, virtual_token: u64) -> f64;
}

#[derive(Debug, Clone, PartialEq)]
pub struct PumpBuyQuote {
    pub sol_in: u64,
    pub fee_lamports: u64,
    pub sol_into_curve: u64,
    pub tokens_out: u64,
    pub spot_price_before: f64,
    pub spot_price_after: f64,
    pub effective_price: f64, // sol_in / tokens_out
}

#[derive(Debug, Clone, PartialEq)]
pub struct PumpSellQuote {
    pub tokens_in: u64,
    pub sol_out_gross: u64,
    pub fee_lamports: u64,
    pub sol_out_net: u64,
    pub spot_price_before: f64,
    pub spot_price_after: f64,
    pub effective_price: f64, // sol_out_net / tokens_in
}

#[derive(Debug, Clone, Default)]
pub struct StandardPumpCurveEngine;

impl StandardPumpCurveEngine {
    pub fn new() -> Self {
        Self
    }
}

impl PumpCurveEngine for StandardPumpCurveEngine {
    fn spot_price(&self, virtual_sol: u64, virtual_token: u64) -> f64 {
        if virtual_token == 0 {
            0.0
        } else {
            virtual_sol as f64 / virtual_token as f64
        }
    }

    fn quote_buy(
        &self,
        virtual_sol: u64,
        virtual_token: u64,
        sol_in_lamports: u64,
    ) -> Result<PumpBuyQuote, EconomicError> {
        if virtual_sol == 0 || virtual_token == 0 {
            return Err(EconomicError::InsufficientLiquidity {
                reserve_lamports: virtual_sol,
                min_required: 1,
            });
        }
        if sol_in_lamports == 0 {
            return Err(EconomicError::SizeBelowMinimumFloor {
                size_lamports: 0,
                min_lamports: 1,
            });
        }

        let spot_price_before = self.spot_price(virtual_sol, virtual_token);

        let sol_in_u128 = sol_in_lamports as u128;
        let fee_lamports = ((sol_in_u128 * PUMP_FEE_BPS as u128) / 10_000) as u64;
        let sol_into_curve = sol_in_lamports.saturating_sub(fee_lamports);

        let v_sol = virtual_sol as u128;
        let v_token = virtual_token as u128;
        let sol_net = sol_into_curve as u128;

        // k = v_sol * v_token
        let k = v_sol.checked_mul(v_token).ok_or(EconomicError::MathOverflow)?;
        let new_v_sol = v_sol.checked_add(sol_net).ok_or(EconomicError::MathOverflow)?;
        let new_v_token = k / new_v_sol;

        let tokens_out_u128 = v_token.saturating_sub(new_v_token);
        if tokens_out_u128 == 0 {
            return Err(EconomicError::MathOverflow);
        }
        let tokens_out = tokens_out_u128 as u64;

        let spot_price_after = self.spot_price(new_v_sol as u64, new_v_token as u64);
        let effective_price = sol_in_lamports as f64 / tokens_out as f64;

        Ok(PumpBuyQuote {
            sol_in: sol_in_lamports,
            fee_lamports,
            sol_into_curve,
            tokens_out,
            spot_price_before,
            spot_price_after,
            effective_price,
        })
    }

    fn quote_sell(
        &self,
        virtual_sol: u64,
        virtual_token: u64,
        tokens_in: u64,
    ) -> Result<PumpSellQuote, EconomicError> {
        if virtual_sol == 0 || virtual_token == 0 {
            return Err(EconomicError::InsufficientLiquidity {
                reserve_lamports: virtual_sol,
                min_required: 1,
            });
        }
        if tokens_in == 0 {
            return Err(EconomicError::SizeBelowMinimumFloor {
                size_lamports: 0,
                min_lamports: 1,
            });
        }

        let spot_price_before = self.spot_price(virtual_sol, virtual_token);

        let v_sol = virtual_sol as u128;
        let v_token = virtual_token as u128;
        let t_in = tokens_in as u128;

        let k = v_sol.checked_mul(v_token).ok_or(EconomicError::MathOverflow)?;
        let new_v_token = v_token.checked_add(t_in).ok_or(EconomicError::MathOverflow)?;
        let new_v_sol = k / new_v_token;

        let sol_out_gross_u128 = v_sol.saturating_sub(new_v_sol);
        let sol_out_gross = sol_out_gross_u128 as u64;

        let fee_lamports = ((sol_out_gross_u128 * PUMP_FEE_BPS as u128) / 10_000) as u64;
        let sol_out_net = sol_out_gross.saturating_sub(fee_lamports);

        let spot_price_after = self.spot_price(new_v_sol as u64, new_v_token as u64);
        let effective_price = if tokens_in == 0 {
            0.0
        } else {
            sol_out_net as f64 / tokens_in as f64
        };

        Ok(PumpSellQuote {
            tokens_in,
            sol_out_gross,
            fee_lamports,
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
    fn test_pump_buy_quote_standard() {
        let engine = StandardPumpCurveEngine::new();
        let sol_in = 1_000_000_000; // 1 SOL

        let quote = engine
            .quote_buy(
                PUMP_INITIAL_VIRTUAL_SOL,
                PUMP_INITIAL_VIRTUAL_TOKEN,
                sol_in,
            )
            .expect("Quote buy should succeed");

        assert_eq!(quote.sol_in, 1_000_000_000);
        assert_eq!(quote.fee_lamports, 10_000_000); // 1% of 1 SOL = 0.01 SOL
        assert_eq!(quote.sol_into_curve, 990_000_000);
        assert!(quote.tokens_out > 0);
        assert!(quote.spot_price_after > quote.spot_price_before);
    }

    #[test]
    fn test_pump_sell_quote_standard() {
        let engine = StandardPumpCurveEngine::new();
        // First buy some tokens
        let buy_quote = engine
            .quote_buy(
                PUMP_INITIAL_VIRTUAL_SOL,
                PUMP_INITIAL_VIRTUAL_TOKEN,
                1_000_000_000,
            )
            .unwrap();

        let new_v_sol = PUMP_INITIAL_VIRTUAL_SOL + buy_quote.sol_into_curve;
        let new_v_token = PUMP_INITIAL_VIRTUAL_TOKEN - buy_quote.tokens_out;

        // Sell back all acquired tokens
        let sell_quote = engine
            .quote_sell(new_v_sol, new_v_token, buy_quote.tokens_out)
            .expect("Quote sell should succeed");

        assert_eq!(sell_quote.tokens_in, buy_quote.tokens_out);
        assert!(sell_quote.sol_out_gross <= buy_quote.sol_into_curve + 1); // constant product conservation
        assert!(sell_quote.sol_out_net < buy_quote.sol_in); // net after two 1% fees
    }
}
