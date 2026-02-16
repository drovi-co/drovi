from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.agentos.work_products.models import WorkProductDeliveryRequest, WorkProductRecord
from src.agentos.work_products.service import WorkProductService


def _record(*, status: str = "generated") -> WorkProductRecord:
    return WorkProductRecord(
        id="agwp_1",
        organization_id="org_test",
        run_id="agrun_1",
        product_type="doc",
        title="Advice timeline",
        status=status,  # type: ignore[arg-type]
        artifact_ref="evh_1",
        payload={"rendered": {"text": "hello"}},
        created_at="2026-02-13T00:00:00Z",
        updated_at="2026-02-13T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_deliver_work_product_returns_pending_approval(monkeypatch) -> None:
    service = WorkProductService()
    audit_mock = AsyncMock()
    monkeypatch.setattr(service, "get_work_product", AsyncMock(return_value=_record()))
    update_mock = AsyncMock()
    monkeypatch.setattr(service, "_update_work_product", update_mock)
    monkeypatch.setattr("src.agentos.work_products.service.emit_control_plane_audit_event", audit_mock)
    monkeypatch.setattr(
        service,
        "_approval_service",
        SimpleNamespace(create_request=AsyncMock(return_value=SimpleNamespace(id="agapr_1"))),
    )

    result = await service.deliver_work_product(
        work_product_id="agwp_1",
        request=WorkProductDeliveryRequest(
            organization_id="org_test",
            channel="email",
            approval_tier="high",
            recipients=["ops@example.com"],
        ),
        actor_id="user_a",
    )

    assert result.status == "pending_approval"
    assert result.approval_request_id == "agapr_1"
    update_mock.assert_awaited_once()
    assert update_mock.await_args.kwargs["status"] == "pending_approval"
    assert audit_mock.await_args.kwargs["action"] == "agentos.work_product.delivery_pending_approval"


@pytest.mark.asyncio
async def test_deliver_work_product_success_marks_delivered(monkeypatch) -> None:
    service = WorkProductService()
    audit_mock = AsyncMock()
    monkeypatch.setattr(service, "get_work_product", AsyncMock(return_value=_record()))
    update_mock = AsyncMock()
    monkeypatch.setattr(service, "_update_work_product", update_mock)
    monkeypatch.setattr(service, "_deliver", AsyncMock(return_value={"ticket_id": "agtk_1"}))
    monkeypatch.setattr("src.agentos.work_products.service.emit_control_plane_audit_event", audit_mock)

    result = await service.deliver_work_product(
        work_product_id="agwp_1",
        request=WorkProductDeliveryRequest(
            organization_id="org_test",
            channel="project_ticket",
            approval_tier="medium",
        ),
        actor_id="user_a",
    )

    assert result.status == "delivered"
    assert result.details["ticket_id"] == "agtk_1"
    update_mock.assert_awaited_once()
    assert update_mock.await_args.kwargs["status"] == "delivered"
    assert audit_mock.await_args.kwargs["action"] == "agentos.work_product.delivered"


@pytest.mark.asyncio
async def test_deliver_work_product_failure_rolls_back_by_default(monkeypatch) -> None:
    service = WorkProductService()
    audit_mock = AsyncMock()
    monkeypatch.setattr(service, "get_work_product", AsyncMock(return_value=_record()))
    update_mock = AsyncMock()
    monkeypatch.setattr(service, "_update_work_product", update_mock)
    monkeypatch.setattr(service, "_deliver", AsyncMock(side_effect=RuntimeError("delivery exploded")))
    monkeypatch.setattr("src.agentos.work_products.service.emit_control_plane_audit_event", audit_mock)

    result = await service.deliver_work_product(
        work_product_id="agwp_1",
        request=WorkProductDeliveryRequest(
            organization_id="org_test",
            channel="api_action",
            endpoint="https://example.com/hook",
            approval_tier="medium",
            rollback_on_failure=True,
        ),
        actor_id="user_a",
    )

    assert result.status == "rolled_back"
    assert "delivery exploded" in result.details["error"]
    update_mock.assert_awaited_once()
    assert update_mock.await_args.kwargs["status"] == "rolled_back"
    assert audit_mock.await_args.kwargs["action"] == "agentos.work_product.delivery_rolled_back"


@pytest.mark.asyncio
async def test_deliver_work_product_failure_can_mark_failed(monkeypatch) -> None:
    service = WorkProductService()
    audit_mock = AsyncMock()
    monkeypatch.setattr(service, "get_work_product", AsyncMock(return_value=_record()))
    update_mock = AsyncMock()
    monkeypatch.setattr(service, "_update_work_product", update_mock)
    monkeypatch.setattr(service, "_deliver", AsyncMock(side_effect=RuntimeError("endpoint timeout")))
    monkeypatch.setattr("src.agentos.work_products.service.emit_control_plane_audit_event", audit_mock)

    result = await service.deliver_work_product(
        work_product_id="agwp_1",
        request=WorkProductDeliveryRequest(
            organization_id="org_test",
            channel="api_action",
            endpoint="https://example.com/hook",
            approval_tier="medium",
            rollback_on_failure=False,
        ),
        actor_id="user_a",
    )

    assert result.status == "failed"
    assert "endpoint timeout" in result.details["error"]
    update_mock.assert_awaited_once()
    assert update_mock.await_args.kwargs["status"] == "failed"
    assert audit_mock.await_args.kwargs["action"] == "agentos.work_product.delivery_failed"
