"""
Agentic Memory Endpoints

Temporal and bi-temporal memory queries inspired by Graphiti.
"""

from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.memory.drovi_memory import get_memory

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
        memory = await get_memory(request.organization_id)

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
        memory = await get_memory(request.organization_id)
        results = await memory.search_across_sources(
            query=request.query,
            limit=request.limit,
        )

        return {
            "success": True,
            "results": results,
        }

    except Exception as e:
        logger.error("Cross-source search failed", error=str(e))
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
        memory = await get_memory(request.organization_id)

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
        memory = await get_memory(organization_id)
        episodes = await memory.get_recent_episodes(limit)

        return {
            "success": True,
            "episodes": episodes,
            "count": len(episodes),
        }

    except Exception as e:
        logger.error("Failed to get recent episodes", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
