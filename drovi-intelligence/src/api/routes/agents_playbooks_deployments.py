from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
import structlog

from src.agentos.control_plane import DeploymentSnapshotCompiler, emit_control_plane_audit_event
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context
from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.time import utc_now

from .agents_common import assert_org_access, as_json, build_snapshot_hash, resolve_org_id, row_dict

router = APIRouter()
_snapshot_compiler = DeploymentSnapshotCompiler()
logger = structlog.get_logger()


class AgentPlaybookModel(BaseModel):
    id: str
    organization_id: str
    role_id: str
    version: int
    name: str
    objective: str
    constraints: dict[str, Any] = Field(default_factory=dict)
    sop: dict[str, Any] = Field(default_factory=dict)
    success_criteria: dict[str, Any] = Field(default_factory=dict)
    escalation_policy: dict[str, Any] = Field(default_factory=dict)
    dsl: dict[str, Any] = Field(default_factory=dict)
    status: Literal["draft", "active", "archived"]
    created_at: Any
    updated_at: Any


class AgentPlaybookCreateRequest(BaseModel):
    organization_id: str
    role_id: str
    version: int | None = Field(default=None, ge=1)
    name: str = Field(..., min_length=2, max_length=200)
    objective: str = Field(..., min_length=5, max_length=5000)
    constraints: dict[str, Any] = Field(default_factory=dict)
    sop: dict[str, Any] = Field(default_factory=dict)
    success_criteria: dict[str, Any] = Field(default_factory=dict)
    escalation_policy: dict[str, Any] = Field(default_factory=dict)
    dsl: dict[str, Any] = Field(default_factory=dict)
    status: Literal["draft", "active", "archived"] = "draft"


class AgentPlaybookUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    objective: str | None = Field(default=None, min_length=5, max_length=5000)
    constraints: dict[str, Any] | None = None
    sop: dict[str, Any] | None = None
    success_criteria: dict[str, Any] | None = None
    escalation_policy: dict[str, Any] | None = None
    dsl: dict[str, Any] | None = None
    status: Literal["draft", "active", "archived"] | None = None


class PlaybookLintRequest(BaseModel):
    objective: str = Field(..., min_length=1)
    sop: dict[str, Any] = Field(default_factory=dict)
    constraints: dict[str, Any] = Field(default_factory=dict)
    success_criteria: dict[str, Any] = Field(default_factory=dict)


class PlaybookLintResponse(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class AgentDeploymentModel(BaseModel):
    id: str
    organization_id: str
    role_id: str
    profile_id: str
    playbook_id: str
    version: int
    status: Literal["draft", "canary", "active", "rolled_back", "archived"]
    rollout_strategy: dict[str, Any] = Field(default_factory=dict)
    snapshot_hash: str
    published_at: Any | None = None
    created_by_user_id: str | None = None
    created_at: Any
    updated_at: Any


class AgentDeploymentCreateRequest(BaseModel):
    organization_id: str
    role_id: str
    profile_id: str
    playbook_id: str
    version: int | None = Field(default=None, ge=1)
    status: Literal["draft", "canary", "active", "rolled_back", "archived"] = "draft"
    rollout_strategy: dict[str, Any] = Field(default_factory=dict)


class DeploymentActionResponse(BaseModel):
    deployment_id: str
    status: str
    updated_at: Any


class AgentCatalogItem(BaseModel):
    role_id: str
    role_name: str
    domain: str | None = None
    deployment_id: str
    deployment_version: int
    deployment_status: str
    playbook_name: str
    updated_at: Any


@router.get("/playbooks", response_model=list[AgentPlaybookModel])
async def list_playbooks(
    organization_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentPlaybookModel]:
    org_id = resolve_org_id(auth, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, organization_id, role_id, version, name, objective, constraints, sop,
                       success_criteria, escalation_policy, dsl, status, created_at, updated_at
                FROM agent_playbook
                WHERE organization_id = :organization_id
                ORDER BY updated_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"organization_id": org_id, "limit": limit, "offset": offset},
        )
        rows = [
            row_dict(row, json_fields={"constraints", "sop", "success_criteria", "escalation_policy", "dsl"})
            for row in result.fetchall()
        ]
    return [AgentPlaybookModel.model_validate(row) for row in rows]


