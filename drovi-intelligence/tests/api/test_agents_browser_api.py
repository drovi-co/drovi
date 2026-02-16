from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from src.agentos.browser.models import BrowserActionLogRecord, BrowserSessionRecord

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def _session() -> BrowserSessionRecord:
    now = datetime(2026, 2, 13, tzinfo=timezone.utc)
    return BrowserSessionRecord(
        id="agbrs_1",
        organization_id="org_test",
        provider="local",
        status="active",
        current_url="https://example.com",
        state={"provider_session_id": "local:agbrs_1"},
        artifacts={},
        metadata={},
        created_at=now,
        updated_at=now,
        last_active_at=now,
    )


def _action_log() -> BrowserActionLogRecord:
    now = datetime(2026, 2, 13, tzinfo=timezone.utc)
    return BrowserActionLogRecord(
        id="agbra_1",
        session_id="agbrs_1",
        organization_id="org_test",
        action_type="navigate",
        status="ok",
        request_payload={"url": "https://example.com"},
        response_payload={"status": "ok"},
        created_at=now,
    )


class TestBrowserSessionApis:
    async def test_create_session(self, async_client):
        with patch("src.api.routes.agents_browser._service.create_session", AsyncMock(return_value=_session())):
            response = await async_client.post(
                "/api/v1/agents/browser/sessions",
                json={
                    "organization_id": "org_test",
                    "provider": "local",
                    "initial_url": "https://example.com",
                },
            )
        assert response.status_code == 200
        assert response.json()["id"] == "agbrs_1"

    async def test_execute_action(self, async_client):
        with patch(
            "src.api.routes.agents_browser._service.execute_action",
            AsyncMock(return_value={"session": _session().model_dump(mode="json"), "action_log": _action_log().model_dump(mode="json")}),
        ):
            response = await async_client.post(
                "/api/v1/agents/browser/sessions/agbrs_1/actions",
                json={
                    "organization_id": "org_test",
                    "action": "navigate",
                    "url": "https://example.com",
                },
            )
        assert response.status_code == 200
        body = response.json()
        assert body["session"]["id"] == "agbrs_1"
        assert body["action_log"]["id"] == "agbra_1"

    async def test_list_secrets(self, async_client):
        with patch(
            "src.api.routes.agents_browser._service.list_secrets",
            AsyncMock(return_value=[]),
        ):
            response = await async_client.get("/api/v1/agents/browser/secrets", params={"organization_id": "org_test"})
        assert response.status_code == 200
        assert response.json() == []
