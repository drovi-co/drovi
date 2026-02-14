from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.agentos.control_plane.models import PolicyDecisionRecord
from src.agentos.desktop.models import DesktopActionResponse

pytest.importorskip("temporalio")

from src.contexts.workflows.infrastructure import agent_run_activities as activities


@pytest.mark.asyncio
async def test_execute_step_desktop_tool_calls_desktop_service(monkeypatch) -> None:
    decision = PolicyDecisionRecord(
        action="allow",
        code="agentos.policy.allowed",
        reason="Allowed",
        reasons=["allowed"],
        tool_id="desktop.fs.write",
        organization_id="org_test",
        deployment_id="agdep_1",
        action_tier="low_risk_write",
    )
    policy_engine = SimpleNamespace(decide=AsyncMock(return_value=decision))
    receipt_service = SimpleNamespace(
        create_receipt=AsyncMock(return_value=SimpleNamespace(id="agrcp_1")),
        finalize_receipt=AsyncMock(),
    )
    approval_service = SimpleNamespace(create_request=AsyncMock())
    desktop_service = SimpleNamespace(
        execute_action=AsyncMock(
            return_value=DesktopActionResponse(
                organization_id="org_test",
                bridge_url="http://127.0.0.1:43111",
                capability="fs.write",
                result={"path": "/tmp/demo.txt"},
                latency_ms=22,
                token_expires_in_seconds=120,
                metadata={},
            )
        )
    )

    monkeypatch.setattr(activities, "_policy_engine", policy_engine)
    monkeypatch.setattr(activities, "_receipt_service", receipt_service)
    monkeypatch.setattr(activities, "_approval_service", approval_service)
    monkeypatch.setattr(activities, "_desktop_service", desktop_service)

    result = await activities.execute_step(
        {
            "organization_id": "org_test",
            "run_id": "agrun_1",
            "deployment_id": "agdep_1",
            "step_type": "tool_call",
            "payload": {
                "tool_id": "desktop.fs.write",
                "desktop_request": {
                    "payload": {"path": "/tmp/demo.txt", "content": "hello"},
                },
            },
        }
    )

    assert result["status"] == "completed"
    assert result["output"]["capability"] == "fs.write"
    assert result["output"]["result"]["path"] == "/tmp/demo.txt"
    desktop_service.execute_action.assert_awaited_once()
