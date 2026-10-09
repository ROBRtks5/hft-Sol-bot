pub mod clock;
pub mod config;
pub mod decoder;
pub mod economics;
pub mod errors;
pub mod events;
pub mod execution;
pub mod exit;
pub mod grpc;
pub mod observability;
pub mod orchestrator;
pub mod position;
pub mod replay;
pub mod risk;
pub mod shadow;
pub mod state;
pub mod types;

// Re-exports for ergonomics
pub use clock::SlotClock;
pub use config::{AppConfig, HotConfig, TradingMode};
pub use decoder::{DecodedInstructionEvent, InstructionDecoder, ProgramRegistry};
pub use economics::{
    DexProtocol, EconomicEdgeGate, EdgeEvaluation, FeeModel, MinOutCalculator,
    PositionSizer, PriceImpactModel, PumpCurveEngine, QuoteEngine, QuoteRequest,
    QuoteResult, RaydiumAmmEngine, SizingContext,
};
pub use errors::{
    ConfigError, EconomicError, ExecutionError, ExitError, HotError, PositionInvariantError,
    RiskError, StateError,
};
pub use events::{MarketState, TradeEvent, TradeSide};
pub use execution::{
    BlockhashCache, BudgetGovernor, BundleBuilder, BundleStatus, CUProfileCache,
    FillStatus, FillTracker, InFlightOrder, JitoBundle, JitoClient, MarketRegime,
    MockJitoClient, RegionalBlockEngine, SendRouter, TipOptimizer,
    MAX_BUNDLE_TRANSACTIONS, SOLANA_MAX_PACKET_SIZE,
};
pub use observability::{
    init_logging, sanitize_log_content, HealthChecker, HealthState, HealthStatus, MetricsRegistry,
};
pub use exit::{
    AdverseSelectionDetector, AdverseSelectionReason, EmergencyExitEngine, EmergencyReason,
    ExitAction, ExitDecision, ExitEvaluationContext, ExitUrgency, LadderController,
    MarketScenario, OrderFlowImbalanceTracker, PriceVelocityTracker, ScenarioTimeStop,
    SmartMoneyDumpDetector, SyntheticOrderEngine,
};
pub use orchestrator::{
    EngineEvent, OperatingMode, OrchestratorEngine, OrchestratorEventLoop,
    OrchestratorEventLoopConfig, OrchestratorState, RiskLimits, RiskSnapshotState,
};
pub use position::{
    BalanceProvider, JournalEvent, JournalRecord, MockBalanceProvider, PositionExitState,
    PositionManager, PositionJournal, PositionState, PositionSummary, ReconciliationStatus,
    StartupRecoveryEngine,
};
pub use replay::{ReplayDecisionLog, ReplayFrame, ReplayLoader, ReplayRunner, ReplaySummary};
pub use shadow::{
    ShadowActivePosition, ShadowPnlModel, ShadowPnlReport, ShadowSimulator,
    ShadowSimulatorConfig, ShadowTradeRecord, SimulatedFrictionCost,
};
pub use risk::{RiskSnapshot, RiskTier};
pub use state::{BoundedBuyerSet, TokenRuntime, TokenState, WalletProfile};
pub use types::{
    Blockhash, Lamports, Mint, Pubkey, Signature, Slot, TokenAmount, WriteVersion,
};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EngineState {
    Idle,
    Scanning,
    EvaluatingSignal,
    SubmittingOrder,
    InPosition,
    ExitingPosition,
    Cooldown,
    Recovering,
    Paused,
    Terminated,
}

impl Default for EngineState {
    fn default() -> Self {
        EngineState::Idle
    }
}

/// Invariant: Cold path provides advisory input ONLY.
/// It can advise a lower size or a VETO, but can NEVER execute or widen stops.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColdAdvisorySignal {
    pub mint: String,
    pub cabal_score: f32, // 0.0 to 1.0
    pub narrative_velocity: f32,
    pub advice_action: AdvisoryAction,
    pub timestamp_ms: u64,
    pub confidence: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AdvisoryAction {
    Neutral,
    Favorable,
    Downsize,
    Veto,
}

/// Telemetry pulse broadcast from hot to cold via Redis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotTelemetryPulse {
    pub engine_state: EngineState,
    pub mode: TradingMode,
    pub current_position_mint: Option<String>,
    pub uptime_secs: u64,
    pub total_flips_executed: u64,
    pub realized_pnl_lamports: i64,
    pub last_latency_micros: u64,
}
