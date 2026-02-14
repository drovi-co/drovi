from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.agentos.control_plane import (
    AgentRegistryService,
    DeploymentSnapshotCompiler,
    TriggerRoutingService,
    convert_continuum_to_playbook,
    emit_control_plane_audit_event,
)
from src.agentos.control_plane.models import (
    TriggerRouteDecision,
)
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context
from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.time import utc_now

from .agents_common import assert_org_access, as_json, resolve_org_id, row_dict

router = APIRouter()

_registry = AgentRegistryService()
_snapshot_compiler = DeploymentSnapshotCompiler(registry=_registry)
_routing_service = TriggerRoutingService(registry=_registry)


class AgentTriggerModel(BaseModel):
    id: str
    organization_id: str
    deployment_id: str
    trigger_type: Literal["manual", "event", "schedule"]
    trigger_spec: dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool = True
    created_at: Any
    updated_at: Any


class AgentTriggerCreateRequest(BaseModel):
    organization_id: str
    deployment_id: str
    trigger_type: Literal["manual", "event", "schedule"]
    trigger_spec: dict[str, Any] = Field(default_factory=dict)
    is_enabled: bool = True


class AgentTriggerUpdateRequest(BaseModel):
    trigger_type: Literal["manual", "event", "schedule"] | None = None
    trigger_spec: dict[str, Any] | None = None
    is_enabled: bool | None = None


class TriggerSimulationRequest(BaseModel):
    organization_id: str
    trigger_type: Literal["manual", "event", "schedule"]
    deployment_id: str | None = None
    event_name: str | None = None
    source: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConfigLintRequest(BaseModel):
    organization_id: str
    deployment_id: str
    extra_tools: list[str] = Field(default_factory=list)


