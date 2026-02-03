"""
HTTP helpers for connectors.

Provides retry/backoff for transient errors and rate limits.
"""

from __future__ import annotations

import asyncio
import random
from typing import Iterable

import httpx
import structlog

logger = structlog.get_logger()


RETRY_STATUSES = {429, 500, 502, 503, 504}


async def request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    max_attempts: int = 5,
    retry_statuses: Iterable[int] | None = None,
    base_backoff: float = 0.5,
    max_backoff: float = 8.0,
    **kwargs,
) -> httpx.Response:
    """
    Make an HTTP request with exponential backoff + jitter.
    """
    retry_statuses = set(retry_statuses or RETRY_STATUSES)

    attempt = 0
    while True:
        attempt += 1
        try:
            response = await client.request(method, url, **kwargs)

            if response.status_code in retry_statuses and attempt < max_attempts:
                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    try:
                        delay = float(retry_after)
                    except ValueError:
                        delay = base_backoff
                else:
                    delay = min(max_backoff, base_backoff * (2 ** (attempt - 1)))
                    delay = delay + random.uniform(0, delay / 2)

                logger.warning(
                    "Retrying request due to status",
                    status_code=response.status_code,
                    url=url,
                    attempt=attempt,
                    delay=delay,
                )
                await asyncio.sleep(delay)
                continue

            return response

        except (httpx.TimeoutException, httpx.NetworkError) as e:
            if attempt >= max_attempts:
                raise

            delay = min(max_backoff, base_backoff * (2 ** (attempt - 1)))
            delay = delay + random.uniform(0, delay / 2)
            logger.warning(
                "Retrying request due to network error",
                url=url,
                attempt=attempt,
                delay=delay,
                error=str(e),
            )
            await asyncio.sleep(delay)
