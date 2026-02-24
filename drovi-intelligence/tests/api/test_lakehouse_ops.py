from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


async def test_lakehouse_backfill_endpoint_queues_job(async_client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("src.api.routes.lakehouse.enqueue_job", AsyncMock(return_value="job_backfill"))

    response = await async_client.post(
        "/api/v1/lakehouse/backfill",
        json={
            "organization_id": "org_test",
            "start_time": "2026-02-01T00:00:00Z",
            "end_time": "2026-02-23T00:00:00Z",
            "source_key": "worldnewsapi",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "queued"
    assert payload["job_id"] == "job_backfill"


async def test_lakehouse_partitions_endpoint(async_client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.api.routes.lakehouse.list_partitions",
        AsyncMock(return_value=[{"table_name": "silver.observations", "partition_key": "date=2026-02-23"}]),
    )

    response = await async_client.get("/api/v1/lakehouse/partitions?organization_id=org_test")

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["items"][0]["table_name"] == "silver.observations"


async def test_lakehouse_cost_endpoint_supports_group_by(async_client, monkeypatch: pytest.MonkeyPatch) -> None:
    summarize = AsyncMock(return_value=[{"organization_id": "org_test", "worker_id": "worker_a"}])
    monkeypatch.setattr("src.api.routes.lakehouse.summarize_cost_attribution", summarize)

    response = await async_client.get("/api/v1/lakehouse/cost?organization_id=org_test&group_by=worker")

    assert response.status_code == 200
    payload = response.json()
    assert payload["group_by"] == "worker"
    assert payload["count"] == 1
    assert payload["items"][0]["worker_id"] == "worker_a"

    kwargs = summarize.await_args.kwargs
    assert kwargs["organization_id"] == "org_test"
    assert kwargs["group_by"] == "worker"


async def test_lakehouse_query_endpoint(async_client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.api.routes.lakehouse.query_lakehouse_table",
        AsyncMock(return_value=[{"observation_id": "obs_1"}]),
    )

    response = await async_client.post(
        "/api/v1/lakehouse/query",
        json={
            "organization_id": "org_test",
            "table_name": "silver.observations",
            "limit": 100,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 1
    assert payload["items"][0]["observation_id"] == "obs_1"


async def test_lakehouse_retention_endpoint_queues_job(async_client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("src.api.routes.lakehouse.enqueue_job", AsyncMock(return_value="job_retention"))

    response = await async_client.post(
        "/api/v1/lakehouse/retention/run",
        json={
            "organization_id": "org_test",
            "limit": 1000,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "queued"
    assert payload["job_id"] == "job_retention"
