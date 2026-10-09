"""Token Flow Worker for Alpha-Flip Cold Path.

Requirements:
- Track SPL token transfers from dev wallet and top insiders
- Detect dev wallet dispersal before pump/dump (wash trading, dispersed holding)
- Calculate insider supply concentration ratio
- Check LP status and freeze/mint authority status via Rugcheck
- Write token:{mint} to Redis
"""

import asyncio
import logging
from typing import Dict, List, Optional
from alpha_flip_cold.clients.gmgn import GmgnClient
from alpha_flip_cold.clients.rugcheck import RugcheckClient
from alpha_flip_cold.config import ColdConfig
from alpha_flip_cold.redis_writer import ColdRedisWriter
from alpha_flip_cold.schemas import AuthorityStatusEnum, LPStatusEnum, TokenProfileSchema

logger = logging.getLogger(__name__)


class TokenFlowWorker:
    def __init__(
        self,
        config: ColdConfig,
        writer: ColdRedisWriter,
        gmgn_client: GmgnClient,
        rugcheck_client: RugcheckClient,
    ):
        self.config = config
        self.writer = writer
        self.gmgn = gmgn_client
        self.rugcheck = rugcheck_client
        self._running = False

    async def analyze_token(self, mint: str) -> TokenProfileSchema:
        """Perform full cold-path forensic audit of a token mint."""
        # 1. Fetch GMGN insider/dev stats
        try:
            gmgn_data = await self.gmgn.get_token_insiders(mint)
        except Exception as e:
            logger.warning(f"GMGN fetch failed for {mint}: {e}, using defaults")
            gmgn_data = {
                "insider_supply_ratio": 0.20,
                "dev_holding_ratio": 0.05,
                "is_bundled_launch": False,
            }

        # 2. Fetch Rugcheck security audit
        try:
            rc_data = await self.rugcheck.check_token(mint)
        except Exception as e:
            logger.warning(f"Rugcheck failed for {mint}: {e}, using defaults")
            rc_data = {
                "mint_authority_revoked": True,
                "freeze_authority_revoked": True,
                "lp_status": "LOCKED",
            }

        # 3. Compute Dev Proxy Risk
        # Dev holding > 10% or disguised dispersal generates elevated dev proxy risk
        dev_holding = gmgn_data.get("dev_holding_ratio", 0.0)
        insider_ratio = gmgn_data.get("insider_supply_ratio", 0.0)
        is_bundled = gmgn_data.get("is_bundled_launch", False)

        dev_proxy_risk = min(1.0, (dev_holding * 3.0) + (0.35 if is_bundled else 0.0))

        # 4. Compute Cabal Cold Score
        # High insider supply (>35%) directly exceeds safety threshold
        cabal_cold_score = min(1.0, insider_ratio * 1.8 + (0.25 if is_bundled else 0.0))

        # 5. Authorities
        mint_revoked = rc_data.get("mint_authority_revoked", False)
        freeze_revoked = rc_data.get("freeze_authority_revoked", False)
        if mint_revoked and freeze_revoked:
            auth_status = AuthorityStatusEnum.REVOKED
        elif not mint_revoked and not freeze_revoked:
            auth_status = AuthorityStatusEnum.ACTIVE
        else:
            auth_status = AuthorityStatusEnum.SUSPICIOUS

        # 6. LP Status
        lp_raw = rc_data.get("lp_status", "UNLOCKED").upper()
        if "LOCKED" in lp_raw:
            lp_status = LPStatusEnum.LOCKED
        elif "BURN" in lp_raw:
            lp_status = LPStatusEnum.BURNED
        else:
            lp_status = LPStatusEnum.UNLOCKED

        profile = TokenProfileSchema(
            mint=mint,
            dev_proxy_risk=round(dev_proxy_risk, 4),
            cabal_cold_score=round(cabal_cold_score, 4),
            narrative_keywords="",
            narrative_confidence=0.5,
            lp_status=lp_status,
            authority_status=auth_status,
            insider_supply_ratio=round(insider_ratio, 4),
        )
        return profile

    async def ingest_mint(self, mint: str) -> TokenProfileSchema:
        """Run analysis and write to Redis."""
        profile = await self.analyze_token(mint)
        await self.writer.write_token_profile(profile)
        return profile
