use alpha_flip_hot::clock::SlotClock;
use alpha_flip_hot::economics::DexProtocol;
use alpha_flip_hot::shadow::{
    ShadowPnlModel, ShadowSimulator, ShadowSimulatorConfig, ShadowTradeRecord, SimulatedFrictionCost,
};
use alpha_flip_hot::types::{Mint, Pubkey, Slot, TokenAmount};
use std::sync::Arc;

#[test]
fn test_shadow_pnl_model_mathematical_expectancy() {
    let mut model = ShadowPnlModel::new();

    // Trade 1: +0.2 SOL profit
    model.record_trade(ShadowTradeRecord {
        trade_id: "trade_1".to_string(),
        mint: "Mint1111111111111111111111111111111111111".to_string(),
        entry_slot: 100,
        exit_slot: 120,
        hold_duration_slots: 20,
        gross_entry_sol_lamports: 1_000_000_000,
        gross_exit_proceeds_lamports: 1_220_000_000,
        friction: SimulatedFrictionCost {
            entry_tip_lamports: 5_000_000,
            exit_tip_lamports: 5_000_000,
            base_network_fees_lamports: 10_000,
            priority_fees_lamports: 200_000,
            ata_rent_lamports: 2_039_280,
            dex_fees_lamports: 7_750_720,
            price_impact_cost_lamports: 0,
        },
        gross_pnl_lamports: 220_000_000,
        net_pnl_lamports: 200_000_000,
        net_roi_bps: 2000,
        landed_successfully: true,
        exit_reason: "TakeProfitLadderTier1".to_string(),
    });

    // Trade 2: -0.05 SOL loss (stop-loss with friction)
    model.record_trade(ShadowTradeRecord {
        trade_id: "trade_2".to_string(),
        mint: "Mint2222222222222222222222222222222222222".to_string(),
        entry_slot: 200,
        exit_slot: 215,
        hold_duration_slots: 15,
        gross_entry_sol_lamports: 1_000_000_000,
        gross_exit_proceeds_lamports: 970_000_000,
        friction: SimulatedFrictionCost {
            entry_tip_lamports: 5_000_000,
            exit_tip_lamports: 5_000_000,
            base_network_fees_lamports: 10_000,
            priority_fees_lamports: 200_000,
            ata_rent_lamports: 2_039_280,
            dex_fees_lamports: 7_750_720,
            price_impact_cost_lamports: 0,
        },
        gross_pnl_lamports: -30_000_000,
        net_pnl_lamports: -50_000_000,
        net_roi_bps: -500,
        landed_successfully: true,
        exit_reason: "EmergencyStopLoss".to_string(),
    });

    let report = model.generate_report();

    assert_eq!(report.total_simulated_trades, 2);
    assert_eq!(report.winning_trades, 1);
    assert_eq!(report.losing_trades, 1);
    assert!((report.win_rate_pct - 50.0).abs() < 0.01);
    assert_eq!(report.net_pnl_lamports, 150_000_000); // +0.15 SOL net
    assert!(report.profit_factor > 3.0); // 200m / 50m = 4.0
    assert!(report.mathematical_expectancy_lamports > 0);
}

#[test]
fn test_shadow_simulator_lifecycle() {
    let clock = Arc::new(SlotClock::new(Slot::new(500)));
    let mut config = ShadowSimulatorConfig::default();
    config.bundle_miss_rate = 0.0; // 100% fill for deterministic test
    config.execution_delay_slots = 0;

    let mut sim = ShadowSimulator::new(clock.clone(), config);
    let mint = Pubkey::new_unique();

    let pool_sol = 30_000_000_000; // 30 SOL pool
    let pool_token = 1_073_000_000_000_000; // 1.073B tokens

    // 1. Simulate Buy Order
    let buy_res = sim
        .simulate_buy_order(mint, 1_000_000_000, pool_sol, pool_token, DexProtocol::PumpFun)
        .expect("Buy failed");

    assert!(buy_res.is_some());
    assert!(sim.has_active_position());

    // 2. Advance clock
    clock.advance_to(Slot::new(515));

    // 3. Simulate Sell Order after price increases
    let higher_sol_reserves = 38_000_000_000;
    let tokens_to_sell = sim.active_position.as_ref().unwrap().remaining_tokens;

    let trade_record = sim
        .simulate_sell_order(
            tokens_to_sell,
            higher_sol_reserves,
            pool_token,
            DexProtocol::PumpFun,
            "TakeProfitTargetHit",
        )
        .expect("Sell failed")
        .expect("Trade should be completed");

    assert!(!sim.has_active_position());
    assert_eq!(trade_record.hold_duration_slots, 15);
    assert!(trade_record.gross_pnl_lamports > 0);

    let report = sim.generate_report();
    assert_eq!(report.total_simulated_trades, 1);
    assert_eq!(report.winning_trades, 1);
}

#[test]
fn test_shadow_simulator_rejects_insufficient_liquidity() {
    let clock = Arc::new(SlotClock::new(Slot::new(100)));
    let mut sim = ShadowSimulator::new(clock, ShadowSimulatorConfig::default());
    let mint = Pubkey::new_unique();

    // Pool has only 2 SOL liquidity (< 10 SOL required)
    let low_pool_sol = 2_000_000_000;
    let pool_token = 1_000_000_000_000;

    let res = sim
        .simulate_buy_order(mint, 1_000_000_000, low_pool_sol, pool_token, DexProtocol::PumpFun)
        .expect("Sim buy error");

    assert!(res.is_none());
    assert!(!sim.has_active_position());
}
