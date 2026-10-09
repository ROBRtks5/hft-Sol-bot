use crate::clock::SlotClock;
use crate::decoder::{DecodedInstructionEvent, InstructionDecoder};
use crate::economics::{DexProtocol, EconomicEdgeGate, FeeModel, JitoTipTier, QuoteEngine, QuoteRequest};
use crate::events::{MarketState, TradeEvent, TradeSide};
use crate::exit::synthetic_order_engine::{ExitAction, ExitDecision, ExitEvaluationContext, SyntheticOrderEngine};
use crate::grpc::transport::{AccountUpdateFrame, SlotUpdateFrame, TransactionUpdateFrame};
use crate::orchestrator::mode::OperatingMode;
use crate::position::journal::PositionJournal;
use crate::position::manager::PositionManager;
use crate::position::state::{PositionExitState, PositionState};
use crate::replay::loader::ReplayFrame;
use crate::risk::{OrganicScorer, RiskSnapshot, SmartMoneyRegistry};
use crate::state::token_runtime::TokenRuntime;
use crate::types::{Lamports, Mint, Pubkey, Signature, Slot, TokenAmount};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;
use tracing::{debug, info, warn};

/// Replay execution statistics and audit trail
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReplaySummary {
    pub total_frames_processed: usize,
    pub starting_slot: Slot,
    pub ending_slot: Slot,
    pub slots_advanced: u64,
    pub transactions_decoded: usize,
    pub trades_detected: usize,
    pub pump_trades: usize,
    pub raydium_swaps: usize,
    pub signals_evaluated: usize,
    pub edge_approvals: usize,
    pub edge_rejections: usize,
    pub simulated_buys: usize,
    pub simulated_sells: usize,
    pub simulated_emergency_exits: usize,
    pub total_simulated_realized_pnl_lamports: i64,
    pub net_roi_bps: i32,
    pub max_drawdown_lamports: u64,
    pub tokens_tracked: usize,
    pub final_positions_open: usize,
}

/// Decision log item emitted during replay
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayDecisionLog {
    pub slot: Slot,
    pub mint: Mint,
    pub event_kind: String,
    pub details: String,
    pub sol_amount: Option<u64>,
    pub pnl_lamports: Option<i64>,
}

/// Deterministic replay runner executing entire pipeline on logical slot clock
pub struct ReplayRunner {
    pub clock: Arc<SlotClock>,
    pub decoder: InstructionDecoder,
    pub tokens: HashMap<Mint, TokenRuntime>,
    pub position_manager: PositionManager,
    pub edge_gate: EconomicEdgeGate,
    pub fee_model: FeeModel,
    pub quote_engine: QuoteEngine,
    pub organic_scorer: OrganicScorer,
    pub smart_money_registry: SmartMoneyRegistry,
    pub mode: OperatingMode,
    pub summary: ReplaySummary,
    pub decision_logs: Vec<ReplayDecisionLog>,
    pub max_position_sol: u64,
    pub trailing_stop_bps: u16,
    pub peak_portfolio_sol: u64,
}

impl ReplayRunner {
    pub fn new(mode: OperatingMode) -> Self {
        let journal = PositionJournal::in_memory();
        let position_manager = PositionManager::new(journal);

        Self {
            clock: Arc::new(SlotClock::default()),
            decoder: InstructionDecoder::default(),
            tokens: HashMap::new(),
            position_manager,
            edge_gate: EconomicEdgeGate::default(),
            fee_model: FeeModel::default(),
            quote_engine: QuoteEngine::default(),
            organic_scorer: OrganicScorer::default(),
            smart_money_registry: SmartMoneyRegistry::default(),
            mode,
            summary: ReplaySummary::default(),
            decision_logs: Vec::new(),
            max_position_sol: 1_000_000_000, // 1.0 SOL default
            trailing_stop_bps: 200,          // 2.0% trailing stop
            peak_portfolio_sol: 0,
        }
    }

