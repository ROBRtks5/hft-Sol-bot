use crate::economics::fee_model::{DexProtocol, FeeModel};
use crate::economics::impact_model::PriceImpactModel;
use crate::economics::min_out::MinOutCalculator;
use crate::economics::pump_curve_math::{PumpCurveEngine, StandardPumpCurveEngine};
use crate::economics::raydium_math::{RaydiumAmmEngine, StandardRaydiumAmmEngine};
use crate::errors::EconomicError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct QuoteRequest {
    pub protocol: DexProtocol,
    pub reserve_sol_lamports: u64,
    pub reserve_token: u64,
    pub amount_in: u64, // SOL for buy, Token for sell
    pub slippage_bps: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QuoteResult {
    pub protocol: DexProtocol,
    pub input_amount: u64,
    pub output_amount: u64,
    pub average_price: f64,
    pub spot_price_before: f64,
    pub spot_price_after: f64,
    pub price_impact_bps: u16,
    pub price_impact_pct: f64,
    pub fee_cost_lamports: u64,
    pub min_out_recommendation: u64,
}

pub struct QuoteEngine {
    pub pump_engine: Box<dyn PumpCurveEngine>,
    pub raydium_engine: Box<dyn RaydiumAmmEngine>,
    pub impact_model: PriceImpactModel,
    pub fee_model: FeeModel,
    pub min_out_calculator: MinOutCalculator,
}

impl Default for QuoteEngine {
    fn default() -> Self {
        Self {
            pump_engine: Box::new(StandardPumpCurveEngine::new()),
            raydium_engine: Box::new(StandardRaydiumAmmEngine::new()),
            impact_model: PriceImpactModel::default(),
            fee_model: FeeModel::default(),
            min_out_calculator: MinOutCalculator::default(),
        }
    }
}

impl QuoteEngine {
    pub fn new(
        pump_engine: Box<dyn PumpCurveEngine>,
        raydium_engine: Box<dyn RaydiumAmmEngine>,
        impact_model: PriceImpactModel,
        fee_model: FeeModel,
        min_out_calculator: MinOutCalculator,
    ) -> Self {
        Self {
            pump_engine,
            raydium_engine,
            impact_model,
            fee_model,
            min_out_calculator,
        }
    }

    /// Produce a deterministic pre-execution buy quote for a given market
    pub fn quote_buy(&self, req: &QuoteRequest) -> Result<QuoteResult, EconomicError> {
        let (tokens_out, spot_before, spot_after, fee_lamports, eff_price) = match req.protocol {
            DexProtocol::PumpFun => {
                let quote = self.pump_engine.quote_buy(
                    req.reserve_sol_lamports,
                    req.reserve_token,
                    req.amount_in,
                )?;
                (
                    quote.tokens_out,
                    quote.spot_price_before,
                    quote.spot_price_after,
                    quote.fee_lamports,
                    quote.effective_price,
                )
            }
            DexProtocol::Raydium => {
                let quote = self.raydium_engine.quote_buy(
                    req.reserve_sol_lamports,
                    req.reserve_token,
                    req.amount_in,
                    req.protocol.swap_fee_bps(),
                )?;
                (
                    quote.tokens_out,
                    quote.spot_price_before,
                    quote.spot_price_after,
                    quote.fee_lamports,
                    quote.effective_price,
                )
            }
        };

        // Validate price impact
        let impact_bps = self.impact_model.evaluate_impact(spot_before, eff_price)?;
        let impact_pct = impact_bps as f64 / 100.0;

        let slippage = req
            .slippage_bps
            .unwrap_or(self.min_out_calculator.default_slippage_bps);
        let min_out = self
            .min_out_calculator
            .calculate_min_out(tokens_out, slippage);

        Ok(QuoteResult {
            protocol: req.protocol,
            input_amount: req.amount_in,
            output_amount: tokens_out,
            average_price: eff_price,
            spot_price_before: spot_before,
            spot_price_after: spot_after,
            price_impact_bps: impact_bps,
            price_impact_pct: impact_pct,
            fee_cost_lamports: fee_lamports,
            min_out_recommendation: min_out,
        })
    }

    /// Produce a deterministic pre-execution sell quote for a given market
    pub fn quote_sell(&self, req: &QuoteRequest) -> Result<QuoteResult, EconomicError> {
        let (sol_out_net, spot_before, spot_after, fee_lamports, eff_price) = match req.protocol {
            DexProtocol::PumpFun => {
                let quote = self.pump_engine.quote_sell(
                    req.reserve_sol_lamports,
                    req.reserve_token,
                    req.amount_in,
                )?;
                (
                    quote.sol_out_net,
                    quote.spot_price_before,
                    quote.spot_price_after,
                    quote.fee_lamports,
                    quote.effective_price,
                )
            }
            DexProtocol::Raydium => {
                let quote = self.raydium_engine.quote_sell(
                    req.reserve_sol_lamports,
                    req.reserve_token,
                    req.amount_in,
                    req.protocol.swap_fee_bps(),
                )?;
                // Raydium fee in tokens, calculate approx lamport equivalent
                let fee_lamports = (quote.fee_tokens as f64 * quote.spot_price_before) as u64;
                (
                    quote.sol_out_net,
                    quote.spot_price_before,
                    quote.spot_price_after,
                    fee_lamports,
                    quote.effective_price,
                )
            }
        };

        let impact_bps = self.impact_model.evaluate_impact(spot_before, eff_price)?;
        let impact_pct = impact_bps as f64 / 100.0;

        let slippage = req
            .slippage_bps
            .unwrap_or(self.min_out_calculator.default_slippage_bps);
        let min_out = self
            .min_out_calculator
            .calculate_min_out(sol_out_net, slippage);

        Ok(QuoteResult {
            protocol: req.protocol,
            input_amount: req.amount_in,
            output_amount: sol_out_net,
            average_price: eff_price,
            spot_price_before: spot_before,
            spot_price_after: spot_after,
            price_impact_bps: impact_bps,
            price_impact_pct: impact_pct,
            fee_cost_lamports: fee_lamports,
            min_out_recommendation: min_out,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::economics::pump_curve_math::{PUMP_INITIAL_VIRTUAL_SOL, PUMP_INITIAL_VIRTUAL_TOKEN};

    #[test]
    fn test_quote_engine_pump_buy() {
        let engine = QuoteEngine::default();
        let req = QuoteRequest {
            protocol: DexProtocol::PumpFun,
            reserve_sol_lamports: PUMP_INITIAL_VIRTUAL_SOL,
            reserve_token: PUMP_INITIAL_VIRTUAL_TOKEN,
            amount_in: 500_000_000, // 0.5 SOL
            slippage_bps: Some(100),
        };

        let res = engine.quote_buy(&req).unwrap();
        assert_eq!(res.protocol, DexProtocol::PumpFun);
        assert_eq!(res.input_amount, 500_000_000);
        assert!(res.output_amount > 0);
        assert!(res.min_out_recommendation < res.output_amount);
        assert_eq!(res.fee_cost_lamports, 5_000_000); // 1% of 0.5 SOL
    }
}
