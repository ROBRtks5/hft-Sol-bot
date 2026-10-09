"""Cold path configuration schema using Pydantic Settings."""

from enum import Enum
from pathlib import Path
from typing import Optional
import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from alpha_flip_cold.schemas import AdvisoryActionEnum


class GeminiAdvisoryConfig(BaseModel):
    model_name: str = "gemini-2.5-flash"
    max_tokens: int = 1024
    temperature: float = 0.2
    confidence_threshold: float = 0.70
    narrative_evaluation_interval_secs: int = 15


class CabalProfilingConfig(BaseModel):
    max_cluster_wallets: int = 50
    insider_holding_veto_threshold: float = 0.35  # >35% insider supply triggers VETO
    min_liquidity_usd: float = 25_000.0
    gmgn_rate_limit_rpm: int = 120


class ColdConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # Core environment variables
    trading_mode: str = Field(default="observe", alias="TRADING_MODE")
    redis_url: str = Field(default="redis://127.0.0.1:6379/0", alias="REDIS_URL")
    postgres_url: str = Field(default="postgresql://alpha_user:alpha_local_dev_password@127.0.0.1:5432/alpha_flip_journal", alias="POSTGRES_URL")
    helius_api_key: Optional[str] = Field(default=None, alias="HELIUS_API_KEY")
    gmgn_api_key: Optional[str] = Field(default=None, alias="GMGN_API_KEY")
    gemini_api_key: Optional[str] = Field(default=None, alias="GEMINI_API_KEY")
    twitter_bearer_token: Optional[str] = Field(default=None, alias="TWITTER_BEARER_TOKEN")
    telegram_bot_token: Optional[str] = Field(default=None, alias="TELEGRAM_BOT_TOKEN")

    # Redis channel names
    advisory_channel: str = "alpha_flip:cold:advisory"
    telemetry_channel: str = "alpha_flip:hot:telemetry"

    # Sub-configs
    gemini: GeminiAdvisoryConfig = Field(default_factory=GeminiAdvisoryConfig)
    cabal: CabalProfilingConfig = Field(default_factory=CabalProfilingConfig)

    @classmethod
    def load_from_yaml(cls, path: str | Path) -> "ColdConfig":
        file_path = Path(path)
        if not file_path.exists():
            return cls()
        with open(file_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        return cls(**data)
