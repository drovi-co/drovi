from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from src.analytics.blindspot_detection import (
    BlindspotDetectionService,
    BlindspotFeedbackSnapshot,
    BlindspotIndicator,
    BlindspotSeverity,
    BlindspotType,
    OrganizationProfile,
)


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


def _sample_blindspot() -> BlindspotIndicator:
    return BlindspotIndicator(
        id="dv_topic_1",
        blindspot_type=BlindspotType.DECISION_VACUUM,
        title="Decision vacuum: pricing",
        severity=BlindspotSeverity.MEDIUM,
        description="Pricing topic has repeated discussion with no decision.",
        evidence_ids=["uio_1", "uio_2"],
        affected_topics=["pricing"],
        suggested_action="Create a decision owner and deadline.",
        detected_at=datetime.now(timezone.utc),
    )


@pytest.mark.asyncio
async def test_analyze_organization_applies_feedback_tuning(monkeypatch):
    service = BlindspotDetectionService(graph_client=AsyncMock())
    blindspot = _sample_blindspot()

    monkeypatch.setattr(
        service,
        "_analyze_decisions",
        AsyncMock(return_value={"total": 0, "reversal_rate": 0.0}),
    )
    monkeypatch.setattr(
        service,
        "_analyze_commitments",
        AsyncMock(return_value={"total": 0, "open_count": 0, "fulfillment_rate": 1.0}),
    )
    monkeypatch.setattr(service, "_analyze_communication", AsyncMock(return_value={}))
    monkeypatch.setattr(
        service,
        "_analyze_risks",
        AsyncMock(return_value={"total": 0, "mitigated": 0}),
    )
    monkeypatch.setattr(
        service,
        "_detect_decision_vacuums",
        AsyncMock(return_value=[blindspot]),
    )
    monkeypatch.setattr(service, "_detect_responsibility_gaps", AsyncMock(return_value=[]))
    monkeypatch.setattr(service, "_detect_recurring_questions", AsyncMock(return_value=[]))
    monkeypatch.setattr(service, "_detect_ignored_risks", AsyncMock(return_value=[]))
    monkeypatch.setattr(service, "_detect_communication_silos", AsyncMock(return_value=[]))
    monkeypatch.setattr(service, "_detect_overcommitment", AsyncMock(return_value=[]))
    monkeypatch.setattr(service, "_detect_stale_commitments", AsyncMock(return_value=[]))

    feedback = BlindspotFeedbackSnapshot(
        dismissed_fingerprints={service._blindspot_fingerprint(blindspot)}
    )
    monkeypatch.setattr(service, "_load_feedback_snapshot", AsyncMock(return_value=feedback))

    profile = await service.analyze_organization("org_1", days=30)
    assert isinstance(profile, OrganizationProfile)
    assert profile.blindspots == []


@pytest.mark.asyncio
async def test_dismiss_blindspot_persists_feedback(monkeypatch):
    service = BlindspotDetectionService(graph_client=AsyncMock())
    blindspot = _sample_blindspot()

    monkeypatch.setattr(
        service,
        "_load_feedback_snapshot",
        AsyncMock(return_value=BlindspotFeedbackSnapshot()),
    )
    monkeypatch.setattr(
        service,
        "analyze_organization",
        AsyncMock(return_value=OrganizationProfile(organization_id="org_1", blindspots=[blindspot])),
    )
    persist_mock = AsyncMock()
    monkeypatch.setattr(service, "_persist_blindspot_dismissal", persist_mock)

    result = await service.dismiss_blindspot(
        organization_id="org_1",
        blindspot_id=blindspot.id,
        reason="Known false positive",
        dismissed_by_subject="user_123",
    )

    assert result is True
    persist_mock.assert_awaited_once()
    call_kwargs = persist_mock.await_args.kwargs
    assert call_kwargs["blindspot_id"] == blindspot.id
    assert call_kwargs["blindspot_type"] == blindspot.blindspot_type.value
    assert call_kwargs["dismissed_by_subject"] == "user_123"


@pytest.mark.asyncio
async def test_dismiss_blindspot_unknown_returns_false(monkeypatch):
    service = BlindspotDetectionService(graph_client=AsyncMock())

    monkeypatch.setattr(
        service,
        "_load_feedback_snapshot",
        AsyncMock(return_value=BlindspotFeedbackSnapshot()),
    )
    monkeypatch.setattr(
        service,
        "analyze_organization",
        AsyncMock(return_value=OrganizationProfile(organization_id="org_1", blindspots=[])),
    )
    persist_mock = AsyncMock()
    monkeypatch.setattr(service, "_persist_blindspot_dismissal", persist_mock)

    result = await service.dismiss_blindspot(
        organization_id="org_1",
        blindspot_id="missing_id",
        reason="No longer relevant",
        dismissed_by_subject="user_123",
    )

    assert result is False
    persist_mock.assert_not_awaited()
