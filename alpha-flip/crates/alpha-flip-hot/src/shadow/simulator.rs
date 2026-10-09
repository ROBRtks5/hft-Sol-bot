use crate::clock::SlotClock;
use crate::economics::fee_model::{
    DexProtocol, FeeModel, JitoTipTier, BASE_SOLANA_SIGNATURE_FEE, RENT_EXEMPT_ATA_LAMPORTS,
};
use crate::economics::quote_engine::{QuoteEngine, QuoteRequest, QuoteResult};
use crate::errors::HotError;
use crate::events::TradeSide;
use crate::position::PositionState;
use crate::shadow::pnl_model::{ShadowPnlModel, ShadowPnlReport, ShadowTradeRecord, SimulatedFrictionCost};
use crate::types::{Lamports, Mint, Slot, TokenAmount};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, info, warn};

/// Configuration for realistic shadow simulation
#[derive(Debug, Clone)]
pub struct ShadowSimulatorConfig {
    /// Initial simulated bankroll in Lamports (default 10 SOL)
    pub initial_bankroll_lamports: u64,
    /// Probability that a simulated Jito bundle fails to land (e.g. 0.08 = 8%)
    pub bundle_miss_rate: f64,
    /// Number of slots delayed between signal and fill (e.g. 1 slot)
    pub execution_delay_slots: u64,
    /// Base tip amount per trade (e.g. 0.005 SOL)
    pub jito_tip_lamports: u64,
    /// Adverse slippage buffer in basis points (e.g. 35 bps)
    pub adverse_movement_buffer_bps: u16,
    /// Maximum allowable position size relative to pool liquidity (e.g. 0.05 = 5%)
    pub max_pool_share: f64,
}

impl Default for ShadowSimulatorConfig {
    fn default() -> Self {
        Self {
            initial_bankroll_lamports: 10_000_000_000,
            bundle_miss_rate: 0.05, // 5% bundle drop probability
            execution_delay_slots: 1,
            jito_tip_lamports: 5_000_000, // 0.005 SOL
            adverse_movement_buffer_bps: 40,
            max_pool_share: 0.05,
        }
    }
}

/// Simulated active position tracked by the Shadow Simulator
#[derive(Debug, Clone)]
pub struct ShadowActivePosition {
    pub mint: Mint,
    pub entry_slot: Slot,
    pub fill_slot: Slot,
    pub target_size_lamports: u64,
    pub filled_sol_lamports: u64,
    pub token_amount: TokenAmount,
    pub remaining_tokens: TokenAmount,
    pub entry_price: f64,
    pub entry_friction: SimulatedFrictionCost,
    pub tier1_sold: bool,
    pub partial_proceeds_lamports: u64,
}

/// Production shadow trading simulator running MODE_SHADOW without on-chain execution
pub struct ShadowSimulator {
    pub config: ShadowSimulatorConfig,
    pub clock: Arc<SlotClock>,
    pub quote_engine: QuoteEngine,
    pub fee_model: FeeModel,
    pub pnl_model: ShadowPnlModel,
    pub active_position: Option<ShadowActivePosition>,
    pub pseudo_random_seed: u64,
}

impl ShadowSimulator {
    pub fn new(clock: Arc<SlotClock>, config: ShadowSimulatorConfig) -> Self {
        Self {
            config,
            clock,
            quote_engine: QuoteEngine::default(),
            fee_model: FeeModel::default(),
            pnl_model: ShadowPnlModel::new(),
            active_position: None,
            pseudo_random_seed: 0xDEADBEEF,
        }
    }

    /// Pseudo-random uniform float in [0.0, 1.0) for deterministic simulation
    fn next_rand_f64(&mut self) -> f64 {
        self.pseudo_random_seed ^= self.pseudo_random_seed << 13;
        self.pseudo_random_seed ^= self.pseudo_random_seed >> 7;
        self.pseudo_random_seed ^= self.pseudo_random_seed << 17;
        ((self.pseudo_random_seed % 10_000) as f64) / 10_000.0
    }

    /// Check if currently holding an active shadow position
    pub fn has_active_position(&self) -> bool {
        self.active_position.is_some()
    }

