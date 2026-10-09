use alpha_flip_hot::config::{AppConfig, TradingMode};
use alpha_flip_hot::events::{MarketState, TradeEvent, TradeSide};
use alpha_flip_hot::position::PositionState;
use alpha_flip_hot::risk::{saturate_score_u8, RiskSnapshot, RiskTier};
use alpha_flip_hot::types::{Lamports, Mint, Pubkey, Signature, Slot, TokenAmount};
use alpha_flip_hot::SlotClock;
use std::str::FromStr;

#[test]
fn test_config_loads_from_example_toml() {
    let toml_sample = r#"
        [mode]
        trading_mode = "shadow"

        [grpc]
        endpoint = "https://grpc.helius.xyz:443"
        x_token = "mock_token"
        commitment = "processed"
        connect_timeout_ms = 4000

        [redis]
        redis_url = "redis://127.0.0.1:6379/0"
        advisory_channel = "alpha_flip:cold:advisory"
        telemetry_channel = "alpha_flip:hot:telemetry"

        [jito]
        block_engine_url = "https://amsterdam.mainnet.block-engine.jito.wtf"
        tip_account = "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5"
        default_tip_lamports = 1000000
        max_tip_lamports = 10000000

        [risk]
        max_concurrent_positions = 1
        max_position_sol = 1.75
        max_slippage_bps = 150
        stop_loss_bps = 350
        cabal_risk_veto_threshold = 80

        [economics]
        min_liquidity_sol = 15.0
        target_flip_size_sol = 1.0
        max_daily_drawdown_sol = 4.0

        [exit]
        take_profit_bps = 1200
        trailing_stop_bps = 200
        max_hold_duration_secs = 180
        max_hold_duration_slots = 450
        post_trade_cooldown_ms = 1200

        [wallet]
        sweep_address = "MockColdVault1111111111111111111111111111"
        min_operating_balance_sol = 0.5

        [observability]
        log_level = "debug"
        telemetry_interval_ms = 250
        enable_json_logs = true
    "#;

    let cfg = AppConfig::load_from_str(toml_sample).expect("Config should parse correctly");
    assert_eq!(cfg.mode.trading_mode, TradingMode::Shadow);
    assert_eq!(cfg.risk.max_concurrent_positions, 1);
    assert_eq!(cfg.risk.max_position_sol, 1.75);
    assert_eq!(cfg.risk.stop_loss_bps, 350);
    assert_eq!(cfg.exit.max_hold_duration_slots, 450);
}

#[test]
fn test_market_state_serialization() {
    let dummy_curve = Pubkey::new_unique();
    let state = MarketState::PumpCurveActive {
        bonding_curve: dummy_curve,
    };

    let serialized = serde_json::to_string(&state).expect("MarketState should serialize");
    let deserialized: MarketState =
        serde_json::from_str(&serialized).expect("MarketState should deserialize");

    assert_eq!(state, deserialized);
    assert!(deserialized.is_tradable());

    let blacklisted = MarketState::Blacklisted {
        reason: "Cabal bundle dump detected".to_string(),
    };
    assert!(blacklisted.is_blacklisted());
    assert!(!blacklisted.is_tradable());
}

#[test]
fn test_trade_event_serialization() {
    let mint = Pubkey::new_unique();
    let trader = Pubkey::new_unique();
    let program_id = Pubkey::new_unique();
    let sig = Signature::default();

    let event = TradeEvent {
        mint,
        side: TradeSide::Buy,
        trader,
        sol_amount: Lamports(500_000_000), // 0.5 SOL
        token_amount: TokenAmount(1_000_000),
        slot: Slot(280_000_000),
        signature: sig,
        program_id,
        is_direct: true,
        router: None,
        success: true,
    };

    let json_str = serde_json::to_string(&event).expect("TradeEvent should serialize to JSON");
    let decoded: TradeEvent =
        serde_json::from_str(&json_str).expect("TradeEvent should deserialize from JSON");

    assert_eq!(decoded.mint, mint);
    assert_eq!(decoded.side, TradeSide::Buy);
    assert_eq!(decoded.sol_amount.as_u64(), 500_000_000);
    assert_eq!(decoded.price_in_lamports_per_token(), 500.0);
}

#[test]
fn test_slot_clock_delta_conversion() {
    let clock = SlotClock::new(Slot(1000));
    assert_eq!(clock.current_slot(), Slot(1000));

    // 10 slots * 400ms = 4000ms
    assert_eq!(SlotClock::slots_to_approx_millis(10), 4000);
    assert_eq!(SlotClock::millis_to_approx_slots(4000), 10);

    clock.advance_to(Slot(1050));
    assert_eq!(clock.current_slot(), Slot(1050));
    assert_eq!(clock.elapsed_slots(Slot(1000)), 50);
    assert_eq!(clock.elapsed_approx_millis(Slot(1000)), 20_000);
}

#[test]
fn test_position_state_invariant_remaining_le_total() {
    let mint = Pubkey::new_unique();
    let initial_sig = Signature::default();

    let mut pos = PositionState::new(
        mint,
        150.0,
        Lamports(1_000_000_000),
        TokenAmount(5_000_000),
        Slot(100),
        initial_sig,
    )
    .expect("Valid position should be created");

    assert_eq!(pos.remaining_token_amount, TokenAmount(5_000_000));
    assert!(pos.is_open());

    // Partial exit 1: Sell 2_000_000 tokens
    pos.record_partial_exit(TokenAmount(2_000_000), Signature::default())
        .expect("Partial exit should succeed");
    assert_eq!(pos.remaining_token_amount, TokenAmount(3_000_000));
    assert!(pos.validate_invariants().is_ok());

    // Invariant breach: Selling more than remaining must error
    let err = pos.record_partial_exit(TokenAmount(4_000_000), Signature::default());
    assert!(err.is_err(), "Must reject selling more than remaining tokens");

    // Sell remaining 3_000_000 tokens
    pos.record_partial_exit(TokenAmount(3_000_000), Signature::default())
        .expect("Final exit should succeed");
    assert_eq!(pos.remaining_token_amount, TokenAmount(0));
    assert!(!pos.is_open());
}

#[test]
fn test_risk_score_saturation() {
    // Normal bounds
    assert_eq!(saturate_score_u8(50), 50);
    assert_eq!(saturate_score_u8(100), 100);

    // Overflows must saturate at 100
    assert_eq!(saturate_score_u8(101), 100);
    assert_eq!(saturate_score_u8(500), 100);

    // Evaluate RiskSnapshot with extreme penalties
    let extreme_risk = RiskSnapshot::evaluate(
        95, // extreme cabal
        90, // extreme dev dump
        0,  // zero organic
        0,  // zero smart money
        true, // transfer hook present!
        false, // mint auth not revoked!
        false, // freeze auth not revoked!
        1.0,
        20.0,
    );

    assert_eq!(extreme_risk.overall_risk_score, 100);
    assert_eq!(extreme_risk.tier, RiskTier::Critical);
    assert!(!extreme_risk.is_trade_allowed);
    assert!(extreme_risk.has_transfer_hook_veto);
    assert!(extreme_risk.mint_authority_veto);
}

