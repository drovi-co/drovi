from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class _FakeNormativeService:
    def __init__(self) -> None:
        self.upsert_constraint_from_source = AsyncMock(
            return_value={"id": "constraint_1", "title": "Overdue cap", "origin_type": "policy"}
        )
        self.list_constraints = AsyncMock(
            return_value=[
                {
                    "id": "constraint_1",
                    "title": "Overdue cap",
                    "origin_type": "policy",
                    "machine_rule": "fact:internal.overdue_commitments <= 2",
                }
            ]
        )
        self.list_violations = AsyncMock(
            return_value=[
                {
                    "id": "viol_1",
                    "constraint_id": "constraint_1",
                    "status": "open",
                    "severity": "high",
                    "confidence": 0.8,
                }
            ]
        )
        self.get_obligation_timeline = AsyncMock(
            return_value={
                "constraint": {"id": "constraint_1", "title": "Overdue cap"},
                "timeline": [{"event_type": "violation.detected", "violation_id": "viol_1"}],
            }
        )
        self.run_violation_sentinel = AsyncMock(
            return_value={
                "constraints_evaluated": 2,
                "signals_detected": 1,
                "signals_persisted": 1,
                "breaches": 1,
                "warnings": 0,
                "items": [],
            }
        )


async def test_brain_normative_read_and_write_endpoints(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeNormativeService()
    monkeypatch.setattr(
        "src.api.routes.brain.get_normative_intelligence_service",
        AsyncMock(return_value=service),
    )

    upsert_response = await async_client.post(
        "/api/v1/brain/constraints/upsert",
        json={
            "organization_id": "org_test",
            "payload": {
                "constraint_id": "constraint_1",
                "source_class": "policy",
                "title": "Overdue cap",
                "machine_rule": "fact:internal.overdue_commitments <= 2",
            },
        },
    )
    assert upsert_response.status_code == 200
    assert upsert_response.json()["constraint"]["id"] == "constraint_1"

    constraints_response = await async_client.get("/api/v1/brain/constraints?organization_id=org_test")
    assert constraints_response.status_code == 200
    assert constraints_response.json()["count"] == 1

    violations_response = await async_client.get("/api/v1/brain/violations?organization_id=org_test")
    assert violations_response.status_code == 200
    assert violations_response.json()["items"][0]["id"] == "viol_1"

    timeline_response = await async_client.get(
        "/api/v1/brain/constraints/constraint_1/timeline?organization_id=org_test"
    )
    assert timeline_response.status_code == 200
    assert timeline_response.json()["timeline"]["constraint"]["id"] == "constraint_1"


async def test_brain_normative_sentinel_run_inline_and_enqueue(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeNormativeService()
    enqueue_job_mock = AsyncMock(return_value="job_norm_1")
    monkeypatch.setattr(
        "src.api.routes.brain.get_normative_intelligence_service",
        AsyncMock(return_value=service),
    )
    monkeypatch.setattr("src.api.routes.brain.enqueue_job", enqueue_job_mock)

    inline_response = await async_client.post(
        "/api/v1/brain/normative/sentinel/run",
        json={
            "organization_id": "org_test",
            "facts": {"internal": {"overdue_commitments": 3}},
            "include_warnings": True,
            "publish_events": False,
            "enqueue": False,
        },
    )
    assert inline_response.status_code == 200
    assert inline_response.json()["enqueued"] is False
    assert inline_response.json()["result"]["signals_persisted"] == 1

    enqueue_response = await async_client.post(
        "/api/v1/brain/normative/sentinel/run",
        json={
            "organization_id": "org_test",
            "enqueue": True,
            "facts": {"internal": {"overdue_commitments": 3}},
        },
    )
    assert enqueue_response.status_code == 200
    assert enqueue_response.json()["enqueued"] is True
    assert enqueue_response.json()["job_id"] == "job_norm_1"
    assert enqueue_job_mock.await_count == 1


async def test_brain_normative_benchmark_endpoint(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "src.api.routes.brain.run_normative_benchmark",
        lambda **_kwargs: {
            "benchmark": "normative-sentinel-v1",
            "cases_total": 4,
            "recall": 1.0,
            "false_positive_rate": 0.0,
            "passed": True,
        },
    )

    response = await async_client.get(
        "/api/v1/brain/normative/benchmark?organization_id=org_test&target_recall=0.9"
    )
    assert response.status_code == 200
    assert response.json()["benchmark"]["passed"] is True
