from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.agentos.browser.models import BrowserActionLogRecord, BrowserSessionRecord
from src.agentos.control_plane.models import PolicyDecisionRecord

pytest.importorskip("temporalio")

from src.contexts.workflows.infrastructure import agent_run_activities as activities


@pytest.mark.asyncio
async def test_execute_step_browser_tool_calls_browser_service(monkeypatch) -> None:
    decision = PolicyDecisionRecord(
        action="allow",
        code="agentos.policy.allowed",
        reason="Allowed",
        reasons=["allowed"],
        tool_id="browser.navigate",
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
    now = datetime(2026, 2, 13, tzinfo=timezone.utc)
    browser_session = BrowserSessionRecord(
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
    browser_action_log = BrowserActionLogRecord(
        id="agbra_1",
        session_id="agbrs_1",
        organization_id="org_test",
        action_type="navigate",
        status="ok",
        request_payload={"url": "https://example.com"},
        response_payload={"ok": True},
        created_at=now,
    )
    browser_service = SimpleNamespace(
        create_session=AsyncMock(return_value=browser_session),
        execute_action=AsyncMock(
            return_value=SimpleNamespace(
                session=browser_session,
                action_log=browser_action_log,
            )
        ),
    )

    monkeypatch.setattr(activities, "_policy_engine", policy_engine)
    monkeypatch.setattr(activities, "_receipt_service", receipt_service)
    monkeypatch.setattr(activities, "_approval_service", approval_service)
    monkeypatch.setattr(activities, "_browser_service", browser_service)

    result = await activities.execute_step(
        {
            "organization_id": "org_test",
            "run_id": "agrun_1",
            "deployment_id": "agdep_1",
            "step_type": "tool_call",
            "payload": {
                "tool_id": "browser.navigate",
                "url": "https://example.com",
            },
        }
    )

    assert result["status"] == "completed"
    assert result["output"]["browser_session_id"] == "agbrs_1"
    assert result["output"]["browser_action_log_id"] == "agbra_1"
    browser_service.create_session.assert_awaited_once()
    browser_service.execute_action.assert_awaited_once()