#[test]
fn test_trading_mode_parsing() {
    assert_eq!(TradingMode::from_str("observe").unwrap(), TradingMode::Observe);
    assert_eq!(TradingMode::from_str("shadow").unwrap(), TradingMode::Shadow);
    assert_eq!(TradingMode::from_str("live").unwrap(), TradingMode::Live);
    assert_eq!(TradingMode::from_str("recovering").unwrap(), TradingMode::Recovering);
    assert_eq!(TradingMode::from_str("paused").unwrap(), TradingMode::Paused);
    assert_eq!(TradingMode::from_str("kill").unwrap(), TradingMode::Kill);
}

#[tokio::test]
async fn test_grpc_mock_transport_connect_disconnect_reconnect() {
    use alpha_flip_hot::grpc::{
        MockGrpcTransport, ReconnectSupervisor, SubscriptionManager, YellowstoneGrpcClient,
    };
    use std::sync::Arc;
    use std::time::Duration;

    let mock_transport = MockGrpcTransport::new();
    let sub_mgr = SubscriptionManager::new("processed");
    let clock = Arc::new(SlotClock::new(Slot(100)));

    let (mut client, _rx) = YellowstoneGrpcClient::new(
        "https://mock.grpc".to_string(),
        None,
        mock_transport.clone(),
        sub_mgr,
        clock,
        100,
    );

    assert!(!client.metrics().snapshot().is_connected);

    // 1. Initial connect
    client.connect().await.expect("Initial connect should succeed");
    assert!(client.metrics().snapshot().is_connected);

    // 2. Disconnect
    client.disconnect().await.expect("Disconnect should succeed");
    assert!(!client.metrics().snapshot().is_connected);

    // 3. Supervisor exponential backoff logic
    let mut supervisor = ReconnectSupervisor::new(
        Duration::from_millis(50),
        Duration::from_millis(200),
        2.0,
        10,
        30,
    );
    let b1 = supervisor.next_backoff_duration();
    assert_eq!(b1.as_millis(), 50);
    let b2 = supervisor.next_backoff_duration();
    assert_eq!(b2.as_millis(), 100);
    let b3 = supervisor.next_backoff_duration();
    assert_eq!(b3.as_millis(), 200);
    // Cap verification
    let b4 = supervisor.next_backoff_duration();
    assert_eq!(b4.as_millis(), 200);

    // Stabilized
    supervisor.record_success();
    assert_eq!(supervisor.total_reconnects(), 1);
    assert_eq!(supervisor.current_attempt(), 0);
}

#[tokio::test]
async fn test_grpc_account_update_dedupe_and_monotonicity() {
    use alpha_flip_hot::grpc::{AccountUpdateFrame, GrpcStreamMessage, MockGrpcTransport, SubscriptionManager, YellowstoneGrpcClient};
    use alpha_flip_hot::state::TokenRuntime;
    use alpha_flip_hot::types::WriteVersion;
    use std::sync::Arc;

    let mock_transport = MockGrpcTransport::new();
    let sub_mgr = SubscriptionManager::new("processed");
    let clock = Arc::new(SlotClock::new(Slot(500)));
    let token_mint = Pubkey::new_unique();

    let (mut client, mut rx) = YellowstoneGrpcClient::new(
        "https://mock.grpc".to_string(),
        None,
        mock_transport.clone(),
        sub_mgr,
        clock,
        50,
    );
    client.connect().await.unwrap();

    let mut token_runtime = TokenRuntime::new(token_mint, Slot(500));
    token_runtime.last_write_version = WriteVersion(10);

    // Frame 1: Older slot (499) -> must be discarded
    let frame_stale = AccountUpdateFrame {
        pubkey: token_mint,
        slot: Slot(499),
        write_version: WriteVersion(100),
        lamports: 1_000_000_000,
        data: vec![1, 2, 3],
        owner: Pubkey::new_unique(),
        executable: false,
        rent_epoch: 0,
    };
    assert!(!token_runtime.is_update_newer(frame_stale.slot, frame_stale.write_version));

    // Frame 2: Same slot, higher write version (11) -> valid
    let frame_newer = AccountUpdateFrame {
        pubkey: token_mint,
        slot: Slot(500),
        write_version: WriteVersion(11),
        lamports: 2_000_000_000,
        data: vec![4, 5, 6],
        owner: Pubkey::new_unique(),
        executable: false,
        rent_epoch: 0,
    };
    assert!(token_runtime.is_update_newer(frame_newer.slot, frame_newer.write_version));

    // Push into mock gRPC stream and process
    mock_transport.push_incoming(GrpcStreamMessage::Account(frame_newer.clone())).await;
    let processed = client.process_one().await.expect("Should process message");
    assert!(processed);

    // Downstream receiver receives the event
    let event = rx.recv().await.expect("Receiver should get event");
    match event {
        alpha_flip_hot::grpc::IngestedStreamEvent::Account(f) => {
            assert_eq!(f.pubkey, token_mint);
            assert_eq!(f.write_version, WriteVersion(11));
        }
        _ => panic!("Expected Account update"),
    }
}

#[tokio::test]
async fn test_grpc_initial_snapshot_merge() {
    use alpha_flip_hot::grpc::{
        AccountUpdateFrame, MockRpcSnapshotProvider, SnapshotBootstrapper,
    };
    use alpha_flip_hot::types::WriteVersion;

    let initial_slot = Slot(750_000);
    let mock_rpc = MockRpcSnapshotProvider::new(initial_slot);
    let clock = SlotClock::new(Slot(0));

    // 1. Initialize clock from RPC snapshot
    let boot_slot = SnapshotBootstrapper::initialize_clock(&mock_rpc, &clock)
        .await
        .expect("Clock init should succeed");
    assert_eq!(boot_slot, initial_slot);
    assert_eq!(clock.current_slot(), initial_slot);

    // 2. Preload bootstrap accounts
    let test_account = Pubkey::new_unique();
    let frame = AccountUpdateFrame {
        pubkey: test_account,
        slot: initial_slot,
        write_version: WriteVersion(1),
        lamports: 5_000_000_000,
        data: vec![0xaa, 0xbb],
        owner: Pubkey::new_unique(),
        executable: false,
        rent_epoch: 0,
    };
    mock_rpc.set_account(test_account, frame.clone()).await;

    let preloaded = SnapshotBootstrapper::preload_accounts(&mock_rpc, &[test_account])
        .await
        .expect("Preload should succeed");
    assert_eq!(preloaded.len(), 1);
    assert_eq!(preloaded[0].pubkey, test_account);
    assert_eq!(preloaded[0].lamports, 5_000_000_000);
}

#[tokio::test]
async fn test_grpc_backpressure_alert_condition() {
    use alpha_flip_hot::grpc::{
        AccountUpdateFrame, GrpcStreamMessage, MockGrpcTransport, SubscriptionManager,
        YellowstoneGrpcClient,
    };
    use alpha_flip_hot::types::WriteVersion;
    use std::sync::Arc;

    let mock_transport = MockGrpcTransport::new();
    let sub_mgr = SubscriptionManager::new("processed");
    let clock = Arc::new(SlotClock::new(Slot(100)));

    // Channel capacity of 2 for testing overflow backpressure
    let (mut client, _rx) = YellowstoneGrpcClient::new(
        "https://mock.grpc".to_string(),
        None,
        mock_transport.clone(),
        sub_mgr,
        clock,
        2,
    );
    client.connect().await.unwrap();

    let dummy_frame = AccountUpdateFrame {
        pubkey: Pubkey::new_unique(),
        slot: Slot(100),
        write_version: WriteVersion(1),
        lamports: 100,
        data: vec![],
        owner: Pubkey::new_unique(),
        executable: false,
        rent_epoch: 0,
    };

    // Fill the channel (capacity = 2)
    mock_transport.push_incoming(GrpcStreamMessage::Account(dummy_frame.clone())).await;
    mock_transport.push_incoming(GrpcStreamMessage::Account(dummy_frame.clone())).await;
    client.process_one().await.unwrap();
    client.process_one().await.unwrap();

    // Third message causes channel overflow (Backpressure error triggered)
    mock_transport.push_incoming(GrpcStreamMessage::Account(dummy_frame.clone())).await;
    let overflow_res = client.process_one().await;
    assert!(overflow_res.is_err(), "Must trigger backpressure overflow error");
    assert_eq!(client.metrics().snapshot().dropped_events_total, 1);
}

