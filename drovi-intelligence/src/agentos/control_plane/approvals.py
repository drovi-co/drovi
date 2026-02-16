from __future__ import annotations

from datetime import timedelta
from typing import Any, Literal

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.errors import NotFoundError, ValidationError
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .audit import emit_control_plane_audit_event
from .models import ApprovalDecisionRecord, ApprovalRequestRecord, ToolSideEffectTier

ApprovalDecision = Literal["approved", "denied"]
ApprovalStatus = Literal["pending", "approved", "denied", "expired", "escalated"]



def _row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping if hasattr(row, "_mapping") else row)



def _normalize_chain_mode(chain_mode: str, required_approvals: int) -> str:
    mode = str(chain_mode or "single").strip().lower()
    if mode not in {"single", "multi"}:
        raise ValidationError(
            code="agentos.approvals.invalid_chain_mode",
            message=f"Unsupported chain mode: {chain_mode}",
        )
    if required_approvals > 1:
        return "multi"
    return mode



def _normalize_approval_chain(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError(
            code="agentos.approvals.invalid_chain",
            message="approval_chain must be a list",
        )
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            raise ValidationError(
                code="agentos.approvals.invalid_chain_entry",
                message="Each approval chain step must be an object",
                meta={"index": index},
            )
        step_index = int(item.get("step_index") or index)
        if step_index <= 0:
            raise ValidationError(
                code="agentos.approvals.invalid_chain_step_index",
                message="approval_chain.step_index must be > 0",
                meta={"index": index},
            )
        required = int(item.get("required_approvals") or 1)
        if required <= 0:
            raise ValidationError(
                code="agentos.approvals.invalid_chain_required_approvals",
                message="approval_chain.required_approvals must be > 0",
                meta={"index": index},
            )
        approver_ids_raw = item.get("approver_ids") or []
        if not isinstance(approver_ids_raw, list):
            raise ValidationError(
                code="agentos.approvals.invalid_chain_approver_ids",
                message="approval_chain.approver_ids must be a list",
                meta={"index": index},
            )
        approver_ids = sorted(
            {
                str(approver_id).strip()
                for approver_id in approver_ids_raw
                if str(approver_id or "").strip()
            }
        )
        normalized.append(
            {
                "step_index": step_index,
                "required_approvals": required,
                "approver_ids": approver_ids,
                "sla_minutes": int(item.get("sla_minutes") or 0) or None,
                "metadata": item.get("metadata") if isinstance(item.get("metadata"), dict) else {},
            }
        )
    normalized.sort(key=lambda step: int(step["step_index"]))
    return normalized



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
        chain_mode: str = "single",
        required_approvals: int = 1,
        approval_chain: list[dict[str, Any]] | None = None,
    ) -> ApprovalRequestRecord:
        request_id = new_prefixed_id("agapr")
        now = utc_now()
        due_at = now + timedelta(minutes=max(1, sla_minutes))
        normalized_chain = _normalize_approval_chain(approval_chain)
        normalized_required_approvals = max(1, int(required_approvals or 1))
        if normalized_chain and normalized_required_approvals == 1:
            normalized_required_approvals = sum(int(step.get("required_approvals") or 1) for step in normalized_chain)
        normalized_chain_mode = _normalize_chain_mode(chain_mode, normalized_required_approvals)

        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_action_approval (
                        id, organization_id, run_id, deployment_id, tool_id, action_tier,
                        reason, status, chain_mode, required_approvals, approval_chain,
                        approvals_received, decision_summary,
                        requested_by, requested_at, sla_due_at, escalation_path, metadata
                    ) VALUES (
                        :id, :organization_id, :run_id, :deployment_id, :tool_id, :action_tier,
                        :reason, 'pending', :chain_mode, :required_approvals,
                        CAST(:approval_chain AS JSONB), 0,
                        CAST(:decision_summary AS JSONB),
                        :requested_by, :requested_at, :sla_due_at,
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
                    "chain_mode": normalized_chain_mode,
                    "required_approvals": normalized_required_approvals,
                    "approval_chain": json_dumps_canonical(normalized_chain),
                    "decision_summary": json_dumps_canonical(
                        {
                            "approved_by": [],
                            "denied_by": [],
                            "last_decision": None,
                        }
                    ),
                    "requested_by": requested_by,
                    "requested_at": now,
                    "sla_due_at": due_at,
                    "escalation_path": json_dumps_canonical(escalation_path or {}),
                    "metadata": json_dumps_canonical(metadata or {}),
                },
            )
            await session.commit()

        await emit_control_plane_audit_event(
            organization_id=organization_id,
            action="agentos.approval.created",
            actor_id=requested_by,
            resource_type="agent_action_approval",
            resource_id=request_id,
            metadata={
                "tool_id": tool_id,
                "run_id": run_id,
                "chain_mode": normalized_chain_mode,
                "required_approvals": normalized_required_approvals,
            },
        )
        return await self.get_request(organization_id=organization_id, approval_id=request_id)

    async def get_request(self, *, organization_id: str, approval_id: str) -> ApprovalRequestRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, run_id, deployment_id, tool_id, action_tier,
                           reason, status, chain_mode, required_approvals, approval_chain,
                           approvals_received, decision_summary,
                           requested_by, requested_at, sla_due_at,
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
                   reason, status, chain_mode, required_approvals, approval_chain,
                   approvals_received, decision_summary,
                   requested_by, requested_at, sla_due_at,
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
        decision_id = new_prefixed_id("agapd")
        async with get_db_session() as session:
            if approver_id and decision == "approved":
                duplicate_check = await session.execute(
                    text(
                        """
                        SELECT id
                        FROM agent_action_approval_decision
                        WHERE organization_id = :organization_id
                          AND approval_id = :approval_id
                          AND decision = 'approved'
                          AND approver_id = :approver_id
                        """
                    ),
                    {
                        "organization_id": organization_id,
                        "approval_id": approval_id,
                        "approver_id": approver_id,
                    },
                )
                if duplicate_check.fetchone() is not None:
                    raise ValidationError(
                        code="agentos.approvals.duplicate_approval",
                        message="Approver already approved this request",
                        meta={"approval_id": approval_id, "approver_id": approver_id},
                    )

            await session.execute(
                text(
                    """
                    INSERT INTO agent_action_approval_decision (
                        id, organization_id, approval_id, step_index,
                        approver_id, decision, reason, decided_at, metadata
                    ) VALUES (
                        :id, :organization_id, :approval_id, :step_index,
                        :approver_id, :decision, :reason, :decided_at,
                        CAST(:metadata AS JSONB)
                    )
                    """
                ),
                {
                    "id": decision_id,
                    "organization_id": organization_id,
                    "approval_id": approval_id,
                    "step_index": 1,
                    "approver_id": approver_id,
                    "decision": decision,
                    "reason": reason,
                    "decided_at": now,
                    "metadata": json_dumps_canonical({}),
                },
            )

            approved_result = await session.execute(
                text(
                    """
                    SELECT approver_id
                    FROM agent_action_approval_decision
                    WHERE organization_id = :organization_id
                      AND approval_id = :approval_id
                      AND decision = 'approved'
                    ORDER BY decided_at ASC
                    """
                ),
                {
                    "organization_id": organization_id,
                    "approval_id": approval_id,
                },
            )
            approved_by = [
                str(row.approver_id)
                for row in approved_result.fetchall()
                if str(row.approver_id or "").strip()
            ]

            denied_result = await session.execute(
                text(
                    """
                    SELECT approver_id
                    FROM agent_action_approval_decision
                    WHERE organization_id = :organization_id
                      AND approval_id = :approval_id
                      AND decision = 'denied'
                    ORDER BY decided_at ASC
                    """
                ),
                {
                    "organization_id": organization_id,
                    "approval_id": approval_id,
                },
            )
            denied_by = [
                str(row.approver_id)
                for row in denied_result.fetchall()
                if str(row.approver_id or "").strip()
            ]

            approvals_received = len(approved_by)
            final_status = current.status
            final_approver_id = None
            final_approval_reason = None
            final_decided_at = None
            if decision == "denied":
                final_status = "denied"
                final_approver_id = approver_id
                final_approval_reason = reason
                final_decided_at = now
            elif approvals_received >= max(1, int(current.required_approvals or 1)):
                final_status = "approved"
                final_approver_id = approver_id
                final_approval_reason = reason
                final_decided_at = now
            elif current.status != "escalated":
                final_status = "pending"

            await session.execute(
                text(
                    """
                    UPDATE agent_action_approval
                    SET status = :status,
                        approvals_received = :approvals_received,
                        decision_summary = CAST(:decision_summary AS JSONB),
                        approver_id = COALESCE(:approver_id, approver_id),
                        approval_reason = COALESCE(:approval_reason, approval_reason),
                        decided_at = COALESCE(:decided_at, decided_at)
                    WHERE id = :id
                      AND organization_id = :organization_id
                    """
                ),
                {
                    "status": final_status,
                    "approvals_received": approvals_received,
                    "decision_summary": json_dumps_canonical(
                        {
                            "approved_by": approved_by,
                            "denied_by": denied_by,
                            "last_decision": {
                                "decision": decision,
                                "approver_id": approver_id,
                                "reason": reason,
                                "decided_at": now.isoformat(),
                            },
                        }
                    ),
                    "approver_id": final_approver_id,
                    "approval_reason": final_approval_reason,
                    "decided_at": final_decided_at,
                    "id": approval_id,
                    "organization_id": organization_id,
                },
            )
            await session.commit()

        await emit_control_plane_audit_event(
            organization_id=organization_id,
            action=f"agentos.approval.{decision}",
            actor_id=approver_id,
            resource_type="agent_action_approval",
            resource_id=approval_id,
            metadata={
                "decision_id": decision_id,
                "reason": reason,
            },
        )
        return await self.get_request(organization_id=organization_id, approval_id=approval_id)

    async def list_decisions(
        self,
        *,
        organization_id: str,
        approval_id: str,
        limit: int = 200,
        offset: int = 0,
    ) -> list[ApprovalDecisionRecord]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, approval_id, step_index,
                           approver_id, decision, reason, decided_at, metadata
                    FROM agent_action_approval_decision
                    WHERE organization_id = :organization_id
                      AND approval_id = :approval_id
                    ORDER BY decided_at ASC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                {
                    "organization_id": organization_id,
                    "approval_id": approval_id,
                    "limit": max(1, min(limit, 500)),
                    "offset": max(0, offset),
                },
            )
            rows = result.fetchall()
        return [ApprovalDecisionRecord.model_validate(_row_to_dict(row)) for row in rows]

    async def escalate_overdue(self, *, organization_id: str) -> int:
        now = utc_now()
        async with get_db_session() as session:
            overdue = await session.execute(
                text(
                    """
                    SELECT id
                    FROM agent_action_approval
                    WHERE organization_id = :organization_id
                      AND status = 'pending'
                      AND sla_due_at IS NOT NULL
                      AND sla_due_at < :now
                    """
                ),
                {"organization_id": organization_id, "now": now},
            )
            overdue_ids = [str(row.id) for row in overdue.fetchall()]
            if not overdue_ids:
                return 0

            for approval_id in overdue_ids:
                await session.execute(
                    text(
                        """
                        UPDATE agent_action_approval
                        SET status = 'escalated',
                            metadata = COALESCE(metadata, '{}'::jsonb) || CAST(:metadata AS JSONB)
                        WHERE organization_id = :organization_id
                          AND id = :approval_id
                        """
                    ),
                    {
                        "organization_id": organization_id,
                        "approval_id": approval_id,
                        "metadata": json_dumps_canonical({"escalated_at": now.isoformat()}),
                    },
                )
                await session.execute(
                    text(
                        """
                        INSERT INTO agent_action_approval_decision (
                            id, organization_id, approval_id, step_index,
                            approver_id, decision, reason, decided_at, metadata
                        ) VALUES (
                            :id, :organization_id, :approval_id, 1,
                            NULL, 'escalated', 'SLA overdue', :decided_at,
                            CAST(:metadata AS JSONB)
                        )
                        """
                    ),
                    {
                        "id": new_prefixed_id("agapd"),
                        "organization_id": organization_id,
                        "approval_id": approval_id,
                        "decided_at": now,
                        "metadata": json_dumps_canonical({"escalated_at": now.isoformat()}),
                    },
                )

            await session.commit()

        await emit_control_plane_audit_event(
            organization_id=organization_id,
            action="agentos.approval.escalated",
            actor_id=None,
            resource_type="agent_action_approval",
            resource_id=organization_id,
            metadata={"count": len(overdue_ids)},
        )
        return len(overdue_ids)
