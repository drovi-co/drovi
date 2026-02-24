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

try:  # pragma: no cover
    from prometheus_client import Counter

    _connector_http_circuit_open_total = Counter(
        "drovi_connector_http_circuit_open_total",
        "Total connector circuit-breaker open events by connector/operation",
        ["connector_type", "operation"],
    )
except Exception:  # pragma: no cover
    _connector_http_circuit_open_total = None


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


@dataclass
class _CircuitBreakerState:
    failure_count: int = 0
    opened_until: float = 0.0
    opened_total: int = 0
    last_failure_status: int | None = None
    last_failure_reason: str | None = None


class ConnectorCircuitOpenError(RuntimeError):
    """Raised when provider circuit breaker is open."""

    def __init__(
        self,
        *,
        key: str,
        retry_after_seconds: float,
    ) -> None:
        super().__init__(f"Connector circuit breaker is open for {key}")
        self.key = key
        self.retry_after_seconds = retry_after_seconds


_circuit_breakers: dict[str, _CircuitBreakerState] = {}


def _get_circuit_state(key: str) -> _CircuitBreakerState:
    state = _circuit_breakers.get(key)
    if not state:
        state = _CircuitBreakerState()
        _circuit_breakers[key] = state
    return state


def _record_circuit_success(key: str) -> None:
    state = _get_circuit_state(key)
    state.failure_count = 0
    state.last_failure_status = None
    state.last_failure_reason = None
    state.opened_until = 0.0


def _record_circuit_failure(
    *,
    key: str,
    threshold: int,
    reset_seconds: float,
    status_code: int | None,
    reason: str,
    metrics_connector_type: str | None,
    metrics_operation: str | None,
) -> None:
    state = _get_circuit_state(key)
    state.failure_count += 1
    state.last_failure_status = status_code
    state.last_failure_reason = reason

    if state.failure_count < max(1, threshold):
        return

    now = time.monotonic()
    state.opened_until = now + max(1.0, float(reset_seconds))
    state.opened_total += 1

    if _connector_http_circuit_open_total is not None and metrics_connector_type:
        try:
            _connector_http_circuit_open_total.labels(
                connector_type=metrics_connector_type,
                operation=metrics_operation or "request",
            ).inc()
        except Exception:
            pass

    logger.warning(
        "Connector provider circuit breaker opened",
        key=key,
        threshold=threshold,
        reset_seconds=reset_seconds,
        status_code=status_code,
        reason=reason,
    )


def _ensure_circuit_available(key: str) -> None:
    state = _get_circuit_state(key)
    if state.opened_until <= 0:
        return

    now = time.monotonic()
    if now >= state.opened_until:
        # Cooldown elapsed; allow traffic again and restart failure accumulation.
        state.opened_until = 0.0
        state.failure_count = 0
        state.last_failure_status = None
        state.last_failure_reason = None
        return

    raise ConnectorCircuitOpenError(
        key=key,
        retry_after_seconds=max(state.opened_until - now, 0.0),
    )


def get_connector_circuit_breaker_snapshot() -> dict[str, dict[str, float | int | bool | str | None]]:
    """
    Return an in-memory snapshot of provider circuit-breaker states.
    """
    now = time.monotonic()
    snapshot: dict[str, dict[str, float | int | bool | str | None]] = {}
    for key, state in _circuit_breakers.items():
        is_open = state.opened_until > now
        retry_after = max(state.opened_until - now, 0.0) if is_open else 0.0
        snapshot[key] = {
            "is_open": is_open,
            "retry_after_seconds": retry_after,
            "opened_until_monotonic": state.opened_until,
            "failure_count": state.failure_count,
            "opened_total": state.opened_total,
            "last_failure_status": state.last_failure_status,
            "last_failure_reason": state.last_failure_reason,
        }
    return snapshot


def reset_connector_http_state() -> None:
    """
    Reset in-memory HTTP controls (rate limiters and circuit breakers).

    Intended for unit tests.
    """
    _rate_limiters.clear()
    _circuit_breakers.clear()


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
    circuit_breaker_key: str | None = None,
    circuit_breaker_enabled: bool = True,
    circuit_breaker_threshold: int = 5,
    circuit_breaker_reset_seconds: float = 60.0,
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
            if circuit_breaker_enabled and circuit_breaker_key:
                _ensure_circuit_available(circuit_breaker_key)

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

            if circuit_breaker_enabled and circuit_breaker_key:
                if response.status_code in retry_statuses:
                    _record_circuit_failure(
                        key=circuit_breaker_key,
                        threshold=circuit_breaker_threshold,
                        reset_seconds=circuit_breaker_reset_seconds,
                        status_code=response.status_code,
                        reason="status",
                        metrics_connector_type=metrics_connector_type,
                        metrics_operation=metrics_operation,
                    )
                elif response.status_code < 400:
                    _record_circuit_success(circuit_breaker_key)

            return response

        except (httpx.TimeoutException, httpx.NetworkError) as e:
            if attempt >= max_attempts:
                if circuit_breaker_enabled and circuit_breaker_key:
                    _record_circuit_failure(
                        key=circuit_breaker_key,
                        threshold=circuit_breaker_threshold,
                        reset_seconds=circuit_breaker_reset_seconds,
                        status_code=None,
                        reason="network",
                        metrics_connector_type=metrics_connector_type,
                        metrics_operation=metrics_operation,
                    )
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
