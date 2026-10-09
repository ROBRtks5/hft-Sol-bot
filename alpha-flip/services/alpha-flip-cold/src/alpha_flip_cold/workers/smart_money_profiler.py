"""Smart Money Profiler Worker for Alpha-Flip Cold Path.

Requirements:
- Profile wallets buying during early momentum
- Score wallets by historical win rate, PnL, average hold time in slots
- Differentiate between genuine smart money vs short-fuse dump snipers
- High dump aggression (> 0.65) or short hold time (< 50 slots = ~20s) MUST be penalized
  as quick dump threat, NOT treated as a bullish signal.
- Write wallet:{pubkey} to Redis.
"""

import asyncio
import logging
from typing import Dict, List, Optional
from alpha_flip_cold.clients.gmgn import GmgnClient
from alpha_flip_cold.config import ColdConfig
from alpha_flip_cold.redis_writer import ColdRedisWriter
from alpha_flip_cold.schemas import CabalRiskTier, WalletProfileSchema

logger = logging.getLogger(__name__)

# Minimum hold duration in slots (~20 seconds) to be considered organic
MIN_ORGANIC_HOLD_SLOTS = 50


class SmartMoneyProfilerWorker:
    def __init__(
        self,
        config: ColdConfig,
        writer: ColdRedisWriter,
        gmgn_client: GmgnClient,
    ):
        self.config = config
        self.writer = writer
        self.gmgn = gmgn_client
        self._running = False

    async def profile_wallet(self, pubkey: str) -> WalletProfileSchema:
        """Evaluate a wallet's trading footprint from on-chain stats."""
        try:
            stats = await self.gmgn.get_wallet_profile(pubkey)
        except Exception as e:
            logger.warning(f"Failed to fetch stats for {pubkey}: {e}, using baseline defaults")
            stats = {
                "winrate": 0.50,
                "avg_hold_time_slots": 150,
                "dump_aggression": 0.20,
                "smart_money_score": 0.40,
                "total_trades": 50,
            }

        winrate = float(stats.get("winrate", 0.50))
        avg_hold = int(stats.get("avg_hold_time_slots", 150))
        dump_aggression = float(stats.get("dump_aggression", 0.20))
        base_smart_score = float(stats.get("smart_money_score", 0.40))
        total_trades = int(stats.get("total_trades", 50))

        # Statistical confidence scales with total sample size
        confidence = min(0.95, max(0.20, total_trades / 100.0))

        # Check for TOXIC SNIPER / DUMP RISK:
        # If hold time is very short (< 50 slots) or dump aggression is high (> 0.65),
        # penalize smart_money_score and raise cabal/dump risk!
        is_toxic_sniper = (avg_hold < MIN_ORGANIC_HOLD_SLOTS) or (dump_aggression > 0.65)

        if is_toxic_sniper:
            # Penalize: this is NOT a high-conviction organic follower, but an imminent seller
            effective_smart_score = max(0.05, base_smart_score * 0.4)
            cabal_risk = min(1.0, 0.50 + dump_aggression * 0.4)
            tier = CabalRiskTier.HIGH if cabal_risk > 0.6 else CabalRiskTier.MODERATE
            logger.info(
                f"Wallet {pubkey[:8]} flagged as TOXIC DUMP THREAT: hold={avg_hold} slots, "
                f"aggression={dump_aggression:.2f}"
            )
        else:
            # True organic smart money
            effective_smart_score = min(1.0, base_smart_score * (winrate / 0.50))
            cabal_risk = 0.10
            tier = CabalRiskTier.LOW

        profile = WalletProfileSchema(
            pubkey=pubkey,
            tier=tier,
            cabal_risk=round(cabal_risk, 4),
            smart_money_score=round(effective_smart_score, 4),
            confidence=round(confidence, 4),
            avg_hold_time_slots=avg_hold,
            dump_aggression=round(dump_aggression, 4),
        )
        return profile

    async def ingest_wallet(self, pubkey: str) -> WalletProfileSchema:
        """Profile and write to Redis."""
        profile = await self.profile_wallet(pubkey)
        await self.writer.write_wallet_profile(profile)
        return profile
