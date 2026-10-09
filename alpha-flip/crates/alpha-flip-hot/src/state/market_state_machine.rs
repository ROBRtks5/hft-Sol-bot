use crate::errors::StateError;
use crate::events::MarketState;
use crate::types::Pubkey;
use tracing::{info, warn};

pub struct MarketStateMachine;

impl MarketStateMachine {
    /// Enforce state transition invariants for token market lifecycle
    pub fn transition(
        current: &MarketState,
        next: MarketState,
    ) -> Result<MarketState, StateError> {
        // Any state can transition to Blacklisted immediately
        if matches!(next, MarketState::Blacklisted { .. }) {
            warn!(current = ?current, next = ?next, "Token blacklisted - trading permanently halted");
            return Ok(next);
        }

        // Blacklisted state is terminal
        if matches!(current, MarketState::Blacklisted { .. }) {
            return Err(StateError::InvalidTransition {
                from: format!("{:?}", current),
                action: format!("Attempted transition to {:?}", next),
            });
        }

        match (current, &next) {
            // Created -> PumpCurveActive
            (MarketState::Created, MarketState::PumpCurveActive { .. }) => {
                info!("Market transition: Created -> PumpCurveActive");
                Ok(next)
            }
            // Created -> RaydiumPoolActive (direct Raydium launch without Pump.fun)
            (MarketState::Created, MarketState::RaydiumPoolActive { .. }) => {
                info!("Market transition: Created -> RaydiumPoolActive");
                Ok(next)
            }
            // PumpCurveActive -> Graduating (migration detected)
            (MarketState::PumpCurveActive { .. }, MarketState::Graduating { .. }) => {
                info!("Market transition: PumpCurveActive -> Graduating");
                Ok(next)
            }
            // Graduating -> RaydiumPoolActive (pool initialized on Raydium)
            (MarketState::Graduating { .. }, MarketState::RaydiumPoolActive { .. }) => {
                info!("Market transition: Graduating -> RaydiumPoolActive");
                Ok(next)
            }
            // PumpCurveActive -> RaydiumPoolActive (migration step completed in same block)
            (MarketState::PumpCurveActive { .. }, MarketState::RaydiumPoolActive { .. }) => {
                info!("Market transition: PumpCurveActive -> RaydiumPoolActive");
                Ok(next)
            }
            // Any active state -> Stale
            (MarketState::PumpCurveActive { .. }, MarketState::Stale)
            | (MarketState::RaydiumPoolActive { .. }, MarketState::Stale)
            | (MarketState::Created, MarketState::Stale)
            | (MarketState::Graduating { .. }, MarketState::Stale) => {
                warn!(current = ?current, "Market transition to Stale due to inactivity");
                Ok(next)
            }
            // Stale -> Reactivated if new trade activity arrives
            (MarketState::Stale, MarketState::PumpCurveActive { .. })
            | (MarketState::Stale, MarketState::RaydiumPoolActive { .. }) => {
                info!(next = ?next, "Stale token market reactivated by new trade");
                Ok(next)
            }
            // Self-transitions (updates with same state type)
            (MarketState::PumpCurveActive { .. }, MarketState::PumpCurveActive { .. })
            | (MarketState::RaydiumPoolActive { .. }, MarketState::RaydiumPoolActive { .. })
            | (MarketState::Graduating { .. }, MarketState::Graduating { .. }) => Ok(next),

            // Disallowed transitions
            _ => Err(StateError::InvalidTransition {
                from: format!("{:?}", current),
                action: format!("Transition to {:?}", next),
            }),
        }
    }

    /// INVARIANT 5: Trading is strictly allowed ONLY in PumpCurveActive or RaydiumPoolActive
    pub fn can_trade(state: &MarketState) -> bool {
        matches!(
            state,
            MarketState::PumpCurveActive { .. } | MarketState::RaydiumPoolActive { .. }
        )
    }

    pub fn is_terminal(state: &MarketState) -> bool {
        matches!(state, MarketState::Blacklisted { .. })
    }
}
