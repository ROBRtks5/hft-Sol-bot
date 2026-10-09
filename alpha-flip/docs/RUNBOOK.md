# Alpha-Flip v3.2 Production Runbook

This document defines standard operating procedures (SOPs), emergency interventions, health checks, and failure recovery protocols for Alpha-Flip v3.2.

---

## 1. Operating Modes & Transitions

| Mode | Purpose | Execution | Safety Invariants |
| :--- | :--- | :--- | :--- |
| **OBSERVE** | Data feed verification, parser latency profiling, market microstructure tracking | Real orders: **NO**<br>Shadow PnL: **NO** | Zero on-chain signature emission. Zero private key exposure. |
| **SHADOW** | Paper trading with realistic slippage, fee, Jito tip, and bundle failure modeling | Real orders: **NO**<br>Shadow PnL: **YES** | Exact quote curves evaluated against incoming stream. |
| **LIVE** | Real trading with 1 concurrent position limit | Real orders: **YES**<br>Jito bundles: **YES** | Strict wallet balance floor, hard daily loss limit, mandatory journal. |
| **RECOVERING** | Automatic state reconciliation upon cold start or unexpected process restart | Real orders: **NO**<br>Exits: **Allowed** | Verifies on-chain token balances vs journaled position. |
| **PAUSED** | Temporary trading freeze (manual or automated) | Real orders: **NO**<br>Open position: **Monitored** | Ladder exits remain active if position is open; new buys blocked. |
| **KILL** | Hard emergency shutdown | Real orders: **NO**<br>Exits: **Market Dump** | Flushes remaining open token balance immediately via emergency exit engine. |

---

## 2. Emergency Kill Switch Procedure

If unexpected market behavior, critical exploit, or anomalous position loss is detected:

### Step 1: Engage Kill Switch
Via UNIX signal or file trigger:
```bash
# Touch emergency kill file
touch /var/lib/alpha-flip/EMERGENCY_KILL

# Or send SIGUSR1 to hot path daemon
pkill -USR1 alpha-flip-hot
```

### Step 2: Verify Immediate De-escalation
Check hot path logs:
```bash
journalctl -u alpha-flip-hot -n 50 -f
# Expected: "EMERGENCY KILL SWITCH ENGAGED: Halting buys, liquidating open position"
```

### Step 3: Verify Position Flush
Query Prometheus metrics:
```bash
curl -s http://localhost:9090/metrics | grep -E "alpha_flip_kill_switch_active|alpha_flip_active_tokens"
```

---

## 3. Disconnection & Stream Failover

### Yellowstone gRPC Loss
- **Condition**: `alpha_flip_grpc_connected == 0` for > 3 seconds.
- **Automated Reaction**:
  1. Hot path freezes new trade evaluations (`EdgeGate` rejects all buys).
  2. If a position is open and unconfirmed, hot path shifts to polling backup RPC blockhash cache.
  3. Automatic exponential backoff reconnection kicks in (initial delay 500ms, max 8s).
- **Manual Intervention**:
  If reconnect count exceeds 10:
  ```bash
  # Check Yellowstone endpoint reachability
  curl -vk https://yellowstone.endpoint.host:10000
  # Restart service if network interface reset is needed
  systemctl restart alpha-flip-hot
  ```

---

## 4. Jito Block Engine Outage / Low Landed Rate

### Diagnosis
- `alpha_flip_landed_rate_bps` drops below 4000 (< 40%).
- Log shows `BundleTimeout` or `BlockhashExpired`.

### SOP
1. Check Jito status page and regional engine endpoints (Amsterdam, Frankfurt, NY, Salt Lake City).
2. Hot path automatically attempts regional round-robin rotation.
3. If outage is global, switch bot to `PAUSED`:
   ```bash
   touch /var/lib/alpha-flip/PAUSE_TRADING
   ```
4. Do **NOT** attempt blind fallback to public RPC mempool (vulnerable to sandwich frontrunning).

---

## 5. State Drift Reconciliation

### Diagnosis
- Alert `PositionStateDriftDetected` fires (`alpha_flip_reconciliation_drift == 1`).
- Occurs when on-chain ATA token balance does not match `PositionJournal` local balance.

### Remediation Protocol
1. Hot path automatically halts new entries (`MODE_RECOVERING`).
2. Run manual ledger inspection:
   ```bash
   /opt/alpha-flip/bin/alpha-flip-hot --inspect-journal /var/lib/alpha-flip/journal.bin
   ```
3. Check on-chain ATA using Solana CLI:
   ```bash
   solana account <USER_TOKEN_ATA> --url <SECURE_RPC>
   ```
4. If token was transferred or sold out-of-band:
   - Archive corrupted journal: `mv /var/lib/alpha-flip/journal.bin /var/lib/alpha-flip/journal.bin.bak.$(date +%s)`
   - Restart daemon to clear open position state: `systemctl restart alpha-flip-hot`

---

## 6. Cold Path (Gemini) Advisory Failure

- Cold path failure does **NOT** crash or block hot path.
- In event of Gemini rate limit, timeout, or schema failure:
  - Cold path emits default neutral multiplier (`1.0x`).
  - Hot path continues operating with deterministic mathematical signals only.
