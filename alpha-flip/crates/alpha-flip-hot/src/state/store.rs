use crate::decoder::DecodedInstructionEvent;
use crate::events::{MarketState, TradeSide};
use crate::grpc::transport::AccountUpdateFrame;
use crate::state::account_to_mint_index::AccountToMintIndex;
use crate::state::market_state_machine::MarketStateMachine;
use crate::state::reconciliation::ReconciliationEngine;
use crate::state::token_runtime::TokenRuntime;
use crate::state::ttl_eviction::{TtlEvictionManager, WalletProfile};
use crate::types::{Mint, Pubkey, Slot};
use std::collections::HashMap;
use tracing::{debug, info, warn};

/// High-performance thread-safe state store for active Solana memecoins
pub struct LocalStateStore {
    tokens: HashMap<Mint, TokenRuntime>,
    wallets: HashMap<Pubkey, WalletProfile>,
    pub account_index: AccountToMintIndex,
    pub eviction_manager: TtlEvictionManager,
    pub reconciliation: ReconciliationEngine,
    total_account_updates_applied: u64,
    total_account_updates_stale_dropped: u64,
}

impl Default for LocalStateStore {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalStateStore {
    pub fn new() -> Self {
        Self {
            tokens: HashMap::with_capacity(256),
            wallets: HashMap::with_capacity(1024),
            account_index: AccountToMintIndex::new(),
            eviction_manager: TtlEvictionManager::default(),
            reconciliation: ReconciliationEngine::default(),
            total_account_updates_applied: 0,
            total_account_updates_stale_dropped: 0,
        }
    }

    pub fn get_token(&self, mint: &Mint) -> Option<&TokenRuntime> {
        self.tokens.get(mint)
    }

    pub fn get_token_mut(&mut self, mint: &Mint) -> Option<&mut TokenRuntime> {
        self.tokens.get_mut(mint)
    }

    pub fn contains_token(&self, mint: &Mint) -> bool {
        self.tokens.contains_key(mint)
    }

    pub fn tokens_count(&self) -> usize {
        self.tokens.len()
    }

    pub fn can_trade(&self, mint: &Mint) -> bool {
        self.tokens.get(mint).map(|t| t.can_trade()).unwrap_or(false)
    }

    /// Process raw AccountUpdate frame from Yellowstone gRPC stream
    pub fn apply_account_update(&mut self, frame: AccountUpdateFrame) -> bool {
        // 1. Resolve target mint through index
        let maybe_mint = self.account_index.resolve_mint(&frame.pubkey);

        let mint = match maybe_mint {
            Some(m) => m,
            None => {
                // Not yet mapped -> Queue safely without dropping
                debug!(account = %frame.pubkey, "Account update unmapped, queued for delayed resolution");
                self.account_index.queue_unresolved(frame);
                return false;
            }
        };

        // 2. Fetch or initialize token runtime
        let token = self
            .tokens
            .entry(mint)
            .or_insert_with(|| TokenRuntime::new(mint, frame.slot));

        // 3. INVARIANT 6: Deduplication check (monotonic slot and write_version)
        if !token.is_update_newer(frame.slot, frame.write_version) {
            self.total_account_updates_stale_dropped =
                self.total_account_updates_stale_dropped.saturating_add(1);
            return false;
        }

        // 4. Update monotonicity markers
        token.last_slot = frame.slot;
        token.last_write_version = frame.write_version;
        token.last_update_slot = frame.slot;

        self.total_account_updates_applied =
            self.total_account_updates_applied.saturating_add(1);
        true
    }

