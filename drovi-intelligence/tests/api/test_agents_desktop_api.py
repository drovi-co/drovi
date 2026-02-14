from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from src.agentos.desktop.models import (
    DesktopActionResponse,
    DesktopBridgeControlResponse,
    DesktopBridgeHealthResponse,
)

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


class TestDesktopBridgeApis:
    async def test_execute_desktop_action(self, async_client):
        response_model = DesktopActionResponse(
            organization_id="org_test",
            bridge_url="http://127.0.0.1:43111",
            capability="fs.write",
            result={"path": "/tmp/demo.txt"},
            latency_ms=14,
            token_expires_in_seconds=120,
            metadata={},
        )
        with patch(
            "src.api.routes.agents_desktop._service.execute_action",
            AsyncMock(return_value=response_model),
        ):
            response = await async_client.post(
                "/api/v1/agents/desktop/actions",
                json={
                    "organization_id": "org_test",
                    "capability": "fs.write",
                    "payload": {"path": "/tmp/demo.txt", "content": "hello"},
                },
            )
        assert response.status_code == 200
        body = response.json()
        assert body["capability"] == "fs.write"
        assert body["result"]["path"] == "/tmp/demo.txt"

    async def test_desktop_health(self, async_client):
        response_model = DesktopBridgeHealthResponse(
            status="ok",
            bridge_url="http://127.0.0.1:43111",
            app_version="0.1.0",
            remote_disabled=False,
            mtls=False,
            raw={"status": "ok"},
        )
        with patch(
            "src.api.routes.agents_desktop._service.health",
            AsyncMock(return_value=response_model),
        ):
            response = await async_client.post(
                "/api/v1/agents/desktop/health",
                json={"organization_id": "org_test"},
            )
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    async def test_disable_desktop_bridge(self, async_client):
        response_model = DesktopBridgeControlResponse(
            ok=True,
            bridge_url="http://127.0.0.1:43111",
            remote_disabled=True,
            raw={"ok": True, "remote_disabled": True},
        )
        with patch(
            "src.api.routes.agents_desktop._service.disable_bridge",
            AsyncMock(return_value=response_model),
        ):
            response = await async_client.post(
                "/api/v1/agents/desktop/control/disable",
                json={"organization_id": "org_test", "reason": "test"},
            )
        assert response.status_code == 200
        assert response.json()["remote_disabled"] is True
