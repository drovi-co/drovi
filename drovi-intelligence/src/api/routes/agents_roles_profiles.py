from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.agentos.control_plane import emit_control_plane_audit_event
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context
from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.time import utc_now

from .agents_common import assert_org_access, as_json, resolve_org_id, row_dict

router = APIRouter()


class AgentRoleModel(BaseModel):
    id: str
    organization_id: str
    role_key: str
    name: str
    description: str | None = None
    domain: str | None = None
    status: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_by_user_id: str | None = None
    created_at: Any
    updated_at: Any


class AgentRoleCreateRequest(BaseModel):
    organization_id: str
    role_key: str = Field(..., min_length=2, max_length=128)
    name: str = Field(..., min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    domain: str | None = Field(default=None, max_length=128)
    status: Literal["draft", "active", "archived"] = "draft"
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentRoleUpdateRequest(BaseModel):
    role_key: str | None = Field(default=None, min_length=2, max_length=128)
    name: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    domain: str | None = Field(default=None, max_length=128)
    status: Literal["draft", "active", "archived"] | None = None
    metadata: dict[str, Any] | None = None


class PermissionScope(BaseModel):
    tools: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    channels: list[Literal["email", "slack", "teams", "api", "desktop"]] = Field(default_factory=list)
    allow_external_send: bool = False
    allowed_domains: list[str] = Field(default_factory=list)


class AgentProfileModel(BaseModel):
    id: str
    organization_id: str
    role_id: str
    name: str
    autonomy_tier: Literal["L0", "L1", "L2", "L3", "L4"]
    model_policy: dict[str, Any] = Field(default_factory=dict)
    tool_policy: dict[str, Any] = Field(default_factory=dict)
    permission_scope: PermissionScope
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: Any
    updated_at: Any


class AgentProfileCreateRequest(BaseModel):
    organization_id: str
    role_id: str
    name: str = Field(..., min_length=2, max_length=200)
    autonomy_tier: Literal["L0", "L1", "L2", "L3", "L4"] = "L1"
    model_policy: dict[str, Any] = Field(default_factory=dict)
    tool_policy: dict[str, Any] = Field(default_factory=dict)
    permission_scope: PermissionScope = Field(default_factory=PermissionScope)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentProfileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    autonomy_tier: Literal["L0", "L1", "L2", "L3", "L4"] | None = None
    model_policy: dict[str, Any] | None = None
    tool_policy: dict[str, Any] | None = None
    permission_scope: PermissionScope | None = None
    metadata: dict[str, Any] | None = None


@router.get("/roles", response_model=list[AgentRoleModel])
async def list_roles(
    organization_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentRoleModel]:
    org_id = resolve_org_id(auth, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, organization_id, role_key, name, description, domain, status, metadata,
                       created_by_user_id, created_at, updated_at
                FROM agent_role
                WHERE organization_id = :organization_id
                ORDER BY updated_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"organization_id": org_id, "limit": limit, "offset": offset},
        )
        rows = [row_dict(row, json_fields={"metadata"}) for row in result.fetchall()]
    return [AgentRoleModel.model_validate(row) for row in rows]


