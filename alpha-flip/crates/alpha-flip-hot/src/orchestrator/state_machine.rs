use crate::errors::RiskError;
use crate::orchestrator::mode::OperatingMode;
use crate::position::manager::PositionManager;
use crate::types::{Lamports, Mint, Slot};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use tracing::{error, info, warn};

/// High-level engine state for the state machine
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OrchestratorState {
    Init,
    Recovering,
    Scanning,
    EvaluatingSignal,
    SubmittingOrder,
    InPosition,
    ExitingPosition,
    Paused,
    Killed,
}

/// Global risk limits enforced strictly before each trade decision
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskLimits {
    pub max_daily_loss_lamports: u64,
    pub max_consecutive_losses: u32,
    pub tip_budget_daily_lamports: u64,
    pub max_trades_per_hour: u32,
    pub max_position_sol_lamports: u64,
    pub min_wallet_reserve_lamports: u64,
}

impl Default for RiskLimits {
    fn default() -> Self {
        Self {
            max_daily_loss_lamports: 2_000_000_000,    // 2.0 SOL
            max_consecutive_losses: 3,
            tip_budget_daily_lamports: 500_000_000,   // 0.5 SOL
            max_trades_per_hour: 12,
            max_position_sol_lamports: 1_000_000_000, // 1.0 SOL
            min_wallet_reserve_lamports: 200_000_000, // 0.2 SOL
        }
    }
}

/// Live snapshot of rolling risk usage
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RiskSnapshotState {
    pub realized_daily_pnl_lamports: i64,
    pub consecutive_losses: u32,
    pub daily_tips_spent_lamports: u64,
    pub trade_timestamps_ms: VecDeque<u64>,
}

/// Core orchestrator coordinating state machine, modes, position manager, and global risk limits.
#[derive(Debug)]
pub struct OrchestratorEngine {
    mode: OperatingMode,
    state: OrchestratorState,
    position_manager: PositionManager,
    risk_limits: RiskLimits,
    risk_state: RiskSnapshotState,
}

impl OrchestratorEngine {
    pub fn new(
        mode: OperatingMode,
        position_manager: PositionManager,
        risk_limits: RiskLimits,
    ) -> Self {
        let initial_state = match mode {
            OperatingMode::Recovering => OrchestratorState::Recovering,
            OperatingMode::Paused => OrchestratorState::Paused,
            OperatingMode::KillSwitch => OrchestratorState::Killed,
            _ => OrchestratorState::Scanning,
        };

        Self {
            mode,
            state: initial_state,
            position_manager,
            risk_limits,
            risk_state: RiskSnapshotState::default(),
        }
    }

    pub fn mode(&self) -> OperatingMode {
        self.mode
    }

    pub fn state(&self) -> OrchestratorState {
        self.state
    }

    pub fn position_manager(&self) -> &PositionManager {
        &self.position_manager
    }

    pub fn position_manager_mut(&mut self) -> &mut PositionManager {
        &mut self.position_manager
    }

    pub fn risk_limits(&self) -> &RiskLimits {
        &self.risk_limits
    }

    pub fn risk_state(&self) -> &RiskSnapshotState {
        &self.risk_state
    }

    /// Set operating mode with safety validations
    pub fn set_mode(&mut self, new_mode: OperatingMode) {
        if self.mode == new_mode {
            return;
        }

        warn!("Operating mode transition: {} -> {}", self.mode, new_mode);
        self.mode = new_mode;

        match new_mode {
            OperatingMode::KillSwitch => {
                self.state = OrchestratorState::Killed;
            }
            OperatingMode::Paused => {
                self.state = OrchestratorState::Paused;
            }
            OperatingMode::Recovering => {
                self.state = OrchestratorState::Recovering;
            }
            OperatingMode::Live | OperatingMode::Shadow | OperatingMode::Observe => {
                if self.position_manager.active_position().is_some() {
                    self.state = OrchestratorState::InPosition;
                } else {
                    self.state = OrchestratorState::Scanning;
                }
            }
        }
    }

    /// Transition internal state machine
    pub fn transition_to(&mut self, next_state: OrchestratorState) {
        if self.state == next_state {
            return;
        }
        info!("State transition: {:?} -> {:?}", self.state, next_state);
        self.state = next_state;
    }

