"""Strict Pydantic schemas for Alpha-Flip v3.2 Cold Path & Redis bridge.

Enforces:
1. Hard boundaries on all scores, percentages, and metrics.
2. Invariant: Cold path is advisory only, zero execution parameters or private keys.
3. Candidate vs Live parameter isolation (candidate writes require human approval).
"""

from enum import Enum
from typing import Dict, List, Optional
import time
from pydantic import BaseModel, Field, field_validator


class CabalRiskTier(str, Enum):
    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class AdvisoryActionEnum(str, Enum):
    NEUTRAL = "NEUTRAL"
    FAVORABLE = "FAVORABLE"
    DOWNSIZE = "DOWNSIZE"
    VETO = "VETO"


class LPStatusEnum(str, Enum):
    LOCKED = "LOCKED"
    BURNED = "BURNED"
    UNLOCKED = "UNLOCKED"
    SUSPICIOUS = "SUSPICIOUS"


class AuthorityStatusEnum(str, Enum):
    REVOKED = "REVOKED"
    ACTIVE = "ACTIVE"
    SUSPICIOUS = "SUSPICIOUS"


# ==============================================================================
# 1. Wallet Profile Schema (Redis key: wallet:{pubkey})
# ==============================================================================
class WalletProfileSchema(BaseModel):
    pubkey: str = Field(description="Base58 Solana public key")
    tier: CabalRiskTier = Field(default=CabalRiskTier.LOW)
    cabal_risk: float = Field(default=0.0, ge=0.0, le=1.0, description="Cabal membership probability [0.0, 1.0]")
    smart_money_score: float = Field(default=0.0, ge=0.0, le=1.0, description="Track record quality score [0.0, 1.0]")
    confidence: float = Field(default=0.5, ge=0.0, le=1.0, description="Statistical confidence [0.0, 1.0]")
    avg_hold_time_slots: int = Field(default=100, ge=0, description="Average token hold time in Solana slots")
    dump_aggression: float = Field(default=0.0, ge=0.0, le=1.0, description="Fast-exit sniper aggression [0.0, 1.0]")
    known_funder: Optional[str] = Field(default=None, description="Primary funding parent wallet/CEX")
    cabal_id: Optional[str] = Field(default=None, description="Cluster ID if affiliated with known cabal")
    updated_at_ms: int = Field(default_factory=lambda: int(time.time() * 1000))

    @field_validator("pubkey")
    @classmethod
    def validate_pubkey(cls, v: str) -> str:
        v = v.strip()
        if not (32 <= len(v) <= 44):
            raise ValueError(f"Invalid Solana pubkey length: {len(v)}")
        return v

    def to_redis_dict(self) -> Dict[str, str]:
        """Convert to Redis Hash string mapping with bounded format."""
        return {
            "pubkey": self.pubkey,
            "tier": self.tier.value,
            "cabal_risk": f"{self.cabal_risk:.4f}",
            "smart_money_score": f"{self.smart_money_score:.4f}",
            "confidence": f"{self.confidence:.4f}",
            "avg_hold_time_slots": str(self.avg_hold_time_slots),
            "dump_aggression": f"{self.dump_aggression:.4f}",
            "known_funder": self.known_funder or "",
            "cabal_id": self.cabal_id or "",
            "updated_at_ms": str(self.updated_at_ms),
        }

    @classmethod
    def from_redis_dict(cls, data: Dict[str, str]) -> "WalletProfileSchema":
        return cls(
            pubkey=data["pubkey"],
            tier=CabalRiskTier(data.get("tier", "LOW")),
            cabal_risk=float(data.get("cabal_risk", 0.0)),
            smart_money_score=float(data.get("smart_money_score", 0.0)),
            confidence=float(data.get("confidence", 0.5)),
            avg_hold_time_slots=int(data.get("avg_hold_time_slots", 100)),
            dump_aggression=float(data.get("dump_aggression", 0.0)),
            known_funder=data.get("known_funder") or None,
            cabal_id=data.get("cabal_id") or None,
            updated_at_ms=int(data.get("updated_at_ms", 0)),
        )


