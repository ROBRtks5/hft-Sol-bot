"""Twitter/X social sentiment and ticker velocity ingestion client."""

import logging
from typing import Any, Dict, List, Optional
import httpx

logger = logging.getLogger(__name__)


class TwitterClient:
    """Client for social momentum and cashtag tracking."""

    def __init__(self, bearer_token: Optional[str] = None):
        self.bearer_token = bearer_token
        self._mock_mode = bearer_token is None or bearer_token == "mock"

    async def get_cashtag_velocity(self, symbol: str) -> Dict[str, Any]:
        """Fetch tweet velocity, unique authors, and influencer engagement in last 30m."""
        if self._mock_mode:
            char_sum = sum(ord(c) for c in symbol)
            tweets_per_min = 5 + (char_sum % 45)
            unique_authors = int(tweets_per_min * 0.8)
            sentiment_ratio = 0.60 + (char_sum % 35) / 100.0  # 60% to 95% bullish

            return {
                "symbol": symbol,
                "tweets_per_min": tweets_per_min,
                "unique_authors": unique_authors,
                "sentiment_ratio": round(sentiment_ratio, 2),
                "has_influencer_mention": (tweets_per_min > 25),
                "trending_score": round(min(1.0, tweets_per_min / 50.0), 2),
            }

        headers = {"Authorization": f"Bearer {self.bearer_token}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://api.twitter.com/2/tweets/counts/recent",
                params={"query": f"${symbol}"},
                headers=headers,
            )
            resp.raise_for_status()
            return resp.json()
