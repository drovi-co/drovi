"""
Agentic Memory Endpoints

Temporal and bi-temporal memory queries inspired by Graphiti.
"""

from datetime import datetime
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.memory import MemoryService, get_memory_service

router = APIRouter()
logger = structlog.get_logger()


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    """Validate organization_id matches auth context."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


class MemorySearchRequest(BaseModel):
    """Request for memory search."""

    query: str = Field(..., description="Search query")
    organization_id: str = Field(..., description="Organization ID")
    source_types: list[str] | None = Field(default=None, description="Filter by source types")
    as_of_date: datetime | None = Field(default=None, description="Search as of this date")
    limit: int = Field(default=50, ge=1, le=200)


class TimelineRequest(BaseModel):
    """Request for timeline queries."""

    entity_id: str | None = Field(default=None, description="Entity ID for timeline")
    contact_id: str | None = Field(default=None, description="Contact ID for timeline")
    organization_id: str = Field(..., description="Organization ID")
    source_types: list[str] | None = Field(default=None)
    limit: int = Field(default=100, ge=1, le=500)


class MemoryUIOSearchRequest(BaseModel):
    query: str = Field(..., description="Search query")
    organization_id: str = Field(..., description="Organization ID")
    uio_types: list[str] | None = Field(default=None, description="Filter by UIO types")
    as_of_date: datetime | None = Field(default=None, description="Search as of this date")
    limit: int = Field(default=50, ge=1, le=200)


class TimeSliceRequest(BaseModel):
    """Request for bi-temporal time-slice queries."""

    organization_id: str = Field(..., description="Organization ID")
    as_of: datetime = Field(..., description="Point in time to query")
    mode: Literal["truth", "knowledge", "both"] = Field(
        default="truth",
        description="Filter mode: truth (valid_from/to), knowledge (system_from/to), or both",
    )
    uio_types: list[str] | None = Field(default=None, description="Filter by UIO types")
    status: str | None = Field(default=None, description="Filter by UIO status")
    limit: int = Field(default=100, ge=1, le=500)


class MemoryChangeRequest(BaseModel):
    """Request for change diff between two time slices."""

    organization_id: str = Field(..., description="Organization ID")
    start: datetime = Field(..., description="Start time for diff")
    end: datetime = Field(..., description="End time for diff")
    mode: Literal["truth", "knowledge", "both"] = Field(
        default="truth",
        description="Filter mode: truth (valid_from/to), knowledge (system_from/to), or both",
    )
    uio_types: list[str] | None = Field(default=None, description="Filter by UIO types")
    status: str | None = Field(default=None, description="Filter by UIO status")
    limit: int = Field(default=500, ge=1, le=2000)


class MemoryExportRequest(BaseModel):
    """Request for reality graph export."""

    organization_id: str = Field(..., description="Organization ID")
    as_of: datetime | None = Field(default=None, description="Export as-of time slice")
    include_relationships: bool = Field(default=True)
    limit: int = Field(default=5000, ge=1, le=20000)


class TrailEvent(BaseModel):
    event_type: str
    event_description: str
    previous_value: dict | None = None
    new_value: dict | None = None
    source_type: str | None = None
    source_id: str | None = None
    source_name: str | None = None
    message_id: str | None = None
    quoted_text: str | None = None
    triggered_by: str | None = None
    confidence: float | None = None
    event_at: str | None = None


class TrailResponse(BaseModel):
    uio_id: str
    uio_type: str
    status: str | None = None
    title: str | None = None
    description: str | None = None
    valid_from: str | None = None
    valid_to: str | None = None
    system_from: str | None = None
    system_to: str | None = None
    events: list[TrailEvent] = Field(default_factory=list)


@router.post("/memory/search")
async def search_memory(
    request: MemorySearchRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Search agentic memory with optional temporal filtering.

    If as_of_date is provided, returns the memory state as of that date.

    Requires `read` scope.
    """
    _validate_org_id(ctx, request.organization_id)
    logger.info(
        "Searching memory",
        organization_id=request.organization_id,
        query=request.query[:50],
        as_of_date=request.as_of_date,
    )

    try:
        memory = await get_memory_service(request.organization_id)

        if request.as_of_date:
            results = await memory.search_as_of(
                query=request.query,
                as_of_date=request.as_of_date,
                source_types=request.source_types,
                limit=request.limit,
            )
        else:
            results = await memory.search(
                query=request.query,
                source_types=request.source_types,
                limit=request.limit,
            )

        results = MemoryService.apply_temporal_decay(results)

        return {
            "success": True,
            "results": results,
            "count": len(results),
            "as_of_date": request.as_of_date.isoformat() if request.as_of_date else None,
        }

    except Exception as e:
        logger.error("Memory search failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/memory/search/cross-source")
