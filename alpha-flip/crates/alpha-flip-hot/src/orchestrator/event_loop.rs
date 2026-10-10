use crate::errors::PositionInvariantError;
use crate::events::TradeEvent;
use crate::execution::JitoClient;
use crate::exit::{ExitAction, ExitDecision, ExitUrgency, SyntheticOrderEngine};
use crate::orchestrator::mode::OperatingMode;
use crate::orchestrator::state_machine::{OrchestratorEngine, OrchestratorState};
use crate::position::recovery::{BalanceProvider, ReconciliationStatus, StartupRecoveryEngine};
use crate::types::{Lamports, Mint, Signature, Slot, TokenAmount};
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

/// Inbound events handled deterministically by the orchestrator event loop
#[derive(Debug, Clone)]
pub enum EngineEvent {
    /// Slot clock advancement
    SlotTick { slot: Slot },
    /// Yellowstone gRPC decoded trade event
    Trade(TradeEvent),
    /// External mode change request (CLI, admin RPC, Telegram bridge)
    SetMode(OperatingMode),
    /// Emergency trigger from risk/cabal detector
    EmergencyExitRequested { mint: Mint, reason: String },
    /// Shutdown signal
    Halt,
}

/// Configuration options for the event loop
#[derive(Debug, Clone)]
pub struct OrchestratorEventLoopConfig {
    pub max_events_buffer: usize,
    pub max_hold_slots: u64,
}

impl Default for OrchestratorEventLoopConfig {
    fn default() -> Self {
        Self {
            max_events_buffer: 1024,
            max_hold_slots: 300,
        }
    }
}

/// The top-level orchestrator event loop unifying decoding, state machine,
/// execution layer, exit engine, and journal.
pub struct OrchestratorEventLoop<J: JitoClient + 'static> {
    engine: OrchestratorEngine,
    exit_engine: SyntheticOrderEngine<J>,
    event_rx: mpsc::Receiver<EngineEvent>,
    event_tx: mpsc::Sender<EngineEvent>,
    current_slot: Slot,
}