    /// Attempt simulated buy fill enforcing liquidity constraints, adverse drift, and miss probability
    pub fn simulate_buy_order(
        &mut self,
        mint: Mint,
        requested_sol_lamports: u64,
        pool_sol_reserves: u64,
        pool_token_reserves: u64,
        protocol: DexProtocol,
    ) -> Result<Option<ShadowActivePosition>, HotError> {
        if self.active_position.is_some() {
            return Ok(None); // Strict 1-position limit
        }

        let current_slot = self.clock.current_slot();
        let fill_slot = current_slot + self.config.execution_delay_slots;

        // 1. Model bundle landing failure
        let rand_val = self.next_rand_f64();
        if rand_val < self.config.bundle_miss_rate {
            warn!("Shadow Simulator: Simulated Jito buy bundle dropped (miss rate triggered)");
            return Ok(None);
        }

        // 2. Model pool liquidity caps: if pool liquidity is too small, fill is rejected
        if pool_sol_reserves < 10_000_000_000 {
            warn!("Shadow Simulator: Insufficient liquidity (pool < 10 SOL)");
            return Ok(None);
        }

        // 3. Model partial fill if requested size exceeds maximum acceptable pool share
        let max_fillable_sol = (pool_sol_reserves as f64 * self.config.max_pool_share) as u64;
        let actual_size_lamports = requested_sol_lamports.min(max_fillable_sol);

        // 4. Calculate quotes using QuoteEngine
        let quote_req = QuoteRequest {
            protocol,
            reserve_sol_lamports: pool_sol_reserves,
            reserve_token: pool_token_reserves,
            amount_in: actual_size_lamports,
            slippage_bps: Some(150),
        };

        let quote_res = self
            .quote_engine
            .calculate_buy_quote(&quote_req)
            .map_err(|e| HotError::Economic(e.to_string()))?;

        // 5. Apply adverse price movement buffer between trigger slot and execution slot
        let adverse_penalty_multiplier =
            1.0 - (self.config.adverse_movement_buffer_bps as f64 / 10_000.0);
        let delivered_tokens = (quote_res.output_amount as f64 * adverse_penalty_multiplier) as u64;

        if delivered_tokens == 0 {
            return Ok(None);
        }

        // 6. Calculate realistic entry friction costs
        let entry_friction = SimulatedFrictionCost {
            entry_tip_lamports: self.config.jito_tip_lamports,
            exit_tip_lamports: 0,
            base_network_fees_lamports: BASE_SOLANA_SIGNATURE_FEE * 2,
            priority_fees_lamports: 200_000,
            ata_rent_lamports: RENT_EXEMPT_ATA_LAMPORTS,
            dex_fees_lamports: quote_res.fee_cost_lamports,
            price_impact_cost_lamports: ((actual_size_lamports as f64)
                * (quote_res.price_impact_pct / 100.0)) as u64,
        };

        let effective_price = actual_size_lamports as f64 / delivered_tokens as f64;

        let active_pos = ShadowActivePosition {
            mint,
            entry_slot: current_slot,
            fill_slot,
            target_size_lamports: requested_sol_lamports,
            filled_sol_lamports: actual_size_lamports,
            token_amount: TokenAmount::new(delivered_tokens),
            remaining_tokens: TokenAmount::new(delivered_tokens),
            entry_price: effective_price,
            entry_friction,
            tier1_sold: false,
            partial_proceeds_lamports: 0,
        };

        self.active_position = Some(active_pos.clone());
        info!(
            "Shadow Simulator: Position OPENED for {} ({} tokens for {} SOL)",
            mint, delivered_tokens, actual_size_lamports as f64 / 1e9
        );

        Ok(Some(active_pos))
    }