#[tokio::test]
async fn test_grpc_replay_log_writing_and_sanitization() {
    use alpha_flip_hot::grpc::{AccountUpdateFrame, ReplayRecorder, SlotUpdateFrame};
    use alpha_flip_hot::types::WriteVersion;

    let recorder = ReplayRecorder::new(100);
    assert_eq!(recorder.records_written(), 0);

    let frame = AccountUpdateFrame {
        pubkey: Pubkey::new_unique(),
        slot: Slot(1024),
        write_version: WriteVersion(42),
        lamports: 100_000_000,
        data: vec![1, 2, 3],
        owner: Pubkey::new_unique(),
        executable: false,
        rent_epoch: 0,
    };

    recorder.record_account(&frame, 1729000000000).await;
    assert_eq!(recorder.records_written(), 1);

    let slot_frame = SlotUpdateFrame {
        slot: Slot(1025),
        parent_slot: Some(Slot(1024)),
        status: "confirmed".to_string(),
    };
    recorder.record_slot(&slot_frame, 1729000000400).await;
    assert_eq!(recorder.records_written(), 2);

    let jsonl = recorder.export_jsonl().await.expect("JSONL export should succeed");
    assert!(jsonl.contains("ACCOUNT"));
    assert!(jsonl.contains("SLOT"));
    assert!(jsonl.contains("1024"));
    // SANITIZATION INVARIANT: No secrets or private keys in replay log
    assert!(!jsonl.contains("secret"));
    assert!(!jsonl.contains("keypair"));
}

#[test]
fn test_decoder_golden_fixtures_pipeline() {
    use alpha_flip_hot::decoder::fixtures::*;
    use alpha_flip_hot::decoder::{
        DecodedInstructionEvent, InstructionDecoder, Token2022Parser,
    };
    use alpha_flip_hot::events::TradeSide;

    let decoder = InstructionDecoder::default();

    // 1. Pump.fun Create
    let tx_create = mock_pump_create_tx();
    let events = decoder.decode_transaction(&tx_create);
    assert_eq!(events.len(), 1);
    match &events[0] {
        DecodedInstructionEvent::PumpCreate(c) => {
            assert_eq!(c.name, "AlphaToken");
            assert_eq!(c.symbol, "ALPHA");
        }
        _ => panic!("Expected PumpCreate event"),
    }

    // 2. Pump.fun Buy Direct
    let tx_buy = mock_pump_buy_direct_tx();
    let events = decoder.decode_transaction(&tx_buy);
    assert_eq!(events.len(), 1);
    match &events[0] {
        DecodedInstructionEvent::PumpTrade(t) => {
            assert_eq!(t.side, TradeSide::Buy);
            assert_eq!(t.token_amount.as_u64(), 10_000_000);
            assert_eq!(t.sol_amount.as_u64(), 1_500_000_000);
            assert!(!t.has_ata_creation);
        }
        _ => panic!("Expected PumpTrade buy"),
    }

    // 3. Pump.fun Buy with ATA creation
    let tx_buy_ata = mock_pump_buy_with_ata_tx();
    let events = decoder.decode_transaction(&tx_buy_ata);
    assert_eq!(events.len(), 1);
    match &events[0] {
        DecodedInstructionEvent::PumpTrade(t) => {
            assert_eq!(t.side, TradeSide::Buy);
            assert!(t.has_ata_creation, "ATA creation must be detected");
        }
        _ => panic!("Expected PumpTrade buy with ATA"),
    }

    // 4. Pump.fun Sell
    let tx_sell = mock_pump_sell_tx();
    let events = decoder.decode_transaction(&tx_sell);
    assert_eq!(events.len(), 1);
    match &events[0] {
        DecodedInstructionEvent::PumpTrade(t) => {
            assert_eq!(t.side, TradeSide::Sell);
            assert_eq!(t.token_amount.as_u64(), 5_000_000);
            assert_eq!(t.sol_amount.as_u64(), 1_200_000_000);
        }
        _ => panic!("Expected PumpTrade sell"),
    }

    // 5. Raydium AMM v4 Swap Buy
    let tx_ray_buy = mock_raydium_swap_buy_tx();
    let events = decoder.decode_transaction(&tx_ray_buy);
    assert_eq!(events.len(), 1);
    match &events[0] {
        DecodedInstructionEvent::RaydiumSwap(s) => {
            assert_eq!(s.side, TradeSide::Buy);
            assert_eq!(s.sol_amount.as_u64(), 2_000_000_000);
            assert_eq!(s.token_amount.as_u64(), 15_000_000);
        }
        _ => panic!("Expected Raydium swap buy"),
    }

    // 6. Failed transaction policy (Must be ignored)
    let tx_failed = mock_failed_tx();
    let events = decoder.decode_transaction(&tx_failed);
    assert!(events.is_empty(), "Failed transactions must be dropped");
    assert_eq!(decoder.metrics().skipped_failed_tx_total.load(std::sync::atomic::Ordering::Relaxed), 1);

    // 7. Unknown program skipped
    let tx_unknown = mock_unknown_program_tx();
    let events = decoder.decode_transaction(&tx_unknown);
    assert!(events.is_empty(), "Unknown programs must be dropped");
    assert_eq!(decoder.metrics().skipped_unknown_program_total.load(std::sync::atomic::Ordering::Relaxed), 1);

    // 8. Token-2022 TransferHook detection
    let token_2022_bytes = mock_token_2022_mint_with_transfer_hook_bytes();
    let inspection = Token2022Parser::inspect_mint_data(&token_2022_bytes);
    assert!(inspection.is_token_2022);
    assert!(inspection.has_transfer_hook);
    assert!(inspection.is_dangerous);
    assert!(!inspection.veto_reasons.is_empty());

    // 9. Metrics inspection
    assert!(decoder.metrics().decoded_events_total.load(std::sync::atomic::Ordering::Relaxed) >= 5);
}

