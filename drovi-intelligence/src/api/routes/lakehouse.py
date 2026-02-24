"""Lakehouse operator and consumer APIs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.jobs.queue import EnqueueJobRequest, enqueue_job
from src.lakehouse.compute_tier import LakehouseComputeTier
from src.lakehouse.control_plane import list_partitions, summarize_cost_attribution
from src.lakehouse.query import query_lakehouse_table

router = APIRouter(prefix="/lakehouse", tags=["Lakehouse"])


def _resolve_org(ctx: APIKeyContext, requested_org_id: str | None) -> str:
    organization_id = requested_org_id or ctx.organization_id
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization mismatch for authenticated key")
    return organization_id


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


class LakehouseBackfillRequest(BaseModel):
    organization_id: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    source_key: str = Field(default="backfill", max_length=128)


class LakehouseReplayRequest(BaseModel):
    organization_id: str | None = None
    checkpoint_key: str = Field(default="lakehouse_replay:event_records", max_length=255)
    max_events: int = Field(default=2000, ge=1, le=50000)


class LakehouseQualityRequest(BaseModel):
    organization_id: str | None = None
    table_name: str | None = Field(default=None, max_length=255)
    limit: int = Field(default=2000, ge=1, le=10000)


class LakehouseRetentionRequest(BaseModel):
    organization_id: str | None = None
    limit: int = Field(default=5000, ge=1, le=50000)


class LakehouseLifecycleRequest(BaseModel):
    organization_id: str | None = None
    limit: int = Field(default=5000, ge=1, le=50000)
    warm_after_days: int = Field(default=7, ge=1, le=365)
    cold_after_days: int = Field(default=30, ge=2, le=3650)


class LakehouseQueryRequest(BaseModel):
    organization_id: str | None = None
    table_name: str
    start_time: str | None = None
    end_time: str | None = None
    limit: int = Field(default=1000, ge=1, le=10000)
    dedupe_by_key: bool = True


class LakehouseComputePlanRequest(BaseModel):
    organization_id: str | None = None
    table_name: str
    lookback_hours: int = Field(default=24, ge=1, le=24 * 365)
    estimated_rows: int = Field(default=100000, ge=0, le=1000000000)
    priority: str = Field(default="normal", max_length=32)


@router.post("/backfill")
async def queue_lakehouse_backfill(
    body: LakehouseBackfillRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> dict[str, Any]:
    organization_id = _resolve_org(ctx, body.organization_id)
    end_time = body.end_time or datetime.now(timezone.utc)
    start_time = body.start_time or (end_time - timedelta(days=30))
    job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=organization_id,
            job_type="lakehouse.backfill",
            payload={
                "organization_id": organization_id,
                "start_time": start_time.isoformat(),
                "end_time": end_time.isoformat(),
                "source_key": body.source_key,
            },
            priority=1,
            max_attempts=2,
            idempotency_key=(
                f"lakehouse_backfill:{organization_id}:{start_time.isoformat()}:{end_time.isoformat()}:{body.source_key}"
            ),
            resource_key=f"lakehouse:backfill:{organization_id}",
        )
    )
    return {
        "status": "queued",
        "job_id": job_id,
        "organization_id": organization_id,
        "start_time": start_time.isoformat(),
        "end_time": end_time.isoformat(),
    }


@router.post("/replay")
async def queue_lakehouse_replay(
    body: LakehouseReplayRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> dict[str, Any]:
    organization_id = _resolve_org(ctx, body.organization_id)
    job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=organization_id,
            job_type="lakehouse.replay",
            payload={
                "organization_id": organization_id,
                "checkpoint_key": body.checkpoint_key,
                "max_events": body.max_events,
            },
            priority=1,
            max_attempts=2,
            idempotency_key=f"lakehouse_replay:{organization_id}:{body.checkpoint_key}",
            resource_key=f"lakehouse:replay:{organization_id}",
        )
    )
    return {
        "status": "queued",
        "job_id": job_id,
        "organization_id": organization_id,
        "checkpoint_key": body.checkpoint_key,
    }


@router.post("/quality/run")
async def queue_lakehouse_quality(
    body: LakehouseQualityRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> dict[str, Any]:
    organization_id = _resolve_org(ctx, body.organization_id)
    job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=organization_id,
            job_type="lakehouse.quality",
            payload={
                "organization_id": organization_id,
                "table_name": body.table_name,
                "limit": body.limit,
            },
            priority=1,
            max_attempts=2,
            idempotency_key=f"lakehouse_quality:{organization_id}:{body.table_name or 'all'}",
            resource_key=f"lakehouse:quality:{organization_id}",
        )
    )
    return {
        "status": "queued",
        "job_id": job_id,
        "organization_id": organization_id,
        "table_name": body.table_name,
    }


@router.post("/retention/run")
async def queue_lakehouse_retention(
    body: LakehouseRetentionRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> dict[str, Any]:
    organization_id = _resolve_org(ctx, body.organization_id)
    job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=organization_id,
            job_type="lakehouse.retention",
            payload={
                "organization_id": organization_id,
                "limit": body.limit,
            },
            priority=1,
            max_attempts=2,
            idempotency_key=f"lakehouse_retention:{organization_id}",
            resource_key=f"lakehouse:retention:{organization_id}",
        )
    )
    return {
        "status": "queued",
        "job_id": job_id,
        "organization_id": organization_id,
        "limit": body.limit,
    }


@router.post("/lifecycle/run")
async def queue_lakehouse_lifecycle(
    body: LakehouseLifecycleRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> dict[str, Any]:
    organization_id = _resolve_org(ctx, body.organization_id)
    job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=organization_id,
            job_type="lakehouse.lifecycle",
            payload={
                "organization_id": organization_id,
                "limit": body.limit,
                "warm_after_days": body.warm_after_days,
                "cold_after_days": body.cold_after_days,
            },
            priority=1,
            max_attempts=2,
            idempotency_key=(
                f"lakehouse_lifecycle:{organization_id}:{body.warm_after_days}:{body.cold_after_days}"
            ),
            resource_key=f"lakehouse:lifecycle:{organization_id}",
        )
    )
    return {
        "status": "queued",
        "job_id": job_id,
        "organization_id": organization_id,
        "limit": body.limit,
        "warm_after_days": body.warm_after_days,
        "cold_after_days": body.cold_after_days,
    }


@router.get("/partitions")
async def get_lakehouse_partitions(
    organization_id: str | None = Query(default=None),
    table_name: str | None = Query(default=None),
    quality_status: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=2000),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> dict[str, Any]:
    resolved_org = _resolve_org(ctx, organization_id)
    rows = await list_partitions(
        organization_id=resolved_org,
        table_name=table_name,
        quality_status=quality_status,
        limit=limit,
    )
    return {"organization_id": resolved_org, "count": len(rows), "items": rows}


@router.get("/cost")
async def get_lakehouse_cost(
    organization_id: str | None = Query(default=None),
    source_key: str | None = Query(default=None),
    table_name: str | None = Query(default=None),
    group_by: str = Query(default="source_table", pattern="^(source_table|tenant|worker|pack)$"),
    limit: int = Query(default=500, ge=1, le=5000),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> dict[str, Any]:
    resolved_org = _resolve_org(ctx, organization_id)
    rows = await summarize_cost_attribution(
        organization_id=resolved_org,
        source_key=source_key,
        table_name=table_name,
        group_by=group_by,
        limit=limit,
    )
    return {"organization_id": resolved_org, "group_by": group_by, "count": len(rows), "items": rows}


@router.post("/query")
async def query_lakehouse(
    body: LakehouseQueryRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> dict[str, Any]:
    organization_id = _resolve_org(ctx, body.organization_id)
    start = _parse_datetime(body.start_time) if body.start_time else None
    end = _parse_datetime(body.end_time) if body.end_time else None
    rows = await query_lakehouse_table(
        organization_id=organization_id,
        table_name=body.table_name,
        start_time=start,
        end_time=end,
        limit=body.limit,
        dedupe_by_key=body.dedupe_by_key,
    )
    return {
        "organization_id": organization_id,
        "table_name": body.table_name,
        "count": len(rows),
        "items": rows,
    }


@router.post("/compute/plan")
async def plan_lakehouse_compute(
    body: LakehouseComputePlanRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> dict[str, Any]:
    organization_id = _resolve_org(ctx, body.organization_id)
    planner = LakehouseComputeTier()
    summary = planner.summarize_request(
        table_name=body.table_name,
        lookback_hours=body.lookback_hours,
        estimated_rows=body.estimated_rows,
        priority=body.priority,
    )
    return {
        "organization_id": organization_id,
        **summary,
    }
