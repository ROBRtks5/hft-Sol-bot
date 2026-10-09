"""Narrative Ingestion & Gemini Advisory Worker for Alpha-Flip Cold Path.

Requirements:
- Ingest Twitter cashtag/topic velocity and Telegram caller channel alerts.
- Use Gemini API strictly as ADVISORY (schema-validated structured outputs).
- Output one of: NEUTRAL, FAVORABLE, DOWNSIZE, VETO.
- AI NEVER executes trades or overrides risk caps/liquidity minimums.
- Publish advisory signals to Redis channel and update token:{mint} narrative fields.
- Fallback gracefully when API key is missing or offline.
"""

import asyncio
import json
import logging
import os
from typing import Dict, List, Optional
import httpx
from alpha_flip_cold.clients.telegram import TelegramClient
from alpha_flip_cold.clients.twitter import TwitterClient
from alpha_flip_cold.config import ColdConfig
from alpha_flip_cold.redis_writer import ColdRedisWriter
from alpha_flip_cold.schemas import AdvisoryActionEnum, ColdAdvisorySignal, TokenProfileSchema

logger = logging.getLogger(__name__)


class NarrativeIngestWorker:
    def __init__(
        self,
        config: ColdConfig,
        writer: ColdRedisWriter,
        twitter_client: TwitterClient,
        telegram_client: TelegramClient,
    ):
        self.config = config
        self.writer = writer
        self.twitter = twitter_client
        self.telegram = telegram_client
        self._running = False

    async def query_gemini_advisory(
        self,
        mint: str,
        symbol: str,
        social_context: Dict[str, any],
    ) -> ColdAdvisorySignal:
        """Call Gemini to evaluate narrative momentum under strict structured advisory constraints."""
        tweets = social_context.get("tweets", [])
        telegram_msgs = social_context.get("telegram_messages", [])
        caller_count = social_context.get("caller_channels_count", 0)
        tweets_per_min = float(social_context.get("tweets_per_min", 0.0))

        analyzer = GeminiNarrativeAnalyzer(
            api_key=self.config.gemini_api_key or os.environ.get("GEMINI_API_KEY"),
            model_name=self.config.gemini.model_name,
        )

        res = await analyzer.analyze_narrative(
            mint=mint,
            symbol=symbol,
            tweets=tweets,
            telegram_messages=telegram_msgs,
            caller_count=caller_count,
            tweets_per_min=tweets_per_min,
        )

        action_map = {
            "NEUTRAL": AdvisoryActionEnum.NEUTRAL,
            "FAVORABLE": AdvisoryActionEnum.FAVORABLE,
            "DOWNSIZE": AdvisoryActionEnum.DOWNSIZE,
            "VETO": AdvisoryActionEnum.VETO,
        }
        action = action_map.get(res.action, AdvisoryActionEnum.NEUTRAL)

        return ColdAdvisorySignal(
            mint=mint,
            cabal_score=float(min(1.0, max(0.0, res.spam_score * 0.85))),
            narrative_velocity=float(min(1.0, max(0.0, res.narrative_confidence))),
            advice_action=action,
            confidence=float(res.narrative_confidence),
            reasoning=f"[{','.join(res.narrative_keywords)}] {res.risk_summary} (boost: {res.boost_multiplier:.2f}x)",
        )

    async def evaluate_token(self, mint: str, symbol: str) -> ColdAdvisorySignal:
        """Fetch socials, invoke Gemini advisory, publish to Redis."""
        # 1. Social ingestion
        tw_data = await self.twitter.get_cashtag_velocity(symbol)
        tg_data = await self.telegram.get_mentions(symbol)

        social_context = {
            "twitter": tw_data,
            "telegram": tg_data,
            "tweets_per_min": tw_data.get("tweets_per_min", 0),
            "sentiment_ratio": tw_data.get("sentiment_ratio", 0.5),
            "caller_channels_count": tg_data.get("caller_channels_count", 0),
        }

        # 2. Gemini advisory
        signal = await self.query_gemini_advisory(mint, symbol, social_context)

        # 3. Publish to Redis Advisory Channel for the hot path
        await self.writer.publish_advisory(self.config.advisory_channel, signal)

        # 4. Update Token Profile in Redis
        existing_profile = await self.writer.get_token_profile(mint)
        if existing_profile:
            existing_profile.narrative_keywords = f"${symbol},crypto"
            existing_profile.narrative_confidence = signal.confidence
            await self.writer.write_token_profile(existing_profile)

        return signal
