"""Post-Mortem ETL Worker for Alpha-Flip Cold Path.

Requirements:
- Ingest completed trade records from Hot Path telemetry channel or journal files.
- Compute performance metrics: realized PnL, hold time in slots, slippage vs expected,
  exit reason breakdown (take-profit tiers vs adverse selection vs time stop).
- Generate parameter candidate tuning proposals (e.g. tighter stop loss or adjusted
  take-profit target) written to params:candidate_v...
- CRITICAL SAFETY INVARIANT: Post-mortem worker writes strictly CANDIDATE parameters.
  It NEVER overwrites live parameters without explicit manual human approval promotion.
"""

import asyncio
from collections import deque
import json
import logging
import time
from typing import Any, Deque, Dict, List, Optional
from alpha_flip_cold.config import ColdConfig
from alpha_flip_cold.redis_writer import ColdRedisWriter
from alpha_flip_cold.schemas import ModelParametersSchema

logger = logging.getLogger(__name__)

MAX_COMPLETED_TRADES_HISTORY = 10_000


class PostMortemETLWorker:
    def __init__(self, config: ColdConfig, writer: ColdRedisWriter):
        self.config = config
        self.writer = writer
        self._running = False
        self.completed_trades: Deque[Dict[str, Any]] = deque(maxlen=MAX_COMPLETED_TRADES_HISTORY)

    def record_completed_trade(self, trade_data: Dict[str, Any]):
        """Record trade event for post-mortem analysis."""
        self.completed_trades.append(trade_data)
        logger.info(
            f"Logged completed trade for {trade_data.get('mint')}: "
            f"pnl_sol={trade_data.get('realized_pnl_sol', 0.0):.4f}, "
            f"exit_reason={trade_data.get('exit_reason')}"
        )

    def analyze_performance(self) -> Dict[str, Any]:
        """Aggregate trade metrics."""
        if not self.completed_trades:
            return {"trade_count": 0, "winrate": 0.0, "total_pnl_sol": 0.0}

        total_pnl = sum(t.get("realized_pnl_sol", 0.0) for t in self.completed_trades)
        wins = sum(1 for t in self.completed_trades if t.get("realized_pnl_sol", 0.0) > 0)
        winrate = wins / len(self.completed_trades)

        return {
            "trade_count": len(self.completed_trades),
            "wins": wins,
            "winrate": round(winrate, 4),
            "total_pnl_sol": round(total_pnl, 4),
        }

    async def generate_candidate_parameters(self) -> ModelParametersSchema:
        """Derive optimized candidate parameter set based on observed trade history.
        
        CRITICAL: is_live is hardcoded to False.
        """
        metrics = self.analyze_performance()
        version_tag = f"candidate_v3.2_{int(time.time())}"

        # If winrate is lower than 50%, tighten stop loss and lower target flip size
        if metrics["trade_count"] >= 5 and metrics["winrate"] < 0.50:
            suggested_stop_loss = 300  # tighter 3%
            suggested_size = 0.50     # downsize
            suggested_take_profit = 1000
        else:
            suggested_stop_loss = 350
            suggested_size = 1.00
            suggested_take_profit = 1200

        candidate = ModelParametersSchema(
            version=version_tag,
            is_live=False,  # STRICT SAFETY: candidate only!
            min_liquidity_sol=12.0,
            target_flip_size_sol=suggested_size,
            stop_loss_bps=suggested_stop_loss,
            take_profit_bps=suggested_take_profit,
            cabal_risk_veto_threshold=0.70,
            max_slippage_bps=150,
        )

        await self.writer.write_parameters(candidate)
        logger.info(f"Published proposed candidate parameters: {version_tag}")
        return candidate
