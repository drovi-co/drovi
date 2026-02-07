"""
Scheduler Runner

Runs the connector scheduler as a standalone process.
"""

import asyncio
import signal

import structlog

from src.connectors.scheduling.scheduler import init_scheduler, shutdown_scheduler
from src.db.client import close_db, init_db
from src.graph.client import close_graph_client, get_graph_client

logger = structlog.get_logger()


async def _run() -> None:
    await init_db()

    # Some scheduled jobs touch the graph directly (reports, candidates). Ensure
    # the client is connected and indexes exist so the scheduler process is
    # self-sufficient when deployed independently from the API process.
    try:
        graph = await get_graph_client()
        await graph.initialize_indexes()
        logger.info("FalkorDB initialized in scheduler process")
    except Exception as exc:
        logger.warning("Failed to initialize FalkorDB in scheduler", error=str(exc))

    await init_scheduler()
    logger.info("Scheduler runner started")

    # Sleep forever until signal
    stop_event = asyncio.Event()

    def _handle_signal(*_args):
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            asyncio.get_event_loop().add_signal_handler(sig, _handle_signal)
        except NotImplementedError:
            signal.signal(sig, lambda *_: stop_event.set())

    try:
        await stop_event.wait()
    finally:
        await shutdown_scheduler()
        await close_graph_client()
        await close_db()
        logger.info("Scheduler runner stopped")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
