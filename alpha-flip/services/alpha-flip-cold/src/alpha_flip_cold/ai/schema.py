"""Schema definitions for Gemini Narrative Analyzer outputs and guardrail enforcement."""

from typing import List, Optional
from pydantic import BaseModel, Field, field_validator


class NarrativeKeywordItem(BaseModel):
    keyword: str = Field(..., max_length=64, description="Extracted trending narrative theme (e.g. ai-agent, cto)")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score from 0.0 to 1.0")
    source_quality: float = Field(..., ge=0.0, le=1.0, description="Assessment of source authenticity and quality")

    @field_validator("keyword")
    @classmethod
    def clean_keyword(cls, v: str) -> str:
        cleaned = v.strip().lower()
        if not cleaned:
            raise ValueError("Keyword must not be empty")
        return cleaned[:32]


class TickerMentionItem(BaseModel):
    ticker: str = Field(..., max_length=16, description="Ticker mention with or without $")
    mint_hint: Optional[str] = Field(None, max_length=64, description="Optional detected Solana mint address hint")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Detection confidence")

    @field_validator("ticker")
    @classmethod
    def clean_ticker(cls, v: str) -> str:
        cleaned = v.strip().upper()
        if not cleaned.startswith("$") and cleaned.isalnum():
            cleaned = f"${cleaned}"
        return cleaned[:16]


class GeminiNarrativeResponse(BaseModel):
    """Raw response parsed from Gemini API adhering to strict classification schema."""
    narrative_keywords: List[NarrativeKeywordItem] = Field(
        default_factory=list,
        max_length=20,
        description="Top narrative keywords detected"
    )
    ticker_mentions: List[TickerMentionItem] = Field(
        default_factory=list,
        max_length=20,
        description="Tickers mentioned in content"
    )
    spam_score: float = Field(..., ge=0.0, le=1.0, description="Likelihood of bot/spam farm or sybil coordination")
    narrative_confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence in organic viral momentum")
    risk_notes: str = Field(..., max_length=512, description="Concise textual summary of detected anomalies or risks")
    recommended_boost_multiplier: float = Field(
        ...,
        ge=1.0,
        le=1.5,
        description="Advisory momentum boost multiplier strictly clamped between 1.0 and 1.5"
    )

    @field_validator("recommended_boost_multiplier")
    @classmethod
    def clamp_multiplier(cls, v: float) -> float:
        # Enforce non-negotiable boundaries
        if v < 1.0:
            return 1.0
        if v > 1.5:
            return 1.5
        return round(v, 4)


class ValidatedAdvisoryOutput(BaseModel):
    """Sanitized, clamped, and hot-path ready advisory model."""
    action: str = Field(..., description="NEUTRAL, FAVORABLE, DOWNSIZE, or VETO")
    boost_multiplier: float = Field(..., ge=1.0, le=1.5)
    narrative_keywords: List[str]
    narrative_confidence: float
    spam_score: float
    is_vetoed: bool
    risk_summary: str
    sanitized_at_ts: float
