use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TradingMode {
    Observe,
    Shadow,
    Live,
    Recovering,
    Paused,
    Kill,
}

impl TradingMode {
    pub fn is_execution_active(&self) -> bool {
        matches!(self, TradingMode::Live)
    }

    pub fn allows_simulated_fills(&self) -> bool {
        matches!(self, TradingMode::Shadow)
    }

    pub fn is_safety_halt(&self) -> bool {
        matches!(self, TradingMode::Paused | TradingMode::Kill)
    }
}

impl FromStr for TradingMode {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_lowercase().as_str() {
            "observe" => Ok(TradingMode::Observe),
            "shadow" => Ok(TradingMode::Shadow),
            "live" => Ok(TradingMode::Live),
            "recovering" => Ok(TradingMode::Recovering),
            "paused" => Ok(TradingMode::Paused),
            "kill" => Ok(TradingMode::Kill),
            other => Err(anyhow::anyhow!(
                "Unknown trading mode '{}'. Valid: observe, shadow, live, recovering, paused, kill",
                other
            )),
        }
    }
}

impl std::fmt::Display for TradingMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TradingMode::Observe => write!(f, "OBSERVE"),
            TradingMode::Shadow => write!(f, "SHADOW"),
            TradingMode::Live => write!(f, "LIVE"),
            TradingMode::Recovering => write!(f, "RECOVERING"),
            TradingMode::Paused => write!(f, "PAUSED"),
            TradingMode::Kill => write!(f, "KILL"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrpcConfig {
    pub endpoint: String,
    pub x_token: Option<String>,
    pub commitment: String,
    pub connect_timeout_ms: u64,
}

impl Default for GrpcConfig {
    fn default() -> Self {
        Self {
            endpoint: "https://grpc.helius.xyz:443".to_string(),
            x_token: None,
            commitment: "processed".to_string(),
            connect_timeout_ms: 5000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisConfig {
    pub redis_url: String,
    pub advisory_channel: String,
    pub telemetry_channel: String,
}

impl Default for RedisConfig {
    fn default() -> Self {
        Self {
            redis_url: "redis://127.0.0.1:6379/0".to_string(),
            advisory_channel: "alpha_flip:cold:advisory".to_string(),
            telemetry_channel: "alpha_flip:hot:telemetry".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JitoConfig {
    pub block_engine_url: String,
    pub tip_account: String,
    pub default_tip_lamports: u64,
    pub max_tip_lamports: u64,
}

impl Default for JitoConfig {
    fn default() -> Self {
        Self {
            block_engine_url: "https://amsterdam.mainnet.block-engine.jito.wtf".to_string(),
            tip_account: "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5".to_string(),
            default_tip_lamports: 1_000_000, // 0.001 SOL
            max_tip_lamports: 10_000_000,    // 0.010 SOL
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskConfig {
    /// STRICT CAPITAL VELOCITY INVARIANT: Never exceed 1 concurrent position
    pub max_concurrent_positions: usize,
    /// Absolute hard capital cap per flip in SOL
    pub max_position_sol: f64,
    /// Slippage tolerance in basis points (150 = 1.5%)
    pub max_slippage_bps: u16,
    /// Mandatory stop loss in basis points (350 = -3.5%)
    pub stop_loss_bps: u16,
    /// Cabal score threshold (0-100) above which trades are vetoed
    pub cabal_risk_veto_threshold: u8,
}

impl Default for RiskConfig {
    fn default() -> Self {
        Self {
            max_concurrent_positions: 1,
            max_position_sol: 1.5,
            max_slippage_bps: 150,
            stop_loss_bps: 350,
            cabal_risk_veto_threshold: 75,
        }
    }
}

fn default_max_pool_reserve_pct() -> f64 { 2.0 }
fn default_max_price_impact_bps() -> u16 { 300 }
fn default_min_trade_size_sol() -> f64 { 0.05 }
fn default_min_gross_edge_bps() -> u16 { 400 }
fn default_margin_of_safety_bps() -> u16 { 150 }
fn default_base_network_fee_lamports() -> u64 { 5_000 }
fn default_priority_fee_lamports() -> u64 { 50_000 }
fn default_dex_fee_pump_bps() -> u16 { 100 }
fn default_dex_fee_raydium_bps() -> u16 { 25 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EconomicsConfig {
    pub min_liquidity_sol: f64,
    pub target_flip_size_sol: f64,
    pub max_daily_drawdown_sol: f64,
    #[serde(default = "default_max_pool_reserve_pct")]
    pub max_pool_reserve_pct: f64,
    #[serde(default = "default_max_price_impact_bps")]
    pub max_price_impact_bps: u16,
    #[serde(default = "default_min_trade_size_sol")]
    pub min_trade_size_sol: f64,
    #[serde(default = "default_min_gross_edge_bps")]
    pub min_gross_edge_bps: u16,
    #[serde(default = "default_margin_of_safety_bps")]
    pub margin_of_safety_bps: u16,
    #[serde(default = "default_base_network_fee_lamports")]
    pub base_network_fee_lamports: u64,
    #[serde(default = "default_priority_fee_lamports")]
    pub priority_fee_lamports: u64,
    #[serde(default = "default_dex_fee_pump_bps")]
    pub dex_fee_pump_bps: u16,
    #[serde(default = "default_dex_fee_raydium_bps")]
    pub dex_fee_raydium_bps: u16,
}

impl Default for EconomicsConfig {
    fn default() -> Self {
        Self {
            min_liquidity_sol: 10.0,
            target_flip_size_sol: 1.0,
            max_daily_drawdown_sol: 5.0,
            max_pool_reserve_pct: 2.0,
            max_price_impact_bps: 300,
            min_trade_size_sol: 0.05,
            min_gross_edge_bps: 400,
            margin_of_safety_bps: 150,
            base_network_fee_lamports: 5_000,
            priority_fee_lamports: 50_000,
            dex_fee_pump_bps: 100,
            dex_fee_raydium_bps: 25,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExitConfig {
    /// Initial take profit target in basis points (1200 = +12%)
    pub take_profit_bps: u16,
    /// Trailing profit trigger pullback in basis points (200 = 2.0%)
    pub trailing_stop_bps: u16,
    /// Maximum allowable hold time in seconds before mandatory market exit
    pub max_hold_duration_secs: u64,
    /// Maximum allowable hold time in logical slots
    pub max_hold_duration_slots: u64,
    /// Cooldown period between flips in milliseconds
    pub post_trade_cooldown_ms: u64,
}

impl Default for ExitConfig {
    fn default() -> Self {
        Self {
            take_profit_bps: 1200,
            trailing_stop_bps: 200,
            max_hold_duration_secs: 180,
            max_hold_duration_slots: 450, // ~180s at 400ms/slot
            post_trade_cooldown_ms: 1500,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModeConfig {
    pub trading_mode: TradingMode,
}

impl Default for ModeConfig {
    fn default() -> Self {
        Self {
            trading_mode: TradingMode::Observe,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletConfig {
    pub keypair_path: Option<PathBuf>,
    pub sweep_address: Option<String>,
    pub min_operating_balance_sol: f64,
}

impl Default for WalletConfig {
    fn default() -> Self {
        Self {
            keypair_path: None,
            sweep_address: None,
            min_operating_balance_sol: 0.25,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObservabilityConfig {
    pub log_level: String,
    pub telemetry_interval_ms: u64,
    pub enable_json_logs: bool,
}

impl Default for ObservabilityConfig {
    fn default() -> Self {
        Self {
            log_level: "info".to_string(),
            telemetry_interval_ms: 500,
            enable_json_logs: false,
        }
    }
}

/// Unified application configuration with strict sections
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub grpc: GrpcConfig,
    pub redis: RedisConfig,
    pub jito: JitoConfig,
    pub risk: RiskConfig,
    pub economics: EconomicsConfig,
    pub exit: ExitConfig,
    pub mode: ModeConfig,
    pub wallet: WalletConfig,
    pub observability: ObservabilityConfig,
}

/// Legacy backward compatibility aliases
pub type HotConfig = AppConfig;
pub type RiskLimits = RiskConfig;
pub type RedisBridgeConfig = RedisConfig;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NetworkConfig {
    pub rpc_url: String,
    pub wss_url: String,
    pub yellowstone_grpc_endpoint: String,
    pub yellowstone_x_token: Option<String>,
}

impl AppConfig {
    pub fn load_from_str(toml_str: &str) -> Result<Self> {
        let mut config: AppConfig = toml::from_str(toml_str)
            .context("Failed to deserialize AppConfig from TOML")?;
        config.apply_env_overrides()?;
        config.validate_invariants()?;
        Ok(config)
    }

    pub fn load_from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let path_ref = path.as_ref();
        let content = std::fs::read_to_string(path_ref)
            .with_context(|| format!("Failed to read config file at {:?}", path_ref))?;
        Self::load_from_str(&content)
    }

    pub fn load_with_fallbacks(optional_path: Option<&str>) -> Result<Self> {
        let _ = dotenvy::dotenv();

        let mut config = if let Some(path) = optional_path {
            Self::load_from_file(path)?
        } else if Path::new("configs/hot.example.toml").exists() {
            Self::load_from_file("configs/hot.example.toml")?
        } else if Path::new("../configs/hot.example.toml").exists() {
            Self::load_from_file("../configs/hot.example.toml")?
        } else {
            Self::default()
        };

        config.apply_env_overrides()?;
        config.validate_invariants()?;
        Ok(config)
    }

    pub fn apply_env_overrides(&mut self) -> Result<()> {
        if let Ok(mode_str) = std::env::var("TRADING_MODE") {
            self.mode.trading_mode = TradingMode::from_str(&mode_str)?;
        }
        if let Ok(grpc) = std::env::var("YELLOWSTONE_GRPC_ENDPOINT") {
            self.grpc.endpoint = grpc;
        }
        if let Ok(token) = std::env::var("YELLOWSTONE_X_TOKEN") {
            self.grpc.x_token = Some(token);
        }
        if let Ok(redis) = std::env::var("REDIS_URL") {
            self.redis.redis_url = redis;
        }
        if let Ok(jito_engine) = std::env::var("JITO_BLOCK_ENGINE_URL") {
            self.jito.block_engine_url = jito_engine;
        }
        if let Ok(tip_account) = std::env::var("JITO_TIP_ACCOUNT") {
            self.jito.tip_account = tip_account;
        }
        if let Ok(wallet_path) = std::env::var("HOT_WALLET_KEYPAIR_PATH") {
            self.wallet.keypair_path = Some(PathBuf::from(wallet_path));
        }
        if let Ok(sweep) = std::env::var("COLD_WALLET_SWEEP_ADDRESS") {
            self.wallet.sweep_address = Some(sweep);
        }
        Ok(())
    }

    pub fn validate_invariants(&self) -> Result<()> {
        // INVARIANT 1: Strict capital velocity
        anyhow::ensure!(
            self.risk.max_concurrent_positions == 1,
            "CRITICAL INVARIANT VIOLATION: max_concurrent_positions must strictly be 1 for capital velocity"
        );

        // INVARIANT 2: Max position size sanity cap
        anyhow::ensure!(
            self.risk.max_position_sol > 0.0 && self.risk.max_position_sol <= 10.0,
            "CRITICAL RISK CAP: max_position_sol ({}) must be > 0 and <= 10.0 SOL",
            self.risk.max_position_sol
        );

        // INVARIANT 3: Jito tip bounds
        anyhow::ensure!(
            self.jito.default_tip_lamports <= self.jito.max_tip_lamports,
            "Jito default tip cannot exceed max tip"
        );

        // INVARIANT 4: Live mode requires hot wallet path
        if self.mode.trading_mode == TradingMode::Live {
            anyhow::ensure!(
                self.wallet.keypair_path.is_some(),
                "LIVE trading rejected: wallet.keypair_path must be configured"
            );
        }

        // INVARIANT 5: Stop loss sanity
        anyhow::ensure!(
            self.risk.stop_loss_bps > 0 && self.risk.stop_loss_bps <= 2000,
            "Stop loss must be between 1 and 2000 bps (0.01% - 20%)"
        );

        Ok(())
    }
}
