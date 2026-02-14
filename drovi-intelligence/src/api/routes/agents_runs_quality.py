from __future__ import annotations

import asyncio
import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.agentos.control_plane import emit_control_plane_audit_event
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context
from src.config import get_settings
from src.contexts.workflows.infrastructure.agent_run_dispatcher import (
    run_workflow_id,
    start_agent_run_workflow,
)
from src.contexts.workflows.infrastructure.client import get_temporal_client
from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.time import utc_now

from .agents_common import assert_org_access, as_json, resolve_org_id, row_dict

router = APIRouter()


class AgentRunModel(BaseModel):
    id: str
    organization_id: str
    deployment_id: str
    trigger_id: str | None = None
    status: str
    initiated_by: str | None = None
    started_at: Any | None = None
    completed_at: Any | None = None
    failure_reason: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: Any
    updated_at: Any


class AgentRunCreateRequest(BaseModel):
    organization_id: str
    deployment_id: str
    trigger_id: str | None = None
    initiated_by: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    payload: dict[str, Any] = Field(default_factory=dict)
    resource_lane_key: str | None = None
    steps: list[str] | None = None
    org_concurrency_cap: int | None = Field(default=None, ge=1, le=100)
    lane_ttl_seconds: int | None = Field(default=None, ge=10, le=3600)
    lane_max_attempts: int | None = Field(default=None, ge=1, le=5000)
    lane_retry_seconds: int | None = Field(default=None, ge=1, le=300)


class AgentRunControlRequest(BaseModel):
    organization_id: str
    reason: str | None = None


class AgentRunControlResponse(BaseModel):
    run_id: str
    status: str
    workflow_id: str
    accepted: bool = True


class AgentRunStepModel(BaseModel):
    id: str
    run_id: str
    organization_id: str
    step_index: int
    step_type: str
    status: str
    input_payload: dict[str, Any] = Field(default_factory=dict)
    output_payload: dict[str, Any] = Field(default_factory=dict)
    evidence_refs: dict[str, Any] = Field(default_factory=dict)
    started_at: Any | None = None
    completed_at: Any | None = None
    created_at: Any


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


class AgentRunReplayResponse(BaseModel):
    run: AgentRunModel
    steps: list[AgentRunStepModel] = Field(default_factory=list)
    parent_run_id: str | None = None
    child_runs: list[AgentRunModel] = Field(default_factory=list)
    handoffs: list[AgentHandoffModel] = Field(default_factory=list)


class AgentEvalResultModel(BaseModel):
    id: str
    organization_id: str
    deployment_id: str | None = None
    run_id: str | None = None
    suite_name: str
    metric_name: str
    metric_value: float
    threshold: float | None = None
    passed: bool
    metadata: dict[str, Any] = Field(default_factory=dict)
    evaluated_at: Any
    created_at: Any


class AgentEvalCreateRequest(BaseModel):
    organization_id: str
    deployment_id: str | None = None
    run_id: str | None = None
    suite_name: str = Field(..., min_length=1, max_length=200)
    metric_name: str = Field(..., min_length=1, max_length=200)
    metric_value: float
    threshold: float | None = None
    passed: bool
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentFeedbackModel(BaseModel):
    id: str
    organization_id: str
    run_id: str
    deployment_id: str | None = None
    user_id: str | None = None
    verdict: Literal["accepted", "edited", "rejected", "needs_review"]
    reason: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: Any


class AgentFeedbackCreateRequest(BaseModel):
    organization_id: str
    run_id: str
    deployment_id: str | None = None
    verdict: Literal["accepted", "edited", "rejected", "needs_review"]
    reason: str | None = Field(default=None, max_length=5000)
    metadata: dict[str, Any] = Field(default_factory=dict)


