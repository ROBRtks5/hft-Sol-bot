# Alpha-Flip v3.2 Incident Response Playbook

This document defines standardized emergency response workflows for production anomalies.

---

## 1. Severities & Response Times

- **P0 (Emergency)**: Direct capital exposure, crash with open position, or key/security incident. Immediate intervention ($< 2 \ \text{minutes}$).
- **P1 (Critical)**: Ingestion stream lost, Jito block engine failure, consecutive losses hit. Response $< 15 \ \text{minutes}$.
- **P2 (Degraded)**: Cold path Redis delayed, high slot lag, partial API drop. Response $< 1 \ \text{hour}$.

---

## 2. Emergency Scenarios & Runbooks

### 2.1 Bot Loses Connection (Yellowstone gRPC)
- **Symptom**: `alpha_flip_grpc_connected == 0` for $> 2$ seconds.
- **Automated Behavior**: New buy signals are immediately discarded.
- **Action**:
  1. If holding an open position, observe whether time-stop triggers emergency sell via direct RPC fallback.
  2. If connection is not restored within 60s, dispatch manual kill switch:
     ```bash
     redis-cli PUBLISH alpha_flip:hot:commands '{"action":"SET_MODE","mode":"KILL_SWITCH"}'
     ```
  3. Verify provider status on Helius / Triton dashboard.

### 2.2 Jito Bundles Not Landing
- **Symptom**: `alpha_flip_landed_rate_pct < 40%`.
- **Root Cause**: Validator cluster congestion, low priority tip, or regional block engine degradation.
- **Action**:
  1. Inspect tip spend:
     ```bash
     curl -s http://localhost:9090/metrics | grep alpha_flip_bundles
     ```
  2. Failover block engine URL in `/etc/alpha-flip/config.toml` to alternate region (e.g. `frankfurt` or `ny`).
  3. Reload service:
     ```bash
     sudo systemctl reload alpha-flip-hot.service
     ```

### 2.3 Position Stuck In-Flight
- **Symptom**: Engine reports `InPosition`, but neither ladder sell nor time-stop lands.
- **Action**:
  1. Query hot wallet on-chain SPL token accounts:
     ```bash
     spl-token accounts --owner /etc/alpha-flip/keypair.json
     ```
  2. If tokens exist on-chain:
     ```bash
     # Execute manual emergency exit transaction using Jupiter or Pump CLI tool
     ./scripts/manual_exit.sh --mint <TOKEN_MINT>
     ```
  3. Restart engine to trigger `StartupRecoveryEngine` reconciliation.

### 2.4 Dev Dump or Cabal Attack Detected
- **Symptom**: Alert `AdverseSelectionDevDump` or single-block sell $> 5 \ \text{SOL}$.
- **Automated Behavior**: Synthetic exit engine immediately overrides ladder and executes `EmergencyDump` with aggressive slippage.
- **Action**:
  1. Confirm token is blacklisted in local state store.
  2. Ensure journal registers `PositionClosed` with recorded loss.

### 2.5 State Drift Detected (Reconciliation Mismatch)
- **Symptom**: `alpha_flip_reconciliation_drift_events > 0`.
- **Automated Behavior**: Engine auto-transitions to `RECOVERING` mode and refuses new orders.
- **Action**:
  1. Review last 50 journal entries:
     ```bash
     tail -n 50 /opt/alpha-flip/data/journal_*.jsonl | jq .
     ```
  2. Reconcile token balance on Solscan.
  3. Once confirmed clean, reset mode to `LIVE` via Redis command.

### 2.6 Redis Bridge Down
- **Symptom**: Cold path disconnected.
- **Behavior**: Hot path continues independently using local scoring gates (organic, cabal hot scorer).
- **Action**: Restart Redis server: `sudo systemctl restart redis`.

### 2.7 Gemini Cold Path Advisory Output Malformed
- **Symptom**: Worker logs `ValidationError` from Pydantic schema validator.
- **Behavior**: Cold path discards output; boost multiplier defaults safely to 1.0. Zero impact on hot execution safety.

### 2.8 Unexpected Profit or Loss Spike
- **Symptom**: PnL moves $> 1.0 \ \text{SOL}$ in under 5 minutes.
- **Action**:
  1. Immediately set mode to `PAUSED`.
  2. Inspect whether anomalous trade was caused by token transfer tax, honeypot pool, or curve exploit.
  3. Ensure profit sweeper moves excess funds to cold vault.
