from __future__ import annotations

import asyncio
from typing import Any

try:
    from temporalio.client import Client

    _HAS_TEMPORAL = True
except ModuleNotFoundError:  # pragma: no cover - optional in some test/dev envs
    Client = Any  # type: ignore[misc,assignment]
    _HAS_TEMPORAL = False

from src.config import get_settings

_client: Client | None = None
_client_lock = asyncio.Lock()


async def get_temporal_client() -> Client:
    settings = get_settings()
    if not settings.temporal_enabled:
        raise RuntimeError("Temporal is disabled (TEMPORAL_ENABLED=false)")
    if not _HAS_TEMPORAL:
        raise RuntimeError("temporalio dependency is not installed")

    global _client
    if _client is not None:
        return _client

    async with _client_lock:
        if _client is None:
            _client = await Client.connect(
                settings.temporal_address,
                namespace=settings.temporal_namespace,
            )
    return _client


async def close_temporal_client() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None
