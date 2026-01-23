"""
Graph Query Endpoints

Execute Cypher queries and graph operations on the knowledge graph.
"""

import structlog
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.graph.client import get_graph_client

router = APIRouter()
logger = structlog.get_logger()


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
async def execute_query(request: GraphQueryRequest) -> GraphQueryResponse:
    """
    Execute a Cypher query on the knowledge graph.

    Note: Only read queries are allowed. Write operations must go through
    specific endpoints.
    """
    # Validate query is read-only
    query_upper = request.cypher.upper().strip()
    write_keywords = ["CREATE", "MERGE", "DELETE", "SET", "REMOVE", "DETACH"]

    if any(kw in query_upper for kw in write_keywords):
        raise HTTPException(
            status_code=400,
            detail="Write operations not allowed via query endpoint. Use specific mutation endpoints.",
        )

    logger.info(
        "Executing graph query",
        organization_id=request.organization_id,
        query_length=len(request.cypher),
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
async def get_graph_stats(organization_id: str):
    """Get graph statistics for an organization."""
    try:
        graph = await get_graph_client()

        # Get node counts by type
        query = """
        MATCH (n)
        WHERE n.organizationId = $orgId
        RETURN labels(n)[0] as nodeType, count(n) as count
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
