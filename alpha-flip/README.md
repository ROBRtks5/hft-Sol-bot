# Alpha-Flip v3.2: Autonomous Solana Momentum Flip Engine

High-frequency, sub-second memecoin momentum flip engine built for Solana with a strict **Two-Contour Architecture**:
- **Hot Contour (Rust / Tokio)**: Microsecond deterministic hot path for Yellowstone gRPC streaming, account subscriptions, log-gated decoders, finite-state machine (FSM), strict liquidity/risk caps, and Jito bundle execution.
- **Cold Contour (Python / Gemini)**: Asynchronous advisory path for wallet/cabal profiling, narrative sentiment distillation, and advisory signal publishing to Redis. **Advisory only — AI never executes trades or overrides risk caps.**

---

## Safety Invariants & Guardrails

1. **AI Never Executes**: Gemini and cold-path models produce advisory telemetry only. Cold signals can downgrade position size or veto trades, but **can never initiate a trade, override stop losses, or loosen risk caps**.
2. **One Open Position**: Strict capital velocity model. Max 1 active token position at any instant. Zero long-holds; instant stop/take-profit mechanics.
3. **No Private Keys in Logs or Cold Memory**: The hot path loads keypairs solely from secured filesystem paths (`HOT_WALLET_KEYPAIR_PATH`) via ephemeral memory guards. No private keys are ever sent to Redis, external APIs, AI models, or logs.
4. **Isolated Hot Wallet**: The hot wallet only holds operating flip capital (e.g., 2–5 SOL). All net profits are automatically swept to an air-gapped Cold Wallet.
5. **Durable Journal & Fail-Safe Modes**:
   - `OBSERVE`: Ingests market data, parses mints, simulates signals without placing orders.
   - `SHADOW`: Full pipeline simulation with simulated fills, slippage, and latency tracking.
   - `LIVE`: Real on-chain trading with active Jito bundles and hard stops.
   - `RECOVERING`: Emergency state recovery verifying pending tx signatures and orphan tokens.
   - `PAUSED`: Halted trading, listening to RPC health.
   - `KILL`: Atomic instant exit and process termination.

---

## Quickstart

### 1. Prerequisites
- **Rust**: 1.75+ (`cargo`, `rustc`)
- **Python**: 3.11+ (`pip`, `pytest`)
- **Docker & Docker Compose**: (for Redis 7 and PostgreSQL 16)
- **Make**

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your RPC keys and config
```

### 3. Spin Up Infrastructure
```bash
make docker-up
```

### 4. Build and Test
```bash
make build
make test
```

### 5. Run in Safe Observe Mode
```bash
make run-observe
```

### 6. Run in Shadow Mode (Dry Run)
```bash
make run-shadow
```

---

## Repository Structure

```
alpha-flip/
├── README.md                 # Primary system manual and safety protocol
├── Makefile                  # Build, test, lint, and run targets
├── docker-compose.yml        # Redis 7 & Postgres 16 local containers
├── .env.example              # Placeholder environment configuration
├── .gitignore                # Git ignore for keys, binaries, cache
├── Cargo.toml                # Rust workspace configuration
├── crates/
│   └── alpha-flip-hot/       # Hot path: Tokio, gRPC, FSM, Jito, Risk
│       ├── Cargo.toml
│       ├── src/
│       │   ├── main.rs
│       │   ├── lib.rs
│       │   └── config.rs
│       └── tests/
│           └── smoke_test.rs
├── services/
│   └── alpha-flip-cold/      # Cold path: Cabal profiling & Gemini advisory
│       ├── pyproject.toml
│       ├── README.md
│       ├── src/
│       │   └── alpha_flip_cold/
│       │       ├── __init__.py
│       │       ├── config.py
│       │       └── main.py
│       └── tests/
│           └── test_smoke.py
├── configs/
│   ├── hot.example.toml      # Example Hot engine config
│   └── cold.example.yaml     # Example Cold engine config
└── docs/
    ├── ARCHITECTURE.md       # Two-contour architecture & flow diagrams
    └── SECURITY.md           # Zero-trust key safety and operational limits
```
