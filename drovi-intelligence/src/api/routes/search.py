"""
Hybrid Search Endpoints

Combines vector (semantic), full-text (keyword), and graph (relationship) search.
"""

from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.search.hybrid import HybridSearch, get_hybrid_search

router = APIRouter()
logger = structlog.get_logger()


class SearchRequest(BaseModel):
    """Request for hybrid search."""

    query: str = Field(..., description="Search query")
    organization_id: str | None = Field(default=None, description="Organization ID (optional if using session auth)")
    types: list[str] | None = Field(
        default=None,
        description="Node types to search (commitment, decision, contact, etc.)",
    )
    source_types: list[str] | None = Field(default=None, description="Filter by source types")
    time_range: dict | None = Field(
        default=None,
        description="Time range filter: {from: ISO date, to: ISO date}",
    )
    include_graph_context: bool = Field(
        default=False,
        description="Include connected nodes in results",
    )
    limit: int = Field(default=20, ge=1, le=100)


class SearchResult(BaseModel):
    """A single search result."""

    id: str | None = None
    type: str
    title: str | None = None
    properties: dict
    score: float
    scores: dict = Field(default_factory=dict)  # {vector, fulltext, contains}
    match_source: str  # vector, fulltext, contains, both, or combinations
    connections: list[dict] | None = None


class SearchResponse(BaseModel):
    """Response for hybrid search."""

    success: bool
    results: list[SearchResult]
    count: int
    query_time_ms: int


@router.post("/search")
async def hybrid_search(
    request: SearchRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> SearchResponse:
    """
    Perform hybrid search combining vector and full-text search.

    Uses Reciprocal Rank Fusion (RRF) to combine results from multiple sources.

    Requires `read` scope.
    """
    # Use org_id from auth context if not provided in request
    org_id = request.organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")

    # Validate organization_id matches auth context (if not internal)
    if ctx.organization_id != "internal" and request.organization_id and request.organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )

    start_time = datetime.utcnow()

    logger.info(
        "Hybrid search",
        organization_id=org_id,
        query=request.query[:50],
        types=request.types,
        key_id=ctx.key_id,
    )

    try:
        search = await get_hybrid_search()

        results = await search.search(
            query=request.query,
            organization_id=org_id,
            types=request.types,
            source_types=request.source_types,
            time_range=request.time_range,
            include_graph_context=request.include_graph_context,
            limit=request.limit,
        )

        query_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        return SearchResponse(
            success=True,
            results=[SearchResult(**r) for r in results],
            count=len(results),
            query_time_ms=query_time,
        )

    except Exception as e:
        logger.error("Hybrid search failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search/vector")
async def vector_search(
    request: SearchRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> SearchResponse:
    """
    Perform vector-only search for semantic similarity.

    Requires `read` scope.
    """
    # Validate organization_id matches auth context
    if ctx.organization_id != "internal" and request.organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )

    start_time = datetime.utcnow()

    try:
        search = await get_hybrid_search()

        results = await search.vector_search(
            query=request.query,
            organization_id=request.organization_id,
            types=request.types,
            limit=request.limit,
        )

        query_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        return SearchResponse(
            success=True,
            results=[SearchResult(**r) for r in results],
            count=len(results),
            query_time_ms=query_time,
        )

    except Exception as e:
        logger.error("Vector search failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search/fulltext")
async def fulltext_search(
    request: SearchRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> SearchResponse:
    """
    Perform full-text search for keyword matching.

    Requires `read` scope.
    """
    # Validate organization_id matches auth context
    if ctx.organization_id != "internal" and request.organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )

    start_time = datetime.utcnow()

    try:
        search = await get_hybrid_search()

        results = await search.fulltext_search(
            query=request.query,
            organization_id=request.organization_id,
            types=request.types,
            limit=request.limit,
        )

        query_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        return SearchResponse(
            success=True,
            results=[SearchResult(**r) for r in results],
            count=len(results),
            query_time_ms=query_time,
        )

    except Exception as e:
        logger.error("Fulltext search failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search/graph-aware")
async def graph_aware_search(
    request: SearchRequest,
    depth: int = 1,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> SearchResponse:
    """
    Perform search with graph context expansion.

    Finds matching nodes and expands to connected nodes up to specified depth.

    Requires `read` scope.
    """
    # Validate organization_id matches auth context
    if ctx.organization_id != "internal" and request.organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )

    start_time = datetime.utcnow()

    try:
        search = await get_hybrid_search()

        results = await search.graph_aware_search(
            query=request.query,
            organization_id=request.organization_id,
            types=request.types,
            depth=depth,
            limit=request.limit,
        )

        query_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        return SearchResponse(
            success=True,
            results=[SearchResult(**r) for r in results],
            count=len(results),
            query_time_ms=query_time,
        )

    except Exception as e:
        logger.error("Graph-aware search failed", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