    /// Process decoded instruction events from Raydium or Pump.fun decoders
    pub fn apply_decoded_instruction(&mut self, event: &DecodedInstructionEvent) {
        match event {
            DecodedInstructionEvent::PumpCreate(create) => {
                // 1. Register index mapping
                self.account_index
                    .register_bonding_curve(create.bonding_curve, create.mint);

                // 2. Initialize token runtime
                let token = self
                    .tokens
                    .entry(create.mint)
                    .or_insert_with(|| TokenRuntime::new(create.mint, create.slot));

                token.bonding_curve = Some(create.bonding_curve);
                token.last_slot = create.slot;
                token.last_update_slot = create.slot;

                // 3. Transition to PumpCurveActive
                if let Ok(next) = MarketStateMachine::transition(
                    &token.state,
                    MarketState::PumpCurveActive {
                        bonding_curve: create.bonding_curve,
                    },
                ) {
                    token.state = next;
                }

                // 4. Drain any pending account updates queued for this curve
                let pending = self.account_index.drain_unresolved(&create.bonding_curve);
                for frame in pending {
                    self.apply_account_update(frame);
                }
            }

            DecodedInstructionEvent::PumpTrade(trade) => {
                let token = self
                    .tokens
                    .entry(trade.mint)
                    .or_insert_with(|| TokenRuntime::new(trade.mint, trade.slot));

                token.last_update_slot = trade.slot;

                match trade.side {
                    TradeSide::Buy => {
                        token.buyers.record_buy(trade.trader);
                        token.virtual_sol_reserves += trade.sol_amount;
                        token.virtual_token_reserves -= trade.token_amount;
                    }
                    TradeSide::Sell => {
                        token.buyers.record_sell(
                            trade.trader,
                            trade.slot,
                            trade.sol_amount,
                            false,
                            false,
                        );
                        token.virtual_sol_reserves -= trade.sol_amount;
                        token.virtual_token_reserves += trade.token_amount;
                    }
                }
            }

            DecodedInstructionEvent::PumpMigrate(migrate) => {
                if let Some(token) = self.tokens.get_mut(&migrate.mint) {
                    token.last_update_slot = migrate.slot;
                    if let Ok(next) = MarketStateMachine::transition(
                        &token.state,
                        MarketState::Graduating {
                            expected_pool: None,
                        },
                    ) {
                        token.state = next;
                    }
                }
            }

            DecodedInstructionEvent::RaydiumPool(pool) => {
                self.account_index
                    .register_raydium_pool(pool.pool, pool.coin_mint);

                let token = self
                    .tokens
                    .entry(pool.coin_mint)
                    .or_insert_with(|| TokenRuntime::new(pool.coin_mint, pool.slot));

                token.raydium_pool = Some(pool.pool);
                token.last_slot = pool.slot;
                token.last_update_slot = pool.slot;

                if let Ok(next) = MarketStateMachine::transition(
                    &token.state,
                    MarketState::RaydiumPoolActive { pool: pool.pool },
                ) {
                    token.state = next;
                }

                let pending = self.account_index.drain_unresolved(&pool.pool);
                for frame in pending {
                    self.apply_account_update(frame);
                }
            }

            DecodedInstructionEvent::RaydiumSwap(swap) => {
                let token = self
                    .tokens
                    .entry(swap.mint)
                    .or_insert_with(|| TokenRuntime::new(swap.mint, swap.slot));

                token.last_update_slot = swap.slot;

                match swap.side {
                    TradeSide::Buy => {
                        token.buyers.record_buy(swap.trader);
                    }
                    TradeSide::Sell => {
                        token.buyers.record_sell(
                            swap.trader,
                            swap.slot,
                            swap.sol_amount,
                            false,
                            false,
                        );
                    }
                }
            }
        }
    }

    /// Perform TTL and memory overflow pruning
    pub fn prune(&mut self, current_slot: Slot, active_position: Option<&Mint>) -> usize {
        let tokens_evicted =
            self.eviction_manager
                .prune_tokens(&mut self.tokens, current_slot, active_position);
        let wallets_evicted =
            self.eviction_manager
                .prune_wallets(&mut self.wallets, current_slot);

        tokens_evicted + wallets_evicted
    }

    pub fn blacklist_token(&mut self, mint: &Mint, reason: String) {
        if let Some(token) = self.tokens.get_mut(mint) {
            token.state = MarketState::Blacklisted { reason };
        }
    }
}
