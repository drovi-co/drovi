"""
HTTP helpers for connectors.

Provides retry/backoff for transient errors and rate limits.
"""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from typing import Iterable

import httpx
import structlog

logger = structlog.get_logger()

try:  # pragma: no cover
    from prometheus_client import Counter

    _connector_http_retries_total = Counter(
        "drovi_connector_http_retries_total",
        "Total connector HTTP retries by connector/operation and reason",
        ["connector_type", "operation", "reason", "status_code"],
    )
except Exception:  # pragma: no cover
    _connector_http_retries_total = None


RETRY_STATUSES = {429, 500, 502, 503, 504}


@dataclass
class _RateLimiter:
    rate_per_minute: int
    next_allowed: float = 0.0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def wait(self) -> None:
        if self.rate_per_minute <= 0:
            return
        interval = 60.0 / float(self.rate_per_minute)
        async with self.lock:
            now = time.monotonic()
            if now < self.next_allowed:
                await asyncio.sleep(self.next_allowed - now)
            self.next_allowed = max(now, self.next_allowed) + interval


_rate_limiters: dict[str, _RateLimiter] = {}


async def _apply_rate_limit(
    key: str | None,
    rate_limit_per_minute: int | None,
) -> None:
    if not key or not rate_limit_per_minute:
        return
    limiter = _rate_limiters.get(key)
    if not limiter:
        limiter = _RateLimiter(rate_per_minute=rate_limit_per_minute)
        _rate_limiters[key] = limiter
    await limiter.wait()


async def request_with_retry(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    max_attempts: int = 5,
    retry_statuses: Iterable[int] | None = None,
    base_backoff: float = 0.5,
    max_backoff: float = 8.0,
    rate_limit_key: str | None = None,
    rate_limit_per_minute: int | None = None,
    metrics_connector_type: str | None = None,
    metrics_operation: str | None = None,
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
            await _apply_rate_limit(rate_limit_key, rate_limit_per_minute)
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

                if _connector_http_retries_total is not None and metrics_connector_type:
                    try:
                        _connector_http_retries_total.labels(
                            connector_type=metrics_connector_type,
                            operation=metrics_operation or "request",
                            reason="status",
                            status_code=str(response.status_code),
                        ).inc()
                    except Exception:
                        pass

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
            if _connector_http_retries_total is not None and metrics_connector_type:
                try:
                    _connector_http_retries_total.labels(
                        connector_type=metrics_connector_type,
                        operation=metrics_operation or "request",
                        reason="network",
                        status_code="0",
                    ).inc()
                except Exception:
                    pass
            logger.warning(
                "Retrying request due to network error",
                url=url,
                attempt=attempt,
                delay=delay,
                error=str(e),
            )
            await asyncio.sleep(delay)
