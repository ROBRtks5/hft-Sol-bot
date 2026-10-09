# Alpha-Flip v3.2 Parameter Governance & Freeze Policy

This document defines the governance rules for parameter versioning, promotion, canary validation, and rollbacks.

---

## 1. Core Principle: No Automated Parameter Promotion

1. **Strict Freeze**: Parameters controlling sizing, risk limits, stop-loss thresholds, tip bidding, and edge hurdles cannot be updated automatically by cold-path workers, AI models, or automated scripts.
2. **Explicit Human Sign-Off**: Every parameter change requires an audited Git commit and operational review.
3. **Versioned Hashes**: Parameter sets are hashed and versioned (`params:v3.2.0-micro`, `params:v3.2.1-live`).

---

## 2. Parameter Tiers

| Tier | Parameters | Change Authority | Canary Duration |
| :--- | :--- | :---: | :---: |
| **Tier 1 (Critical Risk)** | `max_position_sol`, `stop_loss_bps`, `max_daily_loss_sol`, `max_concurrent_positions` | Senior Engineer + Quant Sign-off | 7 Days SHADOW |
| **Tier 2 (Economics/Exit)** | `margin_of_safety_bps`, `take_profit_bps`, `trailing_stop_bps`, `min_liquidity_sol` | Quant Engineer | 48 Hours SHADOW |
| **Tier 3 (Execution/Tips)** | `default_tip_lamports`, `max_tip_lamports`, `reconnect_backoff_ms` | Lead Operator | 24 Hours SHADOW |

---

## 3. Canary Promotion Workflow

1. **Step 1: Calibration**: Candidate parameters are tuned on recorded replay datasets via `scripts/replay_day.sh`.
2. **Step 2: Shadow Validation**: Run in `MODE_SHADOW` for required canary duration. Compare Sharpe ratio, drawdown, and expectancy against production baseline.
3. **Step 3: Staged Promotion**:
   - Promote to `micro-live` (0.01 - 0.05 SOL) for 48 hours.
   - If landed rate $> 60\%$ and loss limits unbreached, sign off for primary deployment.

---

## 4. Emergency Rollback Procedure

If a newly deployed parameter version displays unexpected adverse selection:
```bash
# 1. Rollback configuration to frozen baseline
cp /etc/alpha-flip/config.toml.v3.2.0-baseline /etc/alpha-flip/config.toml

# 2. Reload daemon
sudo systemctl reload alpha-flip-hot.service

# 3. Verify active version via metrics
curl -s http://localhost:9090/metrics | grep alpha_flip_params_version
```
Rollback takes effect immediately for all subsequent trade evaluations.
