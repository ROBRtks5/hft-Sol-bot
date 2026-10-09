"""Production Gemini Narrative Analyzer for Alpha-Flip Cold Path.

Requirements:
- Implements classification & narrative extraction for social signals.
- Uses Gemini API with structured output / system instructions.
- Enforces strict AI guardrails:
    1. AI never trades or overrides risk caps.
    2. Recommended boost multiplier is clamped strictly between 1.0 and 1.5.
    3. JSON output schema validation rejects unexpected fields or invalid bounds.
    4. Robust graceful fallback to heuristic advisory when API is offline or key missing.
"""

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
import httpx
from pydantic import ValidationError

from alpha_flip_cold.ai.prompt_guardrails import build_guarded_prompt, sanitize_external_text
from alpha_flip_cold.ai.schema import GeminiNarrativeResponse, ValidatedAdvisoryOutput

logger = logging.getLogger(__name__)

# Load production system prompt from adjacent markdown file
SYSTEM_PROMPT_PATH = Path(__file__).parent / "system_prompt.md"


class GeminiNarrativeAnalyzer:
    """
    Production client & validator for Gemini Narrative Analysis.
    Operates in Cold Path; outputs advisory signals only.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "gemini-2.5-flash",
        timeout_seconds: float = 8.0,
    ):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        self.model_name = model_name
        self.timeout = timeout_seconds
        self.system_prompt = self._load_system_prompt()

    def _load_system_prompt(self) -> str:
        try:
            if SYSTEM_PROMPT_PATH.exists():
                return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
        except Exception as e:
            logger.warning(f"Failed to load system prompt from file: {e}")
        return "You are an AI advisory narrative analyzer for Solana tokens. Output valid JSON only."

    async def analyze_narrative(
        self,
        mint: str,
        symbol: str,
        tweets: List[str],
        telegram_messages: List[str],
        caller_count: int = 0,
        tweets_per_min: float = 0.0,
    ) -> ValidatedAdvisoryOutput:
        """
        Analyze ingested social sentiment and extract guarded narrative advisory.
        Always returns a safe, validated output even in the event of API timeout or error.
        """
        # Build prompt wrapped in untrusted tags with regex-level injection inspection
        guarded_user_prompt, injection_detected = build_guarded_prompt(
            mint=mint,
            symbol=symbol,
            tweets=tweets,
            telegram_messages=telegram_messages,
            caller_count=caller_count,
            tweets_per_min=tweets_per_min,
        )

        # If injection was detected in social feeds, immediately flag and clamp
        if injection_detected:
            logger.warning(f"Injection pattern detected in social context for {symbol} ({mint})")

        # Fallback if no valid API key
        if not self.api_key or self.api_key.strip() in ("", "mock", "placeholder"):
            return self._heuristic_fallback(
                symbol=symbol,
                tweets_per_min=tweets_per_min,
                caller_count=caller_count,
                injection_detected=injection_detected,
                reason="No Gemini API Key provided, using deterministic heuristic",
            )

        try:
            raw_json_str = await self._call_gemini_api(guarded_user_prompt)
            validated_response = self._parse_and_validate(raw_json_str)
            return self._to_advisory_output(validated_response, injection_detected)
        except Exception as exc:
            logger.error(f"Gemini API call or validation failed for {symbol}: {exc}")
            return self._heuristic_fallback(
                symbol=symbol,
                tweets_per_min=tweets_per_min,
                caller_count=caller_count,
                injection_detected=injection_detected,
                reason=f"Gemini API error ({type(exc).__name__}): fallback engaged",
            )

    async def _call_gemini_api(self, user_content: str) -> str:
        """Call Gemini REST API endpoint using structured system instructions."""
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_name}:generateContent"
        params = {"key": self.api_key}

        payload: Dict[str, Any] = {
            "system_instruction": {
                "parts": [{"text": self.system_prompt}]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": user_content}]
                }
            ],
            "generationConfig": {
                "response_mime_type": "application/json",
                "temperature": 0.1,  # Low temperature for stable classification
                "max_output_tokens": 1024,
            }
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(url, params=params, json=payload)
            resp.raise_for_status()
            data = resp.json()

            # Extract generated response text
            candidates = data.get("candidates", [])
            if not candidates:
                raise ValueError("No candidates returned by Gemini API")
            
            parts = candidates[0].get("content", {}).get("parts", [])
            if not parts or "text" not in parts[0]:
                raise ValueError("Empty content parts in Gemini response")

            return parts[0]["text"]

    def _parse_and_validate(self, raw_text: str) -> GeminiNarrativeResponse:
        """Validate raw model response against strict Pydantic schema."""
        # Clean potential markdown fences if present despite response_mime_type
        cleaned = raw_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

        parsed = json.loads(cleaned)
        return GeminiNarrativeResponse.model_validate(parsed)

    def _to_advisory_output(
        self,
        resp: GeminiNarrativeResponse,
        injection_flag: bool,
    ) -> ValidatedAdvisoryOutput:
        """Convert validated schema into final bounded advisory output for hot path consumption."""
        # Severe spam or prompt injection triggers immediate VETO
        is_vetoed = resp.spam_score >= 0.85 or injection_flag

        # Action classification
        if is_vetoed:
            action = "VETO"
            boost = 1.0  # Reset boost to neutral on veto
        elif resp.narrative_confidence > 0.70 and resp.spam_score < 0.25:
            action = "FAVORABLE"
            boost = resp.recommended_boost_multiplier
        elif resp.spam_score > 0.60 or resp.narrative_confidence < 0.30:
            action = "DOWNSIZE"
            boost = 1.0
        else:
            action = "NEUTRAL"
            boost = 1.0

        # Hard clamp boost multiplier strictly between 1.0 and 1.5
        clamped_boost = max(1.0, min(1.5, boost))

        keywords = [k.keyword for k in resp.narrative_keywords[:5]]

        return ValidatedAdvisoryOutput(
            action=action,
            boost_multiplier=clamped_boost,
            narrative_keywords=keywords,
            narrative_confidence=resp.narrative_confidence,
            spam_score=resp.spam_score,
            is_vetoed=is_vetoed,
            risk_summary=resp.risk_notes[:256],
            sanitized_at_ts=time.time(),
        )

    def _heuristic_fallback(
        self,
        symbol: str,
        tweets_per_min: float,
        caller_count: int,
        injection_detected: bool,
        reason: str,
    ) -> ValidatedAdvisoryOutput:
        """Safe deterministic fallback when external LLM cannot be reached."""
        if injection_detected:
            return ValidatedAdvisoryOutput(
                action="VETO",
                boost_multiplier=1.0,
                narrative_keywords=["injection-detected"],
                narrative_confidence=0.0,
                spam_score=1.0,
                is_vetoed=True,
                risk_summary=f"Injection detected in raw social text ({reason})",
                sanitized_at_ts=time.time(),
            )

        if caller_count >= 3 and tweets_per_min >= 20.0:
            action = "FAVORABLE"
            boost = 1.15
            conf = 0.80
            spam = 0.15
        elif tweets_per_min < 2.0 and caller_count == 0:
            action = "DOWNSIZE"
            boost = 1.0
            conf = 0.20
            spam = 0.40
        else:
            action = "NEUTRAL"
            boost = 1.0
            conf = 0.50
            spam = 0.20

        return ValidatedAdvisoryOutput(
            action=action,
            boost_multiplier=boost,
            narrative_keywords=[f"{symbol.lower()}-momentum"],
            narrative_confidence=conf,
            spam_score=spam,
            is_vetoed=False,
            risk_summary=f"Deterministic fallback: {reason}",
            sanitized_at_ts=time.time(),
        )
