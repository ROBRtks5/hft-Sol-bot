use crate::economics::quote_engine::{QuoteEngine, QuoteRequest};
use crate::errors::ExitError;
use crate::events::TradeSide;
use crate::exit::adverse_selection::AdverseSelectionDetector;
use crate::exit::emergency::EmergencyExitEngine;
use crate::exit::ladder_controller::LadderController;
use crate::exit::ofi::OrderFlowImbalanceTracker;
use crate::exit::smart_money_dump::SmartMoneyDumpDetector;
use crate::exit::time_stop::{MarketScenario, ScenarioTimeStop};
use crate::exit::velocity::PriceVelocityTracker;
use crate::position::PositionState;
use crate::types::{Lamports, Slot, TokenAmount};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExitAction {
    Hold,
    SellTier1,
    SellTier2,
    FullExit,
    EmergencyExit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum ExitUrgency {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExitDecision {
    pub action: ExitAction,
    pub reason: String,
    pub tokens_to_sell: TokenAmount,
    pub expected_proceeds_lamports: u64,
    pub impact_bps: u16,
    pub urgency: ExitUrgency,
    pub min_acceptable_proceeds_lamports: u64,
}

#[derive(Debug, Clone)]
pub struct ExitEvaluationContext {
    pub current_slot: Slot,
    pub current_spot_price: f64,
    pub pool_virtual_sol_reserves: u64,
    pub pool_virtual_token_reserves: u64,
    pub peak_pool_sol_reserves: u64,
    pub scenario: MarketScenario,
    pub dev_dump_detected: bool,
    pub grpc_drift_detected: bool,
    pub execution_failure_detected: bool,
    pub recent_consecutive_sells: u32,
    pub recent_sell_volume_lamports: u64,
    pub current_cabal_score: u8,
    pub entry_cabal_score: u8,
    pub has_pending_exit_in_flight: bool,
}

pub struct SyntheticOrderEngine {
    pub ladder: LadderController,
    pub ofi_tracker: OrderFlowImbalanceTracker,
    pub velocity_tracker: PriceVelocityTracker,
    pub time_stop: ScenarioTimeStop,
    pub emergency_engine: EmergencyExitEngine,
    pub adverse_detector: AdverseSelectionDetector,
    pub smart_money_detector: SmartMoneyDumpDetector,
    pub quote_engine: QuoteEngine,
    pub trailing_stop_bps: u16, // e.g. 200 bps (2.0%) pullback from peak
    pub peak_pnl_bps: i32,
}

impl SyntheticOrderEngine {
    pub fn new(
        position: &PositionState,
        quote_engine: QuoteEngine,
        trailing_stop_bps: u16,
    ) -> Self {
        Self {
            ladder: LadderController::new(
                position.token_amount,
                3000, // +30% for Tier 1
                50,   // sell 50%
                6000, // +60% for Tier 2
                30,   // sell 30%
            ),
            ofi_tracker: OrderFlowImbalanceTracker::default(),
            velocity_tracker: PriceVelocityTracker::default(),
            time_stop: ScenarioTimeStop::default(),
            emergency_engine: EmergencyExitEngine::default(),
            adverse_detector: AdverseSelectionDetector::default(),
            smart_money_detector: SmartMoneyDumpDetector::default(),
            quote_engine,
            trailing_stop_bps,
            peak_pnl_bps: 0,
        }
    }

    /// Calculate profit in basis points relative to entry price
    pub fn calculate_pnl_bps(entry_price: f64, current_price: f64) -> i32 {
        if entry_price <= 0.0 {
            0
        } else {
            (((current_price - entry_price) / entry_price) * 10_000.0) as i32
        }
    }

    /// Main evaluation loop for open position
    pub fn evaluate_exit(
        &mut self,
        position: &PositionState,
        ctx: &ExitEvaluationContext,
    ) -> Result<ExitDecision, ExitError> {
        // INVARIANT 1: Double-sell protection. If a pending signature/bundle is in-flight, HOLD!
        if ctx.has_pending_exit_in_flight {
            return Err(ExitError::PendingExitInFlight {
                mint: position.mint.to_string(),
            });
        }

        // INVARIANT 2: Check remaining balance
        if position.remaining_token_amount.as_u64() == 0 {
            return Err(ExitError::NoOpenPosition);
        }

        let current_pnl_bps =
            Self::calculate_pnl_bps(position.entry_price, ctx.current_spot_price);
        if current_pnl_bps > self.peak_pnl_bps {
            self.peak_pnl_bps = current_pnl_bps;
        }

        // Update velocity tracker
        self.velocity_tracker
            .record_price(ctx.current_slot, ctx.current_spot_price);

        // ==========================================
        // 1. EMERGENCY EXIT (Highest Priority)
        // Overrides any ladder or hold decision
        // ==========================================
        let adverse_check = self.adverse_detector.evaluate_adverse_selection(
            position.opened_slot,
            ctx.current_slot,
            ctx.recent_sell_volume_lamports,
            ctx.recent_consecutive_sells,
            25,
            10,
            ctx.entry_cabal_score,
            ctx.current_cabal_score,
        );
        let adverse_str = adverse_check.map(|r| format!("{:?}", r));

        if let Some(emergency_reason) = self.emergency_engine.check_emergency_tripwires(
            current_pnl_bps,
            ctx.pool_virtual_sol_reserves,
            ctx.peak_pool_sol_reserves,
            ctx.dev_dump_detected,
            None,
            adverse_str.clone(),
            ctx.grpc_drift_detected,
            ctx.execution_failure_detected,
        ) {
            let quote = self.quote_sell_amount(position.remaining_token_amount, ctx)?;
            return Ok(ExitDecision {
                action: ExitAction::EmergencyExit,
                reason: format!("EMERGENCY TRIPWIRE: {:?}", emergency_reason),
                tokens_to_sell: position.remaining_token_amount,
                expected_proceeds_lamports: quote.expected_sol,
                impact_bps: quote.impact_bps,
                urgency: ExitUrgency::Critical,
                min_acceptable_proceeds_lamports: quote.min_out_sol,
            });
        }

        // ==========================================
        // 2. TRAILING STOP LOSS (When peak PnL > 10%)
        // ==========================================
        if self.peak_pnl_bps >= 1000 {
            let drawdown_from_peak = self.peak_pnl_bps - current_pnl_bps;
            if drawdown_from_peak >= self.trailing_stop_bps as i32 {
                let quote = self.quote_sell_amount(position.remaining_token_amount, ctx)?;
                return Ok(ExitDecision {
                    action: ExitAction::FullExit,
                    reason: format!(
                        "Trailing stop hit: peak +{} bps, current +{} bps (drop {} bps >= {})",
                        self.peak_pnl_bps, current_pnl_bps, drawdown_from_peak, self.trailing_stop_bps
                    ),
                    tokens_to_sell: position.remaining_token_amount,
                    expected_proceeds_lamports: quote.expected_sol,
                    impact_bps: quote.impact_bps,
                    urgency: ExitUrgency::High,
                    min_acceptable_proceeds_lamports: quote.min_out_sol,
                });
            }
        }

        // ==========================================
        // 3. TAKE-PROFIT LADDER (Tier 1 & Tier 2)
        // ==========================================
        if self.ladder.is_tier1_triggered(current_pnl_bps) {
            let tokens_to_sell = self.ladder.calculate_tier_sell_amount(1)?;
            let quote = self.quote_sell_amount(tokens_to_sell, ctx)?;
            return Ok(ExitDecision {
                action: ExitAction::SellTier1,
                reason: format!("TP Tier 1 target reached (+{} bps)", current_pnl_bps),
                tokens_to_sell,
                expected_proceeds_lamports: quote.expected_sol,
                impact_bps: quote.impact_bps,
                urgency: ExitUrgency::High,
                min_acceptable_proceeds_lamports: quote.min_out_sol,
            });
        }

        if self.ladder.is_tier2_triggered(current_pnl_bps) {
            let tokens_to_sell = self.ladder.calculate_tier_sell_amount(2)?;
            let quote = self.quote_sell_amount(tokens_to_sell, ctx)?;
            return Ok(ExitDecision {
                action: ExitAction::SellTier2,
                reason: format!("TP Tier 2 target reached (+{} bps)", current_pnl_bps),
                tokens_to_sell,
                expected_proceeds_lamports: quote.expected_sol,
                impact_bps: quote.impact_bps,
                urgency: ExitUrgency::High,
                min_acceptable_proceeds_lamports: quote.min_out_sol,
            });
        }

        // ==========================================
        // 4. OFI & VELOCITY DECAY EXIT
        // ==========================================
        let ofi = self.ofi_tracker.short_ofi(ctx.current_slot);
        if self.velocity_tracker.is_velocity_decay_confirmed(
            ctx.current_slot,
            ofi,
            ctx.recent_consecutive_sells,
            3,
        ) {
            let quote = self.quote_sell_amount(position.remaining_token_amount, ctx)?;
            return Ok(ExitDecision {
                action: ExitAction::FullExit,
                reason: format!("Momentum velocity decay confirmed: OFI={:.2}, sells={}", ofi, ctx.recent_consecutive_sells),
                tokens_to_sell: position.remaining_token_amount,
                expected_proceeds_lamports: quote.expected_sol,
                impact_bps: quote.impact_bps,
                urgency: ExitUrgency::High,
                min_acceptable_proceeds_lamports: quote.min_out_sol,
            });
        }

        // ==========================================
        // 5. SCENARIO TIME-STOP EXIT
        // ==========================================
        if let Some(time_reason) = self.time_stop.check_time_stop(
            position.opened_slot,
            ctx.current_slot,
            current_pnl_bps,
            ctx.scenario,
        ) {
            let quote = self.quote_sell_amount(position.remaining_token_amount, ctx)?;
            return Ok(ExitDecision {
                action: ExitAction::FullExit,
                reason: format!("Time stop triggered: {:?}", time_reason),
                tokens_to_sell: position.remaining_token_amount,
                expected_proceeds_lamports: quote.expected_sol,
                impact_bps: quote.impact_bps,
                urgency: ExitUrgency::Medium,
                min_acceptable_proceeds_lamports: quote.min_out_sol,
            });
        }

        // Default: Hold
        Ok(ExitDecision {
            action: ExitAction::Hold,
            reason: format!("Holding position: PnL +{} bps", current_pnl_bps),
            tokens_to_sell: TokenAmount::ZERO,
            expected_proceeds_lamports: 0,
            impact_bps: 0,
            urgency: ExitUrgency::Low,
            min_acceptable_proceeds_lamports: 0,
        })
    }

    /// Internal quote calculation helper
    fn quote_sell_amount(
        &self,
        amount: TokenAmount,
        ctx: &ExitEvaluationContext,
    ) -> Result<SellQuoteResult, ExitError> {
        let req = QuoteRequest {
            side: TradeSide::Sell,
            amount: amount.as_u64(),
            virtual_sol_reserves: ctx.pool_virtual_sol_reserves,
            virtual_token_reserves: ctx.pool_virtual_token_reserves,
            is_pump_curve: true,
            current_volatility_pct: 0.15,
            current_momentum_bps: 50,
        };

        let res = self
            .quote_engine
            .quote_sell(&req)
            .map_err(|e| ExitError::QuoteFailed {
                reason: e.to_string(),
            })?;

        Ok(SellQuoteResult {
            expected_sol: res.output_amount,
            min_out_sol: res.min_out,
            impact_bps: res.price_impact_bps,
        })
    }
}

struct SellQuoteResult {
    pub expected_sol: u64,
    pub min_out_sol: u64,
    pub impact_bps: u16,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Mint, Signature};

    #[test]
    fn test_synthetic_order_engine_emergency_overrides_ladder() {
        let mint = Mint::new_unique();
        let pos = PositionState::new(
            mint,
            0.000100,
            Lamports::new(1_000_000_000),
            TokenAmount::new(10_000_000_000),
            Slot(100),
            Signature::default(),
        )
        .unwrap();

        let quote_engine = QuoteEngine::default();
        let mut engine = SyntheticOrderEngine::new(&pos, quote_engine, 200);

        let ctx = ExitEvaluationContext {
            current_slot: Slot(110),
            current_spot_price: 0.000140, // +40% profit (Tier 1 is eligible!)
            pool_virtual_sol_reserves: 30_000_000_000,
            pool_virtual_token_reserves: 1_000_000_000_000_000,
            peak_pool_sol_reserves: 30_000_000_000,
            scenario: MarketScenario::FreshPump,
            dev_dump_detected: true, // But dev dump occurred!
            grpc_drift_detected: false,
            execution_failure_detected: false,
            recent_consecutive_sells: 2,
            recent_sell_volume_lamports: 500_000_000,
            current_cabal_score: 15,
            entry_cabal_score: 15,
            has_pending_exit_in_flight: false,
        };

        let decision = engine.evaluate_exit(&pos, &ctx).unwrap();
        // Emergency exit must override Tier 1 ladder
        assert_eq!(decision.action, ExitAction::EmergencyExit);
        assert_eq!(decision.urgency, ExitUrgency::Critical);
        assert_eq!(decision.tokens_to_sell, pos.remaining_token_amount);
    }

    #[test]
    fn test_no_double_sell_when_pending_in_flight() {
        let mint = Mint::new_unique();
        let pos = PositionState::new(
            mint,
            0.000100,
            Lamports::new(1_000_000_000),
            TokenAmount::new(10_000_000_000),
            Slot(100),
            Signature::default(),
        )
        .unwrap();

        let quote_engine = QuoteEngine::default();
        let mut engine = SyntheticOrderEngine::new(&pos, quote_engine, 200);

        let ctx = ExitEvaluationContext {
            current_slot: Slot(110),
            current_spot_price: 0.000140,
            pool_virtual_sol_reserves: 30_000_000_000,
            pool_virtual_token_reserves: 1_000_000_000_000_000,
            peak_pool_sol_reserves: 30_000_000_000,
            scenario: MarketScenario::FreshPump,
            dev_dump_detected: false,
            grpc_drift_detected: false,
            execution_failure_detected: false,
            recent_consecutive_sells: 0,
            recent_sell_volume_lamports: 0,
            current_cabal_score: 15,
            entry_cabal_score: 15,
            has_pending_exit_in_flight: true, // Pending exit in flight!
        };

        let res = engine.evaluate_exit(&pos, &ctx);
        assert!(matches!(res, Err(ExitError::PendingExitInFlight { .. })));
    }
}
