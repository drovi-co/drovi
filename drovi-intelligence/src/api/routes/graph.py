"""
Graph Query Endpoints

Execute Cypher queries and graph operations on the knowledge graph.
"""

import re

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.graph.client import get_graph_client

router = APIRouter()
logger = structlog.get_logger()


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    """Validate organization_id matches auth context."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


class GraphQueryRequest(BaseModel):
    """Request body for graph queries."""

    cypher: str = Field(..., description="Cypher query to execute")
    params: dict | None = Field(default=None, description="Query parameters")
    organization_id: str = Field(..., description="Organization ID for filtering")


class GraphQueryResponse(BaseModel):
    """Response body for graph queries."""

    success: bool
    results: list[dict]
    count: int


@router.post("/graph/query")
async def execute_query(
    request: GraphQueryRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_GRAPH)),
) -> GraphQueryResponse:
    """
    Execute a Cypher query on the knowledge graph.

    Note: Only read queries are allowed. Write operations must go through
    specific endpoints.

    Requires `read:graph` scope.
    """
    _validate_org_id(ctx, request.organization_id)

    # Validate query is read-only (use word boundaries to avoid false positives
    # like "createdAt" matching "CREATE" or "OFFSET" matching "SET")
    query_upper = request.cypher.upper().strip()
    write_keywords = ["CREATE", "MERGE", "DELETE", "SET", "REMOVE", "DETACH"]

    if any(re.search(rf"\b{kw}\b", query_upper) for kw in write_keywords):
        raise HTTPException(
            status_code=400,
            detail="Write operations not allowed via query endpoint. Use specific mutation endpoints.",
        )

    logger.info(
        "Executing graph query",
        organization_id=request.organization_id,
        query_length=len(request.cypher),
        key_id=ctx.key_id,
    )

    try:
        graph = await get_graph_client()

        # Inject organization filter if not present
        params = request.params or {}
        params["orgId"] = request.organization_id

        results = await graph.query(request.cypher, params)

        return GraphQueryResponse(
            success=True,
            results=results,
            count=len(results),
        )

    except Exception as e:
        logger.error("Graph query failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.get("/graph/stats")
async def get_graph_stats(
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ_GRAPH)),
):
    """
    Get graph statistics for an organization.

    Requires `read:graph` scope.
    """
    _validate_org_id(ctx, organization_id)
    try:
        graph = await get_graph_client()

        # Get node counts by type
        # FalkorDB returns labels as a list, we use list indexing
        query = """
        MATCH (n)
        WHERE n.organizationId = $orgId
        WITH labels(n)[0] as nodeType, n
        RETURN nodeType, count(n) as count
        ORDER BY count DESC
        """
        node_counts = await graph.query(query, {"orgId": organization_id})

        # Get relationship counts
        rel_query = """
        MATCH (n)-[r]->(m)
        WHERE n.organizationId = $orgId
        RETURN type(r) as relType, count(r) as count
        ORDER BY count DESC
        LIMIT 20
        """
        rel_counts = await graph.query(rel_query, {"orgId": organization_id})

        return {
            "success": True,
            "node_counts": node_counts,
            "relationship_counts": rel_counts,
        }

    except Exception as e:
        logger.error("Failed to get graph stats", error=str(e))
        raise HTTPException(status_code=500, detail=str(e))
