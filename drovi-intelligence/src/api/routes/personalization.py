"""
Personalization API Routes.

Manage per-organization extraction profiles (language, jargon, roles, projects).
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.personalization import OrgProfile, OrgProfileUpdate, get_org_profile, update_org_profile

router = APIRouter(prefix="/personalization", tags=["Personalization"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")


class OrgProfileResponse(BaseModel):
    profile: OrgProfile


@router.get("/{organization_id}", response_model=OrgProfileResponse)
async def get_profile(
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> OrgProfileResponse:
    _validate_org_id(ctx, organization_id)
    profile = await get_org_profile(organization_id)
    return OrgProfileResponse(profile=profile)


@router.put("/{organization_id}", response_model=OrgProfileResponse)
async def update_profile(
    organization_id: str,
    updates: OrgProfileUpdate,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> OrgProfileResponse:
    _validate_org_id(ctx, organization_id)
    profile = await update_org_profile(organization_id, updates)
    return OrgProfileResponse(profile=profile)
