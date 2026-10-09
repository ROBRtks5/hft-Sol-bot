"""Alpha-Flip Cold Path Service Main Entry Point.

Safety Invariants:
1. Cold path is strictly ADVISORY. Zero execution rights, zero private key access.
2. AI (Gemini) advisory cannot execute trades or override risk/liquidity caps.
3. Candidate parameters are strictly isolated from live parameters.
4. All Redis writes enforce explicit TTLs to avoid unbounded RAM accumulation.
"""

import argparse
import asyncio
import logging
import signal
import sys
import time
from typing import Optional

from alpha_flip_cold.clients import GmgnClient, RugcheckClient, TwitterClient, TelegramClient
from alpha_flip_cold.config import ColdConfig
from alpha_flip_cold.redis_writer import ColdRedisWriter
from alpha_flip_cold.schemas import AdvisoryActionEnum, ColdAdvisorySignal
from alpha_flip_cold.workers import (
    FundingGraphWorker,
    TokenFlowWorker,
    SmartMoneyProfilerWorker,
    NarrativeIngestWorker,
    PostMortemETLWorker,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] (cold) %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("alpha_flip_cold")


class ColdPathDaemon:
    def __init__(self, config: ColdConfig):
        self.config = config
        self._running = False
        self.writer = ColdRedisWriter.from_url(config.redis_url)

        # Clients
        self.gmgn_client = GmgnClient(api_key=config.gmgn_api_key)
        self.rugcheck_client = RugcheckClient()
        self.twitter_client = TwitterClient(bearer_token=config.twitter_bearer_token)
        self.telegram_client = TelegramClient(bot_token=config.telegram_bot_token)

        # Workers
        self.funding_worker = FundingGraphWorker(config, self.writer)
        self.token_flow_worker = TokenFlowWorker(
            config, self.writer, self.gmgn_client, self.rugcheck_client
        )
        self.smart_money_worker = SmartMoneyProfilerWorker(
            config, self.writer, self.gmgn_client
        )
        self.narrative_worker = NarrativeIngestWorker(
            config, self.writer, self.twitter_client, self.telegram_client
        )
        self.post_mortem_worker = PostMortemETLWorker(config, self.writer)

    async def start(self):
        self._running = True
        logger.info("===========================================================")
        logger.info("      ALPHA-FLIP v3.2 - COLD ADVISORY DAEMON              ")
        logger.info("===========================================================")
        logger.info(f"Operating Mode     : {self.config.trading_mode}")
        logger.info(f"Redis Endpoint     : {self.config.redis_url}")
        logger.info(f"Gemini Model       : {self.config.gemini.model_name}")
        logger.info(f"Advisory Channel   : {self.config.advisory_channel}")
        logger.info("SAFETY INVARIANTS  : [1] Cold path is strictly ADVISORY.")
        logger.info("                     [2] Zero trade execution capabilities.")
        logger.info("                     [3] No private key or seed access.")
        logger.info("                     [4] AI cannot override hard risk caps.")
        logger.info("===========================================================")

        # Check Redis connection
        redis_ok = await self.writer.ping()
        if not redis_ok:
            logger.warning("Redis ping failed at startup; will attempt reconnects in background.")
        else:
            logger.info("Connected to Redis successfully.")

        # Spawn background tasks
        tasks = [
            asyncio.create_task(self.funding_worker.run_loop()),
            asyncio.create_task(self._telemetry_listener_loop()),
            asyncio.create_task(self._heartbeat_loop()),
        ]

        try:
            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            logger.info("Cold advisory daemon received shutdown cancellation.")
        finally:
            self._running = False
            self.funding_worker.stop()
            await self.writer.close()
            logger.info("Cold advisory daemon halted cleanly.")

    async def _heartbeat_loop(self):
        while self._running:
            logger.debug("Advisory daemon heartbeat pulse...")
            await asyncio.sleep(15)

    async def _telemetry_listener_loop(self):
        """Listen to telemetry channel from hot path (trades, new candidates)."""
        logger.info(f"Subscribing to telemetry channel: {self.config.telemetry_channel}")
        try:
            pubsub = self.writer.redis.pubsub()
            await pubsub.subscribe(self.config.telemetry_channel)
            while self._running:
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg and msg.get("data"):
                    raw_data = msg["data"]
                    logger.debug(f"Received telemetry event: {raw_data}")
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Telemetry listener encountered error: {e}")

    def stop(self):
        self._running = False


def main():
    parser = argparse.ArgumentParser(description="Alpha-Flip v3.2 Cold Path Advisory Daemon")
    parser.add_argument(
        "--config",
        type=str,
        default="configs/cold.example.yaml",
        help="Path to YAML config",
    )
    args = parser.parse_args()

    config = ColdConfig.load_from_yaml(args.config)
    daemon = ColdPathDaemon(config)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    def shutdown():
        daemon.stop()
        for task in asyncio.all_tasks(loop):
            task.cancel()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, shutdown)
        except NotImplementedError:
            pass

    try:
        loop.run_until_complete(daemon.start())
    except KeyboardInterrupt:
        logger.info("Interrupted by user. Shutting down...")
    finally:
        loop.close()


if __name__ == "__main__":
    main()
