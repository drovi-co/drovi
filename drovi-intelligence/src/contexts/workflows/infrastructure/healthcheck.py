"""
Temporal worker healthcheck.

Used by Docker healthchecks to determine if the workflow plane can reach Temporal.
"""

from __future__ import annotations

import asyncio

import structlog
from temporalio.client import Client

from src.config import get_settings

logger = structlog.get_logger()


async def _check() -> int:
    settings = get_settings()
    if not settings.temporal_enabled:
        return 0

    client: Client | None = None
    try:
        client = await Client.connect(
            settings.temporal_address,
            namespace=settings.temporal_namespace,
        )
        return 0
    except Exception as exc:
        logger.error(
            "temporal_healthcheck_failed",
            temporal_address=settings.temporal_address,
            temporal_namespace=settings.temporal_namespace,
            error=str(exc),
        )
        return 1
    finally:
        if client is not None:
            try:
                await client.close()
            except Exception:
                pass


def main() -> None:
    raise SystemExit(asyncio.run(_check()))


if __name__ == "__main__":
    main()

