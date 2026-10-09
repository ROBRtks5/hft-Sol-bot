# Alpha-Flip v3.2: Two-Contour System Architecture

## 1. High-Level Overview

Alpha-Flip v3.2 is engineered around a **Two-Contour Architecture** separating deterministic microsecond execution from asynchronous advisory intelligence:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            HOT EXECUTION CONTOUR                             │
│                           (Rust / Tokio / ~500µs)                            │
│                                                                              │
│  ┌───────────────────┐    ┌────────────────────┐    ┌─────────────────────┐  │
│  │  Yellowstone gRPC │───▶│  Log-Gated Decoder │───▶│ Finite-State Machine│  │
│  │ (Accounts / Logs) │    │  (Raydium / Pump)  │    │      (FSM Core)     │  │
│  └───────────────────┘    └────────────────────┘    └──────────┬──────────┘  │
│                                                                │             │
│                                                                ▼             │
│  ┌───────────────────┐    ┌────────────────────┐    ┌─────────────────────┐  │
│  │   Durable Journal │◀───│ Hard Risk & Econ   │◀───│  Exit & Stop Engine │  │
│  │     (PostgreSQL)  │    │ Invariants Checker │    │ (Trailing / Time-out│  │
│  └───────────────────┘    └──────────┬─────────┘    └─────────────────────┘  │
│                                      │                                       │
│                                      ▼                                       │
│                           ┌────────────────────┐                             │
│                           │ Jito MEV Bundler   │───▶ Solana Mainnet          │
│                           │ (Private Tip Feed) │                             │
│                           └────────────────────┘                             │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Redis Pub/Sub
                                       │ (Advisory Signals & Telemetry)
┌──────────────────────────────────────▼───────────────────────────────────────┐
│                            COLD ADVISORY CONTOUR                             │
│                         (Python / Redis / 1-15 sec)                          │
│                                                                              │
│  ┌───────────────────┐    ┌────────────────────┐    ┌─────────────────────┐  │
│  │  Cabal Profiler   │───▶│ Narrative Scraper  │───▶│  Gemini Advisory    │  │
│  │ (GMGN / Solscan)  │    │ (X / TG / DexS)    │    │ (Schema-Validated)  │  │
│  └───────────────────┘    └────────────────────┘    └──────────┬──────────┘  │
│                                                                │             │
│                                                                ▼             │
│                                                     ┌─────────────────────┐  │
│                                                     │ Advisory Publisher  │  │
│                                                     │ (VETO / DOWNSIZE)   │  │
│                                                     └─────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Hot Contour (Rust / Tokio)

### Sub-Millisecond Pipeline
1. **Yellowstone gRPC Feed**: Subscribes to real-time account updates and program logs (Pump.fun, Raydium CPMM / AMM v4) with zero HTTP round-trips.
2. **Log-Gated Decoders**: Filters program events on the fly without heap allocations or heavy JSON serialization.
3. **Finite-State Machine (FSM)**:
   - `IDLE`: Listening to feed, heartbeat OK.
   - `SCANNING`: Parsing token mints meeting baseline volume/bonding curve criteria.
   - `EVALUATING_SIGNAL`: Correlating micro-momentum against Cold advisory cache.
   - `SUBMITTING_ORDER`: Constructing atomic Jito bundle with dynamic tip.
   - `IN_POSITION`: Actively monitoring trailing PnL, tick intervals, and timeout clock.
   - `EXITING_POSITION`: Instant market dump via Jito bundle.
   - `COOLDOWN`: Enforcing post-flip latency delay.
   - `RECOVERING`: Validating chain state if node/bundle drops.
   - `PAUSED`: Safety halt.
   - `KILL`: Atomic emergency liquidation and termination.
4. **Hard Risk & Invariants**:
   - **Strict Capital Velocity**: Maximum **1 open position**. No concurrent bets.
   - **Zero Long Holds**: Max holding duration hard stop (default 180s).
   - **Hard Slippage & Stop Loss**: Enforced locally before bundle signature.
5. **Durable Journal**: Synchronously writes position entries, exits, realized PnL, and Jito tip lamports to PostgreSQL journal.

---

## 3. Cold Contour (Python / Redis / Gemini)

### Advisory Invariants
- **No Private Keys**: Cold path environment has zero wallet credentials.
- **AI Never Executes**: Gemini cannot trigger trades, buy tokens, or relax risk boundaries.
- **Schema-Validated Advisory Contracts**:
  Cold signals broadcast `ColdAdvisorySignal`:
  - `mint`: Target token mint
  - `cabal_score`: 0.0 - 1.0 (insider clustering and dev wallet purity)
  - `narrative_velocity`: 0.0 - 1.0
  - `advice_action`: `NEUTRAL` | `FAVORABLE` | `DOWNSIZE` | `VETO`
  - `confidence`: 0.0 - 1.0
- **Asymmetric Authority**:
  - Hot path **can accept a VETO** from Cold path to cancel an entry.
  - Hot path **can accept DOWNSIZE** to cut commitment by 50%.
  - Hot path **NEVER accepts an instruction to increase position size or disable stop-loss**.

---

## 4. Operational Modes Matrix

| Mode | Reads Yellowstone | Evaluates Signals | Simulates Fills | Executes Jito Real Txs | Hot Key Required |
|---|---|---|---|---|---|
| **OBSERVE** | Yes | Yes | No | No | No |
| **SHADOW** | Yes | Yes | Yes (Paper) | No | No |
| **LIVE** | Yes | Yes | Yes (Real) | Yes | **Yes (Filesystem)** |
| **RECOVERING** | Yes | No | No | Yes (Sells/Sweeps only)| Yes |
| **PAUSED** | Yes | No | No | No | No |
| **KILL** | No | No | No | Yes (Emergency Exit) | Yes |

---

## 5. Telemetry & Cross-Contour Communication

- **Redis Pub/Sub Channel `alpha_flip:cold:advisory`**: Cold advisory signals published at 1–15s cadence.
- **Redis Pub/Sub Channel `alpha_flip:hot:telemetry`**: Hot engine pulses current state, latency, and PnL every 500ms.