async def _start_agent_run_workflow(
    *,
    run_id: str,
    organization_id: str,
    deployment_id: str,
    trigger_id: str | None,
    initiated_by: str | None,
    payload: dict[str, Any],
    resource_lane_key: str | None,
    steps: list[str] | None,
    org_concurrency_cap: int | None,
    lane_ttl_seconds: int | None,
    lane_max_attempts: int | None,
    lane_retry_seconds: int | None,
) -> None:
    request_payload = {
        "run_id": run_id,
        "organization_id": organization_id,
        "deployment_id": deployment_id,
        "trigger_id": trigger_id,
        "initiated_by": initiated_by,
        "payload": payload,
        "resource_lane_key": resource_lane_key,
        "steps": steps,
    }
    if org_concurrency_cap is not None:
        request_payload["org_concurrency_cap"] = org_concurrency_cap
    if lane_ttl_seconds is not None:
        request_payload["lane_ttl_seconds"] = lane_ttl_seconds
    if lane_max_attempts is not None:
        request_payload["lane_max_attempts"] = lane_max_attempts
    if lane_retry_seconds is not None:
        request_payload["lane_retry_seconds"] = lane_retry_seconds
    await start_agent_run_workflow(request_payload)


async def _get_temporal_client_or_503() -> Any:
    settings = get_settings()
    if not settings.temporal_enabled:
        raise HTTPException(status_code=503, detail="Temporal is disabled")
    try:
        return await get_temporal_client()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Temporal unavailable: {exc}") from exc


@router.get("/runs", response_model=list[AgentRunModel])
async def list_runs(
    organization_id: str | None = None,
    deployment_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentRunModel]:
    org_id = resolve_org_id(auth, organization_id)
    query = """
        SELECT id, organization_id, deployment_id, trigger_id, status, initiated_by, started_at,
               completed_at, failure_reason, metadata, created_at, updated_at
        FROM agent_run
        WHERE organization_id = :organization_id
    """
    params: dict[str, Any] = {"organization_id": org_id, "limit": limit, "offset": offset}
    if deployment_id:
        query += " AND deployment_id = :deployment_id"
        params["deployment_id"] = deployment_id
    query += " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"

    async with get_db_session() as session:
        result = await session.execute(text(query), params)
        rows = [row_dict(row, json_fields={"metadata"}) for row in result.fetchall()]
    return [AgentRunModel.model_validate(row) for row in rows]


