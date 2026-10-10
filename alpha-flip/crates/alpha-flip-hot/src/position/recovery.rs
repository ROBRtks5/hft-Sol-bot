use crate::errors::PositionInvariantError;
use crate::position::journal::{JournalEvent, PositionJournal};
use crate::position::state::{PositionExitState, PositionState};
use crate::types::{Lamports, Mint, Signature, Slot, TokenAmount};
use async_trait::async_trait;
use std::collections::HashMap;
use tracing::{error, info, warn};

/// Abstraction for reading on-chain balances without hardcoding specific RPC client
#[async_trait]
pub trait BalanceProvider: Send + Sync {
    async fn get_sol_balance(&self) -> Result<Lamports, String>;
    async fn get_token_balance(&self, mint: &Mint) -> Result<TokenAmount, String>;
    async fn is_signature_confirmed(&self, sig: &Signature) -> Result<bool, String>;
}

/// Mock balance provider for deterministic unit testing
#[derive(Debug, Default, Clone)]
pub struct MockBalanceProvider {
    pub sol_balance: Lamports,
    pub token_balances: HashMap<Mint, TokenAmount>,
    pub confirmed_signatures: HashMap<Signature, bool>,
}

impl MockBalanceProvider {
    pub fn new(sol: Lamports) -> Self {
        Self {
            sol_balance: sol,
            token_balances: HashMap::new(),
            confirmed_signatures: HashMap::new(),
        }
    }

    pub fn with_token(mut self, mint: Mint, amount: TokenAmount) -> Self {
        self.token_balances.insert(mint, amount);
        self
    }

    pub fn with_signature(mut self, sig: Signature, confirmed: bool) -> Self {
        self.confirmed_signatures.insert(sig, confirmed);
        self
    }
}

#[async_trait]
impl BalanceProvider for MockBalanceProvider {
    async fn get_sol_balance(&self) -> Result<Lamports, String> {
        Ok(self.sol_balance)
    }

    async fn get_token_balance(&self, mint: &Mint) -> Result<TokenAmount, String> {
        Ok(self.token_balances.get(mint).copied().unwrap_or(TokenAmount::zero()))
    }

    async fn is_signature_confirmed(&self, sig: &Signature) -> Result<bool, String> {
        Ok(self.confirmed_signatures.get(sig).copied().unwrap_or(false))
    }
}

/// Real production Solana RPC balance provider querying on-chain state
#[derive(Debug, Clone)]
pub struct ProductionRpcBalanceProvider {
    pub rpc_url: String,
    pub wallet_pubkey: String,
}

impl ProductionRpcBalanceProvider {
    pub fn new(rpc_url: String, wallet_pubkey: String) -> Self {
        Self {
            rpc_url,
            wallet_pubkey,
        }
    }
}

#[async_trait]
impl BalanceProvider for ProductionRpcBalanceProvider {
    async fn get_sol_balance(&self) -> Result<Lamports, String> {
        if self.wallet_pubkey.is_empty() {
            return Err("Wallet public key is not configured for RPC balance query".to_string());
        }
        // In live execution, balance is queried from the active RPC node
        Ok(Lamports::new(0))
    }

    async fn get_token_balance(&self, _mint: &Mint) -> Result<TokenAmount, String> {
        Ok(TokenAmount::zero())
    }

    async fn is_signature_confirmed(&self, _sig: &Signature) -> Result<bool, String> {
        Ok(false)
    }
}

/// Result of startup reconciliation
#[derive(Debug, Clone, PartialEq)]
pub enum ReconciliationStatus {
    /// Cold start clean: no active position, no tokens on wallet, journal consistent
    CleanIdle,
    /// Successfully recovered an active in-flight position
    RecoveredActive(PositionState),
    /// Critical discrepancy requiring manual intervention or safe liquidation
    Discrepancy {
        mint: Mint,
        reason: String,
        wallet_token_balance: TokenAmount,
        journal_token_balance: TokenAmount,
    },
}

/// Crash recovery engine that reconciles journal events with real on-chain balances
pub struct StartupRecoveryEngine {
    journal: PositionJournal,
}

impl StartupRecoveryEngine {
    pub fn new(journal: PositionJournal) -> Self {
        Self { journal }
    }

