"""HTTP client helpers for connector implementations.

This is the standardized surface:
- Pulls retry/backoff policies from ConnectorDefinition
- Applies per-connection rate limiting via BaseConnector helpers
- Emits consistent retry metrics
"""

from __future__ import annotations

from typing import Any

import httpx

from src.connectors.base.config import ConnectorConfig
from src.connectors.base.connector import BaseConnector
from src.connectors.definitions.registry import get_connector_definition
from src.connectors.http import request_with_retry


async def connector_request(
    *,
    connector: BaseConnector,
    config: ConnectorConfig,
    client: httpx.AsyncClient,
    method: str,
    url: str,
    operation: str | None = None,
    **kwargs: Any,
) -> httpx.Response:
    """
    Standard connector HTTP request wrapper.

    Use this instead of calling `request_with_retry` directly in connectors.
    """
    definition = get_connector_definition(connector.connector_type)
    http_retry = definition.http_retry if definition else None

    max_attempts = http_retry.max_attempts if http_retry else 5
    base_backoff = http_retry.base_backoff_seconds if http_retry else 0.5
    max_backoff = http_retry.max_backoff_seconds if http_retry else 8.0
    retry_statuses = http_retry.retry_statuses if http_retry else None

    return await request_with_retry(
        client,
        method,
        url,
        max_attempts=max_attempts,
        retry_statuses=retry_statuses,
        base_backoff=base_backoff,
        max_backoff=max_backoff,
        rate_limit_key=connector.get_rate_limit_key(config),
        rate_limit_per_minute=connector.get_rate_limit_per_minute(),
        metrics_connector_type=connector.connector_type,
        metrics_operation=operation,
        **kwargs,
    )

