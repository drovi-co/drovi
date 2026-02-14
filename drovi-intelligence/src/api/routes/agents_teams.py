from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.agentos.control_plane import emit_control_plane_audit_event
from src.agentos.orchestration import (
    AgentTeamService,
    PlannedChildRun,
    TeamBudgetViolation,
    TeamMemberSpec,
    TeamRunPlanResult,
    TeamRunRequest,
    build_team_plan,
    validate_team_budget,
)
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context
from src.contexts.workflows.infrastructure.agent_run_dispatcher import start_team_monitor_workflow
from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.time import utc_now

from .agents_common import as_json, resolve_org_id, row_dict

router = APIRouter()
_team_service = AgentTeamService()


class AgentTeamModel(BaseModel):
    id: str
    organization_id: str
    name: str
    description: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_by_user_id: str | None = None
    created_at: Any
    updated_at: Any
    member_count: int | None = None


class AgentTeamCreateRequest(BaseModel):
    organization_id: str
    name: str = Field(..., min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentTeamUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    metadata: dict[str, Any] | None = None


class AgentTeamMembersReplaceRequest(BaseModel):
    organization_id: str
    members: list[TeamMemberSpec] = Field(default_factory=list)


class AgentTeamRunDispatchRequest(TeamRunRequest):
    organization_id: str
    parent_deployment_id: str | None = None
    initiated_by: str | None = None
    resource_lane_key: str | None = None
    steps: list[str] | None = None
    org_concurrency_cap: int | None = Field(default=None, ge=1, le=100)
    lane_ttl_seconds: int | None = Field(default=None, ge=10, le=3600)
    lane_max_attempts: int | None = Field(default=None, ge=1, le=5000)
    lane_retry_seconds: int | None = Field(default=None, ge=1, le=300)


class AgentTeamRunDispatchResponse(BaseModel):
    parent_run_id: str
    status: str
    plan: TeamRunPlanResult


class AgentHandoffModel(BaseModel):
    id: str
    organization_id: str
    parent_run_id: str
    child_run_id: str
    from_role_id: str | None = None
    to_role_id: str | None = None
    reason: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: Any


@router.get("/teams", response_model=list[AgentTeamModel])
async def list_teams(
    organization_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentTeamModel]:
    org_id = resolve_org_id(auth, organization_id)
    rows = await _team_service.list_teams(organization_id=org_id)
    return [AgentTeamModel.model_validate(row) for row in rows]


@router.post("/teams", response_model=AgentTeamModel)
async def create_team(
    request: AgentTeamCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentTeamModel:
    org_id = resolve_org_id(auth, request.organization_id)
    team_id = new_prefixed_id("agteam")
    try:
        team = await _team_service.create_team(
            team_id=team_id,
            organization_id=org_id,
            name=request.name,
            description=request.description,
            metadata=request.metadata,
            created_by_user_id=auth.user_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=409, detail=f"Failed to create team: {exc}") from exc

    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.team.created",
        actor_id=auth.user_id,
        resource_type="agent_team",
        resource_id=team.id,
        metadata={"name": team.name},
    )

    payload = team.__dict__.copy()
    payload["member_count"] = 0
    return AgentTeamModel.model_validate(payload)


@router.get("/teams/{team_id}", response_model=AgentTeamModel)
async def get_team(team_id: str, auth: AuthContext = Depends(get_auth_context)) -> AgentTeamModel:
    team = await _team_service.get_team(organization_id=auth.organization_id, team_id=team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")

    members = await _team_service.list_team_members(
        organization_id=team.organization_id,
        team_id=team.id,
        team_metadata=team.metadata,
    )
    payload = team.__dict__.copy()
    payload["member_count"] = len(members)
    return AgentTeamModel.model_validate(payload)


@router.patch("/teams/{team_id}", response_model=AgentTeamModel)
async def update_team(
    team_id: str,
    request: AgentTeamUpdateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentTeamModel:
    team = await _team_service.get_team(organization_id=auth.organization_id, team_id=team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")

    updates: dict[str, Any] = {}
    if request.name is not None:
        updates["name"] = request.name
    if request.description is not None:
        updates["description"] = request.description
    if request.metadata is not None:
        updates["metadata"] = request.metadata
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")

    async with get_db_session() as session:
        set_parts: list[str] = ["updated_at = :updated_at"]
        params: dict[str, Any] = {
            "organization_id": team.organization_id,
            "team_id": team.id,
            "updated_at": utc_now(),
        }
        if "name" in updates:
            set_parts.append("name = :name")
            params["name"] = updates["name"]
        if "description" in updates:
            set_parts.append("description = :description")
            params["description"] = updates["description"]
        if "metadata" in updates:
            set_parts.append("metadata = CAST(:metadata AS JSONB)")
            params["metadata"] = as_json(updates["metadata"])

        await session.execute(
            text(
                f"""
                UPDATE agent_team
                SET {", ".join(set_parts)}
                WHERE organization_id = :organization_id
                  AND id = :team_id
                """
            ),
            params,
        )
        await session.commit()

    updated = await _team_service.get_team(organization_id=team.organization_id, team_id=team.id)
    if updated is None:
        raise HTTPException(status_code=500, detail="Team update failed")

    await emit_control_plane_audit_event(
        organization_id=team.organization_id,
        action="agentos.team.updated",
        actor_id=auth.user_id,
        resource_type="agent_team",
        resource_id=team.id,
        metadata={"updated_fields": sorted(updates.keys())},
    )

    members = await _team_service.list_team_members(
        organization_id=updated.organization_id,
        team_id=updated.id,
        team_metadata=updated.metadata,
    )
    payload = updated.__dict__.copy()
    payload["member_count"] = len(members)
    return AgentTeamModel.model_validate(payload)


@router.get("/teams/{team_id}/members", response_model=list[TeamMemberSpec])
async def list_team_members(team_id: str, auth: AuthContext = Depends(get_auth_context)) -> list[TeamMemberSpec]:
    team = await _team_service.get_team(organization_id=auth.organization_id, team_id=team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    return await _team_service.list_team_members(
        organization_id=team.organization_id,
        team_id=team.id,
        team_metadata=team.metadata,
    )


@router.put("/teams/{team_id}/members", response_model=list[TeamMemberSpec])
async def replace_team_members(
    team_id: str,
    request: AgentTeamMembersReplaceRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> list[TeamMemberSpec]:
    org_id = resolve_org_id(auth, request.organization_id)
    team = await _team_service.get_team(organization_id=org_id, team_id=team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")

    role_ids = [member.role_id for member in request.members]
    if len(role_ids) != len(set(role_ids)):
        raise HTTPException(status_code=400, detail="Duplicate role_id in members payload")

    await _assert_roles_exist(organization_id=org_id, role_ids=role_ids)

    merged_metadata = await _team_service.replace_team_members(
        organization_id=org_id,
        team_id=team_id,
        members=request.members,
        team_metadata=team.metadata,
    )

    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.team.members_replaced",
        actor_id=auth.user_id,
        resource_type="agent_team",
        resource_id=team_id,
        metadata={"member_count": len(request.members)},
    )

    return await _team_service.list_team_members(
        organization_id=org_id,
        team_id=team_id,
        team_metadata=merged_metadata,
    )


@router.post("/teams/{team_id}/runs", response_model=AgentTeamRunDispatchResponse)
async def dispatch_team_run(
    team_id: str,
    request: AgentTeamRunDispatchRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentTeamRunDispatchResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    team = await _team_service.get_team(organization_id=org_id, team_id=team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")

    members = await _team_service.list_team_members(
        organization_id=org_id,
        team_id=team.id,
        team_metadata=team.metadata,
    )
    if not members:
        raise HTTPException(status_code=400, detail="Team has no members")

    deployment_by_role = await _team_service.resolve_role_deployments(
        organization_id=org_id,
        role_ids=sorted({member.role_id for member in members}),
    )

    missing_required = sorted(
        {
            member.role_id
            for member in members
            if member.is_required and member.role_id not in deployment_by_role
        }
    )
    if missing_required:
        raise HTTPException(
            status_code=400,
            detail=f"Missing active deployment for required roles: {', '.join(missing_required)}",
        )

    runnable_members = [member for member in members if member.role_id in deployment_by_role]
    if not runnable_members:
        raise HTTPException(status_code=400, detail="No team members have resolvable deployments")

    plan = build_team_plan(
        team_id=team.id,
        members=runnable_members,
        execution_policy=request.execution_policy,
    )
    try:
        validate_team_budget(plan=plan, budget=request.budget)
    except TeamBudgetViolation as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc

    if request.parent_deployment_id:
        await _assert_deployment_exists(organization_id=org_id, deployment_id=request.parent_deployment_id)
        parent_deployment_id = request.parent_deployment_id
    else:
        first_child = next(
            (
                deployment_by_role.get(member.role_id)
                for stage in plan.stages
                for member in stage.members
                if deployment_by_role.get(member.role_id)
            ),
            None,
        )
        if not first_child:
            raise HTTPException(status_code=400, detail="Unable to determine parent deployment for team run")
        parent_deployment_id = str(first_child)

    parent_run_id = new_prefixed_id("agrun")
    parent_metadata = {
        **request.metadata,
        "runtime": "temporal",
        "run_kind": "team_parent",
        "team_id": team.id,
        "objective": request.objective,
        "objective_context": request.objective_context,
        "execution_policy": request.execution_policy.model_dump(mode="json"),
        "conflict_resolution": request.conflict_resolution.model_dump(mode="json"),
        "budget": request.budget.model_dump(mode="json"),
        "guardrails": request.guardrails.model_dump(mode="json"),
        "member_count": len(runnable_members),
        "stage_count": len(plan.stages),
    }

    child_specs: list[PlannedChildRun] = []
    run_role_by_id: dict[str, str] = {}
    previous_stage_children: list[PlannedChildRun] = []
    for stage in plan.stages:
        stage_children: list[PlannedChildRun] = []
        dependency_ids = [child.child_run_id for child in previous_stage_children]
        for member in stage.members:
            deployment_id = deployment_by_role.get(member.role_id)
            if not deployment_id:
                continue
            child_run_id = new_prefixed_id("agrun")
            child = PlannedChildRun(
                child_run_id=child_run_id,
                role_id=member.role_id,
                deployment_id=deployment_id,
                stage_index=stage.stage_index,
                dependencies=dependency_ids,
                is_required=member.is_required,
                specialization_prompt=member.specialization_prompt,
                constraints=member.constraints,
            )
            child_specs.append(child)
            stage_children.append(child)
            run_role_by_id[child_run_id] = member.role_id
        previous_stage_children = stage_children

    if not child_specs:
        raise HTTPException(status_code=400, detail="Team plan has no runnable members")

    min_stage = min(child.stage_index for child in child_specs)
    now = utc_now()

    async with get_db_session() as session:
        try:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_run (
                        id, organization_id, deployment_id, trigger_id, status, initiated_by,
                        started_at, completed_at, failure_reason, metadata, created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :deployment_id, NULL, :status, :initiated_by,
                        NULL, NULL, NULL, CAST(:metadata AS JSONB), :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": parent_run_id,
                    "organization_id": org_id,
                    "deployment_id": parent_deployment_id,
                    "status": "accepted",
                    "initiated_by": request.initiated_by or auth.user_id,
                    "metadata": as_json(parent_metadata),
                    "created_at": now,
                    "updated_at": now,
                },
            )

            for child in child_specs:
                child_metadata = {
                    "runtime": "temporal",
                    "run_kind": "team_child",
                    "team_id": team.id,
                    "parent_run_id": parent_run_id,
                    "role_id": child.role_id,
                    "stage_index": child.stage_index,
                    "dependencies": child.dependencies,
                    "is_required": child.is_required,
                    "specialization_prompt": child.specialization_prompt,
                    "constraints": child.constraints,
                    "objective": request.objective,
                    "objective_context": request.objective_context,
                    "guardrails": request.guardrails.model_dump(mode="json"),
                }
                status = "accepted" if child.stage_index == min_stage else "queued"
                await session.execute(
                    text(
                        """
                        INSERT INTO agent_run (
                            id, organization_id, deployment_id, trigger_id, status, initiated_by,
                            started_at, completed_at, failure_reason, metadata, created_at, updated_at
                        ) VALUES (
                            :id, :organization_id, :deployment_id, NULL, :status, :initiated_by,
                            NULL, NULL, NULL, CAST(:metadata AS JSONB), :created_at, :updated_at
                        )
                        """
                    ),
                    {
                        "id": child.child_run_id,
                        "organization_id": org_id,
                        "deployment_id": child.deployment_id,
                        "status": status,
                        "initiated_by": request.initiated_by or auth.user_id,
                        "metadata": as_json(child_metadata),
                        "created_at": now,
                        "updated_at": now,
                    },
                )

            for child in child_specs:
                if child.dependencies:
                    for dependency_id in child.dependencies:
                        await session.execute(
                            text(
                                """
                                INSERT INTO agent_handoff (
                                    organization_id,
                                    parent_run_id,
                                    child_run_id,
                                    from_role_id,
                                    to_role_id,
                                    reason,
                                    metadata,
                                    created_at
                                ) VALUES (
                                    :organization_id,
                                    :parent_run_id,
                                    :child_run_id,
                                    :from_role_id,
                                    :to_role_id,
                                    :reason,
                                    CAST(:metadata AS JSONB),
                                    :created_at
                                )
                                """
                            ),
                            {
                                "organization_id": org_id,
                                "parent_run_id": parent_run_id,
                                "child_run_id": child.child_run_id,
                                "from_role_id": run_role_by_id.get(dependency_id),
                                "to_role_id": child.role_id,
                                "reason": "stage_dependency",
                                "metadata": as_json(
                                    {
                                        "stage_index": child.stage_index,
                                        "depends_on_run_id": dependency_id,
                                    }
                                ),
                                "created_at": now,
                            },
                        )
                else:
                    await session.execute(
                        text(
                            """
                            INSERT INTO agent_handoff (
                                organization_id,
                                parent_run_id,
                                child_run_id,
                                from_role_id,
                                to_role_id,
                                reason,
                                metadata,
                                created_at
                            ) VALUES (
                                :organization_id,
                                :parent_run_id,
                                :child_run_id,
                                NULL,
                                :to_role_id,
                                :reason,
                                CAST(:metadata AS JSONB),
                                :created_at
                            )
                            """
                        ),
                        {
                            "organization_id": org_id,
                            "parent_run_id": parent_run_id,
                            "child_run_id": child.child_run_id,
                            "to_role_id": child.role_id,
                            "reason": "objective_dispatch",
                            "metadata": as_json({"stage_index": child.stage_index}),
                            "created_at": now,
                        },
                    )

            await session.commit()
        except Exception:
            await session.rollback()
            raise

    monitor_payload = {
        "organization_id": org_id,
        "parent_run_id": parent_run_id,
        "team_id": team.id,
        "objective": request.objective,
        "objective_context": request.objective_context,
        "execution_policy": request.execution_policy.model_dump(mode="json"),
        "conflict_resolution": request.conflict_resolution.model_dump(mode="json"),
        "children": [
            {
                "run_id": child.child_run_id,
                "deployment_id": child.deployment_id,
                "role_id": child.role_id,
                "stage_index": child.stage_index,
                "dependencies": child.dependencies,
                "is_required": child.is_required,
                "specialization_prompt": child.specialization_prompt,
                "constraints": child.constraints,
            }
            for child in child_specs
        ],
        "steps": request.steps,
        "initiated_by": request.initiated_by or auth.user_id,
        "resource_lane_key": request.resource_lane_key,
        "org_concurrency_cap": request.org_concurrency_cap,
        "lane_ttl_seconds": request.lane_ttl_seconds,
        "lane_max_attempts": request.lane_max_attempts,
        "lane_retry_seconds": request.lane_retry_seconds,
    }

    try:
        await start_team_monitor_workflow(monitor_payload)
    except Exception as exc:
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    UPDATE agent_run
                    SET status = 'failed',
                        failure_reason = :failure_reason,
                        completed_at = :completed_at,
                        updated_at = :updated_at
                    WHERE organization_id = :organization_id
                      AND id = :run_id
                    """
                ),
                {
                    "organization_id": org_id,
                    "run_id": parent_run_id,
                    "failure_reason": str(exc),
                    "completed_at": utc_now(),
                    "updated_at": utc_now(),
                },
            )
            await session.execute(
                text(
                    """
                    UPDATE agent_run
                    SET status = 'cancelled',
                        failure_reason = COALESCE(failure_reason, :failure_reason),
                        completed_at = COALESCE(completed_at, :completed_at),
                        updated_at = :updated_at
                    WHERE organization_id = :organization_id
                      AND id IN (
                        SELECT child_run_id
                        FROM agent_handoff
                        WHERE organization_id = :organization_id
                          AND parent_run_id = :parent_run_id
                      )
                      AND status NOT IN ('completed', 'failed', 'cancelled')
                    """
                ),
                {
                    "organization_id": org_id,
                    "parent_run_id": parent_run_id,
                    "failure_reason": "Team monitor workflow did not start",
                    "completed_at": utc_now(),
                    "updated_at": utc_now(),
                },
            )
            await session.commit()
        raise HTTPException(status_code=503, detail=f"Failed to start team monitor workflow: {exc}") from exc

    plan_result = TeamRunPlanResult(
        parent_run_id=parent_run_id,
        team_id=team.id,
        parent_deployment_id=parent_deployment_id,
        mode=plan.mode,
        stages=plan.stages,
        children=child_specs,
        budget=request.budget,
        guardrails=request.guardrails,
        conflict_resolution=request.conflict_resolution,
    )

    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.team.run_dispatched",
        actor_id=auth.user_id,
        resource_type="agent_run",
        resource_id=parent_run_id,
        metadata={
            "team_id": team.id,
            "child_run_count": len(child_specs),
            "mode": plan.mode,
        },
    )

    return AgentTeamRunDispatchResponse(
        parent_run_id=parent_run_id,
        status="accepted",
        plan=plan_result,
    )


@router.get("/runs/{run_id}/handoffs", response_model=list[AgentHandoffModel])
async def list_handoffs_for_run(
    run_id: str,
    organization_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentHandoffModel]:
    org_id = resolve_org_id(auth, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id::text,
                       organization_id,
                       parent_run_id,
                       child_run_id,
                       from_role_id,
                       to_role_id,
                       reason,
                       metadata,
                       created_at
                FROM agent_handoff
                WHERE organization_id = :organization_id
                  AND (parent_run_id = :run_id OR child_run_id = :run_id)
                ORDER BY created_at ASC
                """
            ),
            {
                "organization_id": org_id,
                "run_id": run_id,
            },
        )
        rows = [row_dict(row, json_fields={"metadata"}) for row in result.fetchall()]

    return [AgentHandoffModel.model_validate(row) for row in rows]


async def _assert_roles_exist(*, organization_id: str, role_ids: list[str]) -> None:
    if not role_ids:
        return
    unique_ids = sorted(set(role_ids))
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id
                FROM agent_role
                WHERE organization_id = :organization_id
                  AND id = ANY(:role_ids)
                """
            ),
            {
                "organization_id": organization_id,
                "role_ids": unique_ids,
            },
        )
        found = {str(row.id) for row in result.fetchall()}

    missing = [role_id for role_id in unique_ids if role_id not in found]
    if missing:
        raise HTTPException(status_code=400, detail=f"Unknown role ids: {', '.join(missing)}")


async def _assert_deployment_exists(*, organization_id: str, deployment_id: str) -> None:
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id
                FROM agent_deployment
                WHERE organization_id = :organization_id
                  AND id = :deployment_id
                """
            ),
            {
                "organization_id": organization_id,
                "deployment_id": deployment_id,
            },
        )
        row = result.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Parent deployment not found")
