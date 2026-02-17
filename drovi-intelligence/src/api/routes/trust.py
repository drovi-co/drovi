"""Trust indicators API."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.trust.indicators import get_trust_indicators
from src.trust.products import (
    compute_continuity_score,
    export_evidence_bundle,
    generate_monthly_integrity_report,
    generate_record_certificate,
    get_retention_profile,
    update_evidence_legal_hold,
    upsert_retention_profile,
)

router = APIRouter(prefix="/trust", tags=["Trust"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")


def _require_admin_scope(ctx: APIKeyContext) -> None:
    if not (ctx.is_internal or ctx.has_scope(Scope.ADMIN)):
        raise HTTPException(status_code=403, detail="Admin scope required")


class TrustRequest(BaseModel):
    organization_id: str
    uio_ids: list[str] = Field(default_factory=list)
    evidence_limit: int = Field(default=3, ge=0, le=10)


@router.post("/uios")
async def trust_for_uios(
    request: TrustRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org_id(ctx, request.organization_id)
    return await get_trust_indicators(
        organization_id=request.organization_id,
        uio_ids=request.uio_ids,
        evidence_limit=request.evidence_limit,
    )


class RetentionProfileUpdateRequest(BaseModel):
    organization_id: str
    data_retention_days: int = Field(default=365, ge=1, le=36500)
    evidence_retention_days: int = Field(default=3650, ge=1, le=36500)
    default_legal_hold: bool = False
    require_legal_hold_reason: bool = True


class EvidenceBundleRequest(BaseModel):
    organization_id: str
    uio_ids: list[str] = Field(default_factory=list)
    evidence_ids: list[str] = Field(default_factory=list)
    include_presigned_urls: bool = False


class EvidenceLegalHoldRequest(BaseModel):
    organization_id: str
    evidence_artifact_ids: list[str] = Field(default_factory=list)
    legal_hold: bool
    reason: str | None = None
    retention_until: datetime | None = None


@router.get("/continuity-score")
async def continuity_score(
    organization_id: str = Query(...),
    lookback_days: int = Query(default=30, ge=1, le=365),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
):
    _validate_org_id(ctx, organization_id)
    _require_admin_scope(ctx)
    return await compute_continuity_score(
        organization_id=organization_id,
        lookback_days=lookback_days,
    )


@router.get("/record-certificate/{uio_id}")
async def record_certificate(
    uio_id: str,
    organization_id: str = Query(...),
    evidence_limit: int = Query(default=10, ge=1, le=50),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
):
    _validate_org_id(ctx, organization_id)
    _require_admin_scope(ctx)
    try:
        return await generate_record_certificate(
            organization_id=organization_id,
            uio_id=uio_id,
            evidence_limit=evidence_limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/integrity-report/monthly")
async def integrity_report_monthly(
    organization_id: str = Query(...),
    month: str | None = Query(default=None, description="YYYY-MM, defaults to previous month"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
):
    _validate_org_id(ctx, organization_id)
    _require_admin_scope(ctx)
    try:
        return await generate_monthly_integrity_report(
            organization_id=organization_id,
            month=month,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/evidence-bundles/export")
async def evidence_bundle_export(
    request: EvidenceBundleRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
):
    _validate_org_id(ctx, request.organization_id)
    _require_admin_scope(ctx)
    try:
        return await export_evidence_bundle(
            organization_id=request.organization_id,
            uio_ids=request.uio_ids,
            evidence_ids=request.evidence_ids,
            include_presigned_urls=request.include_presigned_urls,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/retention-profile")
async def retention_profile(
    organization_id: str = Query(...),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
):
    _validate_org_id(ctx, organization_id)
    _require_admin_scope(ctx)
    return await get_retention_profile(organization_id=organization_id)


@router.put("/retention-profile")
async def retention_profile_update(
    request: RetentionProfileUpdateRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
):
    _validate_org_id(ctx, request.organization_id)
    _require_admin_scope(ctx)
    return await upsert_retention_profile(
        organization_id=request.organization_id,
        data_retention_days=request.data_retention_days,
        evidence_retention_days=request.evidence_retention_days,
        default_legal_hold=request.default_legal_hold,
        require_legal_hold_reason=request.require_legal_hold_reason,
        updated_by_user_id=ctx.auth_subject_id,
    )


@router.post("/evidence/legal-hold")
async def evidence_legal_hold_update(
    request: EvidenceLegalHoldRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
):
    _validate_org_id(ctx, request.organization_id)
    _require_admin_scope(ctx)
    try:
        return await update_evidence_legal_hold(
            organization_id=request.organization_id,
            evidence_artifact_ids=request.evidence_artifact_ids,
            legal_hold=request.legal_hold,
            reason=request.reason,
            actor_id=ctx.auth_subject_id,
            retention_until=request.retention_until,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