def _format_sse_event(*, event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.get("/runs/stream")
async def stream_runs(
    request: Request,
    organization_id: str | None = None,
    deployment_id: str | None = None,
    poll_seconds: float = Query(default=2.0, ge=1.0, le=10.0),
    auth: AuthContext = Depends(get_auth_context),
) -> StreamingResponse:
    org_id = resolve_org_id(auth, organization_id)

    async def generator():
        cursor_updated_at: Any | None = None
        cursor_run_id: str = ""
        heartbeat_seconds = max(poll_seconds * 5.0, 10.0)
        elapsed_since_heartbeat = 0.0

        # Initial snapshot
        async with get_db_session() as session:
            snapshot_result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, deployment_id, trigger_id, status, initiated_by, started_at,
                           completed_at, failure_reason, metadata, created_at, updated_at
                    FROM agent_run
                    WHERE organization_id = :organization_id
                      AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                    ORDER BY updated_at DESC
                    LIMIT 50
                    """
                ),
                {
                    "organization_id": org_id,
                    "deployment_id": deployment_id,
                },
            )
            snapshot_rows = [
                row_dict(row, json_fields={"metadata"})
                for row in snapshot_result.fetchall()
            ]
        if snapshot_rows:
            newest = snapshot_rows[0]
            cursor_updated_at = newest.get("updated_at")
            cursor_run_id = str(newest.get("id") or "")
        yield _format_sse_event(
            event="snapshot",
            data={
                "organization_id": org_id,
                "deployment_id": deployment_id,
                "runs": snapshot_rows,
            },
        )

        while True:
            if await request.is_disconnected():
                break
            await asyncio.sleep(poll_seconds)
            elapsed_since_heartbeat += poll_seconds

            async with get_db_session() as session:
                changes_result = await session.execute(
                    text(
                        """
                        SELECT id, organization_id, deployment_id, trigger_id, status, initiated_by, started_at,
                               completed_at, failure_reason, metadata, created_at, updated_at
                        FROM agent_run
                        WHERE organization_id = :organization_id
                          AND (:deployment_id IS NULL OR deployment_id = :deployment_id)
                          AND (
                            :cursor_updated_at IS NULL
                            OR updated_at > :cursor_updated_at
                            OR (updated_at = :cursor_updated_at AND id > :cursor_run_id)
                          )
                        ORDER BY updated_at ASC, id ASC
                        LIMIT 200
                        """
                    ),
                    {
                        "organization_id": org_id,
                        "deployment_id": deployment_id,
                        "cursor_updated_at": cursor_updated_at,
                        "cursor_run_id": cursor_run_id,
                    },
                )
                change_rows = [
                    row_dict(row, json_fields={"metadata"})
                    for row in changes_result.fetchall()
                ]

            if change_rows:
                for row in change_rows:
                    cursor_updated_at = row.get("updated_at")
                    cursor_run_id = str(row.get("id") or "")
                    yield _format_sse_event(
                        event="run_update",
                        data=row,
                    )
                elapsed_since_heartbeat = 0.0
                continue

            if elapsed_since_heartbeat >= heartbeat_seconds:
                yield _format_sse_event(
                    event="heartbeat",
                    data={"organization_id": org_id},
                )
                elapsed_since_heartbeat = 0.0

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/runs", response_model=AgentRunModel)
async def create_run(
    request: AgentRunCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentRunModel:
    org_id = resolve_org_id(auth, request.organization_id)
    run_id = new_prefixed_id("agrun")
    now = utc_now()

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO agent_run (
                    id, organization_id, deployment_id, trigger_id, status, initiated_by,
                    started_at, completed_at, failure_reason, metadata, created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :deployment_id, :trigger_id, :status, :initiated_by,
                    NULL, NULL, NULL, CAST(:metadata AS JSONB), :created_at, :updated_at
                )
                """
            ),
            {
                "id": run_id,
                "organization_id": org_id,
                "deployment_id": request.deployment_id,
                "trigger_id": request.trigger_id,
                "status": "accepted",
                "initiated_by": request.initiated_by or auth.user_id,
                "metadata": as_json(
                    {
                        **request.metadata,
                        "runtime": "temporal",
                    }
                ),
                "created_at": now,
                "updated_at": now,
            },
        )
        await session.commit()

    try:
        await _start_agent_run_workflow(
            run_id=run_id,
            organization_id=org_id,
            deployment_id=request.deployment_id,
            trigger_id=request.trigger_id,
            initiated_by=request.initiated_by or auth.user_id,
            payload=request.payload,
            resource_lane_key=request.resource_lane_key,
            steps=request.steps,
            org_concurrency_cap=request.org_concurrency_cap,
            lane_ttl_seconds=request.lane_ttl_seconds,
            lane_max_attempts=request.lane_max_attempts,
            lane_retry_seconds=request.lane_retry_seconds,
        )
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
                    WHERE id = :id
                    """
                ),
                {
                    "id": run_id,
                    "failure_reason": str(exc),
                    "completed_at": utc_now(),
                    "updated_at": utc_now(),
                },
            )
            await session.commit()
        raise HTTPException(status_code=503, detail=f"Failed to start AgentRun workflow: {exc}") from exc

    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, organization_id, deployment_id, trigger_id, status, initiated_by, started_at,
                       completed_at, failure_reason, metadata, created_at, updated_at
                FROM agent_run
                WHERE id = :id
                """
            ),
            {"id": run_id},
        )
        row = result.fetchone()

    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.run.created",
        actor_id=auth.user_id,
        resource_type="agent_run",
        resource_id=run_id,
        metadata={"deployment_id": request.deployment_id, "trigger_id": request.trigger_id},
    )
    return AgentRunModel.model_validate(row_dict(row, json_fields={"metadata"}))


