use alpha_flip_hot::observability::{
    EngineMetrics, HealthChecker, HealthStatus, LoggingConfig, SecurityRedactor,
};
use alpha_flip_hot::orchestrator::OperatingMode;
use alpha_flip_hot::types::{Lamports, Slot};

#[test]
fn test_engine_metrics_snapshot_and_prometheus() {
    let metrics = EngineMetrics::new();

    // 1. Record stream status
    metrics.record_grpc_status(true);
    metrics.record_slot_progress(105, 107);
    metrics.record_decode_latency(45);
    metrics.record_decode_latency(120);

    // 2. Record bundle events
    metrics.record_bundle_outcome(true, 5_000_000);
    metrics.record_bundle_outcome(false, 5_000_000);
    metrics.record_trade_slippage(100, 115);

    // 3. Record PnL
    metrics.record_trade_pnl(150_000_000, true);

    let snap = metrics.snapshot();
    assert!(snap.grpc_connected);
    assert_eq!(snap.slot_lag, 2);
    assert_eq!(snap.bundles_submitted, 2);
    assert_eq!(snap.bundles_landed, 1);
    assert_eq!(snap.bundles_failed, 1);
    assert!((snap.landed_rate_pct - 50.0).abs() < 0.01);
    assert!((snap.live_realized_pnl_sol - 0.15).abs() < 0.001);

    // 4. Prometheus text exposition
    let prom = metrics.render_prometheus();
    assert!(prom.contains("alpha_flip_grpc_connected 1"));
    assert!(prom.contains("alpha_flip_slot_lag 2"));
    assert!(prom.contains("alpha_flip_landed_rate_pct 50.00"));
}

#[test]
fn test_health_checker_evaluates_correctly() {
    let checker = HealthChecker::default();

    // Scenario A: All green
    let healthy_report = checker.evaluate(
        OperatingMode::Shadow,
        Slot::new(500),
        Slot::new(502), // 2 slots lag (<= 5 allowed)
        true,           // grpc connected
        true,           // redis reachable
        true,           // blockhash fresh
        Lamports::new(1_000_000_000), // 1.0 SOL (> 0.2 floor)
        false,          // no unresolved recovery
        None,
    );
    assert_eq!(healthy_report.status, HealthStatus::Healthy);
    assert!(healthy_report.issues.is_empty());

    // Scenario B: Critical floor breach and disconnected gRPC
    let critical_report = checker.evaluate(
        OperatingMode::Live,
        Slot::new(500),
        Slot::new(510), // 10 slots lag
        false,          // grpc disconnected!
        true,
        true,
        Lamports::new(50_000_000), // 0.05 SOL (< 0.2 floor)
        true,           // unresolved recovery!
        None,
    );
    assert_eq!(critical_report.status, HealthStatus::Critical);
    assert!(critical_report.issues.len() >= 3);
}

#[test]
fn test_security_redactor_masks_secrets() {
    let log_line = "Debug log containing private_key and secret_key in transaction";
    let sanitized = SecurityRedactor::sanitize_log(log_line);

    assert!(!sanitized.contains("private_key"));
    assert!(!sanitized.contains("secret_key"));
    assert!(sanitized.contains("[REDACTED_SECURITY_CRITICAL]"));
}