    /// Simulate ladder sell or emergency liquidation using future market ticks
    pub fn simulate_sell_order(
        &mut self,
        tokens_to_sell: TokenAmount,
        pool_sol_reserves: u64,
        pool_token_reserves: u64,
        protocol: DexProtocol,
        exit_reason: &str,
    ) -> Result<Option<ShadowTradeRecord>, HotError> {
        let pos = match self.active_position.as_mut() {
            Some(p) => p,
            None => return Ok(None),
        };

        let current_slot = self.clock.current_slot();
        let tokens_selling = tokens_to_sell.as_u64().min(pos.remaining_tokens.as_u64());

        if tokens_selling == 0 {
            return Ok(None);
        }

        // Calculate sell quote
        let quote_req = QuoteRequest {
            protocol,
            reserve_sol_lamports: pool_sol_reserves,
            reserve_token: pool_token_reserves,
            amount_in: tokens_selling,
            slippage_bps: Some(250),
        };

        let quote_res = self
            .quote_engine
            .calculate_sell_quote(&quote_req)
            .map_err(|e| HotError::Economic(e.to_string()))?;

        // Apply adverse impact penalty
        let adverse_penalty = 1.0 - (self.config.adverse_movement_buffer_bps as f64 / 10_000.0);
        let gross_sol_out = (quote_res.output_amount as f64 * adverse_penalty) as u64;

        let exit_friction = SimulatedFrictionCost {
            entry_tip_lamports: 0,
            exit_tip_lamports: self.config.jito_tip_lamports,
            base_network_fees_lamports: BASE_SOLANA_SIGNATURE_FEE * 2,
            priority_fees_lamports: 200_000,
            ata_rent_lamports: 0,
            dex_fees_lamports: quote_res.fee_cost_lamports,
            price_impact_cost_lamports: ((gross_sol_out as f64)
                * (quote_res.price_impact_pct / 100.0)) as u64,
        };

        pos.remaining_tokens = TokenAmount::new(pos.remaining_tokens.as_u64().saturating_sub(tokens_selling));
        pos.partial_proceeds_lamports = pos.partial_proceeds_lamports.saturating_add(gross_sol_out);

        // If remaining tokens are 0, close position and record completed trade
        if pos.remaining_tokens.as_u64() == 0 {
            let total_proceeds = pos.partial_proceeds_lamports;
            let total_entry_sol = pos.filled_sol_lamports;
            let hold_duration = current_slot.saturating_sub(pos.entry_slot);

            let mut aggregate_friction = pos.entry_friction.clone();
            aggregate_friction.exit_tip_lamports += exit_friction.exit_tip_lamports;
            aggregate_friction.base_network_fees_lamports += exit_friction.base_network_fees_lamports;
            aggregate_friction.priority_fees_lamports += exit_friction.priority_fees_lamports;
            aggregate_friction.dex_fees_lamports += exit_friction.dex_fees_lamports;
            aggregate_friction.price_impact_cost_lamports += exit_friction.price_impact_cost_lamports;

            let gross_pnl = (total_proceeds as i64) - (total_entry_sol as i64);
            let net_pnl = gross_pnl - (aggregate_friction.total_friction_lamports() as i64);
            let net_roi_bps = (((net_pnl as f64) / (total_entry_sol as f64)) * 10_000.0) as i32;

            let trade_record = ShadowTradeRecord {
                trade_id: format!("shadow_{}_{}", pos.mint, current_slot),
                mint: pos.mint.to_string(),
                entry_slot: pos.entry_slot.as_u64(),
                exit_slot: current_slot.as_u64(),
                hold_duration_slots: hold_duration,
                gross_entry_sol_lamports: total_entry_sol,
                gross_exit_proceeds_lamports: total_proceeds,
                friction: aggregate_friction,
                gross_pnl_lamports: gross_pnl,
                net_pnl_lamports: net_pnl,
                net_roi_bps,
                landed_successfully: true,
                exit_reason: exit_reason.to_string(),
            };

            self.pnl_model.record_trade(trade_record.clone());
            self.active_position = None;

            info!(
                "Shadow Simulator: Position CLOSED for {} (Net PnL: {:.4} SOL, ROI: {} bps)",
                trade_record.mint,
                net_pnl as f64 / 1e9,
                net_roi_bps
            );

            return Ok(Some(trade_record));
        }

        Ok(None)
    }

    /// Access consolidated PnL statistics
    pub fn generate_report(&self) -> ShadowPnlReport {
        self.pnl_model.generate_report()
    }
}