@router.get("/runs/{run_id}", response_model=AgentRunModel)
async def get_run(run_id: str, auth: AuthContext = Depends(get_auth_context)) -> AgentRunModel:
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, organization_id, deployment_id, trigger_id, status, initiated_by, started_at,
                       completed_at, failure_reason, metadata, created_at, updated_at
                FROM agent_run
                WHERE id = :id
                """
            ),
            {"id": run_id},
        )
        row = result.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Run not found")
    payload = row_dict(row, json_fields={"metadata"})
    assert_org_access(auth, payload["organization_id"])
    return AgentRunModel.model_validate(payload)


@router.post("/runs/{run_id}/pause", response_model=AgentRunControlResponse)
async def pause_run(
    run_id: str,
    request: AgentRunControlRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentRunControlResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    client = await _get_temporal_client_or_503()
    handle = client.get_workflow_handle(run_workflow_id(run_id))
    await handle.signal("pause")

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                UPDATE agent_run
                SET status = 'waiting_approval',
                    updated_at = :updated_at
                WHERE id = :id AND organization_id = :organization_id
                """
            ),
            {"id": run_id, "organization_id": org_id, "updated_at": utc_now()},
        )
        await session.commit()

    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.run.pause_requested",
        actor_id=auth.user_id,
        resource_type="agent_run",
        resource_id=run_id,
    )
    return AgentRunControlResponse(run_id=run_id, status="waiting_approval", workflow_id=run_workflow_id(run_id))


@router.post("/runs/{run_id}/resume", response_model=AgentRunControlResponse)
async def resume_run(
    run_id: str,
    request: AgentRunControlRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentRunControlResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    client = await _get_temporal_client_or_503()
    handle = client.get_workflow_handle(run_workflow_id(run_id))
    await handle.signal("resume")

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                UPDATE agent_run
                SET status = 'running',
                    updated_at = :updated_at
                WHERE id = :id AND organization_id = :organization_id
                """
            ),
            {"id": run_id, "organization_id": org_id, "updated_at": utc_now()},
        )
        await session.commit()

    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.run.resume_requested",
        actor_id=auth.user_id,
        resource_type="agent_run",
        resource_id=run_id,
    )
    return AgentRunControlResponse(run_id=run_id, status="running", workflow_id=run_workflow_id(run_id))


@router.post("/runs/{run_id}/cancel", response_model=AgentRunControlResponse)
async def cancel_run(
    run_id: str,
    request: AgentRunControlRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentRunControlResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    client = await _get_temporal_client_or_503()
    handle = client.get_workflow_handle(run_workflow_id(run_id))
    await handle.signal("cancel")

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                UPDATE agent_run
                SET status = 'cancelled',
                    completed_at = COALESCE(completed_at, :completed_at),
                    updated_at = :updated_at
                WHERE id = :id AND organization_id = :organization_id
                """
            ),
            {
                "id": run_id,
                "organization_id": org_id,
                "completed_at": utc_now(),
                "updated_at": utc_now(),
            },
        )
        await session.commit()

    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.run.cancel_requested",
        actor_id=auth.user_id,
        resource_type="agent_run",
        resource_id=run_id,
    )
    return AgentRunControlResponse(run_id=run_id, status="cancelled", workflow_id=run_workflow_id(run_id))