    /// Enforce global risk limits before allowing entry.
    /// Returns Ok(()) if all risk constraints pass; Err(RiskError) otherwise.
    pub fn check_entry_risk_gates(
        &mut self,
        now_ms: u64,
        wallet_sol: Lamports,
        proposed_size: Lamports,
    ) -> Result<(), RiskError> {
        // 1. Operating mode gate
        if !self.mode.allows_new_orders() && !self.mode.allows_simulation() {
            return Err(RiskError::CircuitBreakerTriggered(format!(
                "New orders prohibited in mode {}",
                self.mode
            )));
        }

        // 2. Strict one position check
        if !self.position_manager.can_open_new_position() {
            return Err(RiskError::MaxPositionsExceeded(1));
        }

        // 3. Size check against cap
        if proposed_size.as_u64() > self.risk_limits.max_position_sol_lamports {
            return Err(RiskError::ExposureLimitExceeded {
                attempted_lamports: proposed_size.as_u64(),
                max_lamports: self.risk_limits.max_position_sol_lamports,
            });
        }

        // 4. Wallet reserve check
        let required_wallet = proposed_size.as_u64() + self.risk_limits.min_wallet_reserve_lamports;
        if wallet_sol.as_u64() < required_wallet {
            return Err(RiskError::CircuitBreakerTriggered(format!(
                "Insufficient wallet reserve: balance={}, required={}",
                wallet_sol.as_u64(),
                required_wallet
            )));
        }

        // 5. Daily loss drawdown circuit breaker
        if self.risk_state.realized_daily_pnl_lamports < 0 {
            let loss_abs = self.risk_state.realized_daily_pnl_lamports.unsigned_abs();
            if loss_abs >= self.risk_limits.max_daily_loss_lamports {
                self.set_mode(OperatingMode::Paused);
                return Err(RiskError::DailyDrawdownExceeded {
                    loss: loss_abs,
                    limit: self.risk_limits.max_daily_loss_lamports,
                });
            }
        }

        // 6. Consecutive losses
        if self.risk_state.consecutive_losses >= self.risk_limits.max_consecutive_losses {
            self.set_mode(OperatingMode::Paused);
            return Err(RiskError::CircuitBreakerTriggered(format!(
                "Max consecutive losses reached: {}",
                self.risk_state.consecutive_losses
            )));
        }

        // 7. Daily tip budget check
        if self.risk_state.daily_tips_spent_lamports >= self.risk_limits.tip_budget_daily_lamports {
            return Err(RiskError::CircuitBreakerTriggered(format!(
                "Daily tip budget exhausted: {} lamports",
                self.risk_state.daily_tips_spent_lamports
            )));
        }

        // 8. Max trades per hour rolling window check
        let one_hour_ago = now_ms.saturating_sub(3_600_000);
        while let Some(&front) = self.risk_state.trade_timestamps_ms.front() {
            if front < one_hour_ago {
                self.risk_state.trade_timestamps_ms.pop_front();
            } else {
                break;
            }
        }

        if self.risk_state.trade_timestamps_ms.len() >= self.risk_limits.max_trades_per_hour as usize {
            return Err(RiskError::CircuitBreakerTriggered(format!(
                "Rate limit exceeded: {} trades in past hour",
                self.risk_state.trade_timestamps_ms.len()
            )));
        }

        Ok(())
    }

    /// Record a completed trade for risk tracking
    pub fn record_trade_completion(&mut self, now_ms: u64, pnl_lamports: i64, tip_spent: u64) {
        self.risk_state.trade_timestamps_ms.push_back(now_ms);
        self.risk_state.realized_daily_pnl_lamports += pnl_lamports;
        self.risk_state.daily_tips_spent_lamports += tip_spent;

        if pnl_lamports < 0 {
            self.risk_state.consecutive_losses += 1;
            warn!(
                "Trade closed with LOSS: {} lamports. Consecutive losses: {}",
                pnl_lamports, self.risk_state.consecutive_losses
            );
        } else {
            self.risk_state.consecutive_losses = 0;
            info!(
                "Trade closed with PROFIT: +{} lamports. Consecutive losses reset.",
                pnl_lamports
            );
        }

        // Auto-pause if drawdown hit
        if self.risk_state.realized_daily_pnl_lamports < 0 {
            let loss_abs = self.risk_state.realized_daily_pnl_lamports.unsigned_abs();
            if loss_abs >= self.risk_limits.max_daily_loss_lamports {
                warn!("Max daily loss breached! Engaging PAUSED mode automatically.");
                self.set_mode(OperatingMode::Paused);
            }
        }
        if self.risk_state.consecutive_losses >= self.risk_limits.max_consecutive_losses {
            warn!("Max consecutive losses breached! Engaging PAUSED mode automatically.");
            self.set_mode(OperatingMode::Paused);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::position::journal::PositionJournal;

    #[test]
    fn test_risk_gates_enforcement() {
        let journal = PositionJournal::ephemeral();
        let manager = PositionManager::new(journal);
        let mut limits = RiskLimits::default();
        limits.max_consecutive_losses = 2;
        limits.max_daily_loss_lamports = 100_000_000;

        let mut engine = OrchestratorEngine::new(OperatingMode::Live, manager, limits);

        let wallet_balance = Lamports::new(10_000_000_000);
        let proposed = Lamports::new(500_000_000);

        // 1. Initial pass
        assert!(engine.check_entry_risk_gates(1000, wallet_balance, proposed).is_ok());

        // 2. First loss
        engine.record_trade_completion(1000, -50_000_000, 10_000);
        assert_eq!(engine.risk_state.consecutive_losses, 1);
        assert!(engine.check_entry_risk_gates(2000, wallet_balance, proposed).is_ok());

        // 3. Second loss triggers consecutive loss limit & auto-pauses
        engine.record_trade_completion(2000, -60_000_000, 10_000);
        assert_eq!(engine.risk_state.consecutive_losses, 2);
        assert_eq!(engine.mode(), OperatingMode::Paused);

        // Subsequent check fails
        let err = engine.check_entry_risk_gates(3000, wallet_balance, proposed);
        assert!(err.is_err());
    }

    #[test]
    fn test_mode_transitions_and_limits() {
        let journal = PositionJournal::ephemeral();
        let manager = PositionManager::new(journal);
        let mut engine = OrchestratorEngine::new(OperatingMode::Observe, manager, RiskLimits::default());

        let res = engine.check_entry_risk_gates(1000, Lamports::new(10_000_000_000), Lamports::new(100_000_000));
        assert!(res.is_err(), "Observe mode must reject live entry");

        engine.set_mode(OperatingMode::Shadow);
        let res_shadow = engine.check_entry_risk_gates(1000, Lamports::new(10_000_000_000), Lamports::new(100_000_000));
        assert!(res_shadow.is_ok(), "Shadow mode allows simulation");

        engine.set_mode(OperatingMode::KillSwitch);
        assert_eq!(engine.state(), OrchestratorState::Killed);
    }
}
