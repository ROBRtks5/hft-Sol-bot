use crate::errors::PositionInvariantError;
use crate::position::journal::{JournalEvent, PositionJournal};
use crate::position::state::{PositionExitState, PositionState};
use crate::types::{Lamports, Mint, Signature, Slot, TokenAmount};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

/// Read-only snapshot of current active position for telemetry & cold advisory
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionSummary {
    pub mint: Mint,
    pub entry_price: f64,
    pub entry_sol: Lamports,
    pub initial_tokens: TokenAmount,
    pub remaining_tokens: TokenAmount,
    pub opened_slot: Slot,
    pub exit_state: PositionExitState,
    pub pending_signatures_count: usize,
}

/// Thread-safe manager guaranteeing the STRICT INVARIANT:
/// Exactly zero or one open position allowed at any time.
#[derive(Debug)]
pub struct PositionManager {
    journal: PositionJournal,
    active_position: Option<PositionState>,
    is_in_flight_intent: bool,
}

impl PositionManager {
    pub fn new(journal: PositionJournal) -> Self {
        Self {
            journal,
            active_position: None,
            is_in_flight_intent: false,
        }
    }

    /// Restore manager state with an active position (from crash recovery)
    pub fn restore_active(&mut self, pos: PositionState) {
        info!("Restoring active position into manager: mint={}", pos.mint);
        self.active_position = Some(pos);
        self.is_in_flight_intent = false;
    }

    /// Strict guard: Can a new position intent be opened right now?
    pub fn can_open_new_position(&self) -> bool {
        if self.is_in_flight_intent {
            return false;
        }
        match &self.active_position {
            None => true,
            Some(pos) => !pos.is_open(),
        }
    }

    /// Register intent to open. Locks entry slot so no parallel intent can race.
    pub fn register_intent(
        &mut self,
        mint: Mint,
        max_sol: Lamports,
        slot: Slot,
        client_order_id: String,
    ) -> Result<(), PositionInvariantError> {
        if !self.can_open_new_position() {
            return Err(PositionInvariantError::Other(
                "Cannot register intent: position already active or intent in flight".to_string(),
            ));
        }

        self.journal.append(
            format!("intent_{}_{}", mint, client_order_id),
            JournalEvent::IntentOpen {
                mint,
                max_sol,
                slot,
                client_order_id,
            },
        )?;

        self.is_in_flight_intent = true;
        Ok(())
    }

    /// Record failure to open (bundle dropped or failed simulation). Releases lock.
    pub fn record_open_failure(
        &mut self,
        mint: Mint,
        bundle_id: String,
        reason: String,
        slot: Slot,
    ) -> Result<(), PositionInvariantError> {
        self.journal.append(
            format!("buy_failed_{}_{}", mint, bundle_id),
            JournalEvent::BuyFailed {
                mint,
                bundle_id,
                reason,
                slot,
            },
        )?;
        self.is_in_flight_intent = false;
        Ok(())
    }

    /// Formally establish open position upon buy transaction confirmation
    pub fn record_buy_landed(
        &mut self,
        mint: Mint,
        signature: Signature,
        tokens_acquired: TokenAmount,
        sol_spent: Lamports,
        effective_price: f64,
        slot: Slot,
    ) -> Result<(), PositionInvariantError> {
        if let Some(ref current) = self.active_position {
            if current.is_open() {
                return Err(PositionInvariantError::Other(format!(
                    "STRICT INVARIANT VIOLATION: Attempted to open position for {} while {} is still active!",
                    mint, current.mint
                )));
            }
        }

        // 1. Journal BuyLanded
        self.journal.append(
            format!("buy_landed_{}_{}", mint, signature),
            JournalEvent::BuyLanded {
                mint,
                signature,
                tokens_acquired,
                sol_spent,
                effective_price,
                slot,
            },
        )?;

        // 2. Journal PositionOpen
        self.journal.append(
            format!("pos_open_{}_{}", mint, signature),
            JournalEvent::PositionOpen {
                mint,
                entry_price: effective_price,
                entry_sol: sol_spent,
                token_amount: tokens_acquired,
                opened_slot: slot,
                initial_sig: signature,
            },
        )?;

        // 3. Create active position state
        let pos = PositionState::new(
            mint,
            effective_price,
            sol_spent,
            tokens_acquired,
            slot,
            signature,
        )?;

        self.active_position = Some(pos);
        self.is_in_flight_intent = false;

        info!(
            "Position opened: mint={}, tokens={}, sol={}",
            mint, tokens_acquired, sol_spent
        );
        Ok(())
    }

    /// Record partial or full tier sell landed
    pub fn record_tier_landed(
        &mut self,
        mint: Mint,
        tier: u8,
        signature: Signature,
        tokens_sold: TokenAmount,
        sol_received: Lamports,
        slot: Slot,
    ) -> Result<(), PositionInvariantError> {
        let pos = self.active_position.as_mut().ok_or_else(|| {
            PositionInvariantError::Other("No active position to record tier landed".to_string())
        })?;

        if pos.mint != mint {
            return Err(PositionInvariantError::Other(format!(
                "Mint mismatch on tier landed: active={} vs event={}",
                pos.mint, mint
            )));
        }

        self.journal.append(
            format!("tier_landed_{}_{}_{}", mint, tier, signature),
            JournalEvent::TierLanded {
                mint,
                tier,
                signature,
                tokens_sold,
                sol_received,
                slot,
            },
        )?;

        pos.record_partial_exit(tokens_sold, signature)?;

        if !pos.is_open() {
            info!("Position for {} fully liquidated via tier {}", mint, tier);
            let net_pnl = sol_received.as_u64() as i64 - pos.entry_sol.as_u64() as i64;
            self.journal.append(
                format!("close_{}_{}", mint, slot),
                JournalEvent::PositionClosed {
                    mint,
                    total_sol_returned: sol_received,
                    net_pnl_sol: net_pnl,
                    closed_slot: slot,
                },
            )?;
            self.active_position = None;
        }

        Ok(())
    }