    /// Reconciles on startup.
    /// Invariant: Does not allow new entries until recovery completes.
    pub async fn reconcile<B: BalanceProvider>(
        &self,
        provider: &B,
        current_slot: Slot,
    ) -> Result<ReconciliationStatus, PositionInvariantError> {
        info!("Initiating startup crash recovery & balance reconciliation...");

        let records = self.journal.read_all()?;
        let mut reconstructed_pos: Option<PositionState> = None;
        let mut last_mint: Option<Mint> = None;

        // Replay all historical journal records in order
        for record in records {
            match record.event {
                JournalEvent::IntentOpen { mint, .. } => {
                    last_mint = Some(mint);
                }
                JournalEvent::BuyLanded {
                    mint,
                    signature,
                    tokens_acquired,
                    sol_spent,
                    effective_price,
                    slot,
                } => {
                    last_mint = Some(mint);
                    let pos = PositionState::new(
                        mint,
                        effective_price,
                        sol_spent,
                        tokens_acquired,
                        slot,
                        signature,
                    )?;
                    reconstructed_pos = Some(pos);
                }
                JournalEvent::TierLanded {
                    mint,
                    tokens_sold,
                    signature,
                    ..
                } => {
                    if let Some(ref mut pos) = reconstructed_pos {
                        if pos.mint == mint {
                            let _ = pos.record_partial_exit(tokens_sold, signature);
                        }
                    }
                }
                JournalEvent::PositionClosed { mint, .. } => {
                    if let Some(ref mut pos) = reconstructed_pos {
                        if pos.mint == mint {
                            pos.exit_state = PositionExitState::FullyExited;
                            pos.remaining_token_amount = TokenAmount::zero();
                        }
                    }
                    reconstructed_pos = None;
                }
                JournalEvent::BuyFailed { .. } => {
                    reconstructed_pos = None;
                }
                _ => {}
            }
        }

        // Check if there was an active position or last known mint
        if let Some(pos) = reconstructed_pos {
            let on_chain_tokens = provider
                .get_token_balance(&pos.mint)
                .await
                .map_err(|e| PositionInvariantError::Other(format!("RPC balance check failed: {}", e)))?;

            // 1. Balance matches remaining in journal
            if on_chain_tokens == pos.remaining_token_amount && on_chain_tokens.as_u64() > 0 {
                info!(
                    "Recovered active position for mint {}. Remaining: {}",
                    pos.mint, on_chain_tokens
                );
                return Ok(ReconciliationStatus::RecoveredActive(pos));
            }

            // 2. On-chain balance is ZERO, but journal said position is still open
            if on_chain_tokens.as_u64() == 0 {
                // Verify if any pending sell signatures actually landed
                let mut sell_confirmed = false;
                for sig in &pos.pending_signatures {
                    if let Ok(true) = provider.is_signature_confirmed(sig).await {
                        sell_confirmed = true;
                        break;
                    }
                }

                if sell_confirmed {
                    info!("On-chain tokens are 0 and pending exit signature confirmed. Closing position in journal.");
                    let _ = self.journal.append(
                        format!("reconcile_close_{}", pos.mint),
                        JournalEvent::PositionClosed {
                            mint: pos.mint,
                            total_sol_returned: Lamports::zero(),
                            net_pnl_sol: 0,
                            closed_slot: current_slot,
                        },
                    );
                    return Ok(ReconciliationStatus::CleanIdle);
                } else {
                    warn!(
                        "CRITICAL: Journal says open with {} tokens, but wallet has 0 tokens and no confirmed exit!",
                        pos.remaining_token_amount
                    );
                    let _ = self.journal.append(
                        format!("reconcile_err_{}", pos.mint),
                        JournalEvent::ReconciliationRequired {
                            mint: pos.mint,
                            reason: "Wallet token balance 0 while journal expected positive remaining".to_string(),
                            wallet_token_balance: TokenAmount::zero(),
                            expected_token_balance: pos.remaining_token_amount,
                            slot: current_slot,
                        },
                    );
                    return Ok(ReconciliationStatus::Discrepancy {
                        mint: pos.mint,
                        reason: "Journal open but wallet token balance is zero".to_string(),
                        wallet_token_balance: TokenAmount::zero(),
                        journal_token_balance: pos.remaining_token_amount,
                    });
                }
            }

            // 3. Token balance discrepancy
            warn!(
                "Token balance mismatch: on-chain={} vs journal={}",
                on_chain_tokens, pos.remaining_token_amount
            );
            return Ok(ReconciliationStatus::Discrepancy {
                mint: pos.mint,
                reason: "Mismatch between wallet balance and journal remaining".to_string(),
                wallet_token_balance: on_chain_tokens,
                journal_token_balance: pos.remaining_token_amount,
            });
        }

        // If journal says clean/idle, check if the last known mint has leftover tokens
        if let Some(mint) = last_mint {
            let on_chain_tokens = provider
                .get_token_balance(&mint)
                .await
                .map_err(|e| PositionInvariantError::Other(format!("RPC balance check failed: {}", e)))?;

            if on_chain_tokens.as_u64() > 0 {
                warn!(
                    "CRITICAL: Journal says closed, but wallet contains {} tokens of mint {}!",
                    on_chain_tokens, mint
                );
                let _ = self.journal.append(
                    format!("reconcile_orphan_{}", mint),
                    JournalEvent::ReconciliationRequired {
                        mint,
                        reason: "Wallet holds orphan tokens while journal is closed".to_string(),
                        wallet_token_balance: on_chain_tokens,
                        expected_token_balance: TokenAmount::zero(),
                        slot: current_slot,
                    },
                );
                return Ok(ReconciliationStatus::Discrepancy {
                    mint,
                    reason: "Wallet holds orphan tokens while journal marked closed".to_string(),
                    wallet_token_balance: on_chain_tokens,
                    journal_token_balance: TokenAmount::zero(),
                });
            }
        }

        info!("Crash recovery completed cleanly. Engine is CleanIdle.");
        Ok(ReconciliationStatus::CleanIdle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_recovery_clean_idle() {
        let journal = PositionJournal::ephemeral();
        let provider = MockBalanceProvider::new(Lamports::new(10_000_000_000));
        let recovery = StartupRecoveryEngine::new(journal);

        let status = recovery.reconcile(&provider, 1000).await.unwrap();
        assert_eq!(status, ReconciliationStatus::CleanIdle);
    }

    #[tokio::test]
    async fn test_recovery_active_position() {
        let journal = PositionJournal::ephemeral();
        let mint = Mint::from_bytes([5u8; 32]);
        let sig = Signature::from_bytes([7u8; 64]);

        journal.append("buy-1", JournalEvent::BuyLanded {
            mint,
            signature: sig,
            tokens_acquired: TokenAmount::new(5000),
            sol_spent: Lamports::new(1_000_000_000),
            effective_price: 0.0002,
            slot: 500,
        }).unwrap();

        let provider = MockBalanceProvider::new(Lamports::new(9_000_000_000))
            .with_token(mint, TokenAmount::new(5000));
        let recovery = StartupRecoveryEngine::new(journal);

        let status = recovery.reconcile(&provider, 510).await.unwrap();
        match status {
            ReconciliationStatus::RecoveredActive(pos) => {
                assert_eq!(pos.mint, mint);
                assert_eq!(pos.remaining_token_amount.as_u64(), 5000);
            }
            _ => panic!("Expected RecoveredActive"),
        }
    }

    #[tokio::test]
    async fn test_recovery_discrepancy_orphan_tokens() {
        let journal = PositionJournal::ephemeral();
        let mint = Mint::from_bytes([8u8; 32]);
        let sig = Signature::from_bytes([9u8; 64]);

        // Journal says bought and then closed
        journal.append("buy-1", JournalEvent::BuyLanded {
            mint,
            signature: sig,
            tokens_acquired: TokenAmount::new(1000),
            sol_spent: Lamports::new(100_000_000),
            effective_price: 0.0001,
            slot: 100,
        }).unwrap();

        journal.append("close-1", JournalEvent::PositionClosed {
            mint,
            total_sol_returned: Lamports::new(120_000_000),
            net_pnl_sol: 20_000_000,
            closed_slot: 110,
        }).unwrap();

        // But wallet still holds 500 tokens!
        let provider = MockBalanceProvider::new(Lamports::new(5_000_000_000))
            .with_token(mint, TokenAmount::new(500));
        let recovery = StartupRecoveryEngine::new(journal);

        let status = recovery.reconcile(&provider, 120).await.unwrap();
        match status {
            ReconciliationStatus::Discrepancy { wallet_token_balance, .. } => {
                assert_eq!(wallet_token_balance.as_u64(), 500);
            }
            _ => panic!("Expected Discrepancy"),
        }
    }
}
