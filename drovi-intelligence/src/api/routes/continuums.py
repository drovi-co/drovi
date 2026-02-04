"""
Continuum API - Runtime scheduling and lifecycle endpoints.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.continuum.dsl import ContinuumDefinition
from src.continuum.manager import (
    add_continuum_version,
    compute_next_run_at,
    create_continuum,
    fetch_continuum_definition,
    rollback_continuum,
    resolve_alert,
    set_continuum_status,
)
from src.continuum.models import ContinuumStatus
from src.continuum.runtime import trigger_continuum_run
from src.db.client import get_db_session

router = APIRouter(prefix="/continuums", tags=["Continuums"])


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _validate_org(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")


class ContinuumCreateRequest(BaseModel):
    organization_id: str
    definition: dict[str, Any]
    activate: bool = False
    created_by: str | None = None


class ContinuumCreateResponse(BaseModel):
    id: str
    version: int
    status: str
    next_run_at: datetime | None


class ContinuumVersionRequest(BaseModel):
    organization_id: str
    definition: dict[str, Any]
    activate: bool = False
    created_by: str | None = None


class ContinuumStatusRequest(BaseModel):
    organization_id: str


class ContinuumRunRequest(BaseModel):
    organization_id: str
    triggered_by: str = "manual"


class ContinuumRollbackRequest(BaseModel):
    organization_id: str
    target_version: int | None = None
    triggered_by: str | None = None


class ContinuumOverrideRequest(BaseModel):
    organization_id: str
    alert_id: str
    resolved_by: str | None = None
    resolution_notes: str | None = None


@router.post("", response_model=ContinuumCreateResponse)
async def create_continuum_endpoint(
    request: ContinuumCreateRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org(ctx, request.organization_id)
    definition = ContinuumDefinition.model_validate(request.definition)
    result = await create_continuum(
        organization_id=request.organization_id,
        definition=definition,
        created_by=request.created_by,
        activate=request.activate,
    )
    return ContinuumCreateResponse(**result)


@router.post("/{continuum_id}/versions")
async def create_version_endpoint(
    continuum_id: str,
    request: ContinuumVersionRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org(ctx, request.organization_id)
    definition = ContinuumDefinition.model_validate(request.definition)
    return await add_continuum_version(
        continuum_id=continuum_id,
        organization_id=request.organization_id,
        definition=definition,
        created_by=request.created_by,
        activate=request.activate,
    )


@router.post("/{continuum_id}/activate")
async def activate_continuum_endpoint(
    continuum_id: str,
    request: ContinuumStatusRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org(ctx, request.organization_id)
    definition = await fetch_continuum_definition(
        continuum_id=continuum_id,
        organization_id=request.organization_id,
    )
    next_run = compute_next_run_at(definition, _utc_now())
    await set_continuum_status(
        continuum_id=continuum_id,
        organization_id=request.organization_id,
        status=ContinuumStatus.ACTIVE,
        next_run_at=next_run,
    )
    return {"status": "active", "next_run_at": next_run}


@router.post("/{continuum_id}/pause")
async def pause_continuum_endpoint(
    continuum_id: str,
    request: ContinuumStatusRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org(ctx, request.organization_id)
    await set_continuum_status(
        continuum_id=continuum_id,
        organization_id=request.organization_id,
        status=ContinuumStatus.PAUSED,
        next_run_at=None,
    )
    return {"status": "paused"}


@router.post("/{continuum_id}/run")
async def run_continuum_endpoint(
    continuum_id: str,
    request: ContinuumRunRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org(ctx, request.organization_id)
    return await trigger_continuum_run(
        continuum_id=continuum_id,
        organization_id=request.organization_id,
        triggered_by=request.triggered_by,
    )


@router.post("/{continuum_id}/rollback")
async def rollback_continuum_endpoint(
    continuum_id: str,
    request: ContinuumRollbackRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org(ctx, request.organization_id)
    return await rollback_continuum(
        continuum_id=continuum_id,
        organization_id=request.organization_id,
        target_version=request.target_version,
        triggered_by=request.triggered_by,
    )


@router.post("/{continuum_id}/override")
async def override_continuum_endpoint(
    continuum_id: str,
    request: ContinuumOverrideRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org(ctx, request.organization_id)
    await resolve_alert(
        alert_id=request.alert_id,
        organization_id=request.organization_id,
        resolved_by=request.resolved_by,
        resolution_notes=request.resolution_notes,
    )
    await set_continuum_status(
        continuum_id=continuum_id,
        organization_id=request.organization_id,
        status=ContinuumStatus.ACTIVE,
        next_run_at=None,
    )
    return {"status": "active"}


@router.get("")
async def list_continuums(
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org(ctx, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, name, description, status, current_version, active_version,
                       created_at, updated_at, next_run_at
                FROM continuum
                WHERE organization_id = :org_id
                ORDER BY updated_at DESC
                """
            ),
            {"org_id": organization_id},
        )
        return [dict(row._mapping) for row in result.fetchall()]


@router.get("/{continuum_id}")
async def get_continuum(
    continuum_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org(ctx, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, name, description, status, current_version, active_version,
                       created_at, updated_at, next_run_at, escalation_policy
                FROM continuum
                WHERE id = :continuum_id AND organization_id = :org_id
                """
            ),
            {"continuum_id": continuum_id, "org_id": organization_id},
        )
        row = result.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Continuum not found")
        return dict(row._mapping)


@router.get("/{continuum_id}/runs")
async def list_continuum_runs(
    continuum_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org(ctx, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, status, version, started_at, completed_at, error_message
                FROM continuum_run
                WHERE continuum_id = :continuum_id AND organization_id = :org_id
                ORDER BY started_at DESC
                LIMIT 100
                """
            ),
            {"continuum_id": continuum_id, "org_id": organization_id},
        )
        return [dict(row._mapping) for row in result.fetchall()]
