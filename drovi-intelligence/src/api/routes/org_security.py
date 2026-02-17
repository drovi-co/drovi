"""Organization security posture routes."""

from __future__ import annotations

from ipaddress import ip_address, ip_network

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.api.routes.auth import require_pilot_auth
from src.auth.pilot_accounts import PilotToken
from src.audit.log import record_audit_event
from src.security.break_glass import (
    create_break_glass_grant,
    revoke_break_glass_grant,
)
from src.security.org_policy import (
    get_org_security_policy,
    upsert_org_security_policy,
)

router = APIRouter(prefix="/org/security", tags=["Organization Security"])

_ALLOWED_ENVS = {"development", "test", "production"}


def _require_admin(token: PilotToken = Depends(require_pilot_auth)) -> PilotToken:
    if token.role not in {"pilot_owner", "pilot_admin"}:
        raise HTTPException(status_code=403, detail="Admin access required")
    return token


def _validate_ip_allowlist(values: list[str]) -> list[str]:
    normalized: list[str] = []
    for raw in values:
        value = str(raw or "").strip()
        if not value:
            continue
        try:
            if "/" in value:
                ip_network(value, strict=False)
            else:
                ip_address(value)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid IP allowlist entry: {value}") from exc
        normalized.append(value)
    return normalized


class OrgSecurityPolicyResponse(BaseModel):
    organization_id: str
    sso_enforced: bool
    password_fallback_enabled: bool
    password_fallback_environments: list[str]
    ip_allowlist: list[str]
    evidence_masking_enabled: bool
    break_glass_enabled: bool
    break_glass_required_actions: list[str]


class OrgSecurityPolicyUpdateRequest(BaseModel):
    sso_enforced: bool | None = None
    password_fallback_enabled: bool | None = None
    password_fallback_environments: list[str] | None = None
    ip_allowlist: list[str] | None = None
    evidence_masking_enabled: bool | None = None
    break_glass_enabled: bool | None = None
    break_glass_required_actions: list[str] | None = None


class BreakGlassGrantRequest(BaseModel):
    scope: str = Field(default="evidence.full")
    justification: str = Field(min_length=10, max_length=2000)
    ttl_minutes: int = Field(default=30, ge=5, le=240)


class BreakGlassGrantResponse(BaseModel):
    id: str
    organization_id: str
    scope: str
    token: str
    justification: str
    expires_at: str
    created_at: str


class BreakGlassRevokeResponse(BaseModel):
    revoked: bool


@router.get("/policy", response_model=OrgSecurityPolicyResponse)
async def get_security_policy(
    token: PilotToken = Depends(require_pilot_auth),
) -> OrgSecurityPolicyResponse:
    policy = await get_org_security_policy(token.org_id)
    return OrgSecurityPolicyResponse(**policy.to_dict())


@router.patch("/policy", response_model=OrgSecurityPolicyResponse)
async def update_security_policy(
    request: OrgSecurityPolicyUpdateRequest,
    token: PilotToken = Depends(_require_admin),
) -> OrgSecurityPolicyResponse:
    envs = None
    if request.password_fallback_environments is not None:
        envs = sorted(
            {
                str(item).strip().lower()
                for item in request.password_fallback_environments
                if str(item).strip()
            }
        )
        unsupported = sorted(set(envs) - _ALLOWED_ENVS)
        if unsupported:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported fallback environment(s): {', '.join(unsupported)}",
            )

    ip_allowlist = None
    if request.ip_allowlist is not None:
        ip_allowlist = _validate_ip_allowlist(request.ip_allowlist)

    break_glass_actions = None
    if request.break_glass_required_actions is not None:
        break_glass_actions = sorted(
            {
                str(item).strip().lower()
                for item in request.break_glass_required_actions
                if str(item).strip()
            }
        )

    updated = await upsert_org_security_policy(
        token.org_id,
        sso_enforced=request.sso_enforced,
        password_fallback_enabled=request.password_fallback_enabled,
        password_fallback_environments=envs,
        ip_allowlist=ip_allowlist,
        evidence_masking_enabled=request.evidence_masking_enabled,
        break_glass_enabled=request.break_glass_enabled,
        break_glass_required_actions=break_glass_actions,
    )

    await record_audit_event(
        organization_id=token.org_id,
        action="security.policy.updated",
        actor_type="user",
        actor_id=token.sub,
        resource_type="organization_security_policy",
        resource_id=token.org_id,
        metadata={
            "sso_enforced": updated.sso_enforced,
            "password_fallback_enabled": updated.password_fallback_enabled,
            "password_fallback_environments": list(updated.password_fallback_environments),
            "ip_allowlist_count": len(updated.ip_allowlist),
            "evidence_masking_enabled": updated.evidence_masking_enabled,
            "break_glass_enabled": updated.break_glass_enabled,
            "break_glass_required_actions": list(updated.break_glass_required_actions),
        },
    )

    return OrgSecurityPolicyResponse(**updated.to_dict())


@router.post("/break-glass/grants", response_model=BreakGlassGrantResponse)
async def create_break_glass(
    request: BreakGlassGrantRequest,
    token: PilotToken = Depends(_require_admin),
) -> BreakGlassGrantResponse:
    policy = await get_org_security_policy(token.org_id)
    if not policy.break_glass_enabled:
        raise HTTPException(
            status_code=403,
            detail="Break-glass workflow is disabled by organization policy",
        )

    grant, plain_token = await create_break_glass_grant(
        organization_id=token.org_id,
        scope=str(request.scope or "*").strip().lower() or "*",
        justification=request.justification.strip(),
        created_by_subject=token.sub,
        ttl_minutes=request.ttl_minutes,
    )

    await record_audit_event(
        organization_id=token.org_id,
        action="security.break_glass.grant_created",
        actor_type="user",
        actor_id=token.sub,
        resource_type="security_break_glass_grant",
        resource_id=grant.id,
        metadata={
            "scope": grant.scope,
            "expires_at": grant.expires_at.isoformat(),
            "ttl_minutes": request.ttl_minutes,
        },
    )

    return BreakGlassGrantResponse(
        id=grant.id,
        organization_id=grant.organization_id,
        scope=grant.scope,
        token=plain_token,
        justification=grant.justification,
        expires_at=grant.expires_at.isoformat(),
        created_at=grant.created_at.isoformat(),
    )


@router.post(
    "/break-glass/grants/{grant_id}/revoke",
    response_model=BreakGlassRevokeResponse,
)
async def revoke_break_glass(
    grant_id: str,
    token: PilotToken = Depends(_require_admin),
) -> BreakGlassRevokeResponse:
    revoked = await revoke_break_glass_grant(
        organization_id=token.org_id,
        grant_id=grant_id,
        revoked_by_subject=token.sub,
    )

    if revoked:
        await record_audit_event(
            organization_id=token.org_id,
            action="security.break_glass.grant_revoked",
            actor_type="user",
            actor_id=token.sub,
            resource_type="security_break_glass_grant",
            resource_id=grant_id,
            metadata={},
        )

    return BreakGlassRevokeResponse(revoked=revoked)
