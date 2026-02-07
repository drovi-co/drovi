from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.api.routes.auth import require_pilot_auth
from src.auth.pilot_accounts import PilotToken

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def _pilot_token(*, role: str = "pilot_member", org_id: str = "org_test", user_id: str = "user_test") -> PilotToken:
    now = datetime.now(timezone.utc)
    return PilotToken(
        sub=user_id,
        org_id=org_id,
        role=role,
        email="pilot@example.com",
        iat=now,
        exp=now + timedelta(hours=1),
    )


class TestConnectorList:
    async def test_list_connectors_includes_configured_and_missing_env(self, async_client):
        # Don't couple this contract test to the local docker env (which may have
        # real OAuth creds set). We patch settings to simulate an unconfigured
        # Gmail connector and validate the API shape + missing env reporting.
        settings_stub = SimpleNamespace(
            google_client_id=None,
            google_client_secret=None,
        )

        with patch("src.api.routes.connections.get_settings", return_value=settings_stub):
            response = await async_client.get("/api/v1/connections/connectors")

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data.get("connectors"), list)
        assert any(conn.get("type") == "gmail" for conn in data["connectors"])

        gmail = next(conn for conn in data["connectors"] if conn.get("type") == "gmail")
        assert gmail["configured"] is False
        assert "GOOGLE_CLIENT_ID" in gmail["missing_env"]
        assert "GOOGLE_CLIENT_SECRET" in gmail["missing_env"]


class TestPilotConnect:
    async def test_connect_returns_400_when_connector_not_configured(self, app, async_client):
        token = _pilot_token()

        async def fake_pilot_auth():
            return token

        app.dependency_overrides[require_pilot_auth] = fake_pilot_auth

        # As above, make the behavior deterministic: force Gmail to be treated as
        # unconfigured so the endpoint fails before touching Redis.
        settings_stub = SimpleNamespace(
            google_client_id=None,
            google_client_secret=None,
        )

        with patch("src.api.routes.org.get_settings", return_value=settings_stub):
            response = await async_client.post(
                "/api/v1/org/connections/gmail/connect",
                json={"redirect_uri": "http://localhost/callback"},
            )

        assert response.status_code == 400
        detail = response.json().get("detail") or ""
        assert "not configured" in detail.lower()
        assert "GOOGLE_CLIENT_ID" in detail
        assert "GOOGLE_CLIENT_SECRET" in detail


class TestPilotBackfill:
    async def test_trigger_backfill_enqueues_job(self, app, async_client):
        token = _pilot_token()

        async def fake_pilot_auth():
            return token

        app.dependency_overrides[require_pilot_auth] = fake_pilot_auth

        fake_session = AsyncMock()

        @asynccontextmanager
        async def fake_get_db_session():
            yield fake_session

        fake_connection = MagicMock()
        fake_connection.id = "conn_1"
        fake_connection.status = "active"

        with patch("src.api.routes.org.get_db_session", fake_get_db_session), patch(
            "src.api.routes.org._require_connection_access",
            AsyncMock(return_value=fake_connection),
        ), patch(
            "src.jobs.queue.enqueue_job",
            AsyncMock(return_value="job_123"),
        ) as mock_enqueue:
            response = await async_client.post(
                "/api/v1/org/connections/conn_1/backfill",
                json={
                    "start_date": "2026-02-01T00:00:00Z",
                    "end_date": "2026-02-02T00:00:00Z",
                    "window_days": 7,
                    "streams": [],
                    "throttle_seconds": 0.5,
                },
            )

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "queued"
        assert data["backfill_jobs"] == ["job_123"]

        args, _kwargs = mock_enqueue.await_args
        request = args[0]
        assert request.organization_id == token.org_id
        assert request.job_type == "connector.backfill_plan"
        assert request.payload["connection_id"] == "conn_1"