class ConfigLintResponse(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    compiled_policy: dict[str, Any] | None = None


class ContinuumAdapterRequest(BaseModel):
    continuum_definition: dict[str, Any]


class ContinuumAdapterResponse(BaseModel):
    playbook: dict[str, Any]
    trigger_hint: dict[str, Any]
    warnings: list[str] = Field(default_factory=list)


class DeploymentSnapshotResponse(BaseModel):
    deployment_id: str
    organization_id: str
    snapshot_hash: str
    snapshot: dict[str, Any]


@router.get("/triggers", response_model=list[AgentTriggerModel])
async def list_triggers(
    organization_id: str | None = None,
    deployment_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentTriggerModel]:
    org_id = resolve_org_id(auth, organization_id)
    query = """
        SELECT id, organization_id, deployment_id, trigger_type, trigger_spec, is_enabled, created_at, updated_at
        FROM agent_trigger
        WHERE organization_id = :organization_id
    """
    params: dict[str, Any] = {"organization_id": org_id, "limit": limit, "offset": offset}
    if deployment_id:
        query += " AND deployment_id = :deployment_id"
        params["deployment_id"] = deployment_id
    query += " ORDER BY updated_at DESC LIMIT :limit OFFSET :offset"

    async with get_db_session() as session:
        result = await session.execute(text(query), params)
        rows = [row_dict(row, json_fields={"trigger_spec"}) for row in result.fetchall()]
    return [AgentTriggerModel.model_validate(row) for row in rows]


@router.post("/triggers", response_model=AgentTriggerModel)
async def create_trigger(
    request: AgentTriggerCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentTriggerModel:
    org_id = resolve_org_id(auth, request.organization_id)
    trigger_id = new_prefixed_id("agtrg")
    now = utc_now()

    async with get_db_session() as session:
        dep_result = await session.execute(
            text("SELECT organization_id FROM agent_deployment WHERE id = :id"),
            {"id": request.deployment_id},
        )
        dep_row = dep_result.fetchone()
        if dep_row is None:
            raise HTTPException(status_code=404, detail="Deployment not found")
        assert_org_access(auth, str(dep_row.organization_id))

        await session.execute(
            text(
                """
                INSERT INTO agent_trigger (
                    id, organization_id, deployment_id, trigger_type, trigger_spec, is_enabled, created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :deployment_id, :trigger_type, CAST(:trigger_spec AS JSONB),
                    :is_enabled, :created_at, :updated_at
                )
                """
            ),
            {
                "id": trigger_id,
                "organization_id": org_id,
                "deployment_id": request.deployment_id,
                "trigger_type": request.trigger_type,
                "trigger_spec": as_json(request.trigger_spec),
                "is_enabled": request.is_enabled,
                "created_at": now,
                "updated_at": now,
            },
        )
        await session.commit()
        created = await session.execute(
            text(
                """
                SELECT id, organization_id, deployment_id, trigger_type, trigger_spec, is_enabled, created_at, updated_at
                FROM agent_trigger
                WHERE id = :id
                """
            ),
            {"id": trigger_id},
        )
        row = created.fetchone()

    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.trigger.created",
        actor_id=auth.user_id,
        resource_type="agent_trigger",
        resource_id=trigger_id,
        metadata={"deployment_id": request.deployment_id, "trigger_type": request.trigger_type},
    )
    return AgentTriggerModel.model_validate(row_dict(row, json_fields={"trigger_spec"}))


@router.patch("/triggers/{trigger_id}", response_model=AgentTriggerModel)
async def update_trigger(
    trigger_id: str,
    request: AgentTriggerUpdateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentTriggerModel:
    updates: dict[str, Any] = {}
    if request.trigger_type is not None:
        updates["trigger_type"] = request.trigger_type
    if request.trigger_spec is not None:
        updates["trigger_spec"] = as_json(request.trigger_spec)
    if request.is_enabled is not None:
        updates["is_enabled"] = request.is_enabled
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    async with get_db_session() as session:
        current = await session.execute(
            text("SELECT organization_id FROM agent_trigger WHERE id = :id"),
            {"id": trigger_id},
        )
        current_row = current.fetchone()
        if current_row is None:
            raise HTTPException(status_code=404, detail="Trigger not found")
        assert_org_access(auth, str(current_row.organization_id))

        params: dict[str, Any] = {"id": trigger_id, "updated_at": utc_now()}
        set_parts: list[str] = []
        for key, value in updates.items():
            if key == "trigger_spec":
                set_parts.append("trigger_spec = CAST(:trigger_spec AS JSONB)")
            else:
                set_parts.append(f"{key} = :{key}")
            params[key] = value
        set_parts.append("updated_at = :updated_at")

        await session.execute(text(f"UPDATE agent_trigger SET {', '.join(set_parts)} WHERE id = :id"), params)
        await session.commit()
        updated = await session.execute(
            text(
                """
                SELECT id, organization_id, deployment_id, trigger_type, trigger_spec, is_enabled, created_at, updated_at
                FROM agent_trigger
                WHERE id = :id
                """
            ),
            {"id": trigger_id},
        )
        row = updated.fetchone()

    await emit_control_plane_audit_event(
        organization_id=str(current_row.organization_id),
        action="agentos.trigger.updated",
        actor_id=auth.user_id,
        resource_type="agent_trigger",
        resource_id=trigger_id,
        metadata={"updated_fields": sorted(list(updates.keys()))},
    )
    return AgentTriggerModel.model_validate(row_dict(row, json_fields={"trigger_spec"}))


@router.delete("/triggers/{trigger_id}")
async def delete_trigger(trigger_id: str, auth: AuthContext = Depends(get_auth_context)) -> dict[str, str]:
    async with get_db_session() as session:
        current = await session.execute(
            text("SELECT organization_id FROM agent_trigger WHERE id = :id"),
            {"id": trigger_id},
        )
        row = current.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Trigger not found")
        assert_org_access(auth, str(row.organization_id))
        await session.execute(text("DELETE FROM agent_trigger WHERE id = :id"), {"id": trigger_id})
        await session.commit()

    await emit_control_plane_audit_event(
        organization_id=str(row.organization_id),
        action="agentos.trigger.deleted",
        actor_id=auth.user_id,
        resource_type="agent_trigger",
        resource_id=trigger_id,
    )
    return {"status": "deleted", "trigger_id": trigger_id}


@router.post("/control/trigger-simulate", response_model=TriggerRouteDecision)
async def simulate_trigger(
    request: TriggerSimulationRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> TriggerRouteDecision:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _routing_service.simulate(
        organization_id=org_id,
        trigger_type=request.trigger_type,
        deployment_id=request.deployment_id,
        event_name=request.event_name,
        source=request.source,
        metadata=request.metadata,
    )


@router.post("/control/lint-config", response_model=ConfigLintResponse)
async def lint_config(
    request: ConfigLintRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> ConfigLintResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    lint = await _snapshot_compiler.lint_deployment_config(
        organization_id=org_id,
        deployment_id=request.deployment_id,
        extra_tools=request.extra_tools,
    )
    return ConfigLintResponse(
        valid=lint.valid,
        errors=lint.errors,
        warnings=lint.warnings,
        compiled_policy=lint.compiled_policy.model_dump(mode="json") if lint.compiled_policy else None,
    )


@router.post("/control/compat/continuum-preview", response_model=ContinuumAdapterResponse)
async def continuum_adapter_preview(
    request: ContinuumAdapterRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> ContinuumAdapterResponse:
    del auth
    adapted = convert_continuum_to_playbook(request.continuum_definition)
    return ContinuumAdapterResponse.model_validate(adapted)


@router.get("/deployments/{deployment_id}/snapshot", response_model=DeploymentSnapshotResponse)
async def get_deployment_snapshot(
    deployment_id: str,
    organization_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> DeploymentSnapshotResponse:
    org_id = resolve_org_id(auth, organization_id)
    snapshot = await _snapshot_compiler.compile_for_deployment(
        organization_id=org_id,
        deployment_id=deployment_id,
        force_refresh=False,
    )
    return DeploymentSnapshotResponse(
        deployment_id=snapshot.deployment_id,
        organization_id=snapshot.organization_id,
        snapshot_hash=snapshot.snapshot_hash,
        snapshot=snapshot.model_dump(mode="json"),
    )
