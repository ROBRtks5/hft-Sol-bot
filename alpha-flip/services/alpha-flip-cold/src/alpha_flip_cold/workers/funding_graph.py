"""Funding Graph Worker for Alpha-Flip Cold Path.

Requirements:
- Analyze new wallet SOL funding sources
- Detect CEX withdrawal clusters (e.g. Binance/Bybit sub-accounts, ChangeNOW, FixedFloat)
- Detect mixer-like patterns and batch funding tree fan-outs
- Assign cabal_id and cabal_risk
- Run strictly asynchronously in the cold path, never blocking hot path event loops.
- Write updates to Redis with strict TTLs and bounds.
"""

import asyncio
import hashlib
import logging
from typing import Dict, List, Optional, Set
from alpha_flip_cold.config import ColdConfig
from alpha_flip_cold.redis_writer import ColdRedisWriter
from alpha_flip_cold.schemas import CabalRiskTier, WalletProfileSchema

logger = logging.getLogger(__name__)

# Known exchange hot wallets or mixing routers (fingerprints)
KNOWN_CEX_ROUTERS = {
    "5tzFkiKscXBixGsN5Ftdv8Rtd3P9Jph72p2t7b11111": "BinanceHotWallet",
    "2AQdpHJ2JpcEgBtATmncENMuvSiPqTS150000000000": "BybitHotWallet",
    "ASTyfSima4LLAdDgoFGkgqoKowG1LZSAML2222222222": "FixedFloatRouter",
    "ChangeNOWRouterAddress111111111111111111111": "ChangeNOWRouter",
}


class FundingGraphWorker:
    def __init__(self, config: ColdConfig, writer: ColdRedisWriter):
        self.config = config
        self.writer = writer
        self._running = False
        # In-memory graph tracker: funder -> set of funded recipient wallets
        self.funder_to_recipients: Dict[str, Set[str]] = {}
        # recipient -> funder
        self.recipient_to_funder: Dict[str, str] = {}

    def analyze_funding_edge(self, funder: str, recipient: str, amount_sol: float) -> WalletProfileSchema:
        """Analyze a newly discovered funding edge and compute cabal cluster affiliation."""
        if funder not in self.funder_to_recipients:
            self.funder_to_recipients[funder] = set()
        self.funder_to_recipients[funder].add(recipient)
        self.recipient_to_funder[recipient] = funder

        cluster_size = len(self.funder_to_recipients[funder])
        is_known_cex = funder in KNOWN_CEX_ROUTERS

        # Determine Cabal Risk
        # If a single non-CEX parent wallet funds many different fresh wallets (batch tree),
        # this is a deterministic sybil/cabal cluster.
        if is_known_cex:
            # CEX withdrawal cluster: multiple wallets funded within tight window from same CEX
            # represents possible coordinated sybils or independent retail
            cabal_risk = min(0.65, 0.20 + (cluster_size * 0.04))
            cabal_id = f"cex_cluster_{funder[:8]}"
        elif cluster_size >= 4:
            # Batch fan-out funding tree: high cabal risk
            cabal_risk = min(0.98, 0.40 + (cluster_size * 0.08))
            cluster_hash = hashlib.sha256(funder.encode()).hexdigest()[:12]
            cabal_id = f"cabal_tree_{cluster_hash}"
        elif cluster_size >= 2:
            cabal_risk = 0.35
            cluster_hash = hashlib.sha256(funder.encode()).hexdigest()[:12]
            cabal_id = f"pair_{cluster_hash}"
        else:
            cabal_risk = 0.05
            cabal_id = None

        # Determine Tier
        if cabal_risk >= 0.75:
            tier = CabalRiskTier.CRITICAL
        elif cabal_risk >= 0.50:
            tier = CabalRiskTier.HIGH
        elif cabal_risk >= 0.25:
            tier = CabalRiskTier.MODERATE
        else:
            tier = CabalRiskTier.LOW

        profile = WalletProfileSchema(
            pubkey=recipient,
            tier=tier,
            cabal_risk=round(cabal_risk, 4),
            smart_money_score=0.10,
            confidence=0.85,
            avg_hold_time_slots=120,
            dump_aggression=0.30 if cabal_risk > 0.5 else 0.10,
            known_funder=funder,
            cabal_id=cabal_id,
        )
        return profile

    async def ingest_funding_event(self, funder: str, recipient: str, amount_sol: float):
        """Asynchronously process an observed funding event and push to Redis."""
        profile = self.analyze_funding_edge(funder, recipient, amount_sol)
        await self.writer.write_wallet_profile(profile)

    async def run_loop(self):
        """Background maintenance loop to prune stale local graph memory."""
        self._running = True
        logger.info("FundingGraphWorker started.")
        while self._running:
            try:
                await asyncio.sleep(60)
                # Bounded memory: keep graph capped at configured max wallets
                if len(self.funder_to_recipients) > self.config.cabal.max_cluster_wallets:
                    keys_to_remove = list(self.funder_to_recipients.keys())[
                        : len(self.funder_to_recipients) - self.config.cabal.max_cluster_wallets
                    ]
                    for k in keys_to_remove:
                        recipients = self.funder_to_recipients.pop(k, set())
                        for r in recipients:
                            self.recipient_to_funder.pop(r, None)
                    logger.debug(f"Pruned {len(keys_to_remove)} funding graph clusters to stay bounded.")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in FundingGraphWorker loop: {e}")

    def stop(self):
        self._running = False