@router.post("/runs/{run_id}/kill", response_model=AgentRunControlResponse)
async def kill_run(
    run_id: str,
    request: AgentRunControlRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentRunControlResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    client = await _get_temporal_client_or_503()
    handle = client.get_workflow_handle(run_workflow_id(run_id))
    await handle.signal("kill")

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                UPDATE agent_run
                SET status = 'failed',
                    failure_reason = COALESCE(:failure_reason, failure_reason, 'killed by operator'),
                    completed_at = COALESCE(completed_at, :completed_at),
                    updated_at = :updated_at
                WHERE id = :id AND organization_id = :organization_id
                """
            ),
            {
                "id": run_id,
                "organization_id": org_id,
                "failure_reason": request.reason,
                "completed_at": utc_now(),
                "updated_at": utc_now(),
            },
        )
        await session.commit()

    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.run.kill_requested",
        actor_id=auth.user_id,
        resource_type="agent_run",
        resource_id=run_id,
        metadata={"reason": request.reason},
    )
    return AgentRunControlResponse(run_id=run_id, status="failed", workflow_id=run_workflow_id(run_id))


@router.get("/runs/{run_id}/replay", response_model=AgentRunReplayResponse)
async def replay_run(run_id: str, auth: AuthContext = Depends(get_auth_context)) -> AgentRunReplayResponse:
    async with get_db_session() as session:
        run_result = await session.execute(
            text(
                """
                SELECT id, organization_id, deployment_id, trigger_id, status, initiated_by, started_at,
                       completed_at, failure_reason, metadata, created_at, updated_at
                FROM agent_run
                WHERE id = :id
                """
            ),
            {"id": run_id},
        )
        run_row = run_result.fetchone()
        if run_row is None:
            raise HTTPException(status_code=404, detail="Run not found")
        run_payload = row_dict(run_row, json_fields={"metadata"})
        assert_org_access(auth, run_payload["organization_id"])

        step_result = await session.execute(
            text(
                """
                SELECT id, run_id, organization_id, step_index, step_type, status, input_payload,
                       output_payload, evidence_refs, started_at, completed_at, created_at
                FROM agent_run_step
                WHERE run_id = :run_id
                ORDER BY step_index ASC
                """
            ),
            {"run_id": run_id},
        )
        steps = [
            row_dict(row, json_fields={"input_payload", "output_payload", "evidence_refs"})
            for row in step_result.fetchall()
        ]

        handoff_result = await session.execute(
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
            {"organization_id": run_payload["organization_id"], "run_id": run_id},
        )
        handoffs = [row_dict(row, json_fields={"metadata"}) for row in handoff_result.fetchall()]

        parent_run_id: str | None = None
        for handoff in handoffs:
            if handoff.get("child_run_id") == run_id:
                parent_run_id = str(handoff.get("parent_run_id"))
                break

        child_run_result = await session.execute(
            text(
                """
                SELECT id, organization_id, deployment_id, trigger_id, status, initiated_by, started_at,
                       completed_at, failure_reason, metadata, created_at, updated_at
                FROM agent_run
                WHERE organization_id = :organization_id
                  AND id IN (
                    SELECT child_run_id
                    FROM agent_handoff
                    WHERE organization_id = :organization_id
                      AND parent_run_id = :run_id
                  )
                ORDER BY created_at ASC
                """
            ),
            {"organization_id": run_payload["organization_id"], "run_id": run_id},
        )
        child_runs = [row_dict(row, json_fields={"metadata"}) for row in child_run_result.fetchall()]

    return AgentRunReplayResponse(
        run=AgentRunModel.model_validate(run_payload),
        steps=[AgentRunStepModel.model_validate(step) for step in steps],
        parent_run_id=parent_run_id,
        child_runs=[AgentRunModel.model_validate(child) for child in child_runs],
        handoffs=[AgentHandoffModel.model_validate(handoff) for handoff in handoffs],
    )


@router.get("/evals", response_model=list[AgentEvalResultModel])
async def list_evals(
    organization_id: str | None = None,
    deployment_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentEvalResultModel]:
    org_id = resolve_org_id(auth, organization_id)
    query = """
        SELECT id, organization_id, deployment_id, run_id, suite_name, metric_name, metric_value,
               threshold, passed, metadata, evaluated_at, created_at
        FROM agent_eval_result
        WHERE organization_id = :organization_id
    """
    params: dict[str, Any] = {"organization_id": org_id}
    if deployment_id:
        query += " AND deployment_id = :deployment_id"
        params["deployment_id"] = deployment_id
    query += " ORDER BY evaluated_at DESC LIMIT 500"

    async with get_db_session() as session:
        result = await session.execute(text(query), params)
        rows = [row_dict(row, json_fields={"metadata"}) for row in result.fetchall()]
    return [AgentEvalResultModel.model_validate(row) for row in rows]


@router.post("/evals", response_model=AgentEvalResultModel)
async def create_eval(
    request: AgentEvalCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentEvalResultModel:
    org_id = resolve_org_id(auth, request.organization_id)
    eval_id = new_prefixed_id("ageval")
    now = utc_now()
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO agent_eval_result (
                    id, organization_id, deployment_id, run_id, suite_name, metric_name, metric_value,
                    threshold, passed, metadata, evaluated_at, created_at
                ) VALUES (
                    :id, :organization_id, :deployment_id, :run_id, :suite_name, :metric_name, :metric_value,
                    :threshold, :passed, CAST(:metadata AS JSONB), :evaluated_at, :created_at
                )
                """
            ),
            {
                "id": eval_id,
                "organization_id": org_id,
                "deployment_id": request.deployment_id,
                "run_id": request.run_id,
                "suite_name": request.suite_name,
                "metric_name": request.metric_name,
                "metric_value": request.metric_value,
                "threshold": request.threshold,
                "passed": request.passed,
                "metadata": as_json(request.metadata),
                "evaluated_at": now,
                "created_at": now,
            },
        )
        await session.commit()
        result = await session.execute(
            text(
                """
                SELECT id, organization_id, deployment_id, run_id, suite_name, metric_name, metric_value,
                       threshold, passed, metadata, evaluated_at, created_at
                FROM agent_eval_result
                WHERE id = :id
                """
            ),
            {"id": eval_id},
        )
        row = result.fetchone()
    return AgentEvalResultModel.model_validate(row_dict(row, json_fields={"metadata"}))


