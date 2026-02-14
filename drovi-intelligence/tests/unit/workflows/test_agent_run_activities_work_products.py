from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.agentos.control_plane.models import PolicyDecisionRecord
from src.agentos.work_products.models import WorkProductDeliveryResult, WorkProductRecord
from src.contexts.workflows.infrastructure import agent_run_activities as activities


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


@pytest.mark.asyncio
async def test_execute_step_work_product_generate_completes(monkeypatch) -> None:
    policy_engine = SimpleNamespace(decide=AsyncMock(return_value=_allow_decision("work_product.generate")))
    receipt_service = SimpleNamespace(
        create_receipt=AsyncMock(return_value=SimpleNamespace(id="agrcp_1")),
        finalize_receipt=AsyncMock(),
    )
    work_product_service = SimpleNamespace(
        generate_work_product=AsyncMock(
            return_value=WorkProductRecord(
                id="agwp_1",
                organization_id="org_test",
                run_id="agrun_1",
                product_type="doc",
                title="Generated doc",
                status="generated",
                artifact_ref="evh_1",
                payload={},
                created_at="2026-02-13T00:00:00Z",
                updated_at="2026-02-13T00:00:00Z",
            )
        ),
        deliver_work_product=AsyncMock(),
    )

    monkeypatch.setattr(activities, "_policy_engine", policy_engine)
    monkeypatch.setattr(activities, "_receipt_service", receipt_service)
    monkeypatch.setattr(activities, "_work_product_service", work_product_service)

    result = await activities.execute_step(
        {
            "organization_id": "org_test",
            "run_id": "agrun_1",
            "deployment_id": "agdep_1",
            "step_type": "report",
            "payload": {
                "tool_id": "work_product.generate",
                "work_product_request": {
                    "organization_id": "org_test",
                    "run_id": "agrun_1",
                    "product_type": "doc",
                },
            },
        }
    )

    assert result["status"] == "completed"
    assert result["output"]["work_product_id"] == "agwp_1"
    work_product_service.generate_work_product.assert_awaited_once()
    receipt_service.finalize_receipt.assert_awaited_once()


@pytest.mark.asyncio
async def test_execute_step_work_product_delivery_waiting_approval(monkeypatch) -> None:
    policy_engine = SimpleNamespace(decide=AsyncMock(return_value=_allow_decision("work_product.deliver")))
    receipt_service = SimpleNamespace(
        create_receipt=AsyncMock(return_value=SimpleNamespace(id="agrcp_2")),
        finalize_receipt=AsyncMock(),
    )
    work_product_service = SimpleNamespace(
        generate_work_product=AsyncMock(),
        deliver_work_product=AsyncMock(
            return_value=WorkProductDeliveryResult(
                work_product_id="agwp_1",
                status="pending_approval",
                delivery_channel="email",
                approval_request_id="agapr_1",
                details={"reason": "approval required"},
            )
        ),
    )

    monkeypatch.setattr(activities, "_policy_engine", policy_engine)
    monkeypatch.setattr(activities, "_receipt_service", receipt_service)
    monkeypatch.setattr(activities, "_work_product_service", work_product_service)

    result = await activities.execute_step(
        {
            "organization_id": "org_test",
            "run_id": "agrun_1",
            "deployment_id": "agdep_1",
            "step_type": "commit",
            "payload": {
                "tool_id": "work_product.deliver",
                "work_product_id": "agwp_1",
                "delivery_request": {
                    "organization_id": "org_test",
                    "channel": "email",
                    "approval_tier": "high",
                    "recipients": ["ops@example.com"],
                },
            },
        }
    )

    assert result["status"] == "waiting_approval"
    assert result["approval_request_id"] == "agapr_1"
    work_product_service.deliver_work_product.assert_awaited_once()
    receipt_service.finalize_receipt.assert_awaited_once()


@pytest.mark.asyncio
async def test_execute_step_work_product_delivery_failure_returns_failed(monkeypatch) -> None:
    policy_engine = SimpleNamespace(decide=AsyncMock(return_value=_allow_decision("work_product.deliver")))
    receipt_service = SimpleNamespace(
        create_receipt=AsyncMock(return_value=SimpleNamespace(id="agrcp_3")),
        finalize_receipt=AsyncMock(),
    )
    work_product_service = SimpleNamespace(
        generate_work_product=AsyncMock(),
        deliver_work_product=AsyncMock(
            return_value=WorkProductDeliveryResult(
                work_product_id="agwp_1",
                status="rolled_back",
                delivery_channel="api_action",
                details={"error": "endpoint timeout"},
            )
        ),
    )

    monkeypatch.setattr(activities, "_policy_engine", policy_engine)
    monkeypatch.setattr(activities, "_receipt_service", receipt_service)
    monkeypatch.setattr(activities, "_work_product_service", work_product_service)

    result = await activities.execute_step(
        {
            "organization_id": "org_test",
            "run_id": "agrun_1",
            "deployment_id": "agdep_1",
            "step_type": "commit",
            "payload": {
                "tool_id": "work_product.deliver",
                "work_product_id": "agwp_1",
                "delivery_request": {
                    "organization_id": "org_test",
                    "channel": "api_action",
                    "endpoint": "https://example.com/hook",
                },
            },
        }
    )

    assert result["status"] == "failed"
    assert result["failure_type"] == "work_product_delivery_failed"
    receipt_service.finalize_receipt.assert_awaited_once()
