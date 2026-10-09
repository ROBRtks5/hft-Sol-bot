use crate::clock::SlotClock;
use crate::errors::HotError;
use crate::grpc::transport::AccountUpdateFrame;
use crate::types::{Pubkey, Slot};
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

/// Abstraction for standard Solana JSON-RPC endpoints to perform initialization & recovery
#[async_trait]
pub trait RpcSnapshotProvider: Send + Sync {
    /// Fetch current cluster slot height
    async fn get_slot(&self) -> Result<Slot, HotError>;

    /// Fetch single account state snapshot
    async fn get_account(&self, pubkey: &Pubkey) -> Result<Option<AccountUpdateFrame>, HotError>;

    /// Batch fetch multiple account state snapshots
    async fn get_multiple_accounts(
        &self,
        pubkeys: &[Pubkey],
    ) -> Result<Vec<(Pubkey, Option<AccountUpdateFrame>)>, HotError>;
}

/// In-memory mock implementation of `RpcSnapshotProvider` for unit tests
#[derive(Default, Clone)]
pub struct MockRpcSnapshotProvider {
    pub slot: Slot,
    pub accounts: Arc<RwLock<HashMap<Pubkey, AccountUpdateFrame>>>,
}

impl MockRpcSnapshotProvider {
    pub fn new(initial_slot: Slot) -> Self {
        Self {
            slot: initial_slot,
            accounts: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn set_account(&self, pubkey: Pubkey, frame: AccountUpdateFrame) {
        let mut map = self.accounts.write().await;
        map.insert(pubkey, frame);
    }
}

#[async_trait]
impl RpcSnapshotProvider for MockRpcSnapshotProvider {
    async fn get_slot(&self) -> Result<Slot, HotError> {
        Ok(self.slot)
    }

    async fn get_account(&self, pubkey: &Pubkey) -> Result<Option<AccountUpdateFrame>, HotError> {
        let map = self.accounts.read().await;
        Ok(map.get(pubkey).cloned())
    }

    async fn get_multiple_accounts(
        &self,
        pubkeys: &[Pubkey],
    ) -> Result<Vec<(Pubkey, Option<AccountUpdateFrame>)>, HotError> {
        let map = self.accounts.read().await;
        let mut results = Vec::with_capacity(pubkeys.len());
        for pk in pubkeys {
            results.push((*pk, map.get(pk).cloned()));
        }
        Ok(results)
    }
}

/// Bootstraps initial state prior to activating Yellowstone gRPC stream
pub struct SnapshotBootstrapper;

impl SnapshotBootstrapper {
    /// Synchronize SlotClock with cluster head prior to stream ingestion
    pub async fn initialize_clock<P: RpcSnapshotProvider>(
        provider: &P,
        clock: &SlotClock,
    ) -> Result<Slot, HotError> {
        let initial_slot = provider.get_slot().await?;
        clock.advance_to(initial_slot);
        info!(
            slot = initial_slot.as_u64(),
            "SlotClock initialized from cluster snapshot"
        );
        Ok(initial_slot)
    }

    /// Preload bootstrap accounts into initial frames
    pub async fn preload_accounts<P: RpcSnapshotProvider>(
        provider: &P,
        accounts: &[Pubkey],
    ) -> Result<Vec<AccountUpdateFrame>, HotError> {
        if accounts.is_empty() {
            return Ok(Vec::new());
        }

        let fetched = provider.get_multiple_accounts(accounts).await?;
        let mut valid_frames = Vec::new();

        for (pubkey, maybe_frame) in fetched {
            if let Some(frame) = maybe_frame {
                valid_frames.push(frame);
            } else {
                info!(pubkey = %pubkey, "Bootstrap account not yet created on chain");
            }
        }

        info!(
            preloaded_count = valid_frames.len(),
            "Bootstrap accounts loaded from RPC"
        );
        Ok(valid_frames)
    }
}
