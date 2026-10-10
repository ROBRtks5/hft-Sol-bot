use alpha_flip_hot::config::{AppConfig, TradingMode};
use alpha_flip_hot::execution::{JitoClient, MockJitoClient, ProductionJitoClient};
use alpha_flip_hot::exit::SyntheticOrderEngine;
use alpha_flip_hot::orchestrator::{
    EngineEvent, OperatingMode, OrchestratorEngine, OrchestratorEventLoop, RiskLimits,
};
use alpha_flip_hot::position::{
    BalanceProvider, MockBalanceProvider, PositionJournal, PositionManager,
    ProductionRpcBalanceProvider, ReconciliationStatus,
};
use alpha_flip_hot::types::{Lamports, Slot};
use anyhow::Result;
use std::env;
use std::str::FromStr;
use std::sync::Arc;
use tracing::{error, info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() -> Result<()> {
    // 1. Initialize structured logging
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,alpha_flip_hot=debug")))
        .with(tracing_subscriber::fmt::layer().with_target(false).compact())
        .init();

    // 2. Parse basic CLI flags
    let args: Vec<String> = env::args().collect();
    let mut config_path_override: Option<String> = None;
    let mut mode_override: Option<OperatingMode> = None;
    let mut replay_file_path: Option<String> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--config" if i + 1 < args.len() => {
                config_path_override = Some(args[i + 1].clone());
                i += 2;
            }
            "--mode" if i + 1 < args.len() => {
                let parsed = OperatingMode::from_str(&args[i + 1])
                    .map_err(|e| anyhow::anyhow!("{}", e))?;
                mode_override = Some(parsed);
                i += 2;
            }
            "--replay" if i + 1 < args.len() => {
                replay_file_path = Some(args[i + 1].clone());
                i += 2;
            }
            "--help" | "-h" => {
                println!("Alpha-Flip v3.2 Hot Execution Daemon");
                println!("Usage: alpha-flip-hot [--config <path>] [--mode <observe|shadow|live|recovering|paused|kill>] [--replay <path.jsonl>]");
                return Ok(());
            }
            _ => {
                i += 1;
            }
        }
    }

    // 2.1 If replay flag is set, run deterministic replay and output summary
    if let Some(path) = replay_file_path {
        info!("===========================================================");
        info!("   STARTING DETERMINISTIC REPLAY FROM: {}", path);
        info!("===========================================================");
        let frames = alpha_flip_hot::replay::ReplayLoader::load_file(&path)?;
        let mode = mode_override.unwrap_or(OperatingMode::Shadow);
        let mut runner = alpha_flip_hot::replay::ReplayRunner::new(mode);
        let summary = runner.run(&frames);

        info!("================ REPLAY SUMMARY REPORT ================");
        info!("Frames Processed       : {}", summary.total_frames_processed);
        info!("Starting Slot          : {}", summary.starting_slot);
        info!("Ending Slot            : {}", summary.ending_slot);
        info!("Slots Advanced         : {}", summary.slots_advanced);
        info!("Transactions Decoded   : {}", summary.transactions_decoded);
        info!("Trades Detected        : {}", summary.trades_detected);
        info!("Pump Trades            : {}", summary.pump_trades);
        info!("Raydium Swaps          : {}", summary.raydium_swaps);
        info!("Signals Evaluated      : {}", summary.signals_evaluated);
        info!("Edge Gate Approvals    : {}", summary.edge_approvals);
        info!("Edge Gate Rejections   : {}", summary.edge_rejections);
        info!("Simulated Buys         : {}", summary.simulated_buys);
        info!("Simulated Sells        : {}", summary.simulated_sells);
        info!("Simulated Emergency    : {}", summary.simulated_emergency_exits);
        info!("Realized Net PnL (SOL) : {:.4}", summary.total_simulated_realized_pnl_lamports as f64 / 1e9);
        info!("Final Open Positions   : {}", summary.final_positions_open);
        info!("=======================================================");
        return Ok(());
    }

    // 3. Load configuration
    let config = AppConfig::load_with_fallbacks(config_path_override.as_deref())?;
    
    // Map initial mode
    let target_mode = mode_override.unwrap_or_else(|| {
        match config.mode.trading_mode {
            TradingMode::Live => OperatingMode::Live,
            TradingMode::Shadow => OperatingMode::Shadow,
            TradingMode::Observe => OperatingMode::Observe,
            TradingMode::Recovering => OperatingMode::Recovering,
            TradingMode::Paused => OperatingMode::Paused,
            TradingMode::Kill => OperatingMode::KillSwitch,
        }
    });

    // 4. Print system startup banner
    info!("===========================================================");
    info!("      ALPHA-FLIP v3.2 - SOLANA MOMENTUM FLIP ENGINE        ");
    info!("===========================================================");
    info!("Operating Mode        : {}", target_mode);
    info!("Max Open Positions    : 1 (STRICT INVARIANT: Capital Velocity)");
    info!("Max Capital Per Flip  : {} SOL", config.risk.max_position_sol);
    info!("Stop Loss Hard Cap    : {} bps", config.risk.stop_loss_bps);
    info!("Take Profit Target    : {} bps", config.exit.take_profit_bps);
    info!("Yellowstone gRPC      : {}", config.grpc.endpoint);
    info!("Jito Block Engine     : {}", config.jito.block_engine_url);
    info!("Redis Bridge          : {}", config.redis.redis_url);

    if target_mode.allows_new_orders() {
        warn!("⚠️  LIVE TRADING MODE ENABLED. Real capital is at risk!");
        warn!("⚠️  Keypair loaded from: {:?}", config.wallet.keypair_path);
    } else {
        info!("🛡️  SAFE MODE ACTIVE: Real execution disabled. No on-chain funds at risk.");
    }

    if target_mode == OperatingMode::KillSwitch {
        error!("KILL_SWITCH mode commanded at boot. Exiting immediately.");
        return Ok(());
    }

    // 5. Initialize Durable Position Journal & Manager
    let journal_path = format!("data/journal_{}.jsonl", config.wallet.pubkey.chars().take(8).collect::<String>());
    let journal = PositionJournal::open(&journal_path)
        .unwrap_or_else(|_| PositionJournal::ephemeral());
    info!("Durable Position Journal loaded: {:?}", journal.path());

    let position_manager = PositionManager::new(journal.clone());

    // 6. Initialize Global Risk Limits
    let risk_limits = RiskLimits {
        max_daily_loss_lamports: (config.risk.max_daily_loss_sol * 1_000_000_000.0) as u64,
        max_consecutive_losses: 3,
        tip_budget_daily_lamports: 500_000_000,
        max_trades_per_hour: 12,
        max_position_sol_lamports: (config.risk.max_position_sol * 1_000_000_000.0) as u64,
        min_wallet_reserve_lamports: 200_000_000,
    };

    let orchestrator_engine = OrchestratorEngine::new(target_mode, position_manager, risk_limits);

    // 7. Initialize Execution Layer & Synthetic Exit Engine
    // MOCK IS STRICTLY UNREACHABLE IN LIVE MODE
    let jito_client: Arc<dyn JitoClient> = match target_mode {
        OperatingMode::Live => {
            info!("🔒 LIVE MODE: Initializing Production Jito Client for {}", config.jito.block_engine_url);
            Arc::new(ProductionJitoClient::new(
                config.jito.block_engine_url.clone(),
                None,
            ))
        }
        _ => {
            info!("🛠️ SAFE/OFFLINE MODE: Initializing Mock Jito Client");
            Arc::new(MockJitoClient::new())
        }
    };
    let exit_engine = SyntheticOrderEngine::new(jito_client);

    let (mut event_loop, event_sender) = OrchestratorEventLoop::new(
        orchestrator_engine,
        exit_engine,
        1024,
    );

    // 8. Run Startup Recovery & Reconciliation
    // MOCK IS STRICTLY UNREACHABLE IN LIVE MODE
    info!("Performing Startup Balance Reconciliation...");
    let recovery_status = match target_mode {
        OperatingMode::Live => {
            let balance_provider = ProductionRpcBalanceProvider::new(
                config.grpc.endpoint.clone(),
                config.wallet.sweep_address.clone().unwrap_or_default(),
            );
            event_loop.run_startup_recovery(&balance_provider, 0).await?
        }
        _ => {
            let balance_provider = MockBalanceProvider::new(Lamports::new(10_000_000_000));
            event_loop.run_startup_recovery(&balance_provider, 250_000_000).await?
        }
    };

    match recovery_status {
        ReconciliationStatus::CleanIdle => {
            info!("✅ Startup Recovery: CleanIdle. Engine ready for incoming signals.");
        }
        ReconciliationStatus::RecoveredActive(ref pos) => {
            warn!("⚠️ Startup Recovery: In-flight position RESTORED for mint {}. Managing defensively.", pos.mint);
        }
        ReconciliationStatus::Discrepancy { ref mint, ref reason, .. } => {
            error!("🚨 Startup Recovery DISCREPANCY on {}: {}. Entering RECOVERING halt.", mint, reason);
        }
    }

    // 9. Setup graceful shutdown listener
    info!("Daemon running. Listening for Yellowstone gRPC trade events. Press Ctrl+C to halt.");
    let shutdown_sender = event_sender.clone();
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("Received SIGINT shutdown signal. Dispatching Halt to orchestrator.");
            let _ = shutdown_sender.send(EngineEvent::Halt).await;
        }
    }

    info!("Alpha-Flip Hot Engine terminated cleanly.");
    Ok(())
}
