"""Comprehensive tests for Alpha-Flip Cold Path Service."""

import pytest
from pydantic import ValidationError
from alpha_flip_cold.config import ColdConfig
from alpha_flip_cold.schemas import (
    AdvisoryActionEnum,
    AuthorityStatusEnum,
    CabalRiskTier,
    ColdAdvisorySignal,
    LPStatusEnum,
    ModelParametersSchema,
    TokenProfileSchema,
    WalletProfileSchema,
)
from alpha_flip_cold.workers.funding_graph import FundingGraphWorker
from alpha_flip_cold.workers.smart_money_profiler import SmartMoneyProfilerWorker
from alpha_flip_cold.workers.token_flow import TokenFlowWorker
from alpha_flip_cold.workers.narrative_ingest import NarrativeIngestWorker
from alpha_flip_cold.workers.post_mortem_etl import PostMortemETLWorker
from alpha_flip_cold.clients.gmgn import GmgnClient
from alpha_flip_cold.clients.rugcheck import RugcheckClient
from alpha_flip_cold.clients.twitter import TwitterClient
from alpha_flip_cold.clients.telegram import TelegramClient


class MockAsyncRedis:
    def __init__(self):
        self.store = {}
        self.ttls = {}
        self.published = []

    def pipeline(self):
        return self

    def hset(self, key, mapping):
        self.store[key] = mapping

    def expire(self, key, ttl):
        self.ttls[key] = ttl

    async def execute(self):
        return True

    async def hgetall(self, key):
        return self.store.get(key, {})

    async def publish(self, channel, message):
        self.published.append((channel, message))
        return 1

    async def ping(self):
        return True

    async def aclose(self):
        pass


@pytest.fixture
def mock_writer():
    from alpha_flip_cold.redis_writer import ColdRedisWriter
    redis = MockAsyncRedis()
    return ColdRedisWriter(redis)


def test_cold_config_defaults():
    config = ColdConfig()
    assert config.trading_mode == "observe"
    assert config.redis_url.startswith("redis://")
    assert config.cabal.insider_holding_veto_threshold == 0.35
    assert config.gemini.confidence_threshold == 0.70


def test_cold_advisory_signal_validation():
    signal = ColdAdvisorySignal(
        mint="DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
        cabal_score=0.85,
        narrative_velocity=0.92,
        advice_action=AdvisoryActionEnum.FAVORABLE,
        confidence=0.88,
        reasoning="Strong organic wallet distribution, trending X/Telegram velocity"
    )
    assert signal.mint == "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
    assert signal.advice_action == AdvisoryActionEnum.FAVORABLE
    assert signal.timestamp_ms > 0


def test_cold_advisory_signal_bounds_rejection():
    # cabal_score > 1.0 must fail
    with pytest.raises(ValidationError):
        ColdAdvisorySignal(
            mint="DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
            cabal_score=1.5,
            narrative_velocity=0.5,
            advice_action=AdvisoryActionEnum.NEUTRAL,
            confidence=0.5,
        )

    # confidence < 0.0 must fail
    with pytest.raises(ValidationError):
        ColdAdvisorySignal(
            mint="DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
            cabal_score=0.5,
            narrative_velocity=0.5,
            advice_action=AdvisoryActionEnum.NEUTRAL,
            confidence=-0.1,
        )


def test_advisory_actions_match_spec():
    expected_actions = {"NEUTRAL", "FAVORABLE", "DOWNSIZE", "VETO"}
    actual_actions = {action.value for action in AdvisoryActionEnum}
    assert expected_actions == actual_actions


@pytest.mark.asyncio
async def test_wallet_profile_redis_roundtrip(mock_writer):
    profile = WalletProfileSchema(
        pubkey="4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
        tier=CabalRiskTier.HIGH,
        cabal_risk=0.82,
        smart_money_score=0.15,
        confidence=0.90,
        avg_hold_time_slots=45,
        dump_aggression=0.75,
        known_funder="FunderPubkey11111111111111111111111111111111",
    )
    ok = await mock_writer.write_wallet_profile(profile)
    assert ok is True

    fetched = await mock_writer.get_wallet_profile("4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R")
    assert fetched is not None
    assert fetched.tier == CabalRiskTier.HIGH
    assert fetched.cabal_risk == 0.82
    assert fetched.dump_aggression == 0.75


@pytest.mark.asyncio
async def test_token_profile_redis_roundtrip(mock_writer):
    token = TokenProfileSchema(
        mint="DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
        dev_proxy_risk=0.45,
        cabal_cold_score=0.60,
        narrative_keywords="pepe,sol",
        narrative_confidence=0.80,
        lp_status=LPStatusEnum.LOCKED,
        authority_status=AuthorityStatusEnum.REVOKED,
        insider_supply_ratio=0.28,
    )
    ok = await mock_writer.write_token_profile(token)
    assert ok is True

    fetched = await mock_writer.get_token_profile("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")
    assert fetched is not None
    assert fetched.dev_proxy_risk == 0.45
    assert fetched.lp_status == LPStatusEnum.LOCKED
    assert fetched.authority_status == AuthorityStatusEnum.REVOKED


@pytest.mark.asyncio
async def test_funding_graph_detects_cabal_cluster(mock_writer):
    config = ColdConfig()
    worker = FundingGraphWorker(config, mock_writer)
    funder = "FunderParentWallet11111111111111111111111111"

    # Simulate batch funding 5 fresh wallets from one parent
    for i in range(5):
        recipient = f"RecipientWallet{i}1111111111111111111111111111"
        p = worker.analyze_funding_edge(funder, recipient, 1.5)

    assert p.cabal_risk > 0.65
    assert p.tier in (CabalRiskTier.HIGH, CabalRiskTier.CRITICAL)
    assert p.cabal_id is not None
    assert "cabal_tree" in p.cabal_id


@pytest.mark.asyncio
async def test_smart_money_penalizes_fast_dump_sniper(mock_writer):
    config = ColdConfig()
    gmgn = GmgnClient()
    worker = SmartMoneyProfilerWorker(config, mock_writer, gmgn)

    # Force mock stats with ultra short hold time & high aggression
    async def mock_toxic_stats(pubkey):
        return {
            "winrate": 0.80,
            "avg_hold_time_slots": 25,  # < 50 slots!
            "dump_aggression": 0.85,    # > 0.65!
            "smart_money_score": 0.90,
            "total_trades": 100,
        }
    gmgn.get_wallet_profile = mock_toxic_stats

    profile = await worker.profile_wallet("ToxicSniperWallet111111111111111111111111111")
    # Must be penalized: smart score reduced, cabal risk elevated
    assert profile.smart_money_score < 0.50
    assert profile.cabal_risk >= 0.70
    assert profile.tier in (CabalRiskTier.HIGH, CabalRiskTier.CRITICAL)


@pytest.mark.asyncio
async def test_post_mortem_candidate_safety_guard(mock_writer):
    config = ColdConfig()
    worker = PostMortemETLWorker(config, mock_writer)

    # Add losing trades
    for _ in range(5):
        worker.record_completed_trade({
            "mint": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
            "realized_pnl_sol": -0.05,
            "exit_reason": "StopLoss",
        })

    candidate = await worker.generate_candidate_parameters()
    # Invariant: is_live MUST be False
    assert candidate.is_live is False
    assert candidate.version.startswith("candidate_v")
    # Stop loss should be tightened to 300 bps
    assert candidate.stop_loss_bps == 300