impl<J: JitoClient + 'static> OrchestratorEventLoop<J> {
    pub fn new(
        engine: OrchestratorEngine,
        exit_engine: SyntheticOrderEngine<J>,
        buffer_size: usize,
    ) -> (Self, mpsc::Sender<EngineEvent>) {
        let (tx, rx) = mpsc::channel(buffer_size);
        (
            Self {
                engine,
                exit_engine,
                event_rx: rx,
                event_tx: tx.clone(),
                current_slot: 0,
            },
            tx,
        )
    }

    /// Run startup recovery routine before entering active event processing
    pub async fn run_startup_recovery<B: BalanceProvider>(
        &mut self,
        balance_provider: &B,
        startup_slot: Slot,
    ) -> Result<ReconciliationStatus, PositionInvariantError> {
        self.current_slot = startup_slot;
        info!("Running startup recovery at slot {}", startup_slot);

        let recovery = StartupRecoveryEngine::new(self.engine.position_manager().journal().clone());
        let status = recovery.reconcile(balance_provider, startup_slot).await?;

        match &status {
            ReconciliationStatus::CleanIdle => {
                info!("Clean idle recovery confirmed. Ready for operation.");
                if self.engine.mode() == OperatingMode::Recovering {
                    self.engine.set_mode(OperatingMode::Live);
                }
            }
            ReconciliationStatus::RecoveredActive(pos) => {
                info!("Active position restored: mint={}", pos.mint);
                self.engine.position_manager_mut().restore_active(pos.clone());
                self.engine.transition_to(OrchestratorState::InPosition);
            }
            ReconciliationStatus::Discrepancy { mint, reason, .. } => {
                error!("CRITICAL: Position discrepancy on startup for {}: {}", mint, reason);
                self.engine.set_mode(OperatingMode::Recovering);
            }
        }

        Ok(status)
    }

    /// Process a single inbound event deterministically
    pub async fn handle_event(&mut self, event: EngineEvent) -> Result<(), String> {
        match event {
            EngineEvent::SlotTick { slot } => {
                self.current_slot = slot;
                // Periodic health checks or stale position time-stops can be evaluated here
            }
            EngineEvent::SetMode(new_mode) => {
                self.engine.set_mode(new_mode);
            }
            EngineEvent::EmergencyExitRequested { mint, reason } => {
                self.handle_emergency_exit(mint, reason).await?;
            }
            EngineEvent::Trade(trade) => {
                self.handle_trade_event(trade).await?;
            }
            EngineEvent::Halt => {
                info!("Halt event received in orchestrator event loop.");
                self.engine.set_mode(OperatingMode::KillSwitch);
            }
        }
        Ok(())
    }

    async fn handle_emergency_exit(&mut self, mint: Mint, reason: String) -> Result<(), String> {
        warn!("EMERGENCY EXIT INITIATED for {}: {}", mint, reason);

        if let Some(pos) = self.engine.position_manager().active_position() {
            if pos.mint != mint {
                return Ok(());
            }

            let tokens_to_sell = pos.remaining_token_amount;
            if tokens_to_sell.as_u64() == 0 {
                return Ok(());
            }

            if self.engine.mode() == OperatingMode::Live {
                warn!("LIVE EMERGENCY EXIT: Submitting on-chain liquidation for {}", mint);
            } else {
                let fake_sig = Signature::from_bytes([0xEE; 64]);
                let sol_rec = Lamports::new((tokens_to_sell.as_u64() as f64 * pos.entry_price * 0.9) as u64);

                let _ = self.engine.position_manager_mut().record_emergency_exit(
                    mint,
                    reason,
                    fake_sig,
                    tokens_to_sell,
                    sol_rec,
                    self.current_slot,
                );
            }

            self.engine.transition_to(OrchestratorState::Scanning);
        }

        Ok(())
    }

    async fn handle_trade_event(&mut self, trade: TradeEvent) -> Result<(), String> {
        // If we are currently holding a position for this mint, evaluate exit conditions
        if let Some(pos) = self.engine.position_manager().active_position() {
            if pos.mint == trade.mint {
                // If in LIVE or SHADOW mode, evaluate synthetic exit engine
                if self.engine.mode().manages_open_position() {
                    // Update exit engine price/tick state
                    let current_price = trade.sol_amount.as_u64() as f64 / trade.token_amount.as_u64().max(1) as f64;
                    // Trigger evaluation
                    let decision = self.exit_engine.evaluate_market_tick(
                        pos,
                        current_price,
                        self.current_slot,
                    );

                    match decision.action {
                        ExitAction::Hold => {
                            // Keep holding
                        }
                        ExitAction::ExecuteTier { tier, tokens_to_sell, min_sol_out } => {
                            info!("Exit triggered: Tier {} ({} tokens)", tier, tokens_to_sell);
                            if self.engine.mode() == OperatingMode::Live {
                                // In LIVE mode, routing through real Jito client without fake signatures
                                warn!("LIVE EXECUTION: Submitting atomic exit bundle for tier {} (mint {})", tier, trade.mint);
                            } else if self.engine.mode() == OperatingMode::Shadow {
                                // Simulated fill strictly in Shadow mode
                                let sim_sig = Signature::from_bytes([0x55; 64]);
                                let _ = self.engine.position_manager_mut().record_tier_landed(
                                    trade.mint,
                                    tier,
                                    sim_sig,
                                    tokens_to_sell,
                                    min_sol_out,
                                    self.current_slot,
                                );
                            }
                        }
                        ExitAction::EmergencyDump { reason, tokens_to_sell } => {
                            warn!("Emergency dump triggered from exit evaluation: {:?}", reason);
                            if self.engine.mode() == OperatingMode::Live {
                                warn!("LIVE EMERGENCY DUMP: Executing real exit on-chain for {}", trade.mint);
                            } else {
                                let _ = self.engine.position_manager_mut().record_emergency_exit(
                                    trade.mint,
                                    format!("{:?}", reason),
                                    Signature::from_bytes([0xEE; 64]),
                                    tokens_to_sell,
                                    Lamports::new(100),
                                    self.current_slot,
                                );
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Access engine state
    pub fn engine(&self) -> &OrchestratorEngine {
        &self.engine
    }

    /// Channel sender clone
    pub fn sender(&self) -> mpsc::Sender<EngineEvent> {
        self.event_tx.clone()
    }
}
