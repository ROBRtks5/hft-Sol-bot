"""Redis Writer for Alpha-Flip Cold Path.

Provides strict atomic, schema-validated writes with mandatory TTLs to prevent
unbounded memory leaks in Redis. 

Key namespaces:
  - wallet:{pubkey} -> Hash, default TTL 3600s (1 hour)
  - token:{mint}   -> Hash, default TTL 1800s (30 mins)
  - params:{version} -> Hash, default TTL 86400s (24 hours)
  - advisory channel pubsub -> JSON message
"""

import json
import logging
from typing import Dict, List, Optional
import redis.asyncio as aioredis
from alpha_flip_cold.schemas import (
    WalletProfileSchema,
    TokenProfileSchema,
    ModelParametersSchema,
    ColdAdvisorySignal,
)

logger = logging.getLogger(__name__)

DEFAULT_WALLET_TTL_SECS = 3600       # 1 hour
DEFAULT_TOKEN_TTL_SECS = 1800        # 30 mins
DEFAULT_PARAMS_TTL_SECS = 86400      # 24 hours


class ColdRedisWriter:
    def __init__(self, redis_client: aioredis.Redis):
        self.redis = redis_client

    @classmethod
    def from_url(cls, redis_url: str) -> "ColdRedisWriter":
        client = aioredis.from_url(redis_url, decode_responses=True)
        return cls(client)

    async def ping(self) -> bool:
        try:
            return await self.redis.ping()
        except Exception as e:
            logger.error(f"Redis ping failed: {e}")
            return False

    async def write_wallet_profile(
        self, profile: WalletProfileSchema, ttl_secs: int = DEFAULT_WALLET_TTL_SECS
    ) -> bool:
        """Write wallet profile hash with atomic TTL enforcement."""
        key = f"wallet:{profile.pubkey}"
        mapping = profile.to_redis_dict()
        try:
            pipe = self.redis.pipeline()
            pipe.hset(key, mapping=mapping)
            pipe.expire(key, ttl_secs)
            await pipe.execute()
            logger.debug(f"Saved wallet profile to {key} (TTL: {ttl_secs}s)")
            return True
        except Exception as e:
            logger.error(f"Failed to write wallet profile for {profile.pubkey}: {e}")
            return False

    async def get_wallet_profile(self, pubkey: str) -> Optional[WalletProfileSchema]:
        """Fetch and reconstruct validated wallet profile."""
        key = f"wallet:{pubkey}"
        try:
            data = await self.redis.hgetall(key)
            if not data:
                return None
            return WalletProfileSchema.from_redis_dict(data)
        except Exception as e:
            logger.error(f"Failed to fetch wallet profile for {pubkey}: {e}")
            return None

    async def write_token_profile(
        self, profile: TokenProfileSchema, ttl_secs: int = DEFAULT_TOKEN_TTL_SECS
    ) -> bool:
        """Write token mint analysis hash with atomic TTL."""
        key = f"token:{profile.mint}"
        mapping = profile.to_redis_dict()
        try:
            pipe = self.redis.pipeline()
            pipe.hset(key, mapping=mapping)
            pipe.expire(key, ttl_secs)
            await pipe.execute()
            logger.debug(f"Saved token profile to {key} (TTL: {ttl_secs}s)")
            return True
        except Exception as e:
            logger.error(f"Failed to write token profile for {profile.mint}: {e}")
            return False

    async def get_token_profile(self, mint: str) -> Optional[TokenProfileSchema]:
        key = f"token:{mint}"
        try:
            data = await self.redis.hgetall(key)
            if not data:
                return None
            return TokenProfileSchema.from_redis_dict(data)
        except Exception as e:
            logger.error(f"Failed to fetch token profile for {mint}: {e}")
            return None

    async def write_parameters(
        self, params: ModelParametersSchema, ttl_secs: int = DEFAULT_PARAMS_TTL_SECS
    ) -> bool:
        """Write candidate or live parameter set.
        
        CRITICAL SAFETY:
        params with is_live=True can only overwrite live keys if explicit approval workflow passes.
        """
        key = f"params:{params.version}"
        mapping = params.to_redis_dict()
        try:
            pipe = self.redis.pipeline()
            pipe.hset(key, mapping=mapping)
            pipe.expire(key, ttl_secs)
            await pipe.execute()
            logger.info(f"Published parameter set {key} (live={params.is_live})")
            return True
        except Exception as e:
            logger.error(f"Failed to write parameters {params.version}: {e}")
            return False

    async def publish_advisory(self, channel: str, signal: ColdAdvisorySignal) -> int:
        """Publish real-time advisory signal to hot path subscriber channel."""
        try:
            payload = signal.model_dump_json()
            subscribers_reached = await self.redis.publish(channel, payload)
            logger.debug(f"Published advisory for {signal.mint} to {channel} (reached: {subscribers_reached})")
            return subscribers_reached
        except Exception as e:
            logger.error(f"Failed to publish advisory signal for {signal.mint}: {e}")
            return 0

    async def close(self):
        await self.redis.aclose()
