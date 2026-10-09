# Alpha-Flip v3.2 Micro-Live Go-Live Checklist

This document specifies the mandatory **HARD GATES** that must pass prior to promoting **Alpha-Flip v3.2** into `micro-live` mode. Failure of any single gate automatically aborts go-live.

---

## 1. Automated Verification Gates

- [ ] **Stage 0-13 Implementation Verified**: All architectural stages implemented and checked against specifications.
- [ ] **Hot Path Test Suite Green**:
  ```bash
  cargo test --workspace --all-targets
  ```
  Zero failed unit or integration tests.
- [ ] **Cold Path Python Test Suite Green**:
  ```bash
  PYTHONPATH=services/alpha-flip-cold/src python3 -m unittest discover -s services/alpha-flip-cold/tests
  ```
  Schema validators, prompt injection guards, and worker unit tests all pass.
- [ ] **Replay Scenario Suite Green**:
  Deterministic replay suite (`tests/replay_tests.rs` and `tests/shadow_tests.rs`) executed and verified without regressions.

---

## 2. Soak & Staging Stability Gates

- [ ] **72 Hours OBSERVE Stable**:
  - Continuous ingestion from Yellowstone gRPC without unhandled panic or crash.
  - Zero memory leaks: RSS consumption stable under 512 MB.
  - P99 instruction decode latency $< 150 \ \mu\text{s}$.
- [ ] **7 Days SHADOW Positive Expectancy**:
  - Tested over $\ge 200$ simulated market trades.
  - Positive mathematical expectancy after realistic deductions (Jito tips, DEX fees, ATA rents, signature fees, and adverse price movement buffers).
  - Profit factor $\ge 1.35$.
- [ ] **Jito Landed Rate Compliance**:
  - Live bundle simulation confirms landed rate $\ge 60\%$ in the chosen block engine region.
- [ ] **Zero Unresolved State Drift**:
  - Metric `alpha_flip_reconciliation_drift_events` is exactly 0.

---

## 3. Operational Safety & Fault Injection Gates

- [ ] **Crash Recovery Tested**:
  - Forced `kill -9` while holding an active in-memory position.
  - On restart, `StartupRecoveryEngine` successfully recovers state from `journal_*.jsonl`, cross-checks on-chain balance, and restores exit orders without duplication.
- [ ] **Kill Switch Drill**:
  - Executed emergency halt via Redis channel `alpha_flip:hot:commands` and verified that active position was liquidated to SOL within 1 slot.
- [ ] **Alerting Pipeline Validated**:
  - Synthetic test alert fired through Prometheus to verify Telegram / Opsgenie delivery.
- [ ] **Security Checklist Passed**:
  - `docs/SECURITY_CHECKLIST.md` audited.
  - Hot wallet SOL balance capped to **0.5 SOL** maximum.
  - File permissions on `/etc/alpha-flip/keypair.json` set to `0400`.
  - Cold profit sweeper cron active.

---

## 4. Go-Live Sign-Off

| Role | Sign-Off Requirement | Status |
| :--- | :--- | :---: |
| **Quant Engineer** | Verified risk limits, edge gate thresholds, and shadow expectancy | [ ] APPROVED |
| **Rust HFT Engineer** | Verified zero memory leaks, thread safety, and crash recovery | [ ] APPROVED |
| **DevOps / Security** | Verified firewall rules, non-root user, and key isolation | [ ] APPROVED |