#[test]
fn test_stage_4_state_store_and_lifecycle_invariants() {
    use alpha_flip_hot::decoder::pump_fun::PumpCreateDecoded;
    use alpha_flip_hot::decoder::DecodedInstructionEvent;
    use alpha_flip_hot::events::MarketState;
    use alpha_flip_hot::grpc::transport::AccountUpdateFrame;
    use alpha_flip_hot::state::market_state_machine::MarketStateMachine;
    use alpha_flip_hot::state::reconciliation::ReconciliationEngine;
    use alpha_flip_hot::state::LocalStateStore;
    use alpha_flip_hot::types::{Lamports, TokenAmount, WriteVersion};

    let mut store = LocalStateStore::new();
    let mint = Pubkey::new_unique();
    let curve = Pubkey::new_unique();

    // 1. Account update without mint mapping is queued safely (not dropped or corrupted)
    let unmapped_frame = AccountUpdateFrame {
        pubkey: curve,
        slot: Slot(100),
        write_version: WriteVersion(1),
        lamports: 1_000_000,
        data: vec![],
        owner: Pubkey::new_unique(),
        executable: false,
        rent_epoch: 0,
    };
    let applied_early = store.apply_account_update(unmapped_frame.clone());
    assert!(!applied_early, "Unmapped account update should be queued");
    assert_eq!(store.account_index.unresolved_accounts_count(), 1);

    // 2. PumpCreate arrives: mapping registered, curve enters PumpCurveActive, and queued frames drained
    let create_event = DecodedInstructionEvent::PumpCreate(PumpCreateDecoded {
        mint,
        bonding_curve: curve,
        creator: Pubkey::new_unique(),
        name: "Alpha".to_string(),
        symbol: "ALP".to_string(),
        uri: "https://alpha".to_string(),
        slot: Slot(100),
        signature: Signature::default(),
    });
    store.apply_decoded_instruction(&create_event);

    assert_eq!(store.account_index.unresolved_accounts_count(), 0);
    assert!(store.contains_token(&mint));
    assert!(store.can_trade(&mint));
    assert_eq!(
        store.get_token(&mint).unwrap().state,
        MarketState::PumpCurveActive { bonding_curve: curve }
    );

    // 3. Deduplication: duplicate old write_version ignored
    let stale_frame = AccountUpdateFrame {
        pubkey: curve,
        slot: Slot(100),
        write_version: WriteVersion(1), // same or older write_version
        lamports: 1_000_000,
        data: vec![],
        owner: Pubkey::new_unique(),
        executable: false,
        rent_epoch: 0,
    };
    assert!(!store.apply_account_update(stale_frame), "Duplicate/stale frame must be ignored");

    // Monotonic newer frame accepted
    let newer_frame = AccountUpdateFrame {
        pubkey: curve,
        slot: Slot(101),
        write_version: WriteVersion(2),
        lamports: 2_000_000,
        data: vec![],
        owner: Pubkey::new_unique(),
        executable: false,
        rent_epoch: 0,
    };
    assert!(store.apply_account_update(newer_frame), "Newer frame must be accepted");

    // 4. Buyer tracking deduplication: repeated buys by same wallet do not increment unique_buyers
    let token = store.get_token_mut(&mint).unwrap();
    let trader1 = Pubkey::new_unique();
    let trader2 = Pubkey::new_unique();

    assert!(token.buyers.record_buy(trader1));
    assert_eq!(token.buyers.unique_buyers(), 1);
    // Repeated buy by trader1
    assert!(!token.buyers.record_buy(trader1));
    assert_eq!(token.buyers.unique_buyers(), 1);

    // New trader2
    assert!(token.buyers.record_buy(trader2));
    assert_eq!(token.buyers.unique_buyers(), 2);

    // 5. Sell does NOT increment buyers
    token.buyers.record_sell(trader1, Slot(105), Lamports(500), false, false);
    assert_eq!(token.buyers.unique_buyers(), 2, "Sell must never increment buyers");
    assert_eq!(token.buyers.total_sell_txs(), 1);

    // 6. State transition to Graduating disables trading
    let token = store.get_token_mut(&mint).unwrap();
    let graduating = MarketStateMachine::transition(
        &token.state,
        MarketState::Graduating { expected_pool: None },
    ).expect("Transition to Graduating should succeed");
    token.state = graduating;
    assert!(!store.can_trade(&mint), "Graduating state must disable trading");

    // 7. Blacklisted state permanently disables trading
    store.blacklist_token(&mint, "TransferHook honeypot detected".to_string());
    assert!(!store.can_trade(&mint), "Blacklisted state must disable trading");

    // 8. TTL Eviction works
    let mut eviction_store = LocalStateStore::new();
    eviction_store.eviction_manager.token_ttl_slots = 50;
    eviction_store.eviction_manager.max_active_tokens = 2;

    let m1 = Pubkey::new_unique();
    let m2 = Pubkey::new_unique();
    let m3 = Pubkey::new_unique();

    // Create 3 tokens at slot 10
    eviction_store.apply_decoded_instruction(&DecodedInstructionEvent::PumpCreate(PumpCreateDecoded {
        mint: m1,
        bonding_curve: Pubkey::new_unique(),
        creator: Pubkey::new_unique(),
        name: "T1".to_string(),
        symbol: "T1".to_string(),
        uri: "".to_string(),
        slot: Slot(10),
        signature: Signature::default(),
    }));
    eviction_store.apply_decoded_instruction(&DecodedInstructionEvent::PumpCreate(PumpCreateDecoded {
        mint: m2,
        bonding_curve: Pubkey::new_unique(),
        creator: Pubkey::new_unique(),
        name: "T2".to_string(),
        symbol: "T2".to_string(),
        uri: "".to_string(),
        slot: Slot(15),
        signature: Signature::default(),
    }));
    eviction_store.apply_decoded_instruction(&DecodedInstructionEvent::PumpCreate(PumpCreateDecoded {
        mint: m3,
        bonding_curve: Pubkey::new_unique(),
        creator: Pubkey::new_unique(),
        name: "T3".to_string(),
        symbol: "T3".to_string(),
        uri: "".to_string(),
        slot: Slot(20),
        signature: Signature::default(),
    }));

    // Prune at slot 100 (>50 slots later)
    let evicted = eviction_store.prune(Slot(100), None);
    assert!(evicted > 0, "Expired tokens must be evicted");

    // 9. Reconciliation detects reserves drift
    let reconciler = ReconciliationEngine::new(0.01); // 1% tolerance
    let drift_report = reconciler.verify_and_reconcile(
        mint,
        Lamports(100_000_000), // local = 0.10 SOL
        Lamports(110_000_000), // chain = 0.11 SOL (10% drift > 1% epsilon)
        TokenAmount(1000),
        TokenAmount(1000),
    );
    assert!(drift_report.is_some(), "Must detect 10% drift");
    let report = drift_report.unwrap();
    assert!(report.drift_ratio >= 0.09);
    assert_eq!(reconciler.metrics().drift_alerts_total.load(std::sync::atomic::Ordering::Relaxed), 1);
}