@router.post("/roles", response_model=AgentRoleModel)
async def create_role(
    request: AgentRoleCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentRoleModel:
    org_id = resolve_org_id(auth, request.organization_id)
    role_id = new_prefixed_id("agrole")
    now = utc_now()
    async with get_db_session() as session:
        try:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_role (
                        id, organization_id, role_key, name, description, domain, status, metadata,
                        created_by_user_id, created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :role_key, :name, :description, :domain, :status,
                        CAST(:metadata AS JSONB), :created_by_user_id, :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": role_id,
                    "organization_id": org_id,
                    "role_key": request.role_key,
                    "name": request.name,
                    "description": request.description,
                    "domain": request.domain,
                    "status": request.status,
                    "metadata": as_json(request.metadata),
                    "created_by_user_id": auth.user_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
        except Exception as exc:
            await session.rollback()
            raise HTTPException(status_code=409, detail=f"Failed to create role: {exc}") from exc
        created = await session.execute(
            text(
                """
                SELECT id, organization_id, role_key, name, description, domain, status, metadata,
                       created_by_user_id, created_at, updated_at
                FROM agent_role
                WHERE id = :id
                """
            ),
            {"id": role_id},
        )
        row = created.fetchone()
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.role.created",
        actor_id=auth.user_id,
        resource_type="agent_role",
        resource_id=role_id,
        metadata={"role_key": request.role_key},
    )
    return AgentRoleModel.model_validate(row_dict(row, json_fields={"metadata"}))


@router.get("/roles/{role_id}", response_model=AgentRoleModel)
async def get_role(role_id: str, auth: AuthContext = Depends(get_auth_context)) -> AgentRoleModel:
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, organization_id, role_key, name, description, domain, status, metadata,
                       created_by_user_id, created_at, updated_at
                FROM agent_role
                WHERE id = :id
                """
            ),
            {"id": role_id},
        )
        row = result.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Role not found")
    payload = row_dict(row, json_fields={"metadata"})
    assert_org_access(auth, payload["organization_id"])
    return AgentRoleModel.model_validate(payload)


@router.patch("/roles/{role_id}", response_model=AgentRoleModel)
async def update_role(
    role_id: str,
    request: AgentRoleUpdateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentRoleModel:
    updates: dict[str, Any] = {}
    if request.role_key is not None:
        updates["role_key"] = request.role_key
    if request.name is not None:
        updates["name"] = request.name
    if request.description is not None:
        updates["description"] = request.description
    if request.domain is not None:
        updates["domain"] = request.domain
    if request.status is not None:
        updates["status"] = request.status
    if request.metadata is not None:
        updates["metadata"] = as_json(request.metadata)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    async with get_db_session() as session:
        current = await session.execute(text("SELECT organization_id FROM agent_role WHERE id = :id"), {"id": role_id})
        row = current.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Role not found")
        assert_org_access(auth, str(row.organization_id))

        set_parts: list[str] = []
        params: dict[str, Any] = {"id": role_id, "updated_at": utc_now()}
        for key, value in updates.items():
            if key == "metadata":
                set_parts.append("metadata = CAST(:metadata AS JSONB)")
            else:
                set_parts.append(f"{key} = :{key}")
            params[key] = value
        set_parts.append("updated_at = :updated_at")
        await session.execute(text(f"UPDATE agent_role SET {', '.join(set_parts)} WHERE id = :id"), params)
        await session.commit()

        updated = await session.execute(
            text(
                """
                SELECT id, organization_id, role_key, name, description, domain, status, metadata,
                       created_by_user_id, created_at, updated_at
                FROM agent_role
                WHERE id = :id
                """
            ),
            {"id": role_id},
        )
        updated_row = updated.fetchone()
    await emit_control_plane_audit_event(
        organization_id=str(row.organization_id),
        action="agentos.role.updated",
        actor_id=auth.user_id,
        resource_type="agent_role",
        resource_id=role_id,
        metadata={"updated_fields": sorted(list(updates.keys()))},
    )
    return AgentRoleModel.model_validate(row_dict(updated_row, json_fields={"metadata"}))


@router.delete("/roles/{role_id}")
async def delete_role(role_id: str, auth: AuthContext = Depends(get_auth_context)) -> dict[str, str]:
    async with get_db_session() as session:
        current = await session.execute(text("SELECT organization_id FROM agent_role WHERE id = :id"), {"id": role_id})
        row = current.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Role not found")
        assert_org_access(auth, str(row.organization_id))
        await session.execute(text("DELETE FROM agent_role WHERE id = :id"), {"id": role_id})
        await session.commit()
    await emit_control_plane_audit_event(
        organization_id=str(row.organization_id),
        action="agentos.role.deleted",
        actor_id=auth.user_id,
        resource_type="agent_role",
        resource_id=role_id,
    )
    return {"status": "deleted", "role_id": role_id}


@router.get("/profiles", response_model=list[AgentProfileModel])
async def list_profiles(
    organization_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentProfileModel]:
    org_id = resolve_org_id(auth, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, organization_id, role_id, name, autonomy_tier, model_policy, tool_policy,
                       permission_scope, metadata, created_at, updated_at
                FROM agent_profile
                WHERE organization_id = :organization_id
                ORDER BY updated_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"organization_id": org_id, "limit": limit, "offset": offset},
        )
        rows = [
            row_dict(row, json_fields={"model_policy", "tool_policy", "permission_scope", "metadata"})
            for row in result.fetchall()
        ]
    return [AgentProfileModel.model_validate(row) for row in rows]


@router.post("/profiles", response_model=AgentProfileModel)
async def create_profile(
    request: AgentProfileCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentProfileModel:
    org_id = resolve_org_id(auth, request.organization_id)
    profile_id = new_prefixed_id("agprof")
    now = utc_now()
    async with get_db_session() as session:
        try:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_profile (
                        id, organization_id, role_id, name, autonomy_tier,
                        model_policy, tool_policy, permission_scope, metadata, created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :role_id, :name, :autonomy_tier,
                        CAST(:model_policy AS JSONB), CAST(:tool_policy AS JSONB),
                        CAST(:permission_scope AS JSONB), CAST(:metadata AS JSONB),
                        :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": profile_id,
                    "organization_id": org_id,
                    "role_id": request.role_id,
                    "name": request.name,
                    "autonomy_tier": request.autonomy_tier,
                    "model_policy": as_json(request.model_policy),
                    "tool_policy": as_json(request.tool_policy),
                    "permission_scope": as_json(request.permission_scope.model_dump(mode="json")),
                    "metadata": as_json(request.metadata),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
        except Exception as exc:
            await session.rollback()
            raise HTTPException(status_code=409, detail=f"Failed to create profile: {exc}") from exc

        created = await session.execute(
            text(
                """
                SELECT id, organization_id, role_id, name, autonomy_tier, model_policy, tool_policy,
                       permission_scope, metadata, created_at, updated_at
                FROM agent_profile
                WHERE id = :id
                """
            ),
            {"id": profile_id},
        )
        row = created.fetchone()
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.profile.created",
        actor_id=auth.user_id,
        resource_type="agent_profile",
        resource_id=profile_id,
        metadata={"role_id": request.role_id, "autonomy_tier": request.autonomy_tier},
    )
    return AgentProfileModel.model_validate(
        row_dict(row, json_fields={"model_policy", "tool_policy", "permission_scope", "metadata"})
    )


@router.get("/profiles/{profile_id}", response_model=AgentProfileModel)
async def get_profile(profile_id: str, auth: AuthContext = Depends(get_auth_context)) -> AgentProfileModel:
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, organization_id, role_id, name, autonomy_tier, model_policy, tool_policy,
                       permission_scope, metadata, created_at, updated_at
                FROM agent_profile
                WHERE id = :id
                """
            ),
            {"id": profile_id},
        )
        row = result.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    payload = row_dict(row, json_fields={"model_policy", "tool_policy", "permission_scope", "metadata"})
    assert_org_access(auth, payload["organization_id"])
    return AgentProfileModel.model_validate(payload)


