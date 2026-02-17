from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


def _settings_stub() -> SimpleNamespace:
    return SimpleNamespace(
        connector_health_failure_window_minutes=120,
        connector_health_stale_multiplier=3,
        connector_health_stale_floor_minutes=15,
        connector_health_sync_slo_minutes=60,
        connector_health_error_failure_threshold=2,
    )


@pytest.mark.asyncio
async def test_connections_health_endpoint_returns_snapshot(async_client) -> None:
    connection_id = str(uuid4())
    connection = SimpleNamespace(
        id=connection_id,
        organization_id="org_test",
        connector_type="gmail",
        status="connected",
        sync_enabled=True,
        sync_frequency_minutes=5,
        last_sync_at=datetime.now(timezone.utc) - timedelta(minutes=45),
        last_sync_status="success",
        last_sync_error=None,
    )

    connection_result = MagicMock()
    connection_result.scalar_one_or_none.return_value = connection

    session = AsyncMock()
    session.execute = AsyncMock(return_value=connection_result)
    session.scalar = AsyncMock(side_effect=[0, 0])

    @asynccontextmanager
    async def fake_session():
        yield session

    with (
        patch("src.db.client.get_db_session", fake_session),
        patch("src.api.routes.connections.get_settings", _settings_stub),
    ):
        response = await async_client.get(f"/api/v1/connections/{connection_id}/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["connection_id"] == connection_id
    assert payload["connector_type"] == "gmail"
    assert payload["status"] in {"healthy", "stale", "degraded", "error", "recovering"}
    assert payload["reason_code"]
    assert "sync_slo_breached" in payload


@pytest.mark.asyncio
async def test_connections_health_endpoint_404(async_client) -> None:
    connection_result = MagicMock()
    connection_result.scalar_one_or_none.return_value = None
    session = AsyncMock()
    session.execute = AsyncMock(return_value=connection_result)

    @asynccontextmanager
    async def fake_session():
        yield session

    with patch("src.db.client.get_db_session", fake_session):
        response = await async_client.get(
            f"/api/v1/connections/{uuid4()}/health"
        )

    assert response.status_code == 404