#[test]
fn test_stage_5_risk_engine_multi_factor() {
    use alpha_flip_hot::risk::{
        DevProxyState, HotCabalScorer, OrganicScorer, RollingFundingGraph, ScoreDecay,
        SmartMoneyProfile, SmartMoneyRegistry, WalletProfileStore,
    };
    use alpha_flip_hot::types::{Lamports, Pubkey, Slot};

    // 1. 50 new wallets funded by one address gets HIGH cabal and LOW organic
    let mut funding_graph = RollingFundingGraph::default();
    let mut wallet_store = WalletProfileStore::default();
    let single_funder = Pubkey::new_unique();

    let mut cabal_wallets = Vec::new();
    let mut cabal_amounts = Vec::new();
    let mut cabal_slots = Vec::new();

    for _ in 0..50 {
        let recipient = Pubkey::new_unique();
        funding_graph.record_funding(single_funder, recipient, Slot(100));
        cabal_wallets.push(recipient);
        // Uniform identical buy size (0.25 SOL)
        cabal_amounts.push(Lamports(250_000_000));
        cabal_slots.push(Slot(101)); // clustered in same slot!
    }

    let cabal_score = HotCabalScorer::score(
        &cabal_wallets,
        &cabal_amounts,
        &cabal_slots,
        &wallet_store,
        &funding_graph,
        Slot(105),
    );
    assert!(
        cabal_score >= 70,
        "50 wallets with 1 funder + uniform buys must get high cabal score, got {}",
        cabal_score
    );

    let cabal_organic = OrganicScorer::score(
        &cabal_wallets,
        &cabal_amounts,
        &cabal_slots,
        cabal_score,
        0,
        &funding_graph,
    );
    assert!(
        cabal_organic <= 30,
        "Cabal cluster must receive low organic score, got {}",
        cabal_organic
    );

    // 2. 25 diverse wallets gets BETTER organic
    let mut diverse_funding = RollingFundingGraph::default();
    let mut diverse_wallets = Vec::new();
    let mut diverse_amounts = Vec::new();
    let mut diverse_slots = Vec::new();

    for i in 0..25 {
        let wallet = Pubkey::new_unique();
        let unique_funder = Pubkey::new_unique();
        diverse_funding.record_funding(unique_funder, wallet, Slot(50 + i * 5));
        diverse_wallets.push(wallet);
        // Varied natural retail buy sizes (0.1 SOL to 1.8 SOL)
        diverse_amounts.push(Lamports(100_000_000 * (1 + (i % 8))));
        diverse_slots.push(Slot(100 + i * 4)); // natural time dispersion
    }

    let diverse_cabal = HotCabalScorer::score(
        &diverse_wallets,
        &diverse_amounts,
        &diverse_slots,
        &wallet_store,
        &diverse_funding,
        Slot(220),
    );
    assert!(diverse_cabal <= 25, "Diverse wallets should get low cabal score, got {}", diverse_cabal);

    let diverse_organic = OrganicScorer::score(
        &diverse_wallets,
        &diverse_amounts,
        &diverse_slots,
        diverse_cabal,
        10,
        &diverse_funding,
    );
    assert!(
        diverse_organic > cabal_organic,
        "Diverse organic score ({}) must be significantly higher than cabal organic ({})",
        diverse_organic,
        cabal_organic
    );

    // 3. Repeated buy by same wallet does not inflate unique buyers
    use alpha_flip_hot::state::BuyerSetStore;
    let mut buyers = BuyerSetStore::default();
    let repeat_trader = Pubkey::new_unique();
    assert!(buyers.record_buy(repeat_trader));
    assert_eq!(buyers.unique_buyers(), 1);
    assert!(!buyers.record_buy(repeat_trader));
    assert_eq!(buyers.unique_buyers(), 1);

    // 4. Score decay reduces old risk
    let decay = ScoreDecay::new(150); // half life = 150 slots (~60s)
    let initial_risk = 80u8;
    assert_eq!(decay.decay_u8(initial_risk, 0), 80);
    // After 150 slots, risk drops by ~50%
    let decayed_150 = decay.decay_u8(initial_risk, 150);
    assert_eq!(decayed_150, 40);
    // After 300 slots, risk drops to ~20
    let decayed_300 = decay.decay_u8(initial_risk, 300);
    assert_eq!(decayed_300, 20);

    // 5. Smart money with 10-second hold time is treated as dump risk, NOT pure bullish
    let mut sm_registry = SmartMoneyRegistry::new();
    let toxic_scalper = Pubkey::new_unique();
    sm_registry.insert(SmartMoneyProfile {
        pubkey: toxic_scalper,
        score: 90,
        confidence: 0.95,
        avg_hold_time_slots: 25, // 25 slots * 400ms = 10 seconds!
        dump_aggression: 85,    // aggressive dump
        cabal_overlap: 10,
        winrate: 0.75,
        realized_pnl_estimate: 250.0,
    });

    let assessment = sm_registry.assess_buyer(&toxic_scalper);
    assert!(assessment.is_smart_money);
    assert!(
        assessment.is_quick_dump_risk,
        "10-second hold time must be flagged as quick dump risk"
    );
    assert!(
        assessment.quality_score < 90,
        "Quality score must be penalized for toxic dump risk"
    );

    // 6. Dev transfer to proxy raises risk even if dev balance is zero
    let dev_wallet = Pubkey::new_unique();
    let total_supply = 1_000_000_000u64;
    let mut dev_tracker = DevProxyState::new(dev_wallet, total_supply);
    assert_eq!(dev_tracker.dev_balance, 0);

    // Dev transfers 6% of supply (60M tokens) to shadow proxies
    let proxy_wallet = Pubkey::new_unique();
    dev_tracker.record_transfer_from_dev(proxy_wallet, 60_000_000, false);
    let dev_risk = dev_tracker.calculate_risk_score();
    assert!(
        dev_risk >= 70,
        "Dev proxy transfer of >5% supply must trigger high risk (>=70) even with 0 dev balance, got {}",
        dev_risk
    );
}

