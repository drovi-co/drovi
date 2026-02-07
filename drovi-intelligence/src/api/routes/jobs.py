"""
Durable Jobs Admin API Routes

These endpoints expose the Postgres-backed durable job plane for operational control:
- list jobs by org/type/status
- cancel a queued/running job
- retry/replay a job deterministically

This surface is intended for internal/admin tooling (not pilot end-users).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.db.client import get_db_session
from src.jobs.queue import EnqueueJobRequest, cancel_job, enqueue_job

logger = structlog.get_logger()

router = APIRouter(prefix="/jobs", tags=["Jobs"])


class JobResponse(BaseModel):
    id: str
    organization_id: str
    job_type: str
    status: str
    priority: int
    run_at: datetime
    resource_key: str | None = None
    attempts: int
    max_attempts: int
    lease_until: datetime | None = None
    locked_by: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    idempotency_key: str | None = None
    payload: dict[str, Any]
    result: dict[str, Any] | None = None
    last_error: str | None = None
    created_at: datetime
    updated_at: datetime


class ListJobsResponse(BaseModel):
    jobs: list[JobResponse]


class RetryJobResponse(BaseModel):
    job_id: str = Field(..., description="Newly enqueued job id")


class ReplayJobRequest(BaseModel):
    payload_overrides: dict[str, Any] = Field(default_factory=dict)
    run_at: datetime | None = None
    priority: int | None = None
    max_attempts: int | None = None
    resource_key: str | None = None


def _row_to_job(row: dict[str, Any]) -> JobResponse:
    return JobResponse(
        id=str(row["id"]),
        organization_id=str(row["organization_id"]),
        job_type=str(row["job_type"]),
        status=str(row["status"]),
        priority=int(row.get("priority") or 0),
        run_at=row["run_at"],
        resource_key=row.get("resource_key"),
        attempts=int(row.get("attempts") or 0),
        max_attempts=int(row.get("max_attempts") or 0),
        lease_until=row.get("lease_until"),
        locked_by=row.get("locked_by"),
        started_at=row.get("started_at"),
        completed_at=row.get("completed_at"),
        idempotency_key=row.get("idempotency_key"),
        payload=row.get("payload") or {},
        result=row.get("result"),
        last_error=row.get("last_error"),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=ListJobsResponse)
async def list_jobs(
    organization_id: str | None = Query(None, description="Filter by org id"),
    job_type: str | None = Query(None, description="Filter by job_type"),
    status: str | None = Query(None, description="Filter by status"),
    limit: int = Query(100, ge=1, le=500),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> ListJobsResponse:
    """
    List durable background jobs.

    Requires `admin` scope (or internal service token).
    """
    params: dict[str, Any] = {"limit": limit}
    where: list[str] = ["1=1"]
    if organization_id:
        where.append("organization_id = :organization_id")
        params["organization_id"] = organization_id
    if job_type:
        where.append("job_type = :job_type")
        params["job_type"] = job_type
    if status:
        where.append("status = :status")
        params["status"] = status

    query = f"""
        SELECT
            id::text as id,
            organization_id,
            job_type,
            status,
            priority,
            run_at,
            resource_key,
            attempts,
            max_attempts,
            lease_until,
            locked_by,
            started_at,
            completed_at,
            idempotency_key,
            payload,
            result,
            last_error,
            created_at,
            updated_at
        FROM background_job
        WHERE {' AND '.join(where)}
        ORDER BY created_at DESC
        LIMIT :limit
    """

    async with get_db_session() as session:
        result = await session.execute(text(query), params)
        rows = result.mappings().all()

    return ListJobsResponse(jobs=[_row_to_job(dict(row)) for row in rows])


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> JobResponse:
    """Get a durable job by id."""
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT
                    id::text as id,
                    organization_id,
                    job_type,
                    status,
                    priority,
                    run_at,
                    resource_key,
                    attempts,
                    max_attempts,
                    lease_until,
                    locked_by,
                    started_at,
                    completed_at,
                    idempotency_key,
                    payload,
                    result,
                    last_error,
                    created_at,
                    updated_at
                FROM background_job
                WHERE id = :job_id
                LIMIT 1
                """
            ),
            {"job_id": job_id},
        )
        row = result.mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    return _row_to_job(dict(row))


@router.post("/{job_id}/cancel")
async def cancel_job_endpoint(
    job_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> dict[str, Any]:
    """Cancel a queued or running job."""
    cancelled = await cancel_job(job_id=job_id)
    return {"job_id": job_id, "cancelled": bool(cancelled)}


@router.post("/{job_id}/retry", response_model=RetryJobResponse)
async def retry_job(
    job_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> RetryJobResponse:
    """
    Retry a job by enqueuing a new job record with the same type and payload.

    Note: This creates a *new* job id and does not reuse idempotency keys.
    """
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT
                    organization_id,
                    job_type,
                    priority,
                    resource_key,
                    max_attempts,
                    payload
                FROM background_job
                WHERE id = :job_id
                LIMIT 1
                """
            ),
            {"job_id": job_id},
        )
        row = result.mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    new_job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=str(row["organization_id"]),
            job_type=str(row["job_type"]),
            payload=dict(row.get("payload") or {}),
            priority=int(row.get("priority") or 0),
            max_attempts=int(row.get("max_attempts") or 5),
            idempotency_key=None,
            resource_key=row.get("resource_key"),
        )
    )

    return RetryJobResponse(job_id=new_job_id)


@router.post("/{job_id}/replay", response_model=RetryJobResponse)
async def replay_job(
    job_id: str,
    request: ReplayJobRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> RetryJobResponse:
    """
    Replay a job by enqueuing a new job record with payload overrides.

    This is intended for incident recovery and debugging (e.g. re-running a
    connector window with adjusted parameters).
    """
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT
                    organization_id,
                    job_type,
                    priority,
                    resource_key,
                    max_attempts,
                    payload
                FROM background_job
                WHERE id = :job_id
                LIMIT 1
                """
            ),
            {"job_id": job_id},
        )
        row = result.mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    payload = dict(row.get("payload") or {})
    if request.payload_overrides:
        payload = {**payload, **request.payload_overrides}

    new_job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=str(row["organization_id"]),
            job_type=str(row["job_type"]),
            payload=payload,
            priority=int(request.priority if request.priority is not None else row.get("priority") or 0),
            run_at=request.run_at,
            max_attempts=int(request.max_attempts if request.max_attempts is not None else row.get("max_attempts") or 5),
            idempotency_key=None,
            resource_key=request.resource_key if request.resource_key is not None else row.get("resource_key"),
        )
    )

    logger.info(
        "Job replay enqueued",
        original_job_id=job_id,
        new_job_id=new_job_id,
    )

    return RetryJobResponse(job_id=new_job_id)

