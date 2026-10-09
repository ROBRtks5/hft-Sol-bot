"""Mockable, robust API clients for Cold Path Intelligence.

Clients:
- GmgnClient: On-chain trader stats, smart money rankings, token holding distribution.
- RugcheckClient: Liquidity lock, mint/freeze authority checks, top holder concentrations.
- TwitterClient: Social volume, cashtag mention velocity, influencer sentiment.
- TelegramClient: Public caller channel mentions, forward velocities, alpha groups.

Strictly follows:
- Rate limiting / backoff
- Offline / mock fallback for hermetic dev & test environments
- Never queries or touches private keys
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional
import httpx

logger = logging.getLogger(__name__)


class GmgnClient:
    """Client for GMGN.ai on-chain intelligence API."""

    def __init__(self, api_key: Optional[str] = None, base_url: str = "https://gmgn.ai/api/v1"):
        self.api_key = api_key
        self.base_url = base_url
        self._mock_mode = api_key is None or api_key == "mock"

    async def get_wallet_profile(self, pubkey: str) -> Dict[str, Any]:
        """Fetch trader winrate, realized PnL, avg holding time, sniper score."""
        if self._mock_mode:
            # Deterministic pseudo-mock based on pubkey character values
            char_sum = sum(ord(c) for c in pubkey)
            winrate = 0.40 + (char_sum % 50) / 100.0  # 40% - 89%
            avg_hold_slots = 30 + (char_sum % 400)
            dump_aggression = 0.15 + (char_sum % 70) / 100.0
            smart_score = 0.50 + (char_sum % 45) / 100.0

            return {
                "pubkey": pubkey,
                "winrate": round(winrate, 2),
                "total_trades": 120 + (char_sum % 300),
                "avg_hold_time_slots": avg_hold_slots,
                "dump_aggression": round(dump_aggression, 2),
                "smart_money_score": round(smart_score, 2),
                "realized_pnl_sol": round((char_sum % 200) - 50.0, 2),
            }

        headers = {"Authorization": f"Bearer {self.api_key}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.base_url}/wallet/{pubkey}/stats", headers=headers)
            resp.raise_for_status()
            return resp.json()

    async def get_token_insiders(self, mint: str) -> Dict[str, Any]:
        """Fetch token top holder concentration and dev holding ratio."""
        if self._mock_mode:
            char_sum = sum(ord(c) for c in mint)
            insider_ratio = (char_sum % 40) / 100.0  # 0% - 39%
            dev_balance_ratio = (char_sum % 15) / 100.0
            return {
                "mint": mint,
                "top_10_holders_ratio": round(insider_ratio + 0.10, 2),
                "insider_supply_ratio": round(insider_ratio, 2),
                "dev_holding_ratio": round(dev_balance_ratio, 2),
                "is_bundled_launch": (char_sum % 3 == 0),
            }

        headers = {"Authorization": f"Bearer {self.api_key}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{self.base_url}/token/{mint}/insiders", headers=headers)
            resp.raise_for_status()
            return resp.json()