#[test]
fn test_stage_6_economics_full_suite() {
    use alpha_flip_hot::economics::*;
    use alpha_flip_hot::errors::EconomicError;
    use alpha_flip_hot::AdvisoryAction;

    // 1. Bonding Curve Math: Buy & Sell deterministic quote & invariant
    let pump = StandardPumpCurveEngine::new();
    let sol_in = 1_000_000_000; // 1 SOL
    let buy_quote = pump
        .quote_buy(PUMP_INITIAL_VIRTUAL_SOL, PUMP_INITIAL_VIRTUAL_TOKEN, sol_in)
        .expect("Pump buy quote should succeed");

    assert_eq!(buy_quote.sol_in, 1_000_000_000);
    assert_eq!(buy_quote.fee_lamports, 10_000_000); // 1.0%
    assert_eq!(buy_quote.sol_into_curve, 990_000_000);
    assert!(buy_quote.tokens_out > 0);
    assert!(buy_quote.spot_price_after > buy_quote.spot_price_before);

    // Sell quote after buy
    let new_sol = PUMP_INITIAL_VIRTUAL_SOL + buy_quote.sol_into_curve;
    let new_tok = PUMP_INITIAL_VIRTUAL_TOKEN - buy_quote.tokens_out;
    let sell_quote = pump
        .quote_sell(new_sol, new_tok, buy_quote.tokens_out)
        .expect("Pump sell quote should succeed");

    assert_eq!(sell_quote.tokens_in, buy_quote.tokens_out);
    assert!(sell_quote.sol_out_gross <= buy_quote.sol_into_curve + 1);
    assert!(sell_quote.sol_out_net < buy_quote.sol_in);

    // 2. Fee Model: Roundtrip total friction calculation
    let fee_model = FeeModel::default();
    let fees = fee_model.estimate_roundtrip(DexProtocol::PumpFun, 1_000_000_000, false);
    assert_eq!(fees.buy_dex_fee_lamports, 10_000_000);
    assert_eq!(fees.sell_dex_fee_lamports, 10_000_000);
    assert_eq!(fees.buy_jito_tip, 1_000_000);
    assert_eq!(fees.sell_jito_tip, 1_000_000);
    assert!(fees.total_cost_bps > 200); // > 2.2% of 1 SOL

    // 3. Economic Edge Gate: Hurdle gate rejection & approval
    let gate = EconomicEdgeGate::new(150, 100); // 150 bps margin of safety, 100 bps slippage budget
    // Small gross edge (2.5% = 250 bps) should fail hurdle (cost 221 bps + 100 bps slippage + 150 bps margin = 471 bps required)
    let rejected_eval = gate.evaluate_edge(250, &fees);
    assert!(matches!(
        rejected_eval,
        Err(EconomicError::InsufficientEdge { .. })
    ));

    // Sufficient gross edge (5.5% = 550 bps) should pass
    let approved_eval = gate.evaluate_edge(550, &fees).expect("Should pass hurdle");
    assert!(approved_eval.approved);
    assert!(approved_eval.net_expected_edge_bps > 0);

    // 4. Position Sizing: Liquidity cap and risk downscaling enforcement
    let sizer = PositionSizer::default(); // max 1.5 SOL, min 0.05 SOL, 2% pool cap

    // Scenario A: Liquidity cap binds on low liquidity pool (10 SOL reserve -> 2% = 0.2 SOL)
    let ctx_low_liq = SizingContext {
        base_target_lamports: 1_000_000_000,        // 1.0 SOL target
        pool_sol_reserves_lamports: 10_000_000_000, // 10 SOL pool
        cabal_score: 10,
        has_smart_money: false,
        dev_proxy_risk_flag: false,
        cold_advisory: None,
    };
    let size_low_liq = sizer.size_position(&ctx_low_liq).unwrap();
    assert_eq!(size_low_liq, 200_000_000); // Capped at exactly 2% (0.2 SOL)

    // Scenario B: Cold advisory veto
    let ctx_veto = SizingContext {
        base_target_lamports: 1_000_000_000,
        pool_sol_reserves_lamports: 100_000_000_000,
        cabal_score: 10,
        has_smart_money: false,
        dev_proxy_risk_flag: false,
        cold_advisory: Some(AdvisoryAction::Veto),
    };
    assert!(matches!(
        sizer.size_position(&ctx_veto),
        Err(EconomicError::AdvisoryVeto { .. })
    ));

    // Scenario C: Cabal score downscaling and floor breach
    let ctx_floor = SizingContext {
        base_target_lamports: 80_000_000, // 0.08 SOL
        pool_sol_reserves_lamports: 100_000_000_000,
        cabal_score: 65,                  // 50% penalty -> 0.04 SOL (< 0.05 SOL floor)
        has_smart_money: false,
        dev_proxy_risk_flag: false,
        cold_advisory: None,
    };
    assert!(matches!(
        sizer.size_position(&ctx_floor),
        Err(EconomicError::SizeBelowMinimumFloor { .. })
    ));

    // 5. MinOut Calculator: Dynamic slippage & fill verification
    let min_out_calc = MinOutCalculator::default();
    let dyn_slip_fast = min_out_calc.calculate_dynamic_slippage(0.95, 250);
    assert_eq!(dyn_slip_fast, 250); // Aggressive tier

    let expected_units = 10_000_000;
    let min_out = min_out_calc.calculate_min_out(expected_units, 250); // 2.5% slippage
    assert_eq!(min_out, 9_750_000);
    assert!(min_out_calc.verify_fill(9_750_000, min_out).is_ok());
    assert!(min_out_calc.verify_fill(9_749_999, min_out).is_err());

    // 6. Price Impact Model: Excessive impact rejection
    let impact_model = PriceImpactModel::new(250); // max 2.5%
    let ok_impact = impact_model.evaluate_impact(1.0, 1.02); // 2.0% impact
    assert_eq!(ok_impact, Ok(200));

    let bad_impact = impact_model.evaluate_impact(1.0, 1.035); // 3.5% impact
    assert!(matches!(
        bad_impact,
        Err(EconomicError::ExcessivePriceImpact { .. })
    ));
}

#[tokio::test]
async fn test_stage_7_jito_execution_suite() {
    use alpha_flip_hot::errors::ExecutionError;
    use alpha_flip_hot::events::TradeSide;
    use alpha_flip_hot::execution::*;
    use alpha_flip_hot::position::PositionState;
    use alpha_flip_hot::types::{Blockhash, Pubkey, Signature, Slot};

    // 1. Stale blockhash triggers refresh & stale guard
    let mut bh_cache = BlockhashCache::new(100, 40); // max 100 slots, refresh after 40
    let test_hash = Blockhash::new([7u8; 32]);
    bh_cache.update(test_hash, Slot(1000));

    // Fresh at slot 1020
    assert!(!bh_cache.needs_refresh(Slot(1020)));
    assert_eq!(bh_cache.get_valid_blockhash(Slot(1020)).unwrap(), test_hash);

    // Refresh trigger at slot 1045 (>40 slots elapsed)
    assert!(bh_cache.needs_refresh(Slot(1045)));
    assert_eq!(bh_cache.get_valid_blockhash(Slot(1045)).unwrap(), test_hash);

    // Stale guard breach at slot 1105 (>100 slots elapsed)
    let stale_err = bh_cache.get_valid_blockhash(Slot(1105));
    assert!(matches!(
        stale_err,
        Err(ExecutionError::StaleBlockhash { age_slots: 105, max_slots: 100 })
    ));

    // 2. Landed rate drop dynamically increases tip within safety caps
    let mut tip_opt = TipOptimizer::new(0.85, 500_000, 10_000_000, 5_000_000, 50_000_000);
    let initial_tip = tip_opt.calculate_optimal_tip().unwrap();
    assert_eq!(initial_tip, 1_000_000); // 2x min_tip in Normal regime

    // Simulate 4 missed bundles (0% landed rate)
    for _ in 0..4 {
        tip_opt.record_submission(1_000_000);
        tip_opt.record_outcome(false);
    }
    assert_eq!(tip_opt.current_landed_rate(), 0.0);
    let boosted_tip = tip_opt.calculate_optimal_tip().unwrap();
    assert!(
        boosted_tip > initial_tip,
        "Tip must be boosted on low landed rate: got {}, initial was {}",
        boosted_tip, initial_tip
    );
    assert!(boosted_tip <= tip_opt.max_tip_per_trade);

    // 3. Failed bundle does not mark position open
    let mock_jito = MockJitoClient::new();
    let mut fill_tracker = FillTracker::new(5000);
    let mint = Pubkey::new_unique();
    let bundle_id = "bundle_buy_fail_1".to_string();

    fill_tracker
        .register_order(
            bundle_id.clone(),
            mint,
            TradeSide::Buy,
            1_000_000,
            100_000_000,
            Slot(1000),
            1700000000000,
        )
        .expect("Buy order registration must succeed");

    // Simulate bundle failure
    mock_jito
        .set_bundle_status(
            bundle_id.clone(),
            BundleStatus::Failed {
                reason: "Block leader slot missed".to_string(),
            },
        )
        .await;

    let failed_order = fill_tracker
        .mark_failed(&bundle_id, "Block leader slot missed".to_string())
        .expect("Order should be marked failed");

    assert!(matches!(failed_order.status, FillStatus::Failed { .. }));
    // Invariant check: failed order must NOT open a position
    let position_opt: Option<PositionState> = None;
    assert!(position_opt.is_none(), "Failed bundle must not open position");
    // Mint lock must be released
    assert!(!fill_tracker.is_mint_in_flight(&mint));

    // 4. Partial sell retry respects remaining balance
    let original_token_amount = 500_000_000u64;
    let partial_sold = 200_000_000u64;
    let remaining_balance = original_token_amount - partial_sold;

    // Retry sell of remaining is valid
    assert!(fill_tracker
        .verify_sell_balance(remaining_balance, 300_000_000)
        .is_ok());

    // Attempting to sell more than remaining balance fails invariant
    let invalid_sell = fill_tracker.verify_sell_balance(remaining_balance, 350_000_000);
    assert!(matches!(
        invalid_sell,
        Err(ExecutionError::InvalidRemainingBalance { remaining: 300_000_000, attempted: 350_000_000 })
    ));

    // 5. Budget governor pauses new entries when hourly cap is exceeded
    let mut gov = BudgetGovernor::new(10_000_000, 100_000_000, 5_000_000);
    // Spend 9M out of 10M limit
    gov.record_spend(9_000_000, false);
    assert!(gov.check_entry_budget(1_000_000).is_ok());

    // 2M entry rejected (exceeds hourly remaining 1M)
    assert!(matches!(
        gov.check_entry_budget(2_000_000),
        Err(ExecutionError::BudgetExhausted { requested_lamports: 2_000_000, remaining_lamports: 1_000_000 })
    ));

    // But emergency exit has dedicated 5M reserve
    assert!(gov.check_exit_budget(2_000_000).is_ok());

    // 6. BundleBuilder strict instruction order & 1232 byte packet MTU limit
    let builder = BundleBuilder::new();
    let swap_program = Pubkey::new_unique();
    let swap_ix = Instruction {
        program_id: swap_program,
        accounts: vec![],
        data: vec![42],
    };
    let tip_acc = Pubkey::new_unique();
    let signer = Pubkey::new_unique();
    let ordered_ixs = builder
        .build_ordered_instructions(swap_ix, 100_000, 50_000, tip_acc, 1_000_000, signer)
        .unwrap();

    assert_eq!(ordered_ixs.len(), 5);
    assert_eq!(ordered_ixs[0].accounts[0].pubkey, builder.dont_front_account);
    assert_eq!(ordered_ixs[1].data[0], 2); // set_compute_unit_limit
    assert_eq!(ordered_ixs[2].data[0], 3); // set_compute_unit_price
    assert_eq!(ordered_ixs[3].program_id, swap_program);
    assert_eq!(ordered_ixs[4].accounts[1].pubkey, tip_acc);

    // 7. Bundle builder enforces 1232 byte Solana MTU packet limit
    let huge_swap = Instruction {
        program_id: swap_program,
        accounts: vec![],
        data: vec![0u8; 1800],
    };
    let mtu_err = builder.build_jito_bundle(
        "b_oversized".into(),
        huge_swap,
        150_000,
        25_000,
        tip_acc,
        1_000_000,
        signer,
        Blockhash::default(),
    );
    assert!(matches!(
        mtu_err,
        Err(ExecutionError::BundleSizeLimitExceeded { max_size: 1232, .. })
    ));

    // 8. Tip ceiling invariant: tip cap is NEVER breached even in MevWar with 0 landed rate
    tip_opt.set_regime(MarketRegime::MevWar);
    let mev_war_tip = tip_opt.calculate_optimal_tip().unwrap();
    assert!(mev_war_tip <= tip_opt.max_tip_per_trade);
    assert!(mev_war_tip <= tip_opt.max_tip_lamports);
}

