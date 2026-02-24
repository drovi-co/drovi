from __future__ import annotations

from unittest.mock import AsyncMock, Mock

import pytest

from src.world_model.impact import ImpactBridgeCandidate
from src.world_model.service import ImpactIntelligenceService


@pytest.mark.asyncio
async def test_compute_and_persist_impacts_skips_recent_duplicates() -> None:
    service = ImpactIntelligenceService(organization_id="org_1")
    service._engine.compute_bridges = Mock(  # type: ignore[method-assign]
        return_value=[
            ImpactBridgeCandidate(
                external_object_ref="ev_1",
                internal_object_ref="obj_1",
                impact_type="risk_drift",
                impact_score=0.82,
                severity="high",
                confidence=0.81,
                exposure_score=0.9,
                materiality_score=0.8,
                causal_strength=0.7,
                uncertainty=0.2,
                dedupe_key="dup_1",
            ),
            ImpactBridgeCandidate(
                external_object_ref="ev_2",
                internal_object_ref="obj_2",
                impact_type="material_change",
                impact_score=0.64,
                severity="medium",
                confidence=0.72,
                exposure_score=0.7,
                materiality_score=0.6,
                causal_strength=0.6,
                uncertainty=0.25,
                dedupe_key="dup_2",
            ),
        ]
    )
    service._has_recent_duplicate = AsyncMock(side_effect=[False, True])  # type: ignore[method-assign]
    service._persist_impact_edge = AsyncMock(  # type: ignore[method-assign]
        return_value={
            "id": "impact_1",
            "external_object_ref": "ev_1",
            "internal_object_ref": "obj_1",
            "impact_type": "risk_drift",
            "severity": "high",
            "confidence": 0.81,
            "created_at": "2026-02-23T00:00:00+00:00",
        }
    )
    service._publish_impact_event = AsyncMock()  # type: ignore[method-assign]

    result = await service.compute_and_persist_impacts(
        internal_objects=[],
        external_events=[],
        publish_events=True,
    )

    assert result["candidates_evaluated"] == 2
    assert result["persisted_count"] == 1
    assert result["skipped_duplicates"] == 1
    assert service._publish_impact_event.await_count == 1


@pytest.mark.asyncio
async def test_preview_impacts_returns_candidate_payload() -> None:
    service = ImpactIntelligenceService(organization_id="org_1")
    service._engine.compute_bridges = Mock(  # type: ignore[method-assign]
        return_value=[
            ImpactBridgeCandidate(
                external_object_ref="ev_1",
                internal_object_ref="obj_1",
                impact_type="requires_update",
                impact_score=0.75,
                severity="high",
                confidence=0.8,
                exposure_score=0.82,
                materiality_score=0.74,
                causal_strength=0.68,
                uncertainty=0.18,
                dedupe_key="k1",
            )
        ]
    )

    result = await service.preview_impacts(
        internal_objects=[],
        external_events=[],
    )

    assert result["candidate_count"] == 1
    assert result["items"][0]["internal_object_ref"] == "obj_1"
