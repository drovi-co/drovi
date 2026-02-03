"""
Scheduler Runner

Runs the connector scheduler as a standalone process.
"""

import asyncio
import signal

import structlog

from src.connectors.scheduling.scheduler import init_scheduler, shutdown_scheduler

logger = structlog.get_logger()


async def _run() -> None:
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

    await stop_event.wait()
    await shutdown_scheduler()
    logger.info("Scheduler runner stopped")


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