@router.post("/playbooks", response_model=AgentPlaybookModel)
async def create_playbook(
    request: AgentPlaybookCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentPlaybookModel:
    org_id = resolve_org_id(auth, request.organization_id)
    playbook_id = new_prefixed_id("agplay")
    now = utc_now()

    async with get_db_session() as session:
        version = request.version
        if version is None:
            latest = await session.execute(
                text("SELECT COALESCE(MAX(version), 0) AS max_version FROM agent_playbook WHERE role_id = :role_id"),
                {"role_id": request.role_id},
            )
            max_version_row = latest.fetchone()
            version = int(max_version_row.max_version) + 1 if max_version_row is not None else 1

        try:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_playbook (
                        id, organization_id, role_id, version, name, objective, constraints, sop,
                        success_criteria, escalation_policy, dsl, status, created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :role_id, :version, :name, :objective,
                        CAST(:constraints AS JSONB), CAST(:sop AS JSONB), CAST(:success_criteria AS JSONB),
                        CAST(:escalation_policy AS JSONB), CAST(:dsl AS JSONB), :status, :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": playbook_id,
                    "organization_id": org_id,
                    "role_id": request.role_id,
                    "version": version,
                    "name": request.name,
                    "objective": request.objective,
                    "constraints": as_json(request.constraints),
                    "sop": as_json(request.sop),
                    "success_criteria": as_json(request.success_criteria),
                    "escalation_policy": as_json(request.escalation_policy),
                    "dsl": as_json(request.dsl),
                    "status": request.status,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
        except Exception as exc:
            await session.rollback()
            raise HTTPException(status_code=409, detail=f"Failed to create playbook: {exc}") from exc

        created = await session.execute(
            text(
                """
                SELECT id, organization_id, role_id, version, name, objective, constraints, sop,
                       success_criteria, escalation_policy, dsl, status, created_at, updated_at
                FROM agent_playbook
                WHERE id = :id
                """
            ),
            {"id": playbook_id},
        )
        row = created.fetchone()
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.playbook.created",
        actor_id=auth.user_id,
        resource_type="agent_playbook",
        resource_id=playbook_id,
        metadata={"role_id": request.role_id, "version": version},
    )
    return AgentPlaybookModel.model_validate(
        row_dict(row, json_fields={"constraints", "sop", "success_criteria", "escalation_policy", "dsl"})
    )


@router.get("/playbooks/{playbook_id}", response_model=AgentPlaybookModel)
async def get_playbook(playbook_id: str, auth: AuthContext = Depends(get_auth_context)) -> AgentPlaybookModel:
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, organization_id, role_id, version, name, objective, constraints, sop,
                       success_criteria, escalation_policy, dsl, status, created_at, updated_at
                FROM agent_playbook
                WHERE id = :id
                """
            ),
            {"id": playbook_id},
        )
        row = result.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Playbook not found")
    payload = row_dict(row, json_fields={"constraints", "sop", "success_criteria", "escalation_policy", "dsl"})
    assert_org_access(auth, payload["organization_id"])
    return AgentPlaybookModel.model_validate(payload)


@router.patch("/playbooks/{playbook_id}", response_model=AgentPlaybookModel)
async def update_playbook(
    playbook_id: str,
    request: AgentPlaybookUpdateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentPlaybookModel:
    updates: dict[str, Any] = {}
    for field in ("name", "objective", "status"):
        value = getattr(request, field)
        if value is not None:
            updates[field] = value
    for field in ("constraints", "sop", "success_criteria", "escalation_policy", "dsl"):
        value = getattr(request, field)
        if value is not None:
            updates[field] = as_json(value)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    async with get_db_session() as session:
        current = await session.execute(text("SELECT organization_id FROM agent_playbook WHERE id = :id"), {"id": playbook_id})
        row = current.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Playbook not found")
        assert_org_access(auth, str(row.organization_id))

        set_parts: list[str] = []
        params: dict[str, Any] = {"id": playbook_id, "updated_at": utc_now()}
        for key, value in updates.items():
            if key in {"constraints", "sop", "success_criteria", "escalation_policy", "dsl"}:
                set_parts.append(f"{key} = CAST(:{key} AS JSONB)")
            else:
                set_parts.append(f"{key} = :{key}")
            params[key] = value
        set_parts.append("updated_at = :updated_at")
        await session.execute(text(f"UPDATE agent_playbook SET {', '.join(set_parts)} WHERE id = :id"), params)
        await session.commit()

        updated = await session.execute(
            text(
                """
                SELECT id, organization_id, role_id, version, name, objective, constraints, sop,
                       success_criteria, escalation_policy, dsl, status, created_at, updated_at
                FROM agent_playbook
                WHERE id = :id
                """
            ),
            {"id": playbook_id},
        )
        updated_row = updated.fetchone()
    await emit_control_plane_audit_event(
        organization_id=str(row.organization_id),
        action="agentos.playbook.updated",
        actor_id=auth.user_id,
        resource_type="agent_playbook",
        resource_id=playbook_id,
        metadata={"updated_fields": sorted(list(updates.keys()))},
    )
    return AgentPlaybookModel.model_validate(
        row_dict(updated_row, json_fields={"constraints", "sop", "success_criteria", "escalation_policy", "dsl"})
    )


@router.delete("/playbooks/{playbook_id}")
async def delete_playbook(playbook_id: str, auth: AuthContext = Depends(get_auth_context)) -> dict[str, str]:
    async with get_db_session() as session:
        current = await session.execute(text("SELECT organization_id FROM agent_playbook WHERE id = :id"), {"id": playbook_id})
        row = current.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Playbook not found")
        assert_org_access(auth, str(row.organization_id))
        await session.execute(text("DELETE FROM agent_playbook WHERE id = :id"), {"id": playbook_id})
        await session.commit()
    await emit_control_plane_audit_event(
        organization_id=str(row.organization_id),
        action="agentos.playbook.deleted",
        actor_id=auth.user_id,
        resource_type="agent_playbook",
        resource_id=playbook_id,
    )
    return {"status": "deleted", "playbook_id": playbook_id}


@router.post("/playbooks/lint", response_model=PlaybookLintResponse)
async def lint_playbook(request: PlaybookLintRequest) -> PlaybookLintResponse:
    errors: list[str] = []
    warnings: list[str] = []

    if len(request.objective.strip()) < 10:
        errors.append("objective must contain at least 10 characters")
    if not request.sop:
        warnings.append("sop is empty; add explicit execution steps")
    if not request.success_criteria:
        warnings.append("success_criteria is empty; quality outcomes may be ambiguous")
    if "forbidden_tools" not in request.constraints:
        warnings.append("constraints.forbidden_tools is missing")

    return PlaybookLintResponse(valid=len(errors) == 0, errors=errors, warnings=warnings)


@router.get("/deployments", response_model=list[AgentDeploymentModel])
async def list_deployments(
    organization_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentDeploymentModel]:
    org_id = resolve_org_id(auth, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, organization_id, role_id, profile_id, playbook_id, version, status,
                       rollout_strategy, snapshot_hash, published_at, created_by_user_id, created_at, updated_at
                FROM agent_deployment
                WHERE organization_id = :organization_id
                ORDER BY updated_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"organization_id": org_id, "limit": limit, "offset": offset},
        )
        rows = [row_dict(row, json_fields={"rollout_strategy"}) for row in result.fetchall()]
    return [AgentDeploymentModel.model_validate(row) for row in rows]


@router.post("/deployments", response_model=AgentDeploymentModel)
async def create_deployment(
    request: AgentDeploymentCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentDeploymentModel:
    org_id = resolve_org_id(auth, request.organization_id)
    deployment_id = new_prefixed_id("agdep")
    now = utc_now()
    snapshot_hash = build_snapshot_hash(
        role_id=request.role_id,
        profile_id=request.profile_id,
        playbook_id=request.playbook_id,
        rollout_strategy=request.rollout_strategy,
    )

    async with get_db_session() as session:
        version = request.version
        if version is None:
            latest = await session.execute(
                text("SELECT COALESCE(MAX(version), 0) AS max_version FROM agent_deployment WHERE role_id = :role_id"),
                {"role_id": request.role_id},
            )
            max_version_row = latest.fetchone()
            version = int(max_version_row.max_version) + 1 if max_version_row is not None else 1

        try:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_deployment (
                        id, organization_id, role_id, profile_id, playbook_id, version, status,
                        rollout_strategy, snapshot_hash, published_at, created_by_user_id, created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :role_id, :profile_id, :playbook_id, :version, :status,
                        CAST(:rollout_strategy AS JSONB), :snapshot_hash, NULL, :created_by_user_id, :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": deployment_id,
                    "organization_id": org_id,
                    "role_id": request.role_id,
                    "profile_id": request.profile_id,
                    "playbook_id": request.playbook_id,
                    "version": version,
                    "status": request.status,
                    "rollout_strategy": as_json(request.rollout_strategy),
                    "snapshot_hash": snapshot_hash,
                    "created_by_user_id": auth.user_id,
                    "created_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
        except Exception as exc:
            await session.rollback()
            raise HTTPException(status_code=409, detail=f"Failed to create deployment: {exc}") from exc

    try:
        snapshot = await _snapshot_compiler.compile_for_deployment(
            organization_id=org_id,
            deployment_id=deployment_id,
            force_refresh=True,
        )
    except Exception as exc:
        async with get_db_session() as cleanup:
            await cleanup.execute(text("DELETE FROM agent_deployment WHERE id = :id"), {"id": deployment_id})
            await cleanup.commit()
        raise HTTPException(status_code=409, detail=f"Failed to compile deployment snapshot: {exc}") from exc

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                UPDATE agent_deployment
                SET snapshot_hash = :snapshot_hash,
                    updated_at = :updated_at
                WHERE id = :id
                """
            ),
            {"id": deployment_id, "snapshot_hash": snapshot.snapshot_hash, "updated_at": utc_now()},
        )
        await session.commit()
        created = await session.execute(
            text(
                """
                SELECT id, organization_id, role_id, profile_id, playbook_id, version, status,
                       rollout_strategy, snapshot_hash, published_at, created_by_user_id, created_at, updated_at
                FROM agent_deployment
                WHERE id = :id
                """
            ),
            {"id": deployment_id},
        )
        row = created.fetchone()
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.deployment.created",
        actor_id=auth.user_id,
        resource_type="agent_deployment",
        resource_id=deployment_id,
        metadata={
            "role_id": request.role_id,
            "profile_id": request.profile_id,
            "playbook_id": request.playbook_id,
            "version": version,
            "snapshot_hash": snapshot.snapshot_hash,
        },
    )
    return AgentDeploymentModel.model_validate(row_dict(row, json_fields={"rollout_strategy"}))


