use crate::clock::SlotClock;
use crate::errors::{HotError, StateError};
use crate::grpc::metrics::GrpcMetrics;
use crate::grpc::reconnect_supervisor::ReconnectSupervisor;
use crate::grpc::replay_recorder::ReplayRecorder;
use crate::grpc::subscription_manager::SubscriptionManager;
use crate::grpc::transport::{GrpcStreamMessage, GrpcTransport};
use crate::types::{Pubkey, Slot};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc::{self, Receiver, Sender};
use tokio::sync::RwLock;
use tracing::{error, info, warn};

/// Default capacity for the bounded event channel connecting gRPC eyes to decoders
pub const DEFAULT_CHANNEL_CAPACITY: usize = 10_000;
/// High-watermark threshold (80% full) triggering defensive warning
pub const HIGH_WATERMARK_RATIO: f64 = 0.80;

/// Event envelope dispatched from gRPC client to hot pipeline decoders
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IngestedStreamEvent {
    Account(crate::grpc::transport::AccountUpdateFrame),
    Transaction(crate::grpc::transport::TransactionUpdateFrame),
    Slot(crate::grpc::transport::SlotUpdateFrame),
}

/// Yellowstone gRPC Eyes client orchestrating connection, subscriptions, replay, and backpressure
pub struct YellowstoneGrpcClient<T: GrpcTransport> {
    endpoint: String,
    x_token: Option<String>,
    transport: T,
    subscription_manager: Arc<RwLock<SubscriptionManager>>,
    reconnect_supervisor: ReconnectSupervisor,
    slot_clock: Arc<SlotClock>,
    replay_recorder: ReplayRecorder,
    metrics: Arc<GrpcMetrics>,

    // Bounded channel to downstream decoders
    event_sender: Sender<IngestedStreamEvent>,
    channel_capacity: usize,
    is_running: bool,
}

impl<T: GrpcTransport> YellowstoneGrpcClient<T> {
    pub fn new(
        endpoint: String,
        x_token: Option<String>,
        transport: T,
        subscription_manager: SubscriptionManager,
        slot_clock: Arc<SlotClock>,
        channel_capacity: usize,
    ) -> (Self, Receiver<IngestedStreamEvent>) {
        let (tx, rx) = mpsc::channel(channel_capacity);
        let metrics = GrpcMetrics::new();
        let replay_recorder = ReplayRecorder::new(2048);

        let client = Self {
            endpoint,
            x_token,
            transport,
            subscription_manager: Arc::new(RwLock::new(subscription_manager)),
            reconnect_supervisor: ReconnectSupervisor::default(),
            slot_clock,
            replay_recorder,
            metrics,
            event_sender: tx,
            channel_capacity,
            is_running: false,
        };

        (client, rx)
    }

    pub fn metrics(&self) -> Arc<GrpcMetrics> {
        self.metrics.clone()
    }

    pub fn replay_recorder(&self) -> ReplayRecorder {
        self.replay_recorder.clone()
    }

    pub fn slot_clock(&self) -> Arc<SlotClock> {
        self.slot_clock.clone()
    }

    /// Establish initial connection and sync subscription filter
    pub async fn connect(&mut self) -> Result<(), HotError> {
        info!(endpoint = %self.endpoint, "Connecting to Yellowstone gRPC endpoint");
        self.transport
            .connect(&self.endpoint, self.x_token.as_deref())
            .await?;

        self.reconnect_supervisor.record_success();
        self.metrics.set_connected(true);

        let filter = {
            let mgr = self.subscription_manager.read().await;
            mgr.build_filter()
        };

        self.transport.subscribe(filter).await?;
        self.is_running = true;
        info!("Yellowstone gRPC connection and subscription active");
        Ok(())
    }

    /// Dynamically register an account and refresh gRPC subscription
    pub async fn subscribe_account(&mut self, pubkey: Pubkey) -> Result<bool, HotError> {
        let mut mgr = self.subscription_manager.write().await;
        let added = mgr.subscribe_account(pubkey);
        if added && self.transport.is_connected() {
            let filter = mgr.build_filter();
            self.transport.subscribe(filter).await?;
        }
        Ok(added)
    }

    /// Dynamically unregister an account and refresh gRPC subscription
    pub async fn unsubscribe_account(&mut self, pubkey: &Pubkey) -> Result<bool, HotError> {
        let mut mgr = self.subscription_manager.write().await;
        let removed = mgr.unsubscribe_account(pubkey);
        if removed && self.transport.is_connected() {
            let filter = mgr.build_filter();
            self.transport.subscribe(filter).await?;
        }
        Ok(removed)
    }

    /// Process next single message from transport with backpressure & metrics
    pub async fn process_one(&mut self) -> Result<bool, HotError> {
        let msg = match self.transport.next_message().await? {
            Some(m) => m,
            None => return Ok(false),
        };

        self.metrics.inc_messages();
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        match msg {
            GrpcStreamMessage::Account(frame) => {
                self.metrics.inc_account_updates();
                self.replay_recorder.record_account(&frame, now_ms).await;
                self.dispatch_event(IngestedStreamEvent::Account(frame)).await?;
            }
            GrpcStreamMessage::Transaction(frame) => {
                self.metrics.inc_transaction_events();
                self.replay_recorder.record_transaction(&frame, now_ms).await;
                self.dispatch_event(IngestedStreamEvent::Transaction(frame)).await?;
            }
            GrpcStreamMessage::Slot(frame) => {
                self.metrics.inc_slot_updates();
                self.slot_clock.advance_to(frame.slot);
                self.replay_recorder.record_slot(&frame, now_ms).await;
                self.dispatch_event(IngestedStreamEvent::Slot(frame)).await?;
            }
            GrpcStreamMessage::Ping | GrpcStreamMessage::Pong => {
                // Heartbeat pulse
            }
        }

        Ok(true)
    }

    /// Enforce explicit backpressure policy before dispatching event
    async fn dispatch_event(&self, event: IngestedStreamEvent) -> Result<(), HotError> {
        let queue_depth = self.channel_capacity.saturating_sub(self.event_sender.capacity());
        self.metrics.set_queue_depth(queue_depth as u64);

        let high_watermark = (self.channel_capacity as f64 * HIGH_WATERMARK_RATIO) as usize;
        if queue_depth >= high_watermark {
            warn!(
                queue_depth,
                capacity = self.channel_capacity,
                "Yellowstone gRPC channel backpressure high-watermark reached"
            );
        }

        match self.event_sender.try_reserve() {
            Ok(permit) => {
                permit.send(event);
                Ok(())
            }
            Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                self.metrics.inc_dropped_events();
                error!(
                    queue_depth,
                    capacity = self.channel_capacity,
                    "DEFENSIVE ALERT: gRPC bounded queue full! Event dropped to preserve hot path stability."
                );
                Err(HotError::Risk(crate::errors::RiskError::LimitBreached(
                    "gRPC event channel overflow: entering defensive mode".to_string(),
                )))
            }
            Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                Err(HotError::State(StateError::InvalidTransition {
                    from: "Active".to_string(),
                    action: "SendToClosedReceiver".to_string(),
                }))
            }
        }
    }

    pub async fn disconnect(&mut self) -> Result<(), HotError> {
        self.is_running = false;
        self.metrics.set_connected(false);
        self.transport.disconnect().await
    }
}
