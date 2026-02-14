from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.agentos.desktop import DesktopActionRequest, DesktopBridgeControlRequest, DesktopBridgeService
from src.kernel.errors import ValidationError


@pytest.mark.asyncio
async def test_execute_action_issues_token_then_executes(monkeypatch) -> None:
    service = DesktopBridgeService()
    request_log: list[dict[str, object]] = []

    async def fake_request_json(**kwargs):
        request_log.append(kwargs)
        if kwargs["path"] == "/v1/bridge/token/issue":
            return {"token": "token_abc"}
        if kwargs["path"] == "/v1/bridge/action":
            return {"ok": True, "result": {"path": "/Users/test/Documents/demo.xlsx"}}
        raise AssertionError(f"Unexpected path {kwargs['path']}")

    monkeypatch.setattr(service, "_request_json", fake_request_json)
    monkeypatch.setattr(
        "src.agentos.desktop.service.get_settings",
        lambda: SimpleNamespace(
            agent_desktop_bridge_url="http://127.0.0.1:43111",
            agent_desktop_allowed_hosts=["127.0.0.1", "localhost"],
            agent_desktop_bridge_bootstrap_secret="bootstrap-secret",
            agent_desktop_bridge_remote_disable_token="disable-secret",
            agent_desktop_request_timeout_seconds=15.0,
        ),
    )
    monkeypatch.setattr("src.agentos.desktop.service.emit_control_plane_audit_event", AsyncMock())
    metrics = SimpleNamespace(
        track_desktop_action=lambda **_kwargs: None,
        track_desktop_control=lambda **_kwargs: None,
    )
    monkeypatch.setattr("src.agentos.desktop.service.get_metrics", lambda: metrics)

    response = await service.execute_action(
        request=DesktopActionRequest(
            organization_id="org_test",
            capability="fs.write",
            payload={"path": "/Users/test/Documents/demo.xlsx", "content": "sheet"},
            token_capabilities=["fs.read"],
        ),
        actor_id="usr_1",
    )

    assert response.organization_id == "org_test"
    assert response.capability == "fs.write"
    assert response.result["path"] == "/Users/test/Documents/demo.xlsx"
    assert len(request_log) == 2
    token_payload = request_log[0]["payload"]
    assert token_payload["capabilities"] == ["fs.read", "fs.write"]


@pytest.mark.asyncio
async def test_execute_action_rejects_non_allowlisted_bridge_host(monkeypatch) -> None:
    service = DesktopBridgeService()
    monkeypatch.setattr(
        "src.agentos.desktop.service.get_settings",
        lambda: SimpleNamespace(
            agent_desktop_bridge_url="http://127.0.0.1:43111",
            agent_desktop_allowed_hosts=["127.0.0.1", "localhost"],
            agent_desktop_bridge_bootstrap_secret="bootstrap-secret",
            agent_desktop_bridge_remote_disable_token="disable-secret",
            agent_desktop_request_timeout_seconds=15.0,
        ),
    )
    monkeypatch.setattr("src.agentos.desktop.service.emit_control_plane_audit_event", AsyncMock())
    metrics = SimpleNamespace(
        track_desktop_action=lambda **_kwargs: None,
        track_desktop_control=lambda **_kwargs: None,
    )
    monkeypatch.setattr("src.agentos.desktop.service.get_metrics", lambda: metrics)

    with pytest.raises(ValidationError) as exc:
        await service.execute_action(
            request=DesktopActionRequest(
                organization_id="org_test",
                capability="app.launch",
                payload={"appName": "Microsoft Excel"},
                bridge_url="http://evil.example.com:43111",
            ),
            actor_id="usr_1",
        )
    assert exc.value.code == "agentos.desktop.bridge_host_not_allowed"


@pytest.mark.asyncio
async def test_disable_bridge_requires_remote_disable_token(monkeypatch) -> None:
    service = DesktopBridgeService()
    monkeypatch.setattr(
        "src.agentos.desktop.service.get_settings",
        lambda: SimpleNamespace(
            agent_desktop_bridge_url="http://127.0.0.1:43111",
            agent_desktop_allowed_hosts=["127.0.0.1", "localhost"],
            agent_desktop_bridge_bootstrap_secret="bootstrap-secret",
            agent_desktop_bridge_remote_disable_token=None,
            agent_desktop_request_timeout_seconds=15.0,
        ),
    )
    monkeypatch.setattr("src.agentos.desktop.service.emit_control_plane_audit_event", AsyncMock())
    metrics = SimpleNamespace(
        track_desktop_action=lambda **_kwargs: None,
        track_desktop_control=lambda **_kwargs: None,
    )
    monkeypatch.setattr("src.agentos.desktop.service.get_metrics", lambda: metrics)

    with pytest.raises(ValidationError) as exc:
        await service.disable_bridge(
            request=DesktopBridgeControlRequest(
                organization_id="org_test",
                reason="security_incident",
            ),
            actor_id="usr_1",
        )
    assert exc.value.code == "agentos.desktop.remote_disable_token_missing"
