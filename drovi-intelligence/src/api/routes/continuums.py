"""
Continuum API - Runtime scheduling and lifecycle endpoints.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
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
from src.db.client import get_db_session
from src.simulation.engine import preview_continuum
from src.simulation.models import ContinuumPreviewRequest, ContinuumPreviewResponse

router = APIRouter(prefix="/continuums", tags=["Continuums"])

LEGACY_WRITE_BLOCK_MESSAGE = (
    "Continuum write operations are decommissioned. "
    "Use AgentOS migration APIs at /api/v1/agents/control/legacy/continuums."
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _validate_org(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")


def _raise_legacy_write_block() -> None:
    raise HTTPException(status_code=410, detail=LEGACY_WRITE_BLOCK_MESSAGE)


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
    _raise_legacy_write_block()
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
    _raise_legacy_write_block()
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
    _raise_legacy_write_block()
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
    _raise_legacy_write_block()
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
    del continuum_id, request, ctx
    _raise_legacy_write_block()


@router.post("/{continuum_id}/rollback")
async def rollback_continuum_endpoint(
    continuum_id: str,
    request: ContinuumRollbackRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _raise_legacy_write_block()
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
    _raise_legacy_write_block()
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


@router.post("/{continuum_id}/preview", response_model=ContinuumPreviewResponse)
async def preview_continuum_endpoint(
    continuum_id: str,
    request: ContinuumPreviewRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org(ctx, request.organization_id)
    return await preview_continuum(
        organization_id=request.organization_id,
        continuum_id=continuum_id,
        horizon_days=request.horizon_days,
    )


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


@router.get("/{continuum_id}/history")
async def list_continuum_history(
    continuum_id: str,
    organization_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org(ctx, organization_id)
    async with get_db_session() as session:
        continuum_result = await session.execute(
            text(
                """
                SELECT id
                FROM continuum
                WHERE id = :continuum_id AND organization_id = :org_id
                """
            ),
            {"continuum_id": continuum_id, "org_id": organization_id},
        )
        if continuum_result.fetchone() is None:
            raise HTTPException(status_code=404, detail="Continuum not found")

        version_result = await session.execute(
            text(
                """
                SELECT version, created_at, created_by, is_active, definition_hash, definition
                FROM continuum_version
                WHERE continuum_id = :continuum_id AND organization_id = :org_id
                ORDER BY version DESC
                LIMIT :limit
                """
            ),
            {
                "continuum_id": continuum_id,
                "org_id": organization_id,
                "limit": limit,
            },
        )
        rows = []
        for row in version_result.fetchall():
            payload = dict(row._mapping)
            definition = payload.get("definition")
            if isinstance(definition, str):
                try:
                    definition = json.loads(definition)
                except Exception:
                    definition = {}
            if not isinstance(definition, dict):
                definition = {}
            rows.append(
                {
                    "version": payload.get("version"),
                    "created_at": payload.get("created_at"),
                    "created_by": payload.get("created_by"),
                    "is_active": payload.get("is_active"),
                    "definition_hash": payload.get("definition_hash"),
                    "name": definition.get("name"),
                    "goal": definition.get("goal"),
                    "schedule": definition.get("schedule"),
                }
            )
        return rows
