from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.simulation.engine import run_simulation
from src.simulation.models import SimulationOverride, SimulationRequest


@pytest.mark.asyncio
async def test_run_simulation_computes_risk_and_sensitivity():
    now = datetime.utcnow()
    commitments = [
        {"id": "c1", "status": "open", "due_date": now - timedelta(days=1)},
        {"id": "c2", "status": "open", "due_date": now + timedelta(days=10)},
        {"id": "c3", "status": "completed", "due_date": now - timedelta(days=2)},
    ]
    result = MagicMock()
    result.fetchall.return_value = [SimpleNamespace(_mapping=item) for item in commitments]

    session = AsyncMock()
    session.execute.side_effect = [result, AsyncMock()]

    @asynccontextmanager
    async def fake_session():
        yield session

    request = SimulationRequest(
        organization_id="org_1",
        scenario_name="what_if",
        horizon_days=30,
        overrides=SimulationOverride(
            commitment_delays={"c1": 5},
            commitment_cancellations=["c2"],
        ),
    )

    with patch("src.simulation.engine.get_db_session", fake_session):
        response = await run_simulation(request)

    assert response.baseline.open_commitments == 2
    assert response.baseline.overdue_commitments == 1
    assert response.simulated.open_commitments == 1
    assert response.simulated.overdue_commitments == 0
    assert response.delta["risk_score"] < 0
    assert len(response.sensitivity) == 2
    change_types = {item.change_type for item in response.sensitivity}
    assert change_types == {"delay", "cancel"}


@pytest.mark.asyncio
async def test_preview_continuum_returns_schedule_and_snapshot():
    from src.continuum.dsl import ContinuumDefinition
    from src.simulation.engine import preview_continuum

    commitments = [
        {"id": "c1", "status": "open", "due_date": datetime.utcnow() + timedelta(days=5)},
    ]
    result = MagicMock()
    result.fetchall.return_value = [SimpleNamespace(_mapping=item) for item in commitments]

    session = AsyncMock()
    session.execute.side_effect = [result]

    @asynccontextmanager
    async def fake_session():
        yield session

    definition = ContinuumDefinition.model_validate(
        {
            "name": "Renewals Watch",
            "goal": "Track renewals",
            "schedule": {"type": "interval", "interval_minutes": 60},
            "steps": [{"id": "scan", "name": "Scan", "action": "workflow:scan", "inputs": {}}],
        }
    )

    with patch("src.simulation.engine.fetch_continuum_definition", return_value=definition), patch(
        "src.simulation.engine.compute_next_run_at",
        return_value=datetime.utcnow() + timedelta(hours=1),
    ), patch(
        "src.simulation.engine.get_db_session",
        fake_session,
    ):
        preview = await preview_continuum(
            organization_id="org_1",
            continuum_id="cont_1",
            horizon_days=14,
        )

    assert preview.name == "Renewals Watch"
    assert preview.expected_actions == ["workflow:scan"]
    assert preview.schedule["next_run_at"] is not None
    assert preview.risk_snapshot.open_commitments == 1