async def search_cross_source(
    request: MemorySearchRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Search memory across all sources, grouped by source type.

    Returns results organized by email, slack, notion, etc.

    Requires `read` scope.
    """
    _validate_org_id(ctx, request.organization_id)
    logger.info(
        "Cross-source memory search",
        organization_id=request.organization_id,
        query=request.query[:50],
    )

    try:
        memory = await get_memory_service(request.organization_id)
        results = await memory.search_across_sources(
            query=request.query,
            limit=request.limit,
        )
        for source_type, items in list(results.items()):
            results[source_type] = MemoryService.apply_temporal_decay(items)

        return {
            "success": True,
            "results": results,
        }

    except Exception as e:
        logger.error("Cross-source search failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/memory/search/uios")
async def search_uios(
    request: MemoryUIOSearchRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Search UIO nodes with optional bi-temporal filtering.
    """
    _validate_org_id(ctx, request.organization_id)
    try:
        memory = await get_memory_service(request.organization_id)
        results = await memory.search_uios_as_of(
            query=request.query,
            as_of_date=request.as_of_date,
            uio_types=request.uio_types,
            limit=request.limit,
        )
        results = MemoryService.apply_temporal_decay(results)

        return {
            "success": True,
            "results": results,
            "count": len(results),
            "as_of_date": request.as_of_date.isoformat() if request.as_of_date else None,
        }
    except Exception as e:
        logger.error("UIO memory search failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/memory/timeline")
async def get_timeline(
    request: TimelineRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get timeline of episodes for an entity or contact.

    Requires `read` scope.
    """
    _validate_org_id(ctx, request.organization_id)
    if not request.entity_id and not request.contact_id:
        raise HTTPException(
            status_code=400,
            detail="Either entity_id or contact_id must be provided",
        )

    logger.info(
        "Getting timeline",
        organization_id=request.organization_id,
        entity_id=request.entity_id,
        contact_id=request.contact_id,
    )

    try:
        memory = await get_memory_service(request.organization_id)

        if request.entity_id:
            episodes = await memory.get_entity_timeline(request.entity_id)
        else:
            episodes = await memory.get_contact_timeline(
                request.contact_id,
                source_types=request.source_types,
            )

        return {
            "success": True,
            "episodes": episodes[:request.limit],
            "count": len(episodes),
        }

    except Exception as e:
        logger.error("Timeline query failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/memory/time-slice")
async def time_slice_uios(
    request: TimeSliceRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Query UIOs as-of a specific timestamp (bi-temporal time slice).
    """
    _validate_org_id(ctx, request.organization_id)
    try:
        memory = await get_memory_service(request.organization_id)
        results = await memory.time_slice_uios(
            as_of=request.as_of,
            mode=request.mode,
            uio_types=request.uio_types,
            status=request.status,
            limit=request.limit,
        )
        return {
            "success": True,
            "as_of": request.as_of.isoformat(),
            "mode": request.mode,
            "results": results,
            "count": len(results),
        }
    except Exception as e:
        logger.error("Time-slice query failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/memory/changes")
async def memory_changes(
    request: MemoryChangeRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Return a diff summary between two time slices."""
    _validate_org_id(ctx, request.organization_id)
    try:
        memory = await get_memory_service(request.organization_id)
        diff = await memory.diff_uios(
            start=request.start,
            end=request.end,
            mode=request.mode,
            uio_types=request.uio_types,
            status=request.status,
            limit=request.limit,
        )
        return {
            "success": True,
            "start": request.start.isoformat(),
            "end": request.end.isoformat(),
            "mode": request.mode,
            "diff": diff,
        }
    except Exception as e:
        logger.error("Memory change diff failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/memory/export")
async def export_reality_graph(
    request: MemoryExportRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Export the reality graph snapshot for audit/compliance."""
    _validate_org_id(ctx, request.organization_id)
    try:
        memory = await get_memory_service(request.organization_id)
        export = await memory.export_reality_graph(
            as_of=request.as_of,
            limit=request.limit,
            include_relationships=request.include_relationships,
        )
        return {"success": True, "export": export}
    except Exception as e:
        logger.error("Reality graph export failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/memory/trails/commitments/{commitment_id}", response_model=TrailResponse)
async def get_commitment_trail(
    commitment_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get an audit-grade commitment trail (timeline of changes + evidence).
    """
    _validate_org_id(ctx, organization_id)
    memory = await get_memory_service(organization_id)
    trail = await memory.get_commitment_trail(commitment_id)
    if not trail:
        raise HTTPException(status_code=404, detail="Commitment not found")
    return TrailResponse(**trail)


@router.get("/memory/trails/decisions/{decision_id}", response_model=TrailResponse)
async def get_decision_trail(
    decision_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get an audit-grade decision trail (timeline of changes + evidence).
    """
    _validate_org_id(ctx, organization_id)
    memory = await get_memory_service(organization_id)
    trail = await memory.get_decision_trail(decision_id)
    if not trail:
        raise HTTPException(status_code=404, detail="Decision not found")
    return TrailResponse(**trail)


@router.get("/memory/recent")
async def get_recent_episodes(
    organization_id: str,
    limit: int = 50,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get the most recent episodes.

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    try:
        memory = await get_memory_service(organization_id)
        episodes = await memory.get_recent_episodes(limit)

        return {
            "success": True,
            "episodes": episodes,
            "count": len(episodes),
        }

    except Exception as e:
        logger.error("Failed to get recent episodes", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
