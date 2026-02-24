from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from src.security.policy_engine import AccessDecision


pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class _FakeObservationService:
    def __init__(self) -> None:
        self.list_observations = AsyncMock(
            return_value=[
                {
                    "id": "obs_1",
                    "source_type": "worldnewsapi",
                    "observation_type": "news.article",
                    "title": "Regulatory update",
                    "evidence_count": 1,
                    "observed_at": "2026-02-23T12:00:00+00:00",
                }
            ]
        )
        self.get_observation = AsyncMock(
            return_value={
                "id": "obs_1",
                "source_type": "worldnewsapi",
                "observation_type": "news.article",
                "title": "Regulatory update",
                "content": {"text": "Regulatory update text"},
                "evidence_count": 1,
            }
        )
        self.get_observation_evidence = AsyncMock(
            return_value=[
                {
                    "id": "link_1",
                    "evidence_artifact_id": "ea_1",
                    "link_type": "supporting",
                    "confidence": 0.9,
                }
            ]
        )


async def test_brain_observation_endpoints(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observation_service = _FakeObservationService()
    monkeypatch.setattr(
        "src.api.routes.brain.get_observation_intelligence_service",
        AsyncMock(return_value=observation_service),
    )

    list_response = await async_client.get("/api/v1/brain/observations?organization_id=org_test")
    assert list_response.status_code == 200
    assert list_response.json()["count"] == 1

    get_response = await async_client.get("/api/v1/brain/observations/obs_1?organization_id=org_test")
    assert get_response.status_code == 200
    assert get_response.json()["observation"]["id"] == "obs_1"

    evidence_response = await async_client.get(
        "/api/v1/brain/observations/obs_1/evidence?organization_id=org_test"
    )
    assert evidence_response.status_code == 200
    assert evidence_response.json()["count"] == 1


async def test_brain_observation_endpoints_apply_redaction_when_masked(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observation_service = _FakeObservationService()
    observation_service.list_observations = AsyncMock(
        return_value=[
            {
                "id": "obs_1",
                "source_type": "worldnewsapi",
                "observation_type": "news.article",
                "title": "Contact jane@example.com for legal update",
                "evidence_count": 1,
            }
        ]
    )
    observation_service.get_observation = AsyncMock(
        return_value={
            "id": "obs_1",
            "title": "Contact jane@example.com for legal update",
            "content": {"text": "Please email jane@example.com immediately."},
        }
    )
    monkeypatch.setattr(
        "src.api.routes.brain.get_observation_intelligence_service",
        AsyncMock(return_value=observation_service),
    )
    monkeypatch.setattr(
        "src.api.routes.brain.require_cognitive_access",
        AsyncMock(
            return_value=AccessDecision(
                allowed=True,
                masked=True,
                requires_break_glass=False,
                reason="allowed_masked",
            )
        ),
    )

    list_response = await async_client.get("/api/v1/brain/observations?organization_id=org_test")
    assert list_response.status_code == 200
    assert list_response.json()["redaction_applied"] is True
    assert "jane@example.com" not in str(list_response.json()["items"][0])

    detail_response = await async_client.get("/api/v1/brain/observations/obs_1?organization_id=org_test")
    assert detail_response.status_code == 200
    assert detail_response.json()["redaction_applied"] is True
    assert "jane@example.com" not in str(detail_response.json()["observation"])


async def test_brain_ask_v2_truth_uncertainty_narrative_ordering(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observation_service = _FakeObservationService()
    belief_service = AsyncMock()
    belief_service.list_beliefs = AsyncMock(
        return_value=[
            {
                "id": "belief_1",
                "proposition": "Tax ruling changes obligations",
                "belief_state": "contested",
                "probability": 0.62,
                "uncertainty_score": 0.71,
            }
        ]
    )
    hypothesis_service = AsyncMock()
    hypothesis_service.list_hypotheses = AsyncMock(
        return_value=[
            {
                "id": "hyp_1",
                "hypothesis_text": "Regulation impacts renewals",
                "status": "accepted",
            }
        ]
    )
    normative_service = AsyncMock()
    normative_service.list_violations = AsyncMock(
        return_value=[
            {
                "id": "viol_1",
                "constraint_title": "Tax disclosure deadline",
                "severity": "high",
            }
        ]
    )
    impact_service = AsyncMock()
    impact_service.list_impacts = AsyncMock(
        return_value=[
            {
                "id": "impact_1",
                "confidence": 0.42,
                "internal_object_ref": "commitment_1",
            }
        ]
    )

    monkeypatch.setattr(
        "src.api.routes.brain.get_observation_intelligence_service",
        AsyncMock(return_value=observation_service),
    )
    monkeypatch.setattr(
        "src.api.routes.brain.get_belief_intelligence_service",
        AsyncMock(return_value=belief_service),
    )
    monkeypatch.setattr(
        "src.api.routes.brain.get_hypothesis_service",
        AsyncMock(return_value=hypothesis_service),
    )
    monkeypatch.setattr(
        "src.api.routes.brain.get_normative_intelligence_service",
        AsyncMock(return_value=normative_service),
    )
    monkeypatch.setattr(
        "src.api.routes.brain.get_impact_intelligence_service",
        AsyncMock(return_value=impact_service),
    )

    response = await async_client.post(
        "/api/v1/brain/ask/v2",
        json={
            "organization_id": "org_test",
            "question": "What changed that affects compliance risk?",
            "role": "legal",
            "limit": 5,
        },
    )
    assert response.status_code == 200
    payload = response.json()["ask_v2"]
    assert payload["ordering"] == ["truth", "uncertainty", "narrative"]
    assert payload["truth"]["counts"]["beliefs"] == 1
    assert payload["uncertainty"]["average_belief_uncertainty"] == 0.71
    assert payload["uncertainty"]["low_confidence_impact_ids"] == ["impact_1"]
    assert payload["uncertainty"]["source_mix"][0]["avg_reliability_score"] is None
    assert "Truth snapshot has" in payload["narrative"]
