from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class _FakeImpactService:
    def __init__(self) -> None:
        self.compute_and_persist_impacts = AsyncMock(
            return_value={
                "candidates_evaluated": 2,
                "persisted_count": 1,
                "skipped_duplicates": 1,
                "items": [{"id": "impact_1"}],
            }
        )
        self.preview_impacts = AsyncMock(
            return_value={
                "candidate_count": 1,
                "items": [{"internal_object_ref": "obj_1"}],
            }
        )
        self.list_impacts = AsyncMock(
            return_value=[
                {
                    "id": "impact_1",
                    "internal_object_ref": "obj_1",
                    "severity": "high",
                }
            ]
        )
        self.get_impact_summary = AsyncMock(
            return_value={"totals": {"total": 5, "high": 2, "critical": 1}}
        )


async def test_brain_impact_compute_read_and_summary_endpoints(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeImpactService()
    audit_mock = AsyncMock()
    monkeypatch.setattr(
        "src.api.routes.brain.get_impact_intelligence_service",
        AsyncMock(return_value=service),
    )
    monkeypatch.setattr("src.api.routes.brain.record_audit_event", audit_mock)

    compute_response = await async_client.post(
        "/api/v1/brain/impact/compute",
        json={
            "organization_id": "org_test",
            "external_events": [{"event_id": "ev_1", "entity_refs": ["acme"], "domain": "legal"}],
            "internal_objects": [{"id": "obj_1", "entity_refs": ["acme"], "type": "commitment"}],
            "persist": True,
            "enqueue": False,
        },
    )
    assert compute_response.status_code == 200
    assert compute_response.json()["enqueued"] is False
    assert compute_response.json()["result"]["persisted_count"] == 1
    assert compute_response.json()["explainability"]["output_type"] == "impact_compute"

    preview_response = await async_client.post(
        "/api/v1/brain/impact/compute",
        json={
            "organization_id": "org_test",
            "external_events": [{"event_id": "ev_1", "entity_refs": ["acme"], "domain": "legal"}],
            "internal_objects": [{"id": "obj_1", "entity_refs": ["acme"], "type": "commitment"}],
            "persist": False,
            "enqueue": False,
        },
    )
    assert preview_response.status_code == 200
    assert preview_response.json()["result"]["candidate_count"] == 1

    list_response = await async_client.get("/api/v1/brain/impact/edges?organization_id=org_test")
    assert list_response.status_code == 200
    assert list_response.json()["count"] == 1
    assert "uncertainty_score" in list_response.json()["items"][0]
    assert "calibration_bucket" in list_response.json()["items"][0]

    summary_response = await async_client.get("/api/v1/brain/impact/summary?organization_id=org_test")
    assert summary_response.status_code == 200
    assert summary_response.json()["summary"]["totals"]["total"] == 5
    assert audit_mock.await_count >= 1


async def test_brain_impact_compute_enqueue_and_benchmark(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeImpactService()
    enqueue_job_mock = AsyncMock(return_value="job_impact_1")
    monkeypatch.setattr(
        "src.api.routes.brain.get_impact_intelligence_service",
        AsyncMock(return_value=service),
    )
    monkeypatch.setattr("src.api.routes.brain.enqueue_job", enqueue_job_mock)
    monkeypatch.setattr(
        "src.api.routes.brain.run_impact_benchmark",
        lambda **_kwargs: {
            "benchmark": "impact-v2-precision-density-v1",
            "cases_total": 3,
            "precision": 0.9,
            "precision_gain": 0.4,
            "alerts_per_event": 1.0,
            "passed": True,
        },
    )

    enqueue_response = await async_client.post(
        "/api/v1/brain/impact/compute",
        json={
            "organization_id": "org_test",
            "external_events": [{"event_id": "ev_1", "entity_refs": ["acme"], "domain": "legal"}],
            "internal_objects": [{"id": "obj_1", "entity_refs": ["acme"], "type": "commitment"}],
            "enqueue": True,
        },
    )
    assert enqueue_response.status_code == 200
    assert enqueue_response.json()["enqueued"] is True
    assert enqueue_response.json()["job_id"] == "job_impact_1"
    assert enqueue_job_mock.await_count == 1

    benchmark_response = await async_client.get("/api/v1/brain/impact/benchmark?organization_id=org_test")
    assert benchmark_response.status_code == 200
    assert benchmark_response.json()["benchmark"]["passed"] is True
