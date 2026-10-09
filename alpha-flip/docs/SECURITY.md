# Alpha-Flip v3.2 Security Protocol & Invariants

This document outlines the strict operational and cryptographic guardrails governing Alpha-Flip v3.2. **Zero compromises are permitted regarding private key isolation and risk caps.**

---

## 1. Absolute Key Safety Invariants

### 1.1 No Private Keys in AI or LLM Prompts
- **Rule**: Neither Gemini nor any external inference engine shall ever receive, see, parse, or process private keys, seed phrases, raw base58 secrets, or signing handles.
- **Enforcement**:
  - The Cold contour codebase contains zero keypair loading libraries or key environment variables.
  - Gemini prompts are strictly scoped to public token mints, ticker symbols, transaction distribution graphs, and volume statistics.

### 1.2 No Private Keys in Redis
- **Rule**: Redis is treated as an unauthenticated inter-process transport.
- **Enforcement**:
  - Only anonymous telemetry pulses, public token mint addresses, cabal scores, and advisory enums (`NEUTRAL`, `FAVORABLE`, `DOWNSIZE`, `VETO`) are passed over Redis channels.
  - Key material, signer handles, or wallet secrets must NEVER be written to Redis keys, streams, or pub/sub topics.

### 1.3 No Private Keys in Logs or Journaling
- **Rule**: Hot and Cold path logs must be safe to export, aggregate, and inspect.
- **Enforcement**:
  - Keypair bytes are memory-locked using ephemeral byte buffers that zeroize on drop.
  - Logging libraries (`tracing`, `tracing-subscriber`, Python `logging`) filter out environment secrets.
  - PostgreSQL journals record transaction signatures, mint IDs, execution timestamps, and realized SOL gains — never key bytes.

---

## 2. Wallet Topology & Fund Management

### 2.1 Hot Wallet Limited Balance
- **Rule**: The Hot Wallet (`HOT_WALLET_KEYPAIR_PATH`) must **NEVER** hold treasury, reserves, or excess capital.
- **Limit**: Maximum operational balance is capped (recommended: 2.0 to 5.0 SOL).
- **Execution Guard**: If the hot wallet balance drops below the minimum required for execution + rent + Jito tips (e.g. 0.25 SOL), the Hot Engine immediately transitions to `PAUSED` mode.

### 2.2 Automatic Profit Sweep to Cold Vault
- **Rule**: Net trading profits do not accumulate on the hot machine.
- **Enforcement**:
  - At the close of each successful flip or end of daily session, any balance exceeding the target operating balance is swept via an authenticated Solana transfer to `COLD_WALLET_SWEEP_ADDRESS`.
  - The Cold Wallet address is hardcoded to a hardware-secured or multi-sig air-gapped vault.

---

## 3. Execution Caps & Circuit Breakers

| Risk Dimension | Cap / Threshold | Behavior on Breach |
|---|---|---|
| **Max Concurrent Positions** | **Strictly 1** | Hard failure; rejection of any secondary signal |
| **Max Capital per Flip** | 1.5 - 2.0 SOL | Order bundle rejected |
| **Max Slippage** | 150 bps (1.5%) | Transaction simulation rejects bundle |
| **Hard Stop Loss** | 350 bps (-3.5%) | Immediate Jito tip market dump |
| **Max Holding Time** | 180 seconds | Mandatory time-out exit |
| **Consecutive Loss Streak** | 3 flips | Auto-transition to `PAUSED` mode |
| **Kill Switch** | Signal or CLI `kill` | Instant market exit and process abort |

---

## 4. Emergency Kill Switch Procedure

In case of abnormal market volatility, RPC degradation, or abnormal memecoin routing:

```bash
# Force instant emergency kill
TRADING_MODE=kill cargo run --bin alpha-flip-hot -- --mode kill

# Or send SIGINT (Ctrl+C) to active daemon
```
The kill sequence:
1. Cancels all pending Jito bundles.
2. If currently `IN_POSITION`, fires a top-priority bundle to exit back to SOL.
3. Transitions state to `TERMINATED`.
4. Writes an audit entry to the durable journal.
