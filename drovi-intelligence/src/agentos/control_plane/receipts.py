from __future__ import annotations

from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.errors import NotFoundError
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .audit import emit_control_plane_audit_event
from .models import ActionReceiptRecord


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping if hasattr(row, "_mapping") else row)


class ActionReceiptService:
    """Audit receipts for every action-capable tool request."""

    async def create_receipt(
        self,
        *,
        organization_id: str,
        tool_id: str,
        run_id: str | None = None,
        deployment_id: str | None = None,
        request_payload: dict[str, Any] | None = None,
        evidence_refs: dict[str, Any] | None = None,
        policy_result: dict[str, Any] | None = None,
        approval_request_id: str | None = None,
        final_status: str = "created",
        result_payload: dict[str, Any] | None = None,
    ) -> ActionReceiptRecord:
        receipt_id = new_prefixed_id("agrcp")
        now = utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_action_receipt (
                        id, organization_id, run_id, deployment_id, tool_id,
                        request_payload, evidence_refs, policy_result,
                        approval_request_id, final_status, result_payload, created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :run_id, :deployment_id, :tool_id,
                        CAST(:request_payload AS JSONB), CAST(:evidence_refs AS JSONB), CAST(:policy_result AS JSONB),
                        :approval_request_id, :final_status, CAST(:result_payload AS JSONB), :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": receipt_id,
                    "organization_id": organization_id,
                    "run_id": run_id,
                    "deployment_id": deployment_id,
                    "tool_id": tool_id,
                    "request_payload": json_dumps_canonical(request_payload or {}),
                    "evidence_refs": json_dumps_canonical(evidence_refs or {}),
                    "policy_result": json_dumps_canonical(policy_result or {}),
                    "approval_request_id": approval_request_id,
                    "final_status": final_status,
                    "result_payload": json_dumps_canonical(result_payload or {}),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
        await emit_control_plane_audit_event(
            organization_id=organization_id,
            action="agentos.receipt.created",
            actor_id=None,
            resource_type="agent_action_receipt",
            resource_id=receipt_id,
            metadata={
                "tool_id": tool_id,
                "run_id": run_id,
                "deployment_id": deployment_id,
                "approval_request_id": approval_request_id,
                "final_status": final_status,
            },
        )
        return await self.get_receipt(organization_id=organization_id, receipt_id=receipt_id)

    async def get_receipt(self, *, organization_id: str, receipt_id: str) -> ActionReceiptRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, run_id, deployment_id, tool_id,
                           request_payload, evidence_refs, policy_result,
                           approval_request_id, final_status, result_payload, created_at, updated_at
                    FROM agent_action_receipt
                    WHERE id = :id AND organization_id = :organization_id
                    """
                ),
                {"id": receipt_id, "organization_id": organization_id},
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.receipts.not_found",
                message="Action receipt not found",
                meta={"receipt_id": receipt_id},
            )
        return ActionReceiptRecord.model_validate(_row_to_dict(row))

    async def finalize_receipt(
        self,
        *,
        organization_id: str,
        receipt_id: str,
        final_status: str,
        result_payload: dict[str, Any] | None = None,
        approval_request_id: str | None = None,
    ) -> ActionReceiptRecord:
        now = utc_now()
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    UPDATE agent_action_receipt
                    SET final_status = :final_status,
                        result_payload = CAST(:result_payload AS JSONB),
                        approval_request_id = COALESCE(:approval_request_id, approval_request_id),
                        updated_at = :updated_at
                    WHERE id = :id
                      AND organization_id = :organization_id
                    RETURNING id
                    """
                ),
                {
                    "final_status": final_status,
                    "result_payload": json_dumps_canonical(result_payload or {}),
                    "approval_request_id": approval_request_id,
                    "updated_at": now,
                    "id": receipt_id,
                    "organization_id": organization_id,
                },
            )
            row = result.fetchone()
            if row is None:
                raise NotFoundError(
                    code="agentos.receipts.not_found",
                    message="Action receipt not found",
                    meta={"receipt_id": receipt_id},
                )
            await session.commit()
        await emit_control_plane_audit_event(
            organization_id=organization_id,
            action="agentos.receipt.finalized",
            actor_id=None,
            resource_type="agent_action_receipt",
            resource_id=receipt_id,
            metadata={
                "final_status": final_status,
                "approval_request_id": approval_request_id,
            },
        )
        return await self.get_receipt(organization_id=organization_id, receipt_id=receipt_id)

    async def list_receipts(
        self,
        *,
        organization_id: str,
        run_id: str | None = None,
        final_status: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[ActionReceiptRecord]:
        query = """
            SELECT id, organization_id, run_id, deployment_id, tool_id,
                   request_payload, evidence_refs, policy_result,
                   approval_request_id, final_status, result_payload, created_at, updated_at
            FROM agent_action_receipt
            WHERE organization_id = :organization_id
        """
        params: dict[str, Any] = {
            "organization_id": organization_id,
            "limit": max(1, min(limit, 500)),
            "offset": max(0, offset),
        }
        if run_id:
            query += " AND run_id = :run_id"
            params["run_id"] = run_id
        if final_status:
            query += " AND final_status = :final_status"
            params["final_status"] = final_status
        query += " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"

        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()
        return [ActionReceiptRecord.model_validate(_row_to_dict(row)) for row in rows]