@router.patch("/profiles/{profile_id}", response_model=AgentProfileModel)
async def update_profile(
    profile_id: str,
    request: AgentProfileUpdateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentProfileModel:
    updates: dict[str, Any] = {}
    if request.name is not None:
        updates["name"] = request.name
    if request.autonomy_tier is not None:
        updates["autonomy_tier"] = request.autonomy_tier
    if request.model_policy is not None:
        updates["model_policy"] = as_json(request.model_policy)
    if request.tool_policy is not None:
        updates["tool_policy"] = as_json(request.tool_policy)
    if request.permission_scope is not None:
        updates["permission_scope"] = as_json(request.permission_scope.model_dump(mode="json"))
    if request.metadata is not None:
        updates["metadata"] = as_json(request.metadata)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    async with get_db_session() as session:
        current = await session.execute(text("SELECT organization_id FROM agent_profile WHERE id = :id"), {"id": profile_id})
        row = current.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Profile not found")
        assert_org_access(auth, str(row.organization_id))

        set_parts: list[str] = []
        params: dict[str, Any] = {"id": profile_id, "updated_at": utc_now()}
        for key, value in updates.items():
            if key in {"model_policy", "tool_policy", "permission_scope", "metadata"}:
                set_parts.append(f"{key} = CAST(:{key} AS JSONB)")
            else:
                set_parts.append(f"{key} = :{key}")
            params[key] = value
        set_parts.append("updated_at = :updated_at")
        await session.execute(text(f"UPDATE agent_profile SET {', '.join(set_parts)} WHERE id = :id"), params)
        await session.commit()

        updated = await session.execute(
            text(
                """
                SELECT id, organization_id, role_id, name, autonomy_tier, model_policy, tool_policy,
                       permission_scope, metadata, created_at, updated_at
                FROM agent_profile
                WHERE id = :id
                """
            ),
            {"id": profile_id},
        )
        updated_row = updated.fetchone()
    await emit_control_plane_audit_event(
        organization_id=str(row.organization_id),
        action="agentos.profile.updated",
        actor_id=auth.user_id,
        resource_type="agent_profile",
        resource_id=profile_id,
        metadata={"updated_fields": sorted(list(updates.keys()))},
    )
    return AgentProfileModel.model_validate(
        row_dict(updated_row, json_fields={"model_policy", "tool_policy", "permission_scope", "metadata"})
    )


@router.delete("/profiles/{profile_id}")
async def delete_profile(profile_id: str, auth: AuthContext = Depends(get_auth_context)) -> dict[str, str]:
    async with get_db_session() as session:
        current = await session.execute(text("SELECT organization_id FROM agent_profile WHERE id = :id"), {"id": profile_id})
        row = current.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Profile not found")
        assert_org_access(auth, str(row.organization_id))
        await session.execute(text("DELETE FROM agent_profile WHERE id = :id"), {"id": profile_id})
        await session.commit()
    await emit_control_plane_audit_event(
        organization_id=str(row.organization_id),
        action="agentos.profile.deleted",
        actor_id=auth.user_id,
        resource_type="agent_profile",
        resource_id=profile_id,
    )
    return {"status": "deleted", "profile_id": profile_id}