    /// Process loaded replay frames in sequence with deterministic logical slot progression
    pub fn run(&mut self, frames: &[ReplayFrame]) -> ReplaySummary {
        if frames.is_empty() {
            return self.summary.clone();
        }

        self.summary.total_frames_processed = frames.len();
        self.summary.starting_slot = frames[0].slot();
        self.clock.advance_to(self.summary.starting_slot);

        for frame in frames {
            let frame_slot = frame.slot();
            if frame_slot > self.clock.current_slot() {
                self.clock.advance_to(frame_slot);
            }

            match frame {
                ReplayFrame::Slot(slot_update) => {
                    self.handle_slot_update(slot_update);
                }
                ReplayFrame::Account(account_update) => {
                    self.handle_account_update(account_update);
                }
                ReplayFrame::Transaction(tx_update) => {
                    self.handle_transaction_update(tx_update);
                }
            }
        }

        let ending_slot = self.clock.current_slot();
        self.summary.ending_slot = ending_slot;
        self.summary.slots_advanced = ending_slot.saturating_sub(self.summary.starting_slot);
        self.summary.tokens_tracked = self.tokens.len();
        self.summary.final_positions_open = if self.position_manager.can_open_new_position() {
            0
        } else {
            1
        };

        self.summary.clone()
    }

    fn handle_slot_update(&mut self, update: &SlotUpdateFrame) {
        self.clock.advance_to(update.slot);

        // Bounded memory protection: prune inactive tokens if tracking map grows too large
        let current_slot = self.clock.current_slot();
        if self.tokens.len() > 10_000 {
            let active_mint = self.position_manager.active_position().map(|p| p.mint);
            self.tokens.retain(|mint, token| {
                if Some(*mint) == active_mint {
                    return true;
                }
                current_slot.saturating_sub(token.last_slot) < 1_500
            });
        }

        // Bounded memory protection: cap decision_logs buffer
        if self.decision_logs.len() > 20_000 {
            let drain_count = self.decision_logs.len() - 10_000;
            self.decision_logs.drain(0..drain_count);
        }

        // Check time-stops for any currently active position
        if let Some(pos) = self.position_manager.active_position().cloned() {
            let elapsed_slots = current_slot.saturating_sub(pos.opened_slot);
            // Time stop: Max 450 slots (~180s)
            if elapsed_slots > 450 && pos.remaining_token_amount.as_u64() > 0 {
                self.execute_replay_sell(
                    pos.mint,
                    pos.remaining_token_amount,
                    "MaxHoldSlotsExceeded",
                    true,
                );
            }
        }
    }

    fn handle_account_update(&mut self, update: &AccountUpdateFrame) {
        // Update reserves if matching token bonding curve or Raydium AMM
        let slot = update.slot;
        let write_version = update.write_version;
        for token in self.tokens.values_mut() {
            if token.bonding_curve == Some(update.pubkey) && update.data.len() >= 40 {
                // Invariant: ignore stale or duplicate account updates using slot and write_version
                if !token.is_update_newer(slot, write_version) {
                    continue;
                }
                // Approximate reserves parsing for replay
                let virtual_token = u64::from_le_bytes(
                    update.data[8..16].try_into().unwrap_or([0u8; 8]),
                );
                let virtual_sol = u64::from_le_bytes(
                    update.data[16..24].try_into().unwrap_or([0u8; 8]),
                );
                if virtual_sol > 0 && virtual_token > 0 {
                    token.virtual_sol_reserves = Lamports::new(virtual_sol);
                    token.virtual_token_reserves = TokenAmount::new(virtual_token);
                    token.last_slot = slot;
                    token.last_write_version = write_version;
                }
            }
        }
    }

