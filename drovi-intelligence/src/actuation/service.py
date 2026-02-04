"""Actuation service for permissioned execution."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

import structlog
from sqlalchemy import text

from src.actuation.models import ActionStatus, ActionTier, ActuationRecord, ActuationRequest
from src.actuation.registry import get_driver
from src.actuation.drivers.base import DriverContext
from src.config import get_settings
from src.db.client import get_db_session
from src.guardrails.policy import evaluate_policy, PolicyContext

logger = structlog.get_logger()


def _utc_now() -> datetime:
    return datetime.utcnow()


def _requires_approval_for_tier(tier: ActionTier) -> bool:
    return tier in (ActionTier.HIGH, ActionTier.CRITICAL)


def _policy_requires_approval(decisions: list[dict[str, Any]]) -> bool:
    return any(decision.get("action") == "require_approval" for decision in decisions)


def _policy_blocks(decisions: list[dict[str, Any]]) -> bool:
    return any(decision.get("action") == "block" for decision in decisions)


def _build_policy_decisions(policy_context: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not policy_context:
        return []
    context = PolicyContext(
        direction=policy_context.get("direction", "outbound"),
        channel=policy_context.get("channel"),
        pii_types=policy_context.get("pii_types", []),
        contradiction_severity=policy_context.get("contradiction_severity"),
        fraud_score=policy_context.get("fraud_score"),
    )
    decisions = evaluate_policy(context)
    return [decision.model_dump() for decision in decisions]


class ActuationService:
    """High-level orchestration for actuation."""

    async def draft(self, request: ActuationRequest) -> ActuationRecord:
        driver = get_driver(request.driver)
        context = DriverContext(organization_id=request.organization_id, actor_id=request.actor_id)
        draft_payload = await driver.draft(context, request.payload)
        tier = request.tier or driver.default_tier
        action_id = str(uuid4())
        now = _utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO actuation_action (
                        id, organization_id, driver, action_type, tier,
                        status, input_payload, draft_payload,
                        created_by, created_at, updated_at
                    ) VALUES (
                        :id, :org_id, :driver, :action_type, :tier,
                        :status, :input_payload, :draft_payload,
                        :created_by, :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": action_id,
                    "org_id": request.organization_id,
                    "driver": request.driver,
                    "action_type": request.action,
                    "tier": tier.value,
                    "status": ActionStatus.DRAFTED.value,
                    "input_payload": request.payload,
                    "draft_payload": draft_payload,
                    "created_by": request.actor_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )
        return ActuationRecord(
            id=action_id,
            organization_id=request.organization_id,
            driver=request.driver,
            action_type=request.action,
            tier=tier,
            status=ActionStatus.DRAFTED,
            input_payload=request.payload,
            draft_payload=draft_payload,
            created_by=request.actor_id,
        )

    async def stage(self, request: ActuationRequest, action_id: str | None = None) -> ActuationRecord:
        record = await self._get_or_create_record(request, action_id)
        driver = get_driver(record.driver)
        context = DriverContext(organization_id=record.organization_id, actor_id=request.actor_id)
        draft_payload = record.draft_payload or record.input_payload
        stage_payload = await driver.stage(context, draft_payload)
        now = _utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    UPDATE actuation_action
                    SET status = :status,
                        stage_payload = :stage_payload,
                        updated_at = :updated_at
                    WHERE id = :id
                    """
                ),
                {
                    "status": ActionStatus.STAGED.value,
                    "stage_payload": stage_payload,
                    "updated_at": now,
                    "id": record.id,
                },
            )
        record.status = ActionStatus.STAGED
        record.stage_payload = stage_payload
        return record

    async def execute(self, request: ActuationRequest, action_id: str | None = None) -> ActuationRecord:
        record = await self._get_or_create_record(request, action_id)
        driver = get_driver(record.driver)
        context = DriverContext(organization_id=record.organization_id, actor_id=request.actor_id)
        tier = request.tier or record.tier
        decisions = _build_policy_decisions(request.policy_context)
        status = record.status

        if _policy_blocks(decisions):
            status = ActionStatus.BLOCKED
            await self._update_action(
                record.id,
                status=status,
                policy_decisions=decisions,
                error_message="Blocked by policy",
            )
            record.status = status
            record.policy_decisions = decisions
            record.error_message = "Blocked by policy"
            return record

        if _policy_requires_approval(decisions) or (_requires_approval_for_tier(tier) and not request.approval_by):
            status = ActionStatus.REQUIRES_APPROVAL
            await self._update_action(
                record.id,
                status=status,
                policy_decisions=decisions,
                approval_by=request.approval_by,
                approval_reason=request.approval_reason,
            )
            record.status = status
            record.policy_decisions = decisions
            return record

        if (
            _requires_approval_for_tier(tier)
            and get_settings().actuation_sandbox_enabled
            and not request.force_execute
        ):
            status = ActionStatus.SANDBOXED
            await self._update_action(
                record.id,
                status=status,
                policy_decisions=decisions,
            )
            record.status = status
            record.policy_decisions = decisions
            return record

        staged_payload = record.stage_payload or record.draft_payload or record.input_payload
        if record.status != ActionStatus.STAGED:
            staged_payload = await driver.stage(context, staged_payload)

        result = await driver.execute(context, staged_payload)
        status = ActionStatus.EXECUTED if result.status != "failed" else ActionStatus.FAILED
        await self._update_action(
            record.id,
            status=status,
            stage_payload=staged_payload,
            result_payload=result.data,
            rollback_payload=result.rollback_payload,
            policy_decisions=decisions,
            approval_by=request.approval_by,
            approval_reason=request.approval_reason,
            executed_at=_utc_now(),
        )
        record.status = status
        record.stage_payload = staged_payload
        record.result_payload = result.data
        record.rollback_payload = result.rollback_payload
        record.policy_decisions = decisions
        return record

    async def rollback(self, organization_id: str, action_id: str, actor_id: str | None = None) -> ActuationRecord:
        record = await self._fetch_record(organization_id, action_id)
        driver = get_driver(record.driver)
        context = DriverContext(organization_id=record.organization_id, actor_id=actor_id)
        if not record.rollback_payload:
            raise ValueError("No rollback payload available")
        result = await driver.rollback(context, record.rollback_payload)
        status = ActionStatus.ROLLED_BACK if result.status != "failed" else ActionStatus.FAILED
        await self._update_action(
            record.id,
            status=status,
            rollback_result=result.data,
            rolled_back_at=_utc_now(),
        )
        record.status = status
        record.rollback_result = result.data
        return record

    async def _fetch_record(self, organization_id: str, action_id: str) -> ActuationRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, driver, action_type, tier, status,
                           input_payload, draft_payload, stage_payload,
                           result_payload, rollback_payload, rollback_result,
                           policy_decisions, created_by, approval_by, approval_reason,
                           error_message
                    FROM actuation_action
                    WHERE id = :id AND organization_id = :org_id
                    """
                ),
                {"id": action_id, "org_id": organization_id},
            )
            row = result.fetchone()
            if not row:
                raise ValueError("Actuation action not found")
            return ActuationRecord(
                id=row.id,
                organization_id=row.organization_id,
                driver=row.driver,
                action_type=row.action_type,
                tier=ActionTier(row.tier),
                status=ActionStatus(row.status),
                input_payload=row.input_payload or {},
                draft_payload=row.draft_payload,
                stage_payload=row.stage_payload,
                result_payload=row.result_payload,
                rollback_payload=row.rollback_payload,
                rollback_result=row.rollback_result,
                policy_decisions=row.policy_decisions or [],
                created_by=row.created_by,
                approval_by=row.approval_by,
                approval_reason=row.approval_reason,
                error_message=row.error_message,
            )

    async def _get_or_create_record(self, request: ActuationRequest, action_id: str | None) -> ActuationRecord:
        if action_id:
            return await self._fetch_record(request.organization_id, action_id)
        return await self.draft(request)

    async def _update_action(
        self,
        action_id: str,
        *,
        status: ActionStatus,
        stage_payload: dict[str, Any] | None = None,
        result_payload: dict[str, Any] | None = None,
        rollback_payload: dict[str, Any] | None = None,
        rollback_result: dict[str, Any] | None = None,
        policy_decisions: list[dict[str, Any]] | None = None,
        approval_by: str | None = None,
        approval_reason: str | None = None,
        error_message: str | None = None,
        executed_at: datetime | None = None,
        rolled_back_at: datetime | None = None,
    ) -> None:
        now = _utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    UPDATE actuation_action
                    SET status = :status,
                        stage_payload = COALESCE(:stage_payload, stage_payload),
                        result_payload = COALESCE(:result_payload, result_payload),
                        rollback_payload = COALESCE(:rollback_payload, rollback_payload),
                        rollback_result = COALESCE(:rollback_result, rollback_result),
                        policy_decisions = COALESCE(:policy_decisions, policy_decisions),
                        approval_by = COALESCE(:approval_by, approval_by),
                        approval_reason = COALESCE(:approval_reason, approval_reason),
                        error_message = COALESCE(:error_message, error_message),
                        executed_at = COALESCE(:executed_at, executed_at),
                        rolled_back_at = COALESCE(:rolled_back_at, rolled_back_at),
                        updated_at = :updated_at
                    WHERE id = :id
                    """
                ),
                {
                    "status": status.value,
                    "stage_payload": stage_payload,
                    "result_payload": result_payload,
                    "rollback_payload": rollback_payload,
                    "rollback_result": rollback_result,
                    "policy_decisions": policy_decisions,
                    "approval_by": approval_by,
                    "approval_reason": approval_reason,
                    "error_message": error_message,
                    "executed_at": executed_at,
                    "rolled_back_at": rolled_back_at,
                    "updated_at": now,
                    "id": action_id,
                },
            )
