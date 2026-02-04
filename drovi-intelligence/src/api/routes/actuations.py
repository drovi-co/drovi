"""
Actuation API - Driver execution endpoints.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.actuation import load_builtin_drivers
from src.actuation.models import ActionTier, ActuationRequest
from src.actuation.registry import list_drivers
from src.actuation.service import ActuationService
from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.db.client import get_db_session

router = APIRouter(prefix="/actuations", tags=["Actuations"])

load_builtin_drivers()


def _validate_org(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")


class ActuationCommandRequest(BaseModel):
    organization_id: str
    driver: str
    action: str
    payload: dict[str, Any] = Field(default_factory=dict)
    tier: ActionTier | None = None
    policy_context: dict[str, Any] | None = None
    actor_id: str | None = None
    approval_by: str | None = None
    approval_reason: str | None = None
    force_execute: bool = False
    mode: Literal["draft", "stage", "execute"] = "execute"
    action_id: str | None = None


class ActuationApprovalRequest(BaseModel):
    organization_id: str
    actor_id: str | None = None
    approval_by: str | None = None
    approval_reason: str | None = None


class ActuationRollbackRequest(BaseModel):
    organization_id: str
    actor_id: str | None = None


@router.get("/drivers")
async def list_available_drivers(
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    return {"drivers": list_drivers()}


@router.post("")
async def run_actuation(
    request: ActuationCommandRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org(ctx, request.organization_id)
    service = ActuationService()
    act_request = ActuationRequest(
        organization_id=request.organization_id,
        driver=request.driver,
        action=request.action,
        payload=request.payload,
        tier=request.tier,
        policy_context=request.policy_context,
        actor_id=request.actor_id,
        approval_by=request.approval_by,
        approval_reason=request.approval_reason,
        force_execute=request.force_execute,
    )

    if request.mode == "draft":
        record = await service.draft(act_request)
    elif request.mode == "stage":
        record = await service.stage(act_request, action_id=request.action_id)
    else:
        record = await service.execute(act_request, action_id=request.action_id)

    return record.model_dump()


@router.post("/{action_id}/approve")
async def approve_actuation(
    action_id: str,
    request: ActuationApprovalRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org(ctx, request.organization_id)
    service = ActuationService()
    act_request = ActuationRequest(
        organization_id=request.organization_id,
        driver="",
        action="",
        payload={},
        approval_by=request.approval_by or request.actor_id,
        approval_reason=request.approval_reason,
        actor_id=request.actor_id,
        force_execute=True,
    )
    record = await service.execute(act_request, action_id=action_id)
    return record.model_dump()


@router.post("/{action_id}/rollback")
async def rollback_actuation(
    action_id: str,
    request: ActuationRollbackRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org(ctx, request.organization_id)
    service = ActuationService()
    record = await service.rollback(request.organization_id, action_id, actor_id=request.actor_id)
    return record.model_dump()


@router.get("")
async def list_actuations(
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org(ctx, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, driver, action_type, tier, status, created_at, updated_at
                FROM actuation_action
                WHERE organization_id = :org_id
                ORDER BY created_at DESC
                LIMIT 200
                """
            ),
            {"org_id": organization_id},
        )
        return [dict(row._mapping) for row in result.fetchall()]


@router.get("/{action_id}")
async def get_actuation(
    action_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org(ctx, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT *
                FROM actuation_action
                WHERE id = :id AND organization_id = :org_id
                """
            ),
            {"id": action_id, "org_id": organization_id},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Actuation not found")
        return dict(row._mapping)
