from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


async def test_seed_frontier_endpoint(async_client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.api.routes.crawl.seed_frontier_url",
        AsyncMock(
            return_value={
                "id": "frontier_1",
                "url": "https://example.com/news",
                "source_key": "rss_osint",
                "status": "queued",
            }
        ),
    )

    response = await async_client.post(
        "/api/v1/crawl/frontier/seed",
        json={
            "organization_id": "org_test",
            "source_key": "rss_osint",
            "url": "https://example.com/news",
            "priority": 2,
            "freshness_policy_minutes": 30,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "queued"
    assert payload["frontier_entry"]["id"] == "frontier_1"


async def test_policy_takedown_endpoint(async_client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.api.routes.crawl.request_takedown",
        AsyncMock(
            return_value={
                "rule": {"id": "rule_1", "scope": "example.com"},
                "affected_frontier_entries": 5,
            }
        ),
    )

    response = await async_client.post(
        "/api/v1/crawl/policy/takedown",
        json={
            "organization_id": "org_test",
            "scope": "example.com",
            "reason": "License withdrawal",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["affected_frontier_entries"] == 5


async def test_frontier_tick_endpoint(async_client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.api.routes.crawl.dispatch_frontier_tick",
        AsyncMock(return_value={"claimed": 3, "enqueued": 3, "job_ids": ["a", "b", "c"]}),
    )

    response = await async_client.post(
        "/api/v1/crawl/frontier/tick",
        json={"sync_params": {"force_render": False}},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["claimed"] == 3
