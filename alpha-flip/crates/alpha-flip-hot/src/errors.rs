use thiserror::Error;

#[derive(Error, Debug)]
pub enum PositionInvariantError {
    #[error("CRITICAL INVARIANT VIOLATION: remaining tokens {remaining} exceed total tokens {total}")]
    RemainingExceedsTotal { remaining: u64, total: u64 },

    #[error("Sell amount {sell} exceeds remaining tokens {remaining}")]
    SellAmountExceedsRemaining { sell: u64, remaining: u64 },

    #[error("Entry price must be positive, got {0}")]
    NonPositiveEntryPrice(f64),
}

#[derive(Error, Debug)]
pub enum RiskError {
    #[error("Risk limit breached: {0}")]
    LimitBreached(String),

    #[error("Hard stop loss triggered: {loss_bps} bps (max allowed {max_loss_bps} bps)")]
    StopLossTriggered { loss_bps: u16, max_loss_bps: u16 },

    #[error("Max holding duration exceeded: elapsed {elapsed_secs}s (max {max_secs}s)")]
    MaxHoldDurationExceeded { elapsed_secs: u64, max_secs: u64 },

    #[error("Transfer hook present on token mint: VETO triggered")]
    TransferHookVeto,

    #[error("Cabal risk score {score} exceeded safety threshold {threshold}")]
    CabalVeto { score: u8, threshold: u8 },

    #[error("Strict capital velocity breach: attempt to hold {attempted} concurrent positions (strictly 1 allowed)")]
    ConcurrentPositionBreach { attempted: usize },
}

#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("Failed to read configuration: {0}")]
    Io(#[from] std::io::Error),

    #[error("Failed to parse TOML configuration: {0}")]
    Toml(#[from] toml::de::Error),

    #[error("Configuration validation failed: {0}")]
    Validation(String),

    #[error("Missing required environment secret or variable: {0}")]
    MissingEnv(String),
}

#[derive(Error, Debug)]
pub enum StateError {
    #[error("Out-of-order gRPC event discarded: event slot {event_slot} < state slot {state_slot}")]
    StaleSlot { event_slot: u64, state_slot: u64 },

    #[error("Invalid state transition from {from} via {action}")]
    InvalidTransition { from: String, action: String },

    #[error("Token not found in cache: {0}")]
    TokenNotFound(String),
}

#[derive(Error, Debug, Clone, PartialEq)]
pub enum EconomicError {
    #[error("Price impact {impact_bps} bps exceeds maximum threshold {max_bps} bps")]
    ExcessivePriceImpact { impact_bps: u16, max_bps: u16 },

    #[error("Insufficient economic edge: gross edge {gross_edge_bps} bps fails to clear hurdle {hurdle_bps} bps (margin of safety: {margin_bps} bps)")]
    InsufficientEdge { gross_edge_bps: u16, hurdle_bps: u16, margin_bps: u16 },

    #[error("Position size below minimum allowable trade size: {size_lamports} < {min_lamports}")]
    SizeBelowMinimumFloor { size_lamports: u64, min_lamports: u64 },

    #[error("Position size exceeds pool liquidity cap: requested {size_lamports}, cap {max_liquidity_lamports} ({max_pct}%)")]
    LiquidityCapExceeded { size_lamports: u64, max_liquidity_lamports: u64, max_pct: f64 },

    #[error("Cold advisory vetoes trade: {reason}")]
    AdvisoryVeto { reason: String },

    #[error("Insufficient curve liquidity: reserve {reserve_lamports} below minimum {min_required}")]
    InsufficientLiquidity { reserve_lamports: u64, min_required: u64 },

    #[error("Math overflow in curve calculation")]
    MathOverflow,

    #[error("Slippage tolerance breach: received {actual} < expected minimum {min_out}")]
    SlippageToleranceBreached { actual: u64, min_out: u64 },
}

#[derive(Error, Debug, Clone, PartialEq)]
pub enum ExecutionError {
    #[error("Blockhash is stale: age {age_slots} slots exceeds max allowable {max_slots} slots")]
    StaleBlockhash { age_slots: u64, max_slots: u64 },

    #[error("Blockhash cache uninitialized")]
    UninitializedBlockhash,

    #[error("Compute budget exceeded: estimated {cu_estimate}, limit {cu_limit}")]
    ComputeBudgetExceeded { cu_estimate: u32, cu_limit: u32 },

    #[error("Execution budget exhausted: requested {requested_lamports}, remaining {remaining_lamports}")]
    BudgetExhausted { requested_lamports: u64, remaining_lamports: u64 },

    #[error("Jito bundle submission rejected: {reason}")]
    BundleRejected { reason: String },

    #[error("Bundle landing timeout after {elapsed_ms}ms (bundle_id: {bundle_id})")]
    BundleTimeout { bundle_id: String, elapsed_ms: u64 },

    #[error("Double buy invariant protection: order already in-flight for mint {mint}")]
    DoubleBuyPrevented { mint: String },

    #[error("Double sell invariant protection: exit already in-flight for mint {mint}")]
    DoubleSellPrevented { mint: String },

    #[error("No valid Jito tip accounts available")]
    NoTipAccountsAvailable,

    #[error("Tip {tip_lamports} exceeds safety cap {max_tip_lamports}")]
    TipCapExceeded { tip_lamports: u64, max_tip_lamports: u64 },

    #[error("Bundle size {size} bytes exceeds Solana MTU packet limit of {max_size} bytes")]
    BundleSizeLimitExceeded { size: usize, max_size: usize },

    #[error("Bundle transaction count {count} exceeds limit of {max_count}")]
    BundleTransactionCountExceeded { count: usize, max_count: usize },

    #[error("Partial sell mismatch: remaining position balance {remaining} < attempt {attempted}")]
    InvalidRemainingBalance { remaining: u64, attempted: u64 },
}

#[derive(Error, Debug, Clone, PartialEq)]
pub enum ExitError {
    #[error("No open position to exit")]
    NoOpenPosition,

    #[error("Exit expected proceeds {expected_lamports} below min acceptable {min_acceptable_lamports}")]
    InsufficientProceeds { expected_lamports: u64, min_acceptable_lamports: u64 },

    #[error("Requested exit token amount {requested} exceeds remaining balance {remaining}")]
    ExceedsRemainingBalance { requested: u64, remaining: u64 },

    #[error("Pending exit signature or bundle already in-flight for mint {mint}")]
    PendingExitInFlight { mint: String },

    #[error("Emergency exit triggered: {reason}")]
    EmergencyExitTriggered { reason: String },

    #[error("Quote calculation failed for exit: {reason}")]
    QuoteFailed { reason: String },

    #[error("Ladder tier {tier} already filled or pending")]
    TierAlreadyExecuted { tier: u8 },
}

#[derive(Error, Debug)]
pub enum HotError {
    #[error("Config error: {0}")]
    Config(#[from] ConfigError),

    #[error("Risk error: {0}")]
    Risk(#[from] RiskError),

    #[error("Economic error: {0}")]
    Economic(#[from] EconomicError),

    #[error("Execution error: {0}")]
    Execution(#[from] ExecutionError),

    #[error("Exit error: {0}")]
    Exit(#[from] ExitError),

    #[error("Position invariant error: {0}")]
    Position(#[from] PositionInvariantError),

    #[error("State error: {0}")]
    State(#[from] StateError),

    #[error("Generic error: {0}")]
    Other(#[from] anyhow::Error),
}