    /// Record emergency exit requested and landed
    pub fn record_emergency_exit(
        &mut self,
        mint: Mint,
        reason: String,
        signature: Signature,
        tokens_sold: TokenAmount,
        sol_received: Lamports,
        slot: Slot,
    ) -> Result<(), PositionInvariantError> {
        let pos = self.active_position.as_mut().ok_or_else(|| {
            PositionInvariantError::Other("No active position for emergency exit".to_string())
        })?;

        if pos.mint != mint {
            return Err(PositionInvariantError::Other("Mint mismatch".to_string()));
        }

        self.journal.append(
            format!("emerg_req_{}_{}", mint, slot),
            JournalEvent::EmergencyRequested {
                mint,
                reason,
                tokens_to_sell: tokens_sold,
                slot,
            },
        )?;

        self.journal.append(
            format!("emerg_landed_{}_{}", mint, signature),
            JournalEvent::TierLanded {
                mint,
                tier: 99, // Emergency indicator
                signature,
                tokens_sold,
                sol_received,
                slot,
            },
        )?;

        pos.record_partial_exit(tokens_sold, signature)?;

        let net_pnl = sol_received.as_u64() as i64 - pos.entry_sol.as_u64() as i64;
        self.journal.append(
            format!("close_emerg_{}_{}", mint, slot),
            JournalEvent::PositionClosed {
                mint,
                total_sol_returned: sol_received,
                net_pnl_sol: net_pnl,
                closed_slot: slot,
            },
        )?;

        self.active_position = None;
        Ok(())
    }

    /// Current active position reference
    pub fn active_position(&self) -> Option<&PositionState> {
        self.active_position.as_ref()
    }

    /// Read summary for telemetry
    pub fn summary(&self) -> Option<PositionSummary> {
        self.active_position.as_ref().map(|p| PositionSummary {
            mint: p.mint,
            entry_price: p.entry_price,
            entry_sol: p.entry_sol,
            initial_tokens: p.token_amount,
            remaining_tokens: p.remaining_token_amount,
            opened_slot: p.opened_slot,
            exit_state: p.exit_state,
            pending_signatures_count: p.pending_signatures.len(),
        })
    }

    pub fn journal(&self) -> &PositionJournal {
        &self.journal
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strict_one_position_limit() {
        let journal = PositionJournal::ephemeral();
        let mut manager = PositionManager::new(journal);

        assert!(manager.can_open_new_position());

        let mint_a = Mint::from_bytes([1u8; 32]);
        manager
            .register_intent(mint_a, Lamports::new(100_000_000), 10, "ord1".to_string())
            .unwrap();

        assert!(!manager.can_open_new_position(), "Intent in flight blocks new open");

        let sig = Signature::from_bytes([2u8; 64]);
        manager
            .record_buy_landed(
                mint_a,
                sig,
                TokenAmount::new(1000),
                Lamports::new(100_000_000),
                0.1,
                11,
            )
            .unwrap();

        assert!(!manager.can_open_new_position(), "Active position blocks new open");

        // Attempting to buy token B while A is open must fail
        let mint_b = Mint::from_bytes([3u8; 32]);
        let err = manager.register_intent(mint_b, Lamports::new(100_000_000), 12, "ord2".to_string());
        assert!(err.is_err());
    }

    #[test]
    fn test_full_lifecycle_exit() {
        let journal = PositionJournal::ephemeral();
        let mut manager = PositionManager::new(journal);
        let mint = Mint::from_bytes([4u8; 32]);
        let sig_buy = Signature::from_bytes([5u8; 64]);

        manager
            .register_intent(mint, Lamports::new(100_000_000), 10, "ord1".to_string())
            .unwrap();
        manager
            .record_buy_landed(
                mint,
                sig_buy,
                TokenAmount::new(1000),
                Lamports::new(100_000_000),
                0.1,
                11,
            )
            .unwrap();

        // Tier 1 sell 50%
        let sig_t1 = Signature::from_bytes([6u8; 64]);
        manager
            .record_tier_landed(
                mint,
                1,
                sig_t1,
                TokenAmount::new(500),
                Lamports::new(65_000_000),
                15,
            )
            .unwrap();

        assert!(!manager.can_open_new_position());
        assert_eq!(
            manager.active_position().unwrap().remaining_token_amount.as_u64(),
            500
        );

        // Tier 2 sell remainder
        let sig_t2 = Signature::from_bytes([7u8; 64]);
        manager
            .record_tier_landed(
                mint,
                2,
                sig_t2,
                TokenAmount::new(500),
                Lamports::new(70_000_000),
                20,
            )
            .unwrap();

        assert!(manager.can_open_new_position(), "Position closed, new open permitted");
        assert!(manager.active_position().is_none());
    }
}
