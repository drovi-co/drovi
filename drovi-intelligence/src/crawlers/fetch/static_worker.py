"""Static fetch worker for HTML/JSON/XML/PDF endpoints."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from src.connectors.http import request_with_retry


@dataclass(frozen=True)
class StaticFetchResult:
    url: str
    final_url: str
    status_code: int
    content_type: str | None
    content: bytes
    headers: dict[str, str]
    blocked: bool
    retryable: bool
    error_message: str | None = None


def _headers_to_dict(headers: httpx.Headers) -> dict[str, str]:
    return {str(key).lower(): str(value) for key, value in headers.items()}


def _is_block_status(status_code: int) -> bool:
    return status_code in {401, 403, 406, 407, 429}


async def fetch_static(
    *,
    url: str,
    timeout_seconds: float,
    user_agent: str,
    max_attempts: int,
    proxy_url: str | None = None,
    extra_headers: dict[str, str] | None = None,
) -> StaticFetchResult:
    """
    Fetch one URL without browser rendering.

    Includes retry, timeout, proxy support, and anti-block classification.
    """
    headers = {"User-Agent": user_agent, "Accept": "*/*"}
    if extra_headers:
        headers.update({str(k): str(v) for k, v in extra_headers.items()})

    client_kwargs: dict[str, Any] = {
        "follow_redirects": True,
        "timeout": max(1.0, float(timeout_seconds)),
    }
    if proxy_url:
        # httpx supports `proxy` (single proxy URL) on client construction.
        client_kwargs["proxy"] = proxy_url

    async with httpx.AsyncClient(**client_kwargs) as client:
        try:
            response = await request_with_retry(
                client,
                "GET",
                url,
                max_attempts=max(1, int(max_attempts)),
                retry_statuses={408, 425, 429, 500, 502, 503, 504},
                base_backoff=0.5,
                max_backoff=8.0,
                rate_limit_key=f"crawler_static:{url}",
                rate_limit_per_minute=120,
                metrics_connector_type="crawler_static",
                metrics_operation="fetch",
                circuit_breaker_key="provider:crawler_static",
                circuit_breaker_enabled=True,
                circuit_breaker_threshold=8,
                circuit_breaker_reset_seconds=90.0,
                headers=headers,
            )
        except Exception as exc:
            return StaticFetchResult(
                url=url,
                final_url=url,
                status_code=0,
                content_type=None,
                content=b"",
                headers={},
                blocked=False,
                retryable=True,
                error_message=str(exc),
            )

    response_headers = _headers_to_dict(response.headers)
    content_type = response_headers.get("content-type")
    status_code = int(response.status_code)
    blocked = _is_block_status(status_code)
    retryable = status_code >= 500 or status_code in {408, 425, 429}

    return StaticFetchResult(
        url=url,
        final_url=str(response.url),
        status_code=status_code,
        content_type=content_type,
        content=bytes(response.content or b""),
        headers=response_headers,
        blocked=blocked,
        retryable=retryable,
        error_message=None if status_code < 400 else f"HTTP {status_code}",
    )
