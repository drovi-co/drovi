from __future__ import annotations

from datetime import timedelta
from typing import Any, Literal

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.errors import NotFoundError, ValidationError
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .models import ApprovalRequestRecord, ToolSideEffectTier

ApprovalDecision = Literal["approved", "denied"]
ApprovalStatus = Literal["pending", "approved", "denied", "expired", "escalated"]


def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping if hasattr(row, "_mapping") else row)


class ApprovalService:
    """Persistence + workflow helpers for high-risk action approvals."""

    async def create_request(
        self,
        *,
        organization_id: str,
        tool_id: str,
        action_tier: ToolSideEffectTier,
        run_id: str | None = None,
        deployment_id: str | None = None,
        reason: str | None = None,
        requested_by: str | None = None,
        sla_minutes: int = 15,
        escalation_path: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ApprovalRequestRecord:
        request_id = new_prefixed_id("agapr")
        now = utc_now()
        due_at = now + timedelta(minutes=max(1, sla_minutes))
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_action_approval (
                        id, organization_id, run_id, deployment_id, tool_id, action_tier,
                        reason, status, requested_by, requested_at, sla_due_at, escalation_path, metadata
                    ) VALUES (
                        :id, :organization_id, :run_id, :deployment_id, :tool_id, :action_tier,
                        :reason, 'pending', :requested_by, :requested_at, :sla_due_at,
                        CAST(:escalation_path AS JSONB), CAST(:metadata AS JSONB)
                    )
                    """
                ),
                {
                    "id": request_id,
                    "organization_id": organization_id,
                    "run_id": run_id,
                    "deployment_id": deployment_id,
                    "tool_id": tool_id,
                    "action_tier": action_tier,
                    "reason": reason,
                    "requested_by": requested_by,
                    "requested_at": now,
                    "sla_due_at": due_at,
                    "escalation_path": json_dumps_canonical(escalation_path or {}),
                    "metadata": json_dumps_canonical(metadata or {}),
                },
            )
            await session.commit()
        return await self.get_request(organization_id=organization_id, approval_id=request_id)

    async def get_request(self, *, organization_id: str, approval_id: str) -> ApprovalRequestRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, run_id, deployment_id, tool_id, action_tier,
                           reason, status, requested_by, requested_at, sla_due_at,
                           escalation_path, approver_id, approval_reason, decided_at, metadata
                    FROM agent_action_approval
                    WHERE id = :id AND organization_id = :organization_id
                    """
                ),
                {"id": approval_id, "organization_id": organization_id},
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.approvals.not_found",
                message="Approval request not found",
                meta={"approval_id": approval_id},
            )
        return ApprovalRequestRecord.model_validate(_row_to_dict(row))

    async def list_requests(
        self,
        *,
        organization_id: str,
        status: ApprovalStatus | None = None,
        run_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[ApprovalRequestRecord]:
        query = """
            SELECT id, organization_id, run_id, deployment_id, tool_id, action_tier,
                   reason, status, requested_by, requested_at, sla_due_at,
                   escalation_path, approver_id, approval_reason, decided_at, metadata
            FROM agent_action_approval
            WHERE organization_id = :organization_id
        """
        params: dict[str, Any] = {
            "organization_id": organization_id,
            "limit": max(1, min(limit, 500)),
            "offset": max(0, offset),
        }
        if status:
            query += " AND status = :status"
            params["status"] = status
        if run_id:
            query += " AND run_id = :run_id"
            params["run_id"] = run_id
        query += " ORDER BY requested_at DESC LIMIT :limit OFFSET :offset"

        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()
        return [ApprovalRequestRecord.model_validate(_row_to_dict(row)) for row in rows]

    async def decide_request(
        self,
        *,
        organization_id: str,
        approval_id: str,
        decision: ApprovalDecision,
        approver_id: str | None,
        reason: str | None = None,
    ) -> ApprovalRequestRecord:
        if decision not in {"approved", "denied"}:
            raise ValidationError(
                code="agentos.approvals.invalid_decision",
                message=f"Unsupported approval decision: {decision}",
            )
        current = await self.get_request(organization_id=organization_id, approval_id=approval_id)
        if current.status not in {"pending", "escalated"}:
            raise ValidationError(
                code="agentos.approvals.invalid_state",
                message=f"Cannot decide approval in status `{current.status}`",
                meta={"approval_id": approval_id, "status": current.status},
            )

        now = utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    UPDATE agent_action_approval
                    SET status = :status,
                        approver_id = :approver_id,
                        approval_reason = :approval_reason,
                        decided_at = :decided_at
                    WHERE id = :id
                      AND organization_id = :organization_id
                    """
                ),
                {
                    "status": decision,
                    "approver_id": approver_id,
                    "approval_reason": reason,
                    "decided_at": now,
                    "id": approval_id,
                    "organization_id": organization_id,
                },
            )
            await session.commit()
        return await self.get_request(organization_id=organization_id, approval_id=approval_id)

    async def escalate_overdue(self, *, organization_id: str) -> int:
        now = utc_now()
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    UPDATE agent_action_approval
                    SET status = 'escalated',
                        metadata = COALESCE(metadata, '{}'::jsonb) || CAST(:metadata AS JSONB)
                    WHERE organization_id = :organization_id
                      AND status = 'pending'
                      AND sla_due_at IS NOT NULL
                      AND sla_due_at < :now
                    """
                ),
                {
                    "organization_id": organization_id,
                    "now": now,
                    "metadata": json_dumps_canonical({"escalated_at": now.isoformat()}),
                },
            )
            await session.commit()
        return int(result.rowcount or 0)