    fn handle_transaction_update(&mut self, tx: &TransactionUpdateFrame) {
        let events = self.decoder.decode_transaction(tx);
        self.summary.transactions_decoded += 1;

        for event in events {
            match event {
                DecodedInstructionEvent::PumpCreate(create) => {
                    let mut token = TokenRuntime::new(create.mint, create.slot);
                    token.bonding_curve = Some(create.bonding_curve);
                    token.state = MarketState::PumpCurveActive {
                        bonding_curve: create.bonding_curve,
                    };
                    token.virtual_sol_reserves = Lamports::new(30_000_000_000); // 30 SOL initial
                    token.virtual_token_token_amount(TokenAmount::new(1_073_000_000_000_000));
                    self.tokens.insert(create.mint, token);

                    self.decision_logs.push(ReplayDecisionLog {
                        slot: create.slot,
                        mint: create.mint,
                        event_kind: "PUMP_CREATE".to_string(),
                        details: format!("New Pump curve: creator={}", create.creator),
                        sol_amount: None,
                        pnl_lamports: None,
                    });
                }
                DecodedInstructionEvent::PumpTrade(trade) => {
                    self.summary.trades_detected += 1;
                    self.summary.pump_trades += 1;
                    self.handle_pump_trade(trade);
                }
                DecodedInstructionEvent::PumpMigrate(migrate) => {
                    if let Some(token) = self.tokens.get_mut(&migrate.mint) {
                        token.state = MarketState::Graduating {
                            expected_pool: None,
                        };
                    }
                }
                DecodedInstructionEvent::RaydiumPool(pool) => {
                    let mint = if pool.coin_mint == Pubkey::default() {
                        pool.pc_mint
                    } else {
                        pool.coin_mint
                    };
                    let mut token = self
                        .tokens
                        .entry(mint)
                        .or_insert_with(|| TokenRuntime::new(mint, pool.slot));
                    token.raydium_pool = Some(pool.pool);
                    token.state = MarketState::RaydiumPoolActive { pool: pool.pool };
                }
                DecodedInstructionEvent::RaydiumSwap(swap) => {
                    self.summary.trades_detected += 1;
                    self.summary.raydium_swaps += 1;
                    self.handle_raydium_swap(swap);
                }
            }
        }
    }

    fn handle_pump_trade(&mut self, trade: crate::decoder::PumpTradeDecoded) {
        let current_slot = self.clock.current_slot();
        let mint = trade.mint;

        // Ensure token is tracked
        let token = self.tokens.entry(mint).or_insert_with(|| {
            let mut t = TokenRuntime::new(mint, current_slot);
            t.bonding_curve = Some(trade.bonding_curve);
            t.state = MarketState::PumpCurveActive {
                bonding_curve: trade.bonding_curve,
            };
            t.virtual_sol_reserves = Lamports::new(30_000_000_000);
            t.virtual_token_reserves = TokenAmount::new(1_073_000_000_000_000);
            t
        });

        // Update reserves based on trade direction
        match trade.side {
            TradeSide::Buy => {
                token.virtual_sol_reserves =
                    token.virtual_sol_reserves.saturating_add(trade.sol_amount);
                token.virtual_token_reserves = token
                    .virtual_token_reserves
                    .saturating_sub(trade.token_amount);
                token.buyers.record_buy(trade.trader, trade.sol_amount.as_u64());
            }
            TradeSide::Sell => {
                token.virtual_sol_reserves =
                    token.virtual_sol_reserves.saturating_sub(trade.sol_amount);
                token.virtual_token_reserves = token
                    .virtual_token_reserves
                    .saturating_add(trade.token_amount);
                token.buyers.record_sell(trade.trader);
            }
        }

        let spot_price = if token.virtual_token_reserves.as_u64() > 0 {
            token.virtual_sol_reserves.as_u64() as f64 / token.virtual_token_reserves.as_u64() as f64
        } else {
            0.0
        };

        // 1. If we hold an active position in this mint, evaluate EXIT ladder / tripwire
        if let Some(pos) = self.position_manager.active_position().cloned() {
            if pos.mint == mint {
                self.evaluate_replay_exit(&pos, spot_price, trade.side, trade.sol_amount.as_u64());
                return;
            }
        }

        // 2. If no position is open, evaluate ENTRY signal
        if self.position_manager.can_open_new_position() && trade.side == TradeSide::Buy {
            self.evaluate_replay_entry(mint, spot_price, &trade);
        }
    }