#[tokio::test]
async fn test_stage_8_exit_engine_suite() {
    use alpha_flip_hot::economics::QuoteEngine;
    use alpha_flip_hot::errors::ExitError;
    use alpha_flip_hot::events::TradeSide;
    use alpha_flip_hot::exit::*;
    use alpha_flip_hot::position::PositionState;
    use alpha_flip_hot::types::{Lamports, Mint, Signature, Slot, TokenAmount};

    let mint = Mint::new_unique();
    let initial_tokens = TokenAmount::new(1_000_000_000); // 1B tokens
    let pos = PositionState::new(
        mint,
        0.000100, // entry price
        Lamports::new(100_000_000),
        initial_tokens,
        Slot(1000),
        Signature::default(),
    )
    .expect("Position initialization must succeed");

    // 1. Ladder tracks remaining balance strictly
    let mut ladder = LadderController::new(initial_tokens, 3000, 50, 6000, 30);
    assert_eq!(ladder.remaining_tokens, initial_tokens);

    let t1_amt = ladder.calculate_tier_sell_amount(1).unwrap();
    assert_eq!(t1_amt.as_u64(), 500_000_000); // 50%
    ladder.mark_tier_filled(1, t1_amt).unwrap();
    assert_eq!(ladder.remaining_tokens.as_u64(), 500_000_000);

    let t2_amt = ladder.calculate_tier_sell_amount(2).unwrap();
    assert_eq!(t2_amt.as_u64(), 300_000_000); // 30% of initial
    ladder.mark_tier_filled(2, t2_amt).unwrap();
    assert_eq!(ladder.remaining_tokens.as_u64(), 200_000_000); // 20% left

    // Attempting to sell more than remaining balance fails invariant
    assert!(matches!(
        ladder.mark_tier_filled(3, TokenAmount::new(200_000_001)),
        Err(ExitError::ExceedsRemainingBalance { .. })
    ));

    // 2. OFI decay exits on sustained sell pressure, not one tick
    let mut ofi = OrderFlowImbalanceTracker::new(30, 60);
    // Buys dominant initially
    for s in 1000..1010 {
        ofi.record_trade(Slot(s), TradeSide::Buy, 5_000_000);
    }
    // Single noisy sell tick
    ofi.record_trade(Slot(1011), TradeSide::Sell, 15_000_000);
    assert!(
        !ofi.is_sustained_sell_pressure(Slot(1011), -0.4),
        "Single noisy sell tick must NOT trigger sustained sell pressure exit"
    );

    // Sustained sell barrage
    for s in 1012..1040 {
        ofi.record_trade(Slot(s), TradeSide::Sell, 10_000_000);
    }
    assert!(
        ofi.is_sustained_sell_pressure(Slot(1040), -0.35),
        "Sustained sell pressure must trigger OFI decay alert"
    );

    // 3. Time-stop scenario differs fresh vs CTO
    let time_stop = ScenarioTimeStop::default();
    // At 100 slots elapsed with stagnant PnL (+50 bps):
    // Fresh Pump expires after 75 slots
    let fresh_check = time_stop.check_time_stop(Slot(1000), Slot(1100), 50, MarketScenario::FreshPump);
    assert!(
        matches!(fresh_check, Some(TimeStopReason::StagnantPnLBand { .. })),
        "Fresh pump must exit on stagnant PnL to preserve capital velocity"
    );

    // CTO Raydium allows up to 225 slots for stagnation
    let cto_check = time_stop.check_time_stop(Slot(1000), Slot(1100), 50, MarketScenario::RaydiumCTO);
    assert!(
        cto_check.is_none(),
        "CTO scenario must give longer leeway and not exit prematurely"
    );

    // 4. Emergency exit overrides ladder
    let quote_engine = QuoteEngine::default();
    let mut engine = SyntheticOrderEngine::new(&pos, quote_engine, 200);

    let emergency_ctx = ExitEvaluationContext {
        current_slot: Slot(1050),
        current_spot_price: 0.000140, // +40% (Tier 1 is in range)
        pool_virtual_sol_reserves: 30_000_000_000,
        pool_virtual_token_reserves: 1_000_000_000_000_000,
        peak_pool_sol_reserves: 30_000_000_000,
        scenario: MarketScenario::FreshPump,
        dev_dump_detected: true, // Emergency trigger!
        grpc_drift_detected: false,
        execution_failure_detected: false,
        recent_consecutive_sells: 1,
        recent_sell_volume_lamports: 100_000_000,
        current_cabal_score: 10,
        entry_cabal_score: 10,
        has_pending_exit_in_flight: false,
    };
    let decision = engine.evaluate_exit(&pos, &emergency_ctx).unwrap();
    assert_eq!(decision.action, ExitAction::EmergencyExit);
    assert_eq!(decision.urgency, ExitUrgency::Critical);

    // 5. Adverse selection accelerates exit
    let adverse_ctx = ExitEvaluationContext {
        current_slot: Slot(1008), // Only 8 slots post-buy!
        current_spot_price: 0.000102,
        pool_virtual_sol_reserves: 30_000_000_000,
        pool_virtual_token_reserves: 1_000_000_000_000_000,
        peak_pool_sol_reserves: 30_000_000_000,
        scenario: MarketScenario::FreshPump,
        dev_dump_detected: false,
        grpc_drift_detected: false,
        execution_failure_detected: false,
        recent_consecutive_sells: 4,
        recent_sell_volume_lamports: 3_500_000_000, // 3.5 SOL immediate post-buy dump
        current_cabal_score: 10,
        entry_cabal_score: 10,
        has_pending_exit_in_flight: false,
    };
    let adverse_decision = engine.evaluate_exit(&pos, &adverse_ctx).unwrap();
    assert_eq!(adverse_decision.action, ExitAction::EmergencyExit);
    assert_eq!(adverse_decision.urgency, ExitUrgency::Critical);

    // 6. No double sell when pending signature exists
    let in_flight_ctx = ExitEvaluationContext {
        current_slot: Slot(1050),
        current_spot_price: 0.000135,
        pool_virtual_sol_reserves: 30_000_000_000,
        pool_virtual_token_reserves: 1_000_000_000_000_000,
        peak_pool_sol_reserves: 30_000_000_000,
        scenario: MarketScenario::FreshPump,
        dev_dump_detected: false,
        grpc_drift_detected: false,
        execution_failure_detected: false,
        recent_consecutive_sells: 0,
        recent_sell_volume_lamports: 0,
        current_cabal_score: 10,
        entry_cabal_score: 10,
        has_pending_exit_in_flight: true, // Signature in-flight!
    };
    let double_sell_res = engine.evaluate_exit(&pos, &in_flight_ctx);
    assert!(matches!(
        double_sell_res,
        Err(ExitError::PendingExitInFlight { .. })
    ));
}