@router.get("/feedback", response_model=list[AgentFeedbackModel])
async def list_feedback(
    organization_id: str | None = None,
    run_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> list[AgentFeedbackModel]:
    org_id = resolve_org_id(auth, organization_id)
    query = """
        SELECT id, organization_id, run_id, deployment_id, user_id, verdict, reason, metadata, created_at
        FROM agent_feedback
        WHERE organization_id = :organization_id
    """
    params: dict[str, Any] = {"organization_id": org_id}
    if run_id:
        query += " AND run_id = :run_id"
        params["run_id"] = run_id
    query += " ORDER BY created_at DESC LIMIT 500"

    async with get_db_session() as session:
        result = await session.execute(text(query), params)
        rows = [row_dict(row, json_fields={"metadata"}) for row in result.fetchall()]
    return [AgentFeedbackModel.model_validate(row) for row in rows]


@router.post("/feedback", response_model=AgentFeedbackModel)
async def create_feedback(
    request: AgentFeedbackCreateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> AgentFeedbackModel:
    org_id = resolve_org_id(auth, request.organization_id)
    feedback_id = new_prefixed_id("agfbk")
    now = utc_now()
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO agent_feedback (
                    id, organization_id, run_id, deployment_id, user_id, verdict, reason, metadata, created_at
                ) VALUES (
                    :id, :organization_id, :run_id, :deployment_id, :user_id, :verdict, :reason,
                    CAST(:metadata AS JSONB), :created_at
                )
                """
            ),
            {
                "id": feedback_id,
                "organization_id": org_id,
                "run_id": request.run_id,
                "deployment_id": request.deployment_id,
                "user_id": auth.user_id,
                "verdict": request.verdict,
                "reason": request.reason,
                "metadata": as_json(request.metadata),
                "created_at": now,
            },
        )
        await session.commit()
        result = await session.execute(
            text(
                """
                SELECT id, organization_id, run_id, deployment_id, user_id, verdict, reason, metadata, created_at
                FROM agent_feedback
                WHERE id = :id
                """
            ),
            {"id": feedback_id},
        )
        row = result.fetchone()
    return AgentFeedbackModel.model_validate(row_dict(row, json_fields={"metadata"}))
