from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest

from src.intervention.service import InterventionService


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_propose_and_persist_writes_plan_and_publishes_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = InterventionService("org_test")

    session = AsyncMock()

    @asynccontextmanager
    async def fake_session():
        yield session

    publisher = AsyncMock()
    publisher.publish_world_brain_contract_event = AsyncMock(return_value=True)

    monkeypatch.setattr("src.intervention.service.get_db_session", fake_session)
    monkeypatch.setattr(
        "src.intervention.service.get_event_publisher",
        AsyncMock(return_value=publisher),
    )

    result = await service.propose_and_persist(
        target_ref="entity_1",
        pressure_score=0.8,
        causal_confidence=0.7,
        max_constraint_severity="high",
        recommended_actions=["pause campaign", "notify compliance"],
        persist=True,
        publish_events=True,
    )

    assert result["intervention_id"].startswith("intv_")
    assert result["intervention_hash"]
    assert result["policy_gates"]
    assert session.execute.await_count == 1
    assert publisher.publish_world_brain_contract_event.await_count == 1


async def test_capture_outcome_persists_feedback_and_publishes_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = InterventionService("org_test")

    session = AsyncMock()

    @asynccontextmanager
    async def fake_session():
        yield session

    publisher = AsyncMock()
    publisher.publish_world_brain_contract_event = AsyncMock(return_value=True)

    monkeypatch.setattr("src.intervention.service.get_db_session", fake_session)
    monkeypatch.setattr(
        "src.intervention.service.get_event_publisher",
        AsyncMock(return_value=publisher),
    )

    result = await service.capture_outcome(
        intervention_plan_id="intv_123",
        outcome_type="execution_success",
        outcome_payload={"risk_delta": -0.2},
        persist=True,
        publish_events=True,
    )

    assert result["realized_outcome_id"].startswith("out_")
    assert result["outcome_hash"]
    assert session.execute.await_count == 2
    assert publisher.publish_world_brain_contract_event.await_count == 1
