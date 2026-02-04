"""Contradiction management API."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.uio.manager import get_uio_manager

router = APIRouter(prefix="/contradictions", tags=["contradictions"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and ctx.organization_id != organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch with authenticated key")


class ContradictionCreateRequest(BaseModel):
    organization_id: str
    uio_a_id: str
    uio_b_id: str
    contradiction_type: str
    severity: str = Field(default="medium")
    evidence_quote: str | None = None
    evidence_artifact_id: str | None = None
    detected_by: str | None = None


class ContradictionResolveRequest(BaseModel):
    organization_id: str
    resolution_reason: str
    resolved_by: str | None = None


@router.post("", response_model=dict)
async def create_contradiction(
    request: ContradictionCreateRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org_id(ctx, request.organization_id)
    manager = await get_uio_manager(request.organization_id)
    try:
        contradiction_id = await manager.record_contradiction(
            uio_a_id=request.uio_a_id,
            uio_b_id=request.uio_b_id,
            contradiction_type=request.contradiction_type,
            severity=request.severity,
            evidence_quote=request.evidence_quote,
            evidence_artifact_id=request.evidence_artifact_id,
            detected_by=request.detected_by or getattr(ctx, "user_id", None),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "success": True,
        "contradiction_id": contradiction_id,
        "detected_at": datetime.utcnow().isoformat(),
    }


@router.post("/{contradiction_id}/resolve", response_model=dict)
async def resolve_contradiction(
    contradiction_id: str,
    request: ContradictionResolveRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org_id(ctx, request.organization_id)
    manager = await get_uio_manager(request.organization_id)
    resolved = await manager.resolve_contradiction(
        contradiction_id=contradiction_id,
        resolution_reason=request.resolution_reason,
        resolved_by=request.resolved_by or getattr(ctx, "user_id", None),
    )
    if not resolved:
        raise HTTPException(status_code=404, detail="Contradiction not found")

    return {
        "success": True,
        "contradiction_id": contradiction_id,
        "resolved_at": datetime.utcnow().isoformat(),
    }
