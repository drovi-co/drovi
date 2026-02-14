from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from src.agentos.control_plane import emit_control_plane_audit_event
from src.agentos.control_plane.governance_policy import GovernancePolicyService
from src.agentos.control_plane.models import (
    AgentServicePrincipalRecord,
    DelegatedAuthorityRecord,
    GovernancePolicyRecord,
)
from src.agentos.control_plane.service_principals import DelegatedAuthorityService, ServicePrincipalService
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context

from .agents_common import resolve_org_id

router = APIRouter()

_governance_policy = GovernancePolicyService()
_service_principals = ServicePrincipalService()
_delegated_authority = DelegatedAuthorityService()


class GovernancePolicyUpsertRequest(BaseModel):
    organization_id: str
    residency_region: str = "global"
    allowed_regions: list[str] = Field(default_factory=list)
    data_retention_days: int = Field(default=365, ge=1, le=36500)
    evidence_retention_days: int = Field(default=3650, ge=1, le=36500)
    require_residency_enforcement: bool = True
    enforce_delegated_authority: bool = False
    kill_switch_enabled: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class ServicePrincipalEnsureRequest(BaseModel):
    organization_id: str
    deployment_id: str
    principal_name: str | None = None
    allowed_scopes: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class DelegatedAuthorityGrantRequest(BaseModel):
    organization_id: str
    principal_id: str
    authority_scope: dict[str, Any] = Field(default_factory=dict)
    authority_reason: str | None = None
    valid_from: datetime | None = None
    valid_to: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class DelegatedAuthorityRevokeRequest(BaseModel):
    organization_id: str
    reason: str | None = None


@router.get("/governance/policy", response_model=GovernancePolicyRecord)
async def get_governance_policy(
    organization_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> GovernancePolicyRecord:
    org_id = resolve_org_id(auth, organization_id)
    return await _governance_policy.get_policy(organization_id=org_id)


@router.put("/governance/policy", response_model=GovernancePolicyRecord)
async def upsert_governance_policy(
    request: GovernancePolicyUpsertRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> GovernancePolicyRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    policy = await _governance_policy.upsert_policy(
        organization_id=org_id,
        policy=request.model_dump(mode="json"),
        updated_by_user_id=auth.user_id,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.governance.policy.updated",
        actor_id=auth.user_id,
        resource_type="agent_org_governance_policy",
        resource_id=org_id,
        metadata={
            "kill_switch_enabled": policy.kill_switch_enabled,
            "enforce_delegated_authority": policy.enforce_delegated_authority,
            "require_residency_enforcement": policy.require_residency_enforcement,
        },
    )
    return policy


@router.get("/governance/principals", response_model=list[AgentServicePrincipalRecord])
async def list_service_principals(
    organization_id: str | None = None,
    deployment_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentServicePrincipalRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _service_principals.list_principals(
        organization_id=org_id,
        deployment_id=deployment_id,
        status=status,
        limit=limit,
        offset=offset,
    )


@router.post("/governance/principals/ensure", response_model=AgentServicePrincipalRecord)
async def ensure_service_principal(
    request: ServicePrincipalEnsureRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentServicePrincipalRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    principal = await _service_principals.ensure_principal_for_deployment(
        organization_id=org_id,
        deployment_id=request.deployment_id,
        created_by_user_id=auth.user_id,
        principal_name=request.principal_name,
        allowed_scopes=request.allowed_scopes,
        metadata=request.metadata,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.governance.principal.ensured",
        actor_id=auth.user_id,
        resource_type="agent_service_principal",
        resource_id=principal.id,
        metadata={"deployment_id": principal.deployment_id},
    )
    return principal


@router.get("/governance/authorities", response_model=list[DelegatedAuthorityRecord])
async def list_delegated_authorities(
    organization_id: str | None = None,
    principal_id: str | None = Query(default=None),
    active_only: bool = Query(default=False),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[DelegatedAuthorityRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _delegated_authority.list_authorities(
        organization_id=org_id,
        principal_id=principal_id,
        active_only=active_only,
        limit=limit,
        offset=offset,
    )


@router.post("/governance/authorities", response_model=DelegatedAuthorityRecord)
async def grant_delegated_authority(
    request: DelegatedAuthorityGrantRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> DelegatedAuthorityRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    authority = await _delegated_authority.grant_authority(
        organization_id=org_id,
        principal_id=request.principal_id,
        authorized_by_user_id=auth.user_id,
        authority_scope=request.authority_scope,
        authority_reason=request.authority_reason,
        valid_from=request.valid_from,
        valid_to=request.valid_to,
        metadata=request.metadata,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.governance.authority.granted",
        actor_id=auth.user_id,
        resource_type="agent_delegated_authority",
        resource_id=authority.id,
        metadata={"principal_id": authority.principal_id},
    )
    return authority


@router.post("/governance/authorities/{authority_id}/revoke", response_model=DelegatedAuthorityRecord)
async def revoke_delegated_authority(
    authority_id: str,
    request: DelegatedAuthorityRevokeRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> DelegatedAuthorityRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    authority = await _delegated_authority.revoke_authority(
        organization_id=org_id,
        authority_id=authority_id,
        revoked_by_user_id=auth.user_id,
        reason=request.reason,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.governance.authority.revoked",
        actor_id=auth.user_id,
        resource_type="agent_delegated_authority",
        resource_id=authority.id,
        metadata={"principal_id": authority.principal_id, "reason": request.reason},
    )
    return authority