# ==============================================================================
# 2. Token Mint Profile Schema (Redis key: token:{mint})
# ==============================================================================
class TokenProfileSchema(BaseModel):
    mint: str = Field(description="Base58 SPL token mint address")
    dev_proxy_risk: float = Field(default=0.0, ge=0.0, le=1.0, description="Dev holding dispersal risk [0.0, 1.0]")
    cabal_cold_score: float = Field(default=0.0, ge=0.0, le=1.0, description="Sybil/cabal cluster score [0.0, 1.0]")
    narrative_keywords: str = Field(default="", description="Comma-separated trending keywords")
    narrative_confidence: float = Field(default=0.0, ge=0.0, le=1.0, description="Social velocity confidence [0.0, 1.0]")
    lp_status: LPStatusEnum = Field(default=LPStatusEnum.UNLOCKED)
    authority_status: AuthorityStatusEnum = Field(default=AuthorityStatusEnum.ACTIVE)
    insider_supply_ratio: float = Field(default=0.0, ge=0.0, le=1.0, description="Top cluster supply share")
    updated_at_ms: int = Field(default_factory=lambda: int(time.time() * 1000))

    @field_validator("mint")
    @classmethod
    def validate_mint(cls, v: str) -> str:
        v = v.strip()
        if not (32 <= len(v) <= 44):
            raise ValueError(f"Invalid Solana mint address length: {len(v)}")
        return v

    def to_redis_dict(self) -> Dict[str, str]:
        return {
            "mint": self.mint,
            "dev_proxy_risk": f"{self.dev_proxy_risk:.4f}",
            "cabal_cold_score": f"{self.cabal_cold_score:.4f}",
            "narrative_keywords": self.narrative_keywords,
            "narrative_confidence": f"{self.narrative_confidence:.4f}",
            "lp_status": self.lp_status.value,
            "authority_status": self.authority_status.value,
            "insider_supply_ratio": f"{self.insider_supply_ratio:.4f}",
            "updated_at_ms": str(self.updated_at_ms),
        }

    @classmethod
    def from_redis_dict(cls, data: Dict[str, str]) -> "TokenProfileSchema":
        return cls(
            mint=data["mint"],
            dev_proxy_risk=float(data.get("dev_proxy_risk", 0.0)),
            cabal_cold_score=float(data.get("cabal_cold_score", 0.0)),
            narrative_keywords=data.get("narrative_keywords", ""),
            narrative_confidence=float(data.get("narrative_confidence", 0.0)),
            lp_status=LPStatusEnum(data.get("lp_status", "UNLOCKED")),
            authority_status=AuthorityStatusEnum(data.get("authority_status", "ACTIVE")),
            insider_supply_ratio=float(data.get("insider_supply_ratio", 0.0)),
            updated_at_ms=int(data.get("updated_at_ms", 0)),
        )


# ==============================================================================
# 3. Dynamic Optimization Parameters (Redis key: params:{version})
# ==============================================================================
class ModelParametersSchema(BaseModel):
    version: str = Field(description="Parameter version tag, e.g. candidate_v3.2.1 or live_v3.2.0")
    is_live: bool = Field(default=False, description="True ONLY after explicit human approval promotion")
    min_liquidity_sol: float = Field(default=10.0, ge=1.0, le=500.0)
    target_flip_size_sol: float = Field(default=1.0, ge=0.01, le=5.0)
    stop_loss_bps: int = Field(default=350, ge=50, le=1000)
    take_profit_bps: int = Field(default=1200, ge=200, le=5000)
    cabal_risk_veto_threshold: float = Field(default=0.75, ge=0.1, le=0.99)
    max_slippage_bps: int = Field(default=150, ge=20, le=500)
    updated_at_ms: int = Field(default_factory=lambda: int(time.time() * 1000))

    def to_redis_dict(self) -> Dict[str, str]:
        return {
            "version": self.version,
            "is_live": "1" if self.is_live else "0",
            "min_liquidity_sol": f"{self.min_liquidity_sol:.2f}",
            "target_flip_size_sol": f"{self.target_flip_size_sol:.2f}",
            "stop_loss_bps": str(self.stop_loss_bps),
            "take_profit_bps": str(self.take_profit_bps),
            "cabal_risk_veto_threshold": f"{self.cabal_risk_veto_threshold:.2f}",
            "max_slippage_bps": str(self.max_slippage_bps),
            "updated_at_ms": str(self.updated_at_ms),
        }


# ==============================================================================
# 4. Cold Advisory PubSub Signal (Redis channel: alpha_flip:cold:advisory)
# ==============================================================================
class ColdAdvisorySignal(BaseModel):
    mint: str = Field(description="Target token mint")
    cabal_score: float = Field(ge=0.0, le=1.0, description="Evaluated cabal cluster risk [0.0, 1.0]")
    narrative_velocity: float = Field(ge=0.0, le=1.0, description="Social velocity score [0.0, 1.0]")
    advice_action: AdvisoryActionEnum = Field(description="Strict advisory posture")
    confidence: float = Field(ge=0.0, le=1.0, description="Model confidence [0.0, 1.0]")
    reasoning: Optional[str] = Field(default=None, description="Rationale explanation string")
    timestamp_ms: int = Field(default_factory=lambda: int(time.time() * 1000))

    @field_validator("mint")
    @classmethod
    def validate_mint(cls, v: str) -> str:
        v = v.strip()
        if not (32 <= len(v) <= 44):
            raise ValueError(f"Invalid Solana mint: {v}")
        return v
