"""
Customer Context API Routes

MCP-style endpoints for customer context aggregation.
Provides tools and resources for LLM access to customer intelligence.

From the "Trillion Dollar Hole" research:
- Aggregate all customer context across sources
- Expose via MCP server for agent access
"""

from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope

logger = structlog.get_logger()

router = APIRouter(prefix="/customer", tags=["Customer Context"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    """Validate organization_id matches auth context."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================


class CustomerContextRequest(BaseModel):
    """Request for customer context."""

    contact_id: str | None = None
    email: str | None = None
    organization_id: str
    include_timeline: bool = True
    max_timeline_items: int = 50


class CommitmentResponse(BaseModel):
    """Commitment in response."""

    id: str
    title: str
    status: str
    priority: str | None = None
    direction: str
    due_date: datetime | None = None
    confidence: float = 0.0


class DecisionResponse(BaseModel):
    """Decision in response."""

    id: str
    title: str
    statement: str | None = None
    status: str
    decided_at: datetime | None = None


class ContactResponse(BaseModel):
    """Contact in response."""

    id: str
    email: str | None = None
    name: str | None = None
    company: str | None = None
    title: str | None = None
    interaction_count: int = 0


class TimelineEventResponse(BaseModel):
    """Timeline event in response."""

    id: str
    event_type: str
    title: str
    summary: str | None = None
    source_type: str | None = None
    reference_time: datetime
    participants: list[str] = Field(default_factory=list)


class CustomerContextResponse(BaseModel):
    """Full customer context response."""

    contact_id: str
    email: str | None = None
    name: str | None = None
    company: str | None = None
    title: str | None = None

    interaction_count: int = 0
    last_interaction: datetime | None = None
    relationship_health: float = 1.0

    source_types: list[str] = Field(default_factory=list)
    open_commitments: list[CommitmentResponse] = Field(default_factory=list)
    related_decisions: list[DecisionResponse] = Field(default_factory=list)
    top_contacts: list[ContactResponse] = Field(default_factory=list)
    top_topics: list[str] = Field(default_factory=list)
    timeline: list[TimelineEventResponse] = Field(default_factory=list)
    relationship_summary: str | None = None


class CustomerSearchRequest(BaseModel):
    """Request for customer search."""

    query: str
    organization_id: str
    limit: int = 20


class CustomerSearchResponse(BaseModel):
    """Customer search response."""

    results: list[ContactResponse]
    total: int


class RelationshipHealthResponse(BaseModel):
    """Relationship health response."""

    contact_id: str
    health_score: float
    factors: dict[str, Any] = Field(default_factory=dict)


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.post("/context", response_model=CustomerContextResponse)
async def get_customer_context(
    request: CustomerContextRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get complete context about a customer.

    MCP Tool: get_customer_context
    - Aggregates all intelligence about a customer via graph traversal
    - Includes commitments, decisions, timeline, relationships

    Requires `read` scope.
    """
    _validate_org_id(ctx, request.organization_id)
    from src.customer.context_aggregator import get_customer_context_aggregator

    logger.info(
        "Getting customer context",
        contact_id=request.contact_id,
        email=request.email,
        organization_id=request.organization_id,
        key_id=ctx.key_id,
    )

    aggregator = await get_customer_context_aggregator()

    # Find contact ID if email provided
    contact_id = request.contact_id
    if not contact_id and request.email:
        contact_id = await _find_contact_by_email(
            request.email, request.organization_id
        )
        if not contact_id:
            raise HTTPException(status_code=404, detail="Contact not found")

    if not contact_id:
        raise HTTPException(status_code=400, detail="contact_id or email required")

    context = await aggregator.get_customer_context(
        contact_id=contact_id,
        organization_id=request.organization_id,
        include_history=request.include_timeline,
        max_timeline_items=request.max_timeline_items,
    )

    return CustomerContextResponse(
        contact_id=context.contact_id,
        email=context.email,
        name=context.name,
        company=context.company,
        title=context.title,
        interaction_count=context.interaction_count,
        last_interaction=context.last_interaction,
        relationship_health=context.relationship_health,
        source_types=context.source_types,
        open_commitments=[
            CommitmentResponse(
                id=c.id,
                title=c.title,
                status=c.status,
                priority=c.priority,
                direction=c.direction,
                due_date=c.due_date,
                confidence=c.confidence,
            )
            for c in context.open_commitments
        ],
        related_decisions=[
            DecisionResponse(
                id=d.id,
                title=d.title,
                statement=d.statement,
                status=d.status,
                decided_at=d.decided_at,
            )
            for d in context.related_decisions
        ],
        top_contacts=[
            ContactResponse(
                id=c.id,
                email=c.email,
                name=c.name,
                company=c.company,
                title=c.title,
                interaction_count=c.interaction_count,
            )
            for c in context.top_contacts
        ],
        top_topics=context.top_topics,
        timeline=[
            TimelineEventResponse(
                id=e.id,
                event_type=e.event_type,
                title=e.title,
                summary=e.summary,
                source_type=e.source_type,
                reference_time=e.reference_time,
                participants=e.participants,
            )
            for e in context.timeline
        ],
        relationship_summary=context.relationship_summary,
    )


@router.post("/search", response_model=CustomerSearchResponse)
async def search_customers(
    request: CustomerSearchRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Search for customers by name, email, or company.

    MCP Tool: search_customers

    Requires `read` scope.
    """
    _validate_org_id(ctx, request.organization_id)
    from src.customer.context_aggregator import get_customer_context_aggregator

    logger.info(
        "Searching customers",
        query=request.query,
        organization_id=request.organization_id,
        key_id=ctx.key_id,
    )

    aggregator = await get_customer_context_aggregator()
    results = await aggregator.search_customers(
        query=request.query,
        organization_id=request.organization_id,
        limit=request.limit,
    )

    return CustomerSearchResponse(
        results=[
            ContactResponse(
                id=c.id,
                email=c.email,
                name=c.name,
                company=c.company,
                title=c.title,
                interaction_count=c.interaction_count,
            )
            for c in results
        ],
        total=len(results),
    )


@router.get("/timeline/{contact_id}")
async def get_customer_timeline(
    contact_id: str,
    organization_id: str = Query(...),
    limit: int = Query(50, ge=1, le=200),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get chronological interaction timeline for a customer.

    MCP Tool: get_customer_timeline

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.customer.context_aggregator import get_customer_context_aggregator

    aggregator = await get_customer_context_aggregator()
    timeline = await aggregator.get_contact_timeline(
        contact_id=contact_id,
        organization_id=organization_id,
        limit=limit,
    )

    return {
        "contact_id": contact_id,
        "events": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "title": e.title,
                "summary": e.summary,
                "source_type": e.source_type,
                "reference_time": e.reference_time.isoformat() if e.reference_time else None,
                "participants": e.participants,
            }
            for e in timeline
        ],
        "total": len(timeline),
    }


@router.get("/health/{contact_id}", response_model=RelationshipHealthResponse)
async def get_relationship_health(
    contact_id: str,
    organization_id: str = Query(...),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get relationship health score for a customer.

    MCP Tool: get_relationship_health

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.customer.context_aggregator import get_customer_context_aggregator

    aggregator = await get_customer_context_aggregator()
    health = await aggregator.compute_relationship_health(
        contact_id=contact_id,
        organization_id=organization_id,
    )

    return RelationshipHealthResponse(
        contact_id=contact_id,
        health_score=health,
        factors={
            "commitment_fulfillment": "healthy" if health > 0.7 else "needs_attention",
            "interaction_trend": "stable" if health > 0.5 else "declining",
        },
    )


@router.post("/summary/{contact_id}")
async def generate_relationship_summary(
    contact_id: str,
    organization_id: str = Query(...),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Generate AI summary of relationship with customer.

    MCP Tool: generate_relationship_summary

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.customer.context_aggregator import get_customer_context_aggregator

    aggregator = await get_customer_context_aggregator()
    summary = await aggregator.generate_relationship_summary(
        contact_id=contact_id,
        organization_id=organization_id,
    )

    return {
        "contact_id": contact_id,
        "summary": summary,
        "generated_at": datetime.utcnow().isoformat(),
    }


@router.get("/commitments/{contact_id}")
async def get_customer_commitments(
    contact_id: str,
    organization_id: str = Query(...),
    status: str = Query(None, description="Filter by status"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get open commitments for a customer.

    MCP Tool: list_open_commitments

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    from src.graph.client import get_graph_client

    graph = await get_graph_client()

    status_filter = ""
    if status:
        status_filter = f"AND c.status = '{status}'"

    result = await graph.query(
        f"""
        MATCH (contact:Contact {{id: $contact_id, organizationId: $org_id}})
              -[:INVOLVED_IN]->(c:Commitment)
        WHERE c.organizationId = $org_id
        AND c.validTo IS NULL
        {status_filter}
        RETURN c.id as id,
               c.title as title,
               c.status as status,
               c.priority as priority,
               c.direction as direction,
               c.dueDate as due_date,
               c.confidence as confidence
        ORDER BY c.dueDate ASC
        """,
        {"contact_id": contact_id, "org_id": organization_id},
    )

    return {
        "contact_id": contact_id,
        "commitments": [
            {
                "id": row["id"],
                "title": row["title"],
                "status": row.get("status"),
                "priority": row.get("priority"),
                "direction": row.get("direction"),
                "due_date": row.get("due_date"),
                "confidence": row.get("confidence", 0),
            }
            for row in (result or [])
        ],
        "total": len(result or []),
    }


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


async def _find_contact_by_email(email: str, organization_id: str) -> str | None:
    """Find contact ID by email."""
    from src.graph.client import get_graph_client

    graph = await get_graph_client()

    result = await graph.query(
        """
        MATCH (c:Contact {email: $email, organizationId: $org_id})
        RETURN c.id as id
        LIMIT 1
        """,
        {"email": email, "org_id": organization_id},
    )

    if result and len(result) > 0:
        return result[0]["id"]
    return None
