from __future__ import annotations

from unittest.mock import AsyncMock

import httpx
import pytest

from src.crawlers.fetch.static_worker import fetch_static

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_static_fetch_worker_flags_block_status(monkeypatch: pytest.MonkeyPatch) -> None:
    request_with_retry = AsyncMock(
        return_value=httpx.Response(
            status_code=403,
            headers={"content-type": "text/html"},
            content=b"<html>forbidden</html>",
            request=httpx.Request("GET", "https://example.com"),
        )
    )
    monkeypatch.setattr(
        "src.crawlers.fetch.static_worker.request_with_retry",
        request_with_retry,
    )

    result = await fetch_static(
        url="https://example.com",
        timeout_seconds=5.0,
        user_agent="DroviCrawler/1.0",
        max_attempts=2,
    )

    assert result.status_code == 403
    assert result.blocked is True
    assert result.retryable is False


async def test_static_fetch_worker_handles_network_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    request_with_retry = AsyncMock(side_effect=httpx.ConnectError("boom"))
    monkeypatch.setattr(
        "src.crawlers.fetch.static_worker.request_with_retry",
        request_with_retry,
    )

    result = await fetch_static(
        url="https://example.com",
        timeout_seconds=5.0,
        user_agent="DroviCrawler/1.0",
        max_attempts=2,
    )

    assert result.status_code == 0
    assert result.retryable is True
    assert "boom" in (result.error_message or "")
