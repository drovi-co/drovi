from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class _FakeService:
    def __init__(self) -> None:
        self.list_beliefs = AsyncMock(
            return_value=[
                {
                    "id": "belief_1",
                    "belief_state": "asserted",
                    "probability": 0.6,
                }
            ]
        )
        self.get_belief_trail = AsyncMock(
            return_value={
                "belief": {"id": "belief_1", "belief_state": "asserted"},
                "revisions": [],
            }
        )
        self.get_belief_evidence = AsyncMock(return_value=[{"evidence_link_id": "ev_1"}])
        self.replay_belief = AsyncMock(
            return_value={
                "belief_id": "belief_1",
                "revision_count": 1,
                "deterministic_hash": "abc",
                "valid_transitions": True,
                "violations": [],
            }
        )
        self.revise_belief = AsyncMock(
            return_value=type(
                "RevisionResult",
                (),
                {
                    "to_dict": lambda _self: {
                        "belief_id": "belief_1",
                        "next_state": "contested",
                        "revision_id": "rev_1",
                    }
                },
            )()
        )
        self.get_calibration_metrics = AsyncMock(
            return_value={
                "organization_id": "org_test",
                "source_metrics": [{"source_key": "worldnewsapi", "reliability_score": 0.8}],
                "model_metrics": [{"model_version": "epistemic-v1", "revision_count": 3}],
            }
        )


async def test_brain_beliefs_endpoints(async_client, monkeypatch: pytest.MonkeyPatch) -> None:
    service = _FakeService()
    monkeypatch.setattr(
        "src.api.routes.brain.get_belief_intelligence_service",
        AsyncMock(return_value=service),
    )

    response = await async_client.get("/api/v1/brain/beliefs?organization_id=org_test")
    assert response.status_code == 200
    assert response.json()["count"] == 1

    trail_response = await async_client.get(
        "/api/v1/brain/beliefs/belief_1/trail?organization_id=org_test"
    )
    assert trail_response.status_code == 200
    assert trail_response.json()["trail"]["belief"]["id"] == "belief_1"

    evidence_response = await async_client.get(
        "/api/v1/brain/beliefs/belief_1/evidence?organization_id=org_test"
    )
    assert evidence_response.status_code == 200
    assert evidence_response.json()["count"] == 1

    replay_response = await async_client.get(
        "/api/v1/brain/beliefs/belief_1/replay?organization_id=org_test"
    )
    assert replay_response.status_code == 200
    assert replay_response.json()["replay"]["valid_transitions"] is True


async def test_brain_revision_and_calibration_endpoints(async_client, monkeypatch: pytest.MonkeyPatch) -> None:
    service = _FakeService()
    enqueue_job_mock = AsyncMock(return_value="job_hyp_rescore_1")
    audit_mock = AsyncMock()
    monkeypatch.setattr(
        "src.api.routes.brain.get_belief_intelligence_service",
        AsyncMock(return_value=service),
    )
    monkeypatch.setattr("src.api.routes.brain.enqueue_job", enqueue_job_mock)
    monkeypatch.setattr("src.api.routes.brain.record_audit_event", audit_mock)

    revise_response = await async_client.post(
        "/api/v1/brain/beliefs/belief_1/revise",
        json={
            "organization_id": "org_test",
            "reason": "contradiction detected",
            "model_version": "epistemic-v1",
            "contradiction_ids": ["contr_1"],
            "signals": [
                {
                    "direction": "contradict",
                    "strength": 0.9,
                    "source_key": "worldnewsapi",
                    "evidence_link_id": "ev_1",
                }
            ],
        },
    )
    assert revise_response.status_code == 200
    assert revise_response.json()["revision"]["next_state"] == "contested"
    assert revise_response.json()["hypothesis_rescore_job_id"] == "job_hyp_rescore_1"
    assert revise_response.json()["epistemic"]["calibration_bucket"] is not None
    assert revise_response.json()["explainability"]["output_type"] == "belief_revision"
    assert enqueue_job_mock.await_count == 1
    audit_mock.assert_awaited_once()

    metrics_response = await async_client.get(
        "/api/v1/brain/calibration/beliefs?organization_id=org_test&days=30"
    )
    assert metrics_response.status_code == 200
    payload = metrics_response.json()["metrics"]
    assert payload["organization_id"] == "org_test"
    assert payload["source_metrics"][0]["source_key"] == "worldnewsapi"