    fn handle_raydium_swap(&mut self, swap: crate::decoder::RaydiumSwapDecoded) {
        let mint = swap.mint;
        let spot_price = if swap.token_amount.as_u64() > 0 {
            swap.sol_amount.as_u64() as f64 / swap.token_amount.as_u64() as f64
        } else {
            0.0
        };

        if let Some(pos) = self.position_manager.active_position().cloned() {
            if pos.mint == mint {
                self.evaluate_replay_exit(&pos, spot_price, swap.side, swap.sol_amount.as_u64());
            }
        }
    }

    fn evaluate_replay_entry(
        &mut self,
        mint: Mint,
        spot_price: f64,
        trade: &crate::decoder::PumpTradeDecoded,
    ) {
        self.summary.signals_evaluated += 1;
        let token = match self.tokens.get(&mint) {
            Some(t) => t,
            None => return,
        };

        // Gate 1: Liquidity threshold check (min 15 SOL virtual)
        if token.virtual_sol_reserves.as_u64() < 15_000_000_000 {
            return;
        }

        // Gate 2: Cabal risk score veto
        if token.hot_cabal_score > 80 || token.dev_proxy_risk > 70 {
            return;
        }

        // Gate 3: Economic Edge Gate evaluation
        let size_lamports = self.max_position_sol.min(1_000_000_000); // 1.0 SOL
        let fee_est = self.fee_model.calculate_roundtrip_fees(
            DexProtocol::PumpFun,
            size_lamports,
            JitoTipTier::Aggressive,
        );

        // Required gross edge for fresh momentum ~500 bps (5.0%)
        let gross_edge_bps = 500u16;
        let edge_eval = self.edge_gate.evaluate_edge(gross_edge_bps, &fee_est);

        match edge_eval {
            Ok(eval) if eval.approved => {
                self.summary.edge_approvals += 1;
            }
            _ => {
                self.summary.edge_rejections += 1;
                return;
            }
        }

        // Calculate expected token quantity out via quote engine
        let quote_req = QuoteRequest {
            protocol: DexProtocol::PumpFun,
            reserve_sol_lamports: token.virtual_sol_reserves.as_u64(),
            reserve_token: token.virtual_token_reserves.as_u64(),
            amount_in: size_lamports,
            slippage_bps: Some(150),
        };

        let quote_res = match self.quote_engine.calculate_buy_quote(&quote_req) {
            Ok(q) => q,
            Err(_) => return,
        };

        let current_slot = self.clock.current_slot();
        let sim_sig = Signature::new([0x33; 64]);

        // Register intent & confirm fill
        let _ = self.position_manager.register_intent(
            mint,
            Lamports::new(size_lamports),
            current_slot,
            format!("replay_{}_{}", mint, current_slot),
        );

        let acquired_tokens = TokenAmount::new(quote_res.output_amount);
        let actual_entry_price = size_lamports as f64 / acquired_tokens.as_u64().max(1) as f64;

        let res = self.position_manager.confirm_buy_fill(
            mint,
            actual_entry_price,
            Lamports::new(size_lamports),
            acquired_tokens,
            current_slot,
            sim_sig,
        );

        if res.is_ok() {
            self.summary.simulated_buys += 1;
            self.decision_logs.push(ReplayDecisionLog {
                slot: current_slot,
                mint,
                event_kind: "SIMULATED_BUY_LANDED".to_string(),
                details: format!(
                    "Acquired {} tokens at price {:.8} SOL",
                    acquired_tokens, actual_entry_price
                ),
                sol_amount: Some(size_lamports),
                pnl_lamports: None,
            });
        }
    }