@router.get("/deployments/{deployment_id}", response_model=AgentDeploymentModel)
async def get_deployment(deployment_id: str, auth: AuthContext = Depends(get_auth_context)) -> AgentDeploymentModel:
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, organization_id, role_id, profile_id, playbook_id, version, status,
                       rollout_strategy, snapshot_hash, published_at, created_by_user_id, created_at, updated_at
                FROM agent_deployment
                WHERE id = :id
                """
            ),
            {"id": deployment_id},
        )
        row = result.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Deployment not found")
    payload = row_dict(row, json_fields={"rollout_strategy"})
    assert_org_access(auth, payload["organization_id"])
    return AgentDeploymentModel.model_validate(payload)


@router.post("/deployments/{deployment_id}/promote", response_model=DeploymentActionResponse)
async def promote_deployment(
    deployment_id: str,
    auth: AuthContext = Depends(get_auth_context),
) -> DeploymentActionResponse:
    now = utc_now()
    async with get_db_session() as session:
        row_result = await session.execute(
            text("SELECT organization_id FROM agent_deployment WHERE id = :id"),
            {"id": deployment_id},
        )
        row = row_result.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Deployment not found")
        assert_org_access(auth, str(row.organization_id))
        await session.execute(
            text(
                """
                UPDATE agent_deployment
                SET status = 'active',
                    published_at = :published_at,
                    updated_at = :updated_at
                WHERE id = :id
                """
            ),
            {"id": deployment_id, "published_at": now, "updated_at": now},
        )
        await session.commit()
    await _snapshot_compiler.invalidate_snapshot(organization_id=str(row.organization_id), deployment_id=deployment_id)
    try:
        await _snapshot_compiler.compile_for_deployment(
            organization_id=str(row.organization_id),
            deployment_id=deployment_id,
            force_refresh=True,
        )
    except Exception as exc:
        logger.warning(
            "Failed to warm deployment snapshot cache after promote",
            deployment_id=deployment_id,
            organization_id=str(row.organization_id),
            error=str(exc),
        )
    await emit_control_plane_audit_event(
        organization_id=str(row.organization_id),
        action="agentos.deployment.promoted",
        actor_id=auth.user_id,
        resource_type="agent_deployment",
        resource_id=deployment_id,
    )
    return DeploymentActionResponse(deployment_id=deployment_id, status="active", updated_at=now)


@router.post("/deployments/{deployment_id}/rollback", response_model=DeploymentActionResponse)
async def rollback_deployment(
    deployment_id: str,
    auth: AuthContext = Depends(get_auth_context),
) -> DeploymentActionResponse:
    now = utc_now()
    async with get_db_session() as session:
        row_result = await session.execute(
            text("SELECT organization_id FROM agent_deployment WHERE id = :id"),
            {"id": deployment_id},
        )
        row = row_result.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Deployment not found")
        assert_org_access(auth, str(row.organization_id))
        await session.execute(
            text(
                """
                UPDATE agent_deployment
                SET status = 'rolled_back',
                    updated_at = :updated_at
                WHERE id = :id
                """
            ),
            {"id": deployment_id, "updated_at": now},
        )
        await session.commit()
    await _snapshot_compiler.invalidate_snapshot(organization_id=str(row.organization_id), deployment_id=deployment_id)
    await emit_control_plane_audit_event(
        organization_id=str(row.organization_id),
        action="agentos.deployment.rolled_back",
        actor_id=auth.user_id,
        resource_type="agent_deployment",
        resource_id=deployment_id,
    )
    return DeploymentActionResponse(deployment_id=deployment_id, status="rolled_back", updated_at=now)


@router.get("/catalog", response_model=list[AgentCatalogItem])
async def list_catalog(
    organization_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentCatalogItem]:
    org_id = resolve_org_id(auth, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT
                    r.id AS role_id,
                    r.name AS role_name,
                    r.domain AS domain,
                    d.id AS deployment_id,
                    d.version AS deployment_version,
                    d.status AS deployment_status,
                    p.name AS playbook_name,
                    d.updated_at AS updated_at
                FROM agent_deployment d
                INNER JOIN agent_role r ON r.id = d.role_id
                INNER JOIN agent_playbook p ON p.id = d.playbook_id
                WHERE d.organization_id = :organization_id
                ORDER BY d.updated_at DESC
                LIMIT 500
                """
            ),
            {"organization_id": org_id},
        )
        rows = [dict(row._mapping) for row in result.fetchall()]
    return [AgentCatalogItem.model_validate(row) for row in rows]
