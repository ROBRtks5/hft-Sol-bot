use alpha_flip_hot::decoder::fixtures::*;
use alpha_flip_hot::grpc::transport::*;
use alpha_flip_hot::orchestrator::OperatingMode;
use alpha_flip_hot::replay::{ReplayFrame, ReplayLoader, ReplayRunner};
use alpha_flip_hot::types::{Lamports, Mint, Pubkey, Signature, Slot, TokenAmount};
use std::str::FromStr;

#[test]
fn test_replay_loader_parses_jsonl() {
    let jsonl = r#"
{"type":"Slot","data":{"slot":1000,"parent_slot":999,"status":"processed"}}
{"type":"Slot","data":{"slot":1001,"parent_slot":1000,"status":"confirmed"}}
{"type":"Slot","data":{"slot":1005,"parent_slot":1004,"status":"rooted"}}
"#;

    let frames = ReplayLoader::load_str(jsonl).expect("Failed to parse replay string");
    assert_eq!(frames.len(), 3);
    assert_eq!(frames[0].slot().as_u64(), 1000);
    assert_eq!(frames[1].slot().as_u64(), 1001);
    assert_eq!(frames[2].slot().as_u64(), 1005);
}

#[test]
fn test_replay_runner_processes_pump_lifecycle() {
    let mut runner = ReplayRunner::new(OperatingMode::Shadow);

    let mint = Pubkey::new_unique();
    let bonding_curve = Pubkey::new_unique();
    let creator = Pubkey::new_unique();
    let trader1 = Pubkey::new_unique();

    let mut frames = Vec::new();

    // Frame 1: Slot 500 tick
    frames.push(ReplayFrame::Slot(SlotUpdateFrame {
        slot: Slot::new(500),
        parent_slot: Some(Slot::new(499)),
        status: "processed".to_string(),
    }));

    // Frame 2: Pump Create
    let mut create_tx = TransactionUpdateFrame::default();
    create_tx.slot = Slot::new(501);
    create_tx.signature = Signature::new([0x01; 64]);
    create_tx.account_keys = vec![creator, mint, bonding_curve, PUMP_FUN_PROGRAM_ID];
    create_tx.instructions.push(RawInstruction {
        program_id: PUMP_FUN_PROGRAM_ID,
        accounts: vec![mint, bonding_curve, Pubkey::new_unique(), Pubkey::new_unique(), creator],
        data: make_pump_create_data("AlphaCoin", "ALPHA", "https://alpha.io"),
    });
    frames.push(ReplayFrame::Transaction(create_tx));

    // Frame 3: Multiple buy trades
    for i in 1..=5 {
        let mut buy_tx = TransactionUpdateFrame::default();
        buy_tx.slot = Slot::new(501 + i);
        buy_tx.signature = Signature::new([i as u8; 64]);
        buy_tx.account_keys = vec![trader1, mint, bonding_curve, PUMP_FUN_PROGRAM_ID];
        buy_tx.instructions.push(RawInstruction {
            program_id: PUMP_FUN_PROGRAM_ID,
            accounts: vec![Pubkey::new_unique(), Pubkey::new_unique(), bonding_curve, Pubkey::new_unique(), Pubkey::new_unique(), Pubkey::new_unique(), trader1],
            data: make_pump_buy_data(10_000_000_000, 2_000_000_000), // 10k tokens for 2 SOL
        });
        frames.push(ReplayFrame::Transaction(buy_tx));
    }

    let summary = runner.run(&frames);

    assert_eq!(summary.total_frames_processed, 7);
    assert_eq!(summary.starting_slot.as_u64(), 500);
    assert_eq!(summary.ending_slot.as_u64(), 506);
    assert_eq!(summary.tokens_tracked, 1);
    assert!(summary.trades_detected >= 5);
}

#[test]
fn test_replay_runner_deterministic_repeatability() {
    let jsonl = r#"
{"type":"Slot","data":{"slot":100,"parent_slot":99,"status":"processed"}}
{"type":"Slot","data":{"slot":105,"parent_slot":104,"status":"confirmed"}}
{"type":"Slot","data":{"slot":110,"parent_slot":109,"status":"rooted"}}
"#;

    let frames = ReplayLoader::load_str(jsonl).unwrap();

    let mut runner1 = ReplayRunner::new(OperatingMode::Shadow);
    let summary1 = runner1.run(&frames);

    let mut runner2 = ReplayRunner::new(OperatingMode::Shadow);
    let summary2 = runner2.run(&frames);

    assert_eq!(summary1.starting_slot, summary2.starting_slot);
    assert_eq!(summary1.ending_slot, summary2.ending_slot);
    assert_eq!(summary1.slots_advanced, summary2.slots_advanced);
    assert_eq!(summary1.total_frames_processed, summary2.total_frames_processed);
}

#[tokio::test]
async fn test_account_update_deduplication_by_slot_and_write_version() {
    use alpha_flip_hot::state::TokenRuntime;
    use alpha_flip_hot::types::WriteVersion;

    let mint = Mint::new(Pubkey::from_bytes([0x11; 32]));
    let mut token = TokenRuntime::new(mint, Slot::new(100));
    token.last_slot = Slot::new(100);
    token.last_write_version = WriteVersion::new(5);

    // 1. Same slot, smaller write_version -> MUST BE REJECTED (false)
    assert!(!token.is_update_newer(Slot::new(100), WriteVersion::new(4)));

    // 2. Same slot, identical write_version -> MUST BE REJECTED (false)
    assert!(!token.is_update_newer(Slot::new(100), WriteVersion::new(5)));

    // 3. Same slot, higher write_version -> ACCEPTED (true)
    assert!(token.is_update_newer(Slot::new(100), WriteVersion::new(6)));

    // 4. Older slot, any write_version -> REJECTED (false)
    assert!(!token.is_update_newer(Slot::new(99), WriteVersion::new(100)));

    // 5. Newer slot, smaller write_version -> ACCEPTED (true)
    assert!(token.is_update_newer(Slot::new(101), WriteVersion::new(1)));
}

#[tokio::test]
async fn test_jito_client_regional_rotation() {
    use alpha_flip_hot::execution::ProductionJitoClient;

    let client = ProductionJitoClient::new(
        "https://mainnet.block-engine.jito.wtf/api/v1/bundles".to_string(),
        None,
    );

    let first = client.current_endpoint().to_string();
    assert!(first.contains("block-engine.jito.wtf"));

    let rotated1 = client.rotate_region();
    assert!(!rotated1.is_empty());
    let rotated2 = client.rotate_region();
    assert!(!rotated2.is_empty());
}
