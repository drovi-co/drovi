from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from src.connectors.health_monitor import run_connectors_health_monitor

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


def _settings_stub() -> SimpleNamespace:
    return SimpleNamespace(
        connector_health_failure_window_minutes=120,
        connector_health_stale_multiplier=3,
        connector_health_stale_floor_minutes=15,
        connector_health_sync_slo_minutes=60,
        connector_health_error_failure_threshold=2,
        connector_health_auto_recovery_enabled=True,
        connector_health_recovery_cooldown_minutes=30,
    )


@pytest.mark.asyncio
async def test_run_connectors_health_monitor_enqueues_auto_recovery() -> None:
    connection_id = uuid4()
    stale_connection = SimpleNamespace(
        id=connection_id,
        organization_id="org_test",
        connector_type="gmail",
        status="connected",
        sync_enabled=True,
        sync_frequency_minutes=5,
        last_sync_at=datetime.now(timezone.utc) - timedelta(minutes=95),
        last_sync_status="success",
        last_sync_error=None,
    )

    connections_result = MagicMock()
    connections_result.scalars.return_value.all.return_value = [stale_connection]
    failures_result = [SimpleNamespace(connection_id=connection_id, failed_count=0)]
    recovering_result: list[SimpleNamespace] = []

    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[connections_result, failures_result, recovering_result]
    )

    @asynccontextmanager
    async def fake_session():
        yield session

    with (
        patch("src.connectors.health_monitor.get_db_session", fake_session),
        patch("src.connectors.health_monitor.get_settings", _settings_stub),
        patch(
            "src.connectors.health_monitor.get_connector_circuit_breaker_snapshot",
            return_value={},
        ),
        patch(
            "src.connectors.health_monitor.enqueue_job",
            AsyncMock(return_value="job_auto_recover_1"),
        ) as mock_enqueue,
    ):
        result = await run_connectors_health_monitor({"organization_id": "internal"})

    assert result["checked_connections"] == 1
    assert result["alerts"] == 1
    assert result["slo_breaches"] == 1
    assert result["auto_recovery_enqueued"] == 1
    assert mock_enqueue.await_count == 1

    request = mock_enqueue.await_args.args[0]
    assert request.job_type == "connector.sync"
    assert request.organization_id == "org_test"
    assert request.payload["sync_params"]["auto_recovery"] is True


@pytest.mark.asyncio
async def test_run_connectors_health_monitor_empty_scope() -> None:
    connections_result = MagicMock()
    connections_result.scalars.return_value.all.return_value = []
    session = AsyncMock()
    session.execute = AsyncMock(return_value=connections_result)

    @asynccontextmanager
    async def fake_session():
        yield session

    with (
        patch("src.connectors.health_monitor.get_db_session", fake_session),
        patch("src.connectors.health_monitor.get_settings", _settings_stub),
        patch(
            "src.connectors.health_monitor.get_connector_circuit_breaker_snapshot",
            return_value={},
        ),
    ):
        result = await run_connectors_health_monitor({"organization_id": "internal"})

    assert result["checked_connections"] == 0
    assert result["alerts"] == 0
    assert result["auto_recovery_enqueued"] == 0


@pytest.mark.asyncio
async def test_run_connectors_health_monitor_reports_open_provider_circuits() -> None:
    connection_id = uuid4()
    healthy_connection = SimpleNamespace(
        id=connection_id,
        organization_id="org_test",
        connector_type="gmail",
        status="connected",
        sync_enabled=True,
        sync_frequency_minutes=5,
        last_sync_at=datetime.now(timezone.utc) - timedelta(minutes=2),
        last_sync_status="success",
        last_sync_error=None,
    )

    connections_result = MagicMock()
    connections_result.scalars.return_value.all.return_value = [healthy_connection]
    failures_result = [SimpleNamespace(connection_id=connection_id, failed_count=0)]
    recovering_result: list[SimpleNamespace] = []

    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[connections_result, failures_result, recovering_result]
    )

    @asynccontextmanager
    async def fake_session():
        yield session

    with (
        patch("src.connectors.health_monitor.get_db_session", fake_session),
        patch("src.connectors.health_monitor.get_settings", _settings_stub),
        patch(
            "src.connectors.health_monitor.get_connector_circuit_breaker_snapshot",
            return_value={"provider:gmail": {"is_open": True}},
        ),
        patch("src.connectors.health_monitor.enqueue_job", AsyncMock(return_value="job_x")),
    ):
        result = await run_connectors_health_monitor({"organization_id": "internal"})

    assert result["checked_connections"] == 1
    assert result["provider_circuit_open_count"] == 1
    assert result["provider_circuit_open_types"] == ["gmail"]
    assert result["alerts"] == 1
