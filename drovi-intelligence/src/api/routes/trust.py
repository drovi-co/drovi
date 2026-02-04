"""Trust indicators API."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.trust.indicators import get_trust_indicators

router = APIRouter(prefix="/trust", tags=["Trust"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")


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
