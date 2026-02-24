from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class _FakeHypothesisService:
    def __init__(self) -> None:
        self.list_hypotheses = AsyncMock(
            return_value=[
                {
                    "id": "hyp_1",
                    "hypothesis_text": "External driver dominates",
                    "status": "accepted",
                    "related_belief_id": "belief_1",
                    "overall_score": 0.81,
                }
            ]
        )
        self.get_hypothesis = AsyncMock(
            return_value={
                "id": "hyp_1",
                "hypothesis_text": "External driver dominates",
                "status": "accepted",
                "scores": [{"score_type": "overall_score", "score_value": 0.81}],
            }
        )
        self.generate_for_belief = AsyncMock(
            return_value={"belief_id": "belief_1", "accepted": 2, "rejected": 1, "generated": 3}
        )
        self.generate_for_contradiction = AsyncMock(
            return_value={"anomaly_ref": "contradiction:ctr_1", "accepted": 1, "rejected": 2, "generated": 3}
        )
        self.generate_for_anomaly = AsyncMock(
            return_value={"anomaly_ref": "anom_1", "accepted": 2, "rejected": 0, "generated": 2}
        )
        self.rescore_hypotheses = AsyncMock(
            return_value={
                "updated": 2,
                "rejected": 1,
                "results": [{"hypothesis_id": "hyp_1", "status_after": "rejected"}],
            }
        )


async def test_brain_hypothesis_read_endpoints(async_client, monkeypatch: pytest.MonkeyPatch) -> None:
    service = _FakeHypothesisService()
    monkeypatch.setattr(
        "src.api.routes.brain.get_hypothesis_service",
        AsyncMock(return_value=service),
    )
    monkeypatch.setattr(
        "src.api.routes.brain.run_hypothesis_red_team_benchmark",
        lambda **_kwargs: {"passed": True, "benchmark_score": 0.83, "cases_total": 5},
    )

    list_response = await async_client.get("/api/v1/brain/hypotheses?organization_id=org_test")
    assert list_response.status_code == 200
    assert list_response.json()["count"] == 1

    belief_list_response = await async_client.get(
        "/api/v1/brain/beliefs/belief_1/hypotheses?organization_id=org_test"
    )
    assert belief_list_response.status_code == 200
    assert belief_list_response.json()["belief_id"] == "belief_1"

    get_response = await async_client.get("/api/v1/brain/hypotheses/hyp_1?organization_id=org_test")
    assert get_response.status_code == 200
    assert get_response.json()["hypothesis"]["id"] == "hyp_1"

    benchmark_response = await async_client.get(
        "/api/v1/brain/hypotheses/benchmark?organization_id=org_test"
    )
    assert benchmark_response.status_code == 200
    assert benchmark_response.json()["benchmark"]["passed"] is True


async def test_brain_hypothesis_generate_and_rescore_endpoints(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeHypothesisService()
    monkeypatch.setattr(
        "src.api.routes.brain.get_hypothesis_service",
        AsyncMock(return_value=service),
    )

    contradiction_generate = await async_client.post(
        "/api/v1/brain/hypotheses/generate",
        json={
            "organization_id": "org_test",
            "contradiction_id": "ctr_1",
            "contradiction_type": "policy_conflict",
            "contradiction_severity": "critical",
            "uio_a_id": "uio_1",
            "uio_b_id": "uio_2",
            "top_k": 3,
            "min_score": 0.5,
        },
    )
    assert contradiction_generate.status_code == 200
    assert contradiction_generate.json()["result"]["accepted"] == 1
    assert service.generate_for_contradiction.await_count == 1

    rescore_response = await async_client.post(
        "/api/v1/brain/hypotheses/rescore",
        json={
            "organization_id": "org_test",
            "belief_id": "belief_1",
            "evidence_signals": [
                {"direction": "contradict", "strength": 0.7, "source_ref": "news:1"}
            ],
            "rejection_threshold": 0.6,
        },
    )
    assert rescore_response.status_code == 200
    assert rescore_response.json()["result"]["updated"] == 2
    assert service.rescore_hypotheses.await_count == 1
