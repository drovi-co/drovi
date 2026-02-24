from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class _FakeTapeService:
    def __init__(self) -> None:
        self.list_events = AsyncMock(
            return_value=[
                {
                    "event_id": "tape:belief:rev_1",
                    "lane": "internal",
                    "delta_domain": "belief",
                    "severity": "medium",
                    "confidence": 0.71,
                    "summary": "Belief state transition",
                    "proof_bundle": {"bundle_id": "proof:belief:rev_1", "citations": []},
                }
            ]
        )
        self.get_event = AsyncMock(
            return_value={
                "event_id": "tape:belief:rev_1",
                "lane": "internal",
                "delta_domain": "belief",
                "severity": "medium",
                "confidence": 0.71,
                "summary": "Belief state transition",
                "proof_bundle": {"bundle_id": "proof:belief:rev_1", "citations": []},
            }
        )
        self.build_live_contract = AsyncMock(
            return_value={
                "lanes": {
                    "internal": [],
                    "external": [],
                    "world_pressure": [{"entity_id": "acme", "pressure_score": 7.2, "tier": "high"}],
                    "bridge": [],
                },
                "visualization_contract": {
                    "world_pressure_lane": {"metric": "pressure_score"},
                    "bridge_visualization": {"edges": []},
                },
            }
        )


async def test_brain_tape_endpoints(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeTapeService()
    monkeypatch.setattr(
        "src.api.routes.brain.get_tape_service",
        AsyncMock(return_value=service),
    )

    list_response = await async_client.get("/api/v1/brain/tape?organization_id=org_test")
    assert list_response.status_code == 200
    assert list_response.json()["count"] == 1

    live_contract_response = await async_client.get(
        "/api/v1/brain/tape/live-contract?organization_id=org_test"
    )
    assert live_contract_response.status_code == 200
    assert live_contract_response.json()["contract"]["lanes"]["world_pressure"][0]["entity_id"] == "acme"

    event_response = await async_client.get(
        "/api/v1/brain/tape/tape:belief:rev_1?organization_id=org_test"
    )
    assert event_response.status_code == 200
    assert event_response.json()["event"]["event_id"] == "tape:belief:rev_1"
    assert event_response.json()["proof_bundle"]["bundle_id"] == "proof:belief:rev_1"
