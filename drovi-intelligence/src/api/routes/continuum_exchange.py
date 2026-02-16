"""Continuum Exchange API endpoints."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.continuum_exchange.bundles import (
    BundleManifest,
    install_bundle,
    list_bundles,
    publish_bundle,
    update_bundle_governance,
)

router = APIRouter(prefix="/continuum-exchange", tags=["Continuum Exchange"])

LEGACY_EXCHANGE_WRITE_BLOCK_MESSAGE = (
    "Continuum Exchange write operations are decommissioned. "
    "Use Agent Catalog and Starter Packs under /api/v1/agents/catalog."
)


def _validate_org(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")


def _raise_legacy_exchange_write_block() -> None:
    raise HTTPException(status_code=410, detail=LEGACY_EXCHANGE_WRITE_BLOCK_MESSAGE)


class BundlePublishRequest(BaseModel):
    organization_id: str
    manifest: dict[str, Any]
    signature: str | None = None
    created_by: str | None = None
    visibility: Literal["private", "public", "curated"] = "private"
    governance_status: Literal["pending", "approved", "rejected"] = "pending"
    price_cents: int | None = Field(default=None, ge=0)
    currency: str | None = None
    billing_model: Literal["one_time", "subscription", "usage"] | None = None


class BundlePublishResponse(BaseModel):
    bundle_id: str
    version: str
    signature: str


class BundleInstallRequest(BaseModel):
    organization_id: str
    version: str | None = None
    installed_by: str | None = None


class BundleGovernanceRequest(BaseModel):
    organization_id: str
    governance_status: Literal["pending", "approved", "rejected"]


@router.post("/bundles/publish", response_model=BundlePublishResponse)
async def publish_bundle_endpoint(
    request: BundlePublishRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _raise_legacy_exchange_write_block()
    _validate_org(ctx, request.organization_id)
    if request.governance_status == "approved" and not ctx.has_scope(Scope.ADMIN):
        raise HTTPException(status_code=403, detail="Admin scope required to approve bundles")

    manifest = BundleManifest.model_validate(request.manifest)
    result = await publish_bundle(
        organization_id=request.organization_id,
        manifest=manifest,
        signature=request.signature,
        created_by=request.created_by,
        visibility=request.visibility,
        governance_status=request.governance_status,
        price_cents=request.price_cents,
        currency=request.currency,
        billing_model=request.billing_model,
    )
    return BundlePublishResponse(**result)


@router.get("/bundles")
async def list_bundles_endpoint(
    organization_id: str = Query(...),
    visibility: str | None = None,
    governance_status: str | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org(ctx, organization_id)
    return await list_bundles(
        organization_id=organization_id,
        visibility=visibility,
        governance_status=governance_status,
    )


@router.post("/bundles/{bundle_id}/install")
async def install_bundle_endpoint(
    bundle_id: str,
    request: BundleInstallRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _raise_legacy_exchange_write_block()
    _validate_org(ctx, request.organization_id)
    return await install_bundle(
        organization_id=request.organization_id,
        bundle_id=bundle_id,
        version=request.version,
        installed_by=request.installed_by,
    )


@router.post("/bundles/{bundle_id}/governance")
async def update_bundle_governance_endpoint(
    bundle_id: str,
    request: BundleGovernanceRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
):
    _raise_legacy_exchange_write_block()
    _validate_org(ctx, request.organization_id)
    await update_bundle_governance(
        organization_id=request.organization_id,
        bundle_id=bundle_id,
        governance_status=request.governance_status,
    )
    return {"status": "ok"}