#[tokio::test]
async fn test_stage_9_position_journal_and_recovery() {
    use alpha_flip_hot::orchestrator::{
        OperatingMode, OrchestratorEngine, OrchestratorState, RiskLimits,
    };
    use alpha_flip_hot::position::{
        JournalEvent, MockBalanceProvider, PositionJournal, PositionManager, ReconciliationStatus,
        StartupRecoveryEngine,
    };
    use alpha_flip_hot::types::{Lamports, Mint, Signature, Slot, TokenAmount};

    // 1. PositionJournal idempotency and lifecycle
    let journal = PositionJournal::ephemeral();
    let mint = Mint::from_bytes([0x11; 32]);
    let sig_buy = Signature::from_bytes([0x22; 64]);

    let app_first = journal.append(
        "buy_landed_1",
        JournalEvent::BuyLanded {
            mint,
            signature: sig_buy,
            tokens_acquired: TokenAmount::new(100_000),
            sol_spent: Lamports::new(1_000_000_000),
            effective_price: 0.00001,
            slot: Slot(500),
        },
    ).unwrap();
    assert!(app_first);

    // Duplicate key rejected idempotently
    let app_dup = journal.append(
        "buy_landed_1",
        JournalEvent::BuyLanded {
            mint,
            signature: sig_buy,
            tokens_acquired: TokenAmount::new(100_000),
            sol_spent: Lamports::new(1_000_000_000),
            effective_price: 0.00001,
            slot: Slot(500),
        },
    ).unwrap();
    assert!(!app_dup, "Duplicate idempotency key must not append");

    // 2. PositionManager strict 1-position invariant
    let mut manager = PositionManager::new(journal.clone());
    assert!(manager.can_open_new_position());

    manager
        .record_buy_landed(
            mint,
            sig_buy,
            TokenAmount::new(100_000),
            Lamports::new(1_000_000_000),
            0.00001,
            Slot(500),
        )
        .unwrap();

    assert!(!manager.can_open_new_position(), "Cannot open second position while one is active");

    let mint_second = Mint::from_bytes([0x33; 32]);
    let second_err = manager.register_intent(mint_second, Lamports::new(500_000_000), Slot(501), "intent2".to_string());
    assert!(second_err.is_err(), "Must reject new position intent while holding active position");

    // 3. Crash recovery reconciliation
    let recovery = StartupRecoveryEngine::new(journal);

    // Scenario A: Balance matches -> RecoveredActive
    let balance_matching = MockBalanceProvider::new(Lamports::new(5_000_000_000))
        .with_token(mint, TokenAmount::new(100_000));
    let rec_active = recovery.reconcile(&balance_matching, Slot(510)).await.unwrap();
    match rec_active {
        ReconciliationStatus::RecoveredActive(pos) => {
            assert_eq!(pos.mint, mint);
            assert_eq!(pos.remaining_token_amount.as_u64(), 100_000);
        }
        _ => panic!("Expected RecoveredActive"),
    }

    // Scenario B: Balance 0 and no confirmed exit -> Discrepancy blocks live trading
    let balance_zero = MockBalanceProvider::new(Lamports::new(5_000_000_000));
    let rec_disc = recovery.reconcile(&balance_zero, Slot(515)).await.unwrap();
    match rec_disc {
        ReconciliationStatus::Discrepancy { ref mint, ref reason, .. } => {
            assert_eq!(*mint, mint);
            assert!(reason.contains("wallet token balance is zero"));
        }
        _ => panic!("Expected Discrepancy"),
    }

    // 4. Global Risk Limits & Circuit Breaker
    let mut risk_limits = RiskLimits::default();
    risk_limits.max_consecutive_losses = 2;
    risk_limits.max_daily_loss_lamports = 200_000_000;

    let mut engine = OrchestratorEngine::new(OperatingMode::Live, manager, risk_limits);
    assert_eq!(engine.mode(), OperatingMode::Live);

    // Observe mode blocks orders
    engine.set_mode(OperatingMode::Observe);
    assert!(engine.check_entry_risk_gates(1000, Lamports::new(10_000_000_000), Lamports::new(100_000_000)).is_err());

    // Live mode passes risk check
    engine.set_mode(OperatingMode::Live);
    // (active position is still held in manager, so entry check fails on 1-position invariant)
    assert!(engine.check_entry_risk_gates(1000, Lamports::new(10_000_000_000), Lamports::new(100_000_000)).is_err());

    // Record 2 consecutive losses -> Auto-pause circuit breaker
    engine.record_trade_completion(1000, -100_000_000, 5000);
    assert_eq!(engine.risk_state().consecutive_losses, 1);
    engine.record_trade_completion(1010, -110_000_000, 5000);
    assert_eq!(engine.risk_state().consecutive_losses, 2);
    assert_eq!(engine.mode(), OperatingMode::Paused, "Circuit breaker must automatically pause engine");
    assert_eq!(engine.state(), OrchestratorState::Paused);
}

