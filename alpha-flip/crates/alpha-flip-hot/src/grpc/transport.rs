use crate::errors::HotError;
use crate::types::{Mint, Pubkey, Signature, Slot, WriteVersion};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Raw account update frame ingested from Yellowstone gRPC stream
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountUpdateFrame {
    pub pubkey: Pubkey,
    pub slot: Slot,
    pub write_version: WriteVersion,
    pub lamports: u64,
    pub data: Vec<u8>,
    pub owner: Pubkey,
    pub executable: bool,
    pub rent_epoch: u64,
}

/// Raw compiled instruction within a transaction
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct RawInstruction {
    pub program_id: Pubkey,
    pub accounts: Vec<Pubkey>,
    pub data: Vec<u8>,
}

/// Inner instructions (CPI) executed by a top-level instruction
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct RawInnerInstructionSet {
    pub parent_instruction_index: u8,
    pub instructions: Vec<RawInstruction>,
}

/// Raw transaction event frame ingested from Yellowstone gRPC stream
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TransactionUpdateFrame {
    pub signature: Signature,
    pub slot: Slot,
    pub is_vote: bool,
    pub account_keys: Vec<Pubkey>,
    pub log_messages: Vec<String>,
    pub err: Option<String>,
    #[serde(default)]
    pub instructions: Vec<RawInstruction>,
    #[serde(default)]
    pub inner_instructions: Vec<RawInnerInstructionSet>,
}

/// Slot progression frame ingested from Yellowstone gRPC stream
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotUpdateFrame {
    pub slot: Slot,
    pub parent_slot: Option<Slot>,
    pub status: String, // "processed", "confirmed", "rooted"
}

/// Normalized envelope for all messages arriving on the gRPC transport stream
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload")]
pub enum GrpcStreamMessage {
    Account(AccountUpdateFrame),
    Transaction(TransactionUpdateFrame),
    Slot(SlotUpdateFrame),
    Ping,
    Pong,
}

/// Filter configuration applied to the gRPC subscription stream
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct SubscriptionFilter {
    pub accounts: Vec<Pubkey>,
    pub program_ids: Vec<Pubkey>,
    pub commitment: String,
}

/// Transport abstraction for Yellowstone gRPC.
///
/// CONFIDENCE: LOW (Proto layout depends on yellowstone-grpc upstream version)
/// TODO(upstream): Verify exact proto schema with https://github.com/rpcpool/yellowstone-grpc
/// Before live production, link against official yellowstone-grpc-client crate.
/// All internal hot-path engines compile and test deterministically against this trait.
#[async_trait]
pub trait GrpcTransport: Send + Sync {
    /// Establish stream connection with endpoint and optional auth x-token
    async fn connect(&mut self, endpoint: &str, x_token: Option<&str>) -> Result<(), HotError>;

    /// Submit or update subscription filter on the active stream
    async fn subscribe(&mut self, filter: SubscriptionFilter) -> Result<(), HotError>;

    /// Read next message from gRPC stream
    async fn next_message(&mut self) -> Result<Option<GrpcStreamMessage>, HotError>;

    /// Terminate stream connection
    async fn disconnect(&mut self) -> Result<(), HotError>;

    /// Check if underlying stream transport is active
    fn is_connected(&self) -> bool;
}

/// In-memory mock implementation of `GrpcTransport` for deterministic unit testing
#[derive(Default, Clone)]
pub struct MockGrpcTransport {
    connected: bool,
    current_filter: Option<SubscriptionFilter>,
    incoming_queue: Arc<Mutex<VecDeque<GrpcStreamMessage>>>,
    pub connect_count: usize,
    pub disconnect_count: usize,
    pub subscribe_count: usize,
}

impl MockGrpcTransport {
    pub fn new() -> Self {
        Self::default()
    }

    /// Enqueue a message to be returned by `next_message()`
    pub async fn push_incoming(&self, message: GrpcStreamMessage) {
        let mut queue = self.incoming_queue.lock().await;
        queue.push_back(message);
    }

    pub fn get_filter(&self) -> Option<SubscriptionFilter> {
        self.current_filter.clone()
    }
}

#[async_trait]
impl GrpcTransport for MockGrpcTransport {
    async fn connect(&mut self, _endpoint: &str, _x_token: Option<&str>) -> Result<(), HotError> {
        self.connected = true;
        self.connect_count += 1;
        Ok(())
    }

    async fn subscribe(&mut self, filter: SubscriptionFilter) -> Result<(), HotError> {
        if !self.connected {
            return Err(HotError::State(crate::errors::StateError::InvalidTransition {
                from: "Disconnected".to_string(),
                action: "Subscribe".to_string(),
            }));
        }
        self.current_filter = Some(filter);
        self.subscribe_count += 1;
        Ok(())
    }

    async fn next_message(&mut self) -> Result<Option<GrpcStreamMessage>, HotError> {
        if !self.connected {
            return Ok(None);
        }
        let mut queue = self.incoming_queue.lock().await;
        Ok(queue.pop_front())
    }

    async fn disconnect(&mut self) -> Result<(), HotError> {
        self.connected = false;
        self.disconnect_count += 1;
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.connected
    }
}
