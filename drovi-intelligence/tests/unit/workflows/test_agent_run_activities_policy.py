from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

temporalio = pytest.importorskip("temporalio")
from temporalio.exceptions import ApplicationError  # noqa: E402

from src.agentos.control_plane.models import PolicyDecisionRecord
from src.contexts.workflows.infrastructure import agent_run_activities as activities


@pytest.mark.asyncio
async def test_execute_step_denied_tool_from_tool_invocation_path(monkeypatch) -> None:
    decision = PolicyDecisionRecord(
        action="deny",
        code="agentos.policy.tool_unregistered",
        reason="Tool is not registered",
        reasons=["tool_manifest_missing"],
        tool_id="undocumented.tool",
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

    monkeypatch.setattr(activities, "_policy_engine", policy_engine)
    monkeypatch.setattr(activities, "_receipt_service", receipt_service)
    monkeypatch.setattr(activities, "_approval_service", approval_service)

    with pytest.raises(ApplicationError) as exc:
        await activities.execute_step(
            {
                "organization_id": "org_test",
                "run_id": "agrun_1",
                "deployment_id": "agdep_1",
                "step_type": "report",
                "payload": {
                    "tool_invocations": [{"tool_id": "undocumented.tool"}],
                    "evidence_refs": {"count": 2},
                },
            }
        )

    assert exc.value.type == "policy_block"
    receipt_service.finalize_receipt.assert_awaited_once()
    approval_service.create_request.assert_not_awaited()


@pytest.mark.asyncio
async def test_execute_step_require_approval_returns_waiting_state(monkeypatch) -> None:
    decision = PolicyDecisionRecord(
        action="require_approval",
        code="agentos.policy.requires_approval",
        reason="Needs approval",
        reasons=["org_overlay_requires_approval"],
        tool_id="email.send",
        organization_id="org_test",
        deployment_id="agdep_1",
        action_tier="external_commit",
    )
    policy_engine = SimpleNamespace(decide=AsyncMock(return_value=decision))
    receipt_service = SimpleNamespace(
        create_receipt=AsyncMock(return_value=SimpleNamespace(id="agrcp_2")),
        finalize_receipt=AsyncMock(),
    )
    approval_service = SimpleNamespace(
        create_request=AsyncMock(return_value=SimpleNamespace(id="agapr_1", reason="Needs approval"))
    )

    monkeypatch.setattr(activities, "_policy_engine", policy_engine)
    monkeypatch.setattr(activities, "_receipt_service", receipt_service)
    monkeypatch.setattr(activities, "_approval_service", approval_service)

    result = await activities.execute_step(
        {
            "organization_id": "org_test",
            "run_id": "agrun_1",
            "deployment_id": "agdep_1",
            "step_type": "tool_call",
            "payload": {"tool_id": "email.send", "evidence_refs": {"count": 1}},
        }
    )

    assert result["status"] == "waiting_approval"
    assert result["approval_request_id"] == "agapr_1"
    assert result["action_receipt_id"] == "agrcp_2"
    approval_service.create_request.assert_awaited_once()
    receipt_service.finalize_receipt.assert_awaited_once()


@pytest.mark.asyncio
async def test_execute_step_allow_finalizes_receipt(monkeypatch) -> None:
    decision = PolicyDecisionRecord(
        action="allow",
        code="agentos.policy.allowed",
        reason="Allowed",
        reasons=["allowed"],
        tool_id="crm.update",
        organization_id="org_test",
        deployment_id="agdep_1",
        action_tier="low_risk_write",
    )
    policy_engine = SimpleNamespace(decide=AsyncMock(return_value=decision))
    receipt_service = SimpleNamespace(
        create_receipt=AsyncMock(return_value=SimpleNamespace(id="agrcp_3")),
        finalize_receipt=AsyncMock(),
    )
    approval_service = SimpleNamespace(create_request=AsyncMock())

    monkeypatch.setattr(activities, "_policy_engine", policy_engine)
    monkeypatch.setattr(activities, "_receipt_service", receipt_service)
    monkeypatch.setattr(activities, "_approval_service", approval_service)

    result = await activities.execute_step(
        {
            "organization_id": "org_test",
            "run_id": "agrun_1",
            "deployment_id": "agdep_1",
            "step_type": "tool_call",
            "payload": {"tool_id": "crm.update", "evidence_refs": {"count": 1}},
        }
    )

    assert result["status"] == "completed"
    assert result["action_receipt_id"] == "agrcp_3"
    receipt_service.finalize_receipt.assert_awaited_once()
    approval_service.create_request.assert_not_awaited()
