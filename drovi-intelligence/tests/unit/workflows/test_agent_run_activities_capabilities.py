from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.agentos.browser.models import BrowserActionLogRecord, BrowserSessionRecord
from src.agentos.control_plane.models import PolicyDecisionRecord
from src.contexts.workflows.infrastructure import agent_run_activities as activities

pytest.importorskip("temporalio")
from temporalio.exceptions import ApplicationError  # noqa: E402


def _allow_decision(tool_id: str) -> PolicyDecisionRecord:
    return PolicyDecisionRecord(
        action="allow",
        code="agentos.policy.allowed",
        reason="Allowed",
        reasons=["allowed"],
        tool_id=tool_id,
        organization_id="org_test",
        deployment_id="agdep_1",
        action_tier="low_risk_write",
    )


def _deny_decision(tool_id: str) -> PolicyDecisionRecord:
    return PolicyDecisionRecord(
        action="deny",
        code="agentos.policy.tool_unregistered",
        reason="Tool is not registered",
        reasons=["tool_manifest_missing"],
        tool_id=tool_id,
        organization_id="org_test",
        deployment_id="agdep_1",
        action_tier="low_risk_write",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tool_id", "service_attr", "blocked_methods"),
    [
        ("browser.navigate", "_browser_service", ("create_session", "execute_action")),
        ("desktop.file_write", "_desktop_service", ("execute_action",)),
        ("work_product.deliver", "_work_product_service", ("deliver_work_product", "generate_work_product")),
    ],
)
async def test_execute_step_denial_blocks_action_capabilities(
    monkeypatch,
    tool_id: str,
    service_attr: str,
    blocked_methods: tuple[str, ...],
) -> None:
    policy_engine = SimpleNamespace(decide=AsyncMock(return_value=_deny_decision(tool_id)))
    receipt_service = SimpleNamespace(
        create_receipt=AsyncMock(return_value=SimpleNamespace(id="agrcp_1")),
        finalize_receipt=AsyncMock(),
    )
    approval_service = SimpleNamespace(create_request=AsyncMock())

    service = SimpleNamespace(**{method: AsyncMock() for method in blocked_methods})
    audit_event_mock = AsyncMock()
    run_event_mock = AsyncMock()

    monkeypatch.setattr(activities, "_policy_engine", policy_engine)
    monkeypatch.setattr(activities, "_receipt_service", receipt_service)
    monkeypatch.setattr(activities, "_approval_service", approval_service)
    monkeypatch.setattr(activities, service_attr, service)
    monkeypatch.setattr(activities, "emit_control_plane_audit_event", audit_event_mock)
    monkeypatch.setattr(activities, "emit_run_event", run_event_mock)

    with pytest.raises(ApplicationError) as exc:
        await activities.execute_step(
            {
                "organization_id": "org_test",
                "run_id": "agrun_1",
                "deployment_id": "agdep_1",
                "step_type": "tool_call",
                "payload": {
                    "tool_id": tool_id,
                    "evidence_refs": {"count": 1},
                },
            }
        )

    assert exc.value.type == "policy_block"
    receipt_service.finalize_receipt.assert_awaited_once()
    approval_service.create_request.assert_not_awaited()
    for method in blocked_methods:
        getattr(service, method).assert_not_awaited()

    emitted_actions = [
        str(call.kwargs.get("action", ""))
        for call in audit_event_mock.await_args_list
    ]
    assert "agentos.runtime.action_policy_evaluated" in emitted_actions
    assert "agentos.runtime.action_denied" in emitted_actions
    assert run_event_mock.await_count >= 2


@pytest.mark.asyncio
async def test_execute_step_browser_allow_emits_action_observability(monkeypatch) -> None:
    policy_engine = SimpleNamespace(decide=AsyncMock(return_value=_allow_decision("browser.navigate")))
    receipt_service = SimpleNamespace(
        create_receipt=AsyncMock(return_value=SimpleNamespace(id="agrcp_1")),
        finalize_receipt=AsyncMock(),
    )
    approval_service = SimpleNamespace(create_request=AsyncMock())
    audit_event_mock = AsyncMock()
    run_event_mock = AsyncMock()

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
    monkeypatch.setattr(activities, "emit_control_plane_audit_event", audit_event_mock)
    monkeypatch.setattr(activities, "emit_run_event", run_event_mock)

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
    emitted_actions = [str(call.kwargs.get("action", "")) for call in audit_event_mock.await_args_list]
    assert "agentos.runtime.action_policy_evaluated" in emitted_actions
    assert "agentos.runtime.action_completed" in emitted_actions
    assert run_event_mock.await_count >= 2