    fn evaluate_replay_exit(
        &mut self,
        pos: &PositionState,
        current_spot_price: f64,
        market_side: TradeSide,
        trade_volume: u64,
    ) {
        let current_slot = self.clock.current_slot();
        let pnl_bps = (((current_spot_price - pos.entry_price) / pos.entry_price) * 10_000.0) as i32;

        // Emergency Check 1: Stop-loss trigger (-350 bps / -3.5%)
        if pnl_bps <= -350 {
            self.execute_replay_sell(pos.mint, pos.remaining_token_amount, "HardStopLoss", true);
            return;
        }

        // Ladder Exit Tier 1: +30% gain (sell 50% remaining)
        if pnl_bps >= 3000 && !pos.tier1_done {
            let tokens_tier1 = TokenAmount::new(pos.token_amount.as_u64() / 2);
            self.execute_replay_sell(pos.mint, tokens_tier1, "LadderTier1_TakeProfit30Pct", false);
            return;
        }

        // Ladder Exit Tier 2: +60% gain (sell remaining balance)
        if pnl_bps >= 6000 && pos.tier1_done && !pos.tier2_done {
            self.execute_replay_sell(
                pos.mint,
                pos.remaining_token_amount,
                "LadderTier2_TakeProfit60Pct",
                false,
            );
            return;
        }

        // Adverse selection check: dev/large sell dump
        if market_side == TradeSide::Sell && trade_volume > 5_000_000_000 {
            self.execute_replay_sell(
                pos.mint,
                pos.remaining_token_amount,
                "AdverseSelectionDevDump",
                true,
            );
        }
    }

    fn execute_replay_sell(
        &mut self,
        mint: Mint,
        tokens_to_sell: TokenAmount,
        reason: &str,
        is_emergency: bool,
    ) {
        let current_slot = self.clock.current_slot();
        let token = match self.tokens.get(&mint) {
            Some(t) => t,
            None => return,
        };

        let quote_req = QuoteRequest {
            protocol: DexProtocol::PumpFun,
            reserve_sol_lamports: token.virtual_sol_reserves.as_u64(),
            reserve_token: token.virtual_token_reserves.as_u64(),
            amount_in: tokens_to_sell.as_u64(),
            slippage_bps: Some(250),
        };

        let quote_res = match self.quote_engine.calculate_sell_quote(&quote_req) {
            Ok(q) => q,
            Err(_) => return,
        };

        let proceeds_sol = quote_res.output_amount;
        let sim_sig = Signature::new([0x77; 64]);

        if let Some(pos) = self.position_manager.active_position() {
            let cost_basis = (pos.entry_price * tokens_to_sell.as_u64() as f64) as u64;
            let pnl_lamports = (proceeds_sol as i64) - (cost_basis as i64);
            self.summary.total_simulated_realized_pnl_lamports += pnl_lamports;

            if is_emergency {
                self.summary.simulated_emergency_exits += 1;
                let _ = self.position_manager.record_emergency_exit(
                    mint,
                    reason.to_string(),
                    sim_sig,
                    tokens_to_sell,
                    Lamports::new(proceeds_sol),
                    current_slot,
                );
            } else {
                let tier = if !pos.tier1_done { 1 } else { 2 };
                let _ = self.position_manager.record_tier_landed(
                    mint,
                    tier,
                    sim_sig,
                    tokens_to_sell,
                    Lamports::new(proceeds_sol),
                    current_slot,
                );
            }

            self.summary.simulated_sells += 1;
            self.decision_logs.push(ReplayDecisionLog {
                slot: current_slot,
                mint,
                event_kind: format!("SIMULATED_SELL_{}", reason),
                details: format!(
                    "Sold {} tokens for {} lamports (PnL: {} lamports)",
                    tokens_to_sell, proceeds_sol, pnl_lamports
                ),
                sol_amount: Some(proceeds_sol),
                pnl_lamports: Some(pnl_lamports),
            });
        }
    }
}

trait TokenRuntimeExt {
    fn virtual_token_token_amount(&mut self, amount: TokenAmount);
}

impl TokenRuntimeExt for TokenRuntime {
    fn virtual_token_token_amount(&mut self, amount: TokenAmount) {
        self.virtual_token_reserves = amount;
    }
}
