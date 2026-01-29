"""
Sessions API Routes

Provides agent context session management for maintaining conversation
continuity and context across multiple interactions.

OpenAPI Tags:
- sessions: Agent context session management
"""

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Path
from pydantic import BaseModel, Field
import structlog

from src.agents import (
    AgentSession,
    SessionManager,
    get_session_manager,
    ContextType,
)
from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope

logger = structlog.get_logger()

router = APIRouter(prefix="/sessions", tags=["Sessions"])


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


class CreateSessionRequest(BaseModel):
    """Request to create a new agent session."""

    organization_id: str = Field(..., description="Organization ID", min_length=1)
    agent_id: str | None = Field(None, description="Optional agent identifier (e.g., MCP client ID)")
    ttl_hours: int = Field(24, description="Session TTL in hours", ge=1, le=168)
    metadata: dict[str, Any] = Field(default_factory=dict, description="Additional session metadata")

    model_config = {"json_schema_extra": {"example": {"organization_id": "org_123", "agent_id": "mcp_client_456", "ttl_hours": 24, "metadata": {"client_name": "Claude Desktop"}}}}


class SessionResponse(BaseModel):
    """Response containing session details."""

    session_id: str = Field(..., description="Unique session ID")
    organization_id: str = Field(..., description="Organization ID")
    agent_id: str | None = Field(None, description="Agent identifier")
    created_at: datetime = Field(..., description="Session creation time")
    last_activity: datetime = Field(..., description="Last activity timestamp")
    ttl_hours: int = Field(..., description="Session TTL in hours")
    is_expired: bool = Field(..., description="Whether session has expired")
    context_summary: dict[str, Any] = Field(..., description="Summary of accumulated context")
    metadata: dict[str, Any] = Field(..., description="Session metadata")

    model_config = {"json_schema_extra": {"example": {"session_id": "sess_abc123", "organization_id": "org_123", "agent_id": "mcp_client_456", "created_at": "2024-01-15T10:30:00Z", "last_activity": "2024-01-15T11:45:00Z", "ttl_hours": 24, "is_expired": False, "context_summary": {"entry_count": 15, "recent_queries": ["What decisions were made?"], "top_entities": ["contact_123"]}, "metadata": {}}}}


class AddContextEntryRequest(BaseModel):
    """Request to add a context entry to a session."""

    context_type: str = Field(..., description="Type of context entry")
    content: dict[str, Any] = Field(..., description="Context content")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Optional metadata")

    model_config = {"json_schema_extra": {"example": {"context_type": "query", "content": {"query": "What commitments are due this week?"}, "metadata": {"source": "chat"}}}}


class AddInteractionRequest(BaseModel):
    """Request to add a query/response interaction."""

    query: str = Field(..., description="User or agent query", min_length=1)
    response: str = Field(..., description="System response", min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict, description="Optional metadata")

    model_config = {"json_schema_extra": {"example": {"query": "What commitments are due this week?", "response": "You have 3 commitments due: ...", "metadata": {"latency_ms": 150}}}}


class ContextEntryResponse(BaseModel):
    """Response after adding a context entry."""

    entry_id: str = Field(..., description="Created entry ID")
    context_type: str = Field(..., description="Type of context")
    timestamp: datetime = Field(..., description="Entry timestamp")

    model_config = {"json_schema_extra": {"example": {"entry_id": "entry_xyz789", "context_type": "query", "timestamp": "2024-01-15T11:45:00Z"}}}


class SessionListResponse(BaseModel):
    """Response containing list of sessions."""

    sessions: list[SessionResponse] = Field(..., description="List of sessions")
    total_count: int = Field(..., description="Total number of sessions")

    model_config = {"json_schema_extra": {"example": {"sessions": [], "total_count": 0}}}


class ContextTypesResponse(BaseModel):
    """Response containing available context types."""

    context_types: list[dict[str, str]] = Field(..., description="Available context types")

    model_config = {"json_schema_extra": {"example": {"context_types": [{"name": "query", "description": "User/agent query"}, {"name": "response", "description": "System response"}]}}}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def _session_to_response(session: AgentSession) -> SessionResponse:
    """Convert AgentSession to SessionResponse."""
    return SessionResponse(
        session_id=session.session_id,
        organization_id=session.organization_id,
        agent_id=session.agent_id,
        created_at=session.created_at,
        last_activity=session.last_activity,
        ttl_hours=session.ttl_hours,
        is_expired=session.is_expired,
        context_summary=session.context.get_context_summary(),
        metadata=session.metadata,
    )


# =============================================================================
# API ENDPOINTS
# =============================================================================


@router.get(
    "/context-types",
    response_model=ContextTypesResponse,
    summary="List available context types",
    description="""
Returns all available context types that can be added to a session.

**Context Types:**
- `query`: User or agent query
- `response`: System response
- `search_results`: Search results returned
- `entity_viewed`: Entity was viewed
- `entity_mentioned`: Entity was mentioned
- `uio_viewed`: UIO was viewed
- `uio_mentioned`: UIO was mentioned
- `thread_viewed`: Thread was viewed
- `action_taken`: Agent took an action
- `action_suggested`: Action was suggested
- `feedback_given`: User gave feedback
- `system_note`: System-generated note
""",
)
async def list_context_types() -> ContextTypesResponse:
    """List all available context types."""
    types = [
        {"name": "query", "description": "User or agent query"},
        {"name": "response", "description": "System response"},
        {"name": "search_results", "description": "Search results returned"},
        {"name": "entity_viewed", "description": "Entity was viewed"},
        {"name": "entity_mentioned", "description": "Entity was mentioned"},
        {"name": "uio_viewed", "description": "UIO was viewed"},
        {"name": "uio_mentioned", "description": "UIO was mentioned"},
        {"name": "thread_viewed", "description": "Thread was viewed"},
        {"name": "action_taken", "description": "Agent took an action"},
        {"name": "action_suggested", "description": "Action was suggested"},
        {"name": "feedback_given", "description": "User gave feedback"},
        {"name": "system_note", "description": "System-generated note"},
    ]
    return ContextTypesResponse(context_types=types)


@router.post(
    "",
    response_model=SessionResponse,
    status_code=201,
    summary="Create a new session",
    description="""
Create a new agent context session.

Sessions maintain context across multiple interactions, enabling:
- Continuity in agent conversations
- Tracking of viewed entities and UIOs
- Query history for context-aware responses
- Relevance decay for older context

**TTL:** Sessions expire after `ttl_hours` of inactivity (default: 24 hours).
""",
    responses={
        201: {"description": "Session created successfully"},
        500: {"description": "Failed to create session"},
    },
)
async def create_session(
    request: CreateSessionRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> SessionResponse:
    """Create a new agent context session. Requires `write` scope."""
    _validate_org_id(ctx, request.organization_id)
    try:
        manager = await get_session_manager()

        session = await manager.create_session(
            organization_id=request.organization_id,
            agent_id=request.agent_id,
            metadata=request.metadata,
        )

        # Update TTL if specified
        if request.ttl_hours != 24:
            session.ttl_hours = request.ttl_hours
            await manager.update_session(session)

        logger.info(
            "Session created",
            session_id=session.session_id,
            organization_id=request.organization_id,
            key_id=ctx.key_id,
        )

        return _session_to_response(session)

    except Exception as e:
        logger.error("Failed to create session", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to create session: {str(e)}")


@router.get(
    "/{session_id}",
    response_model=SessionResponse,
    summary="Get session details",
    description="""
Retrieve details of an existing session.

Returns the session's:
- Basic information (ID, organization, agent)
- Timestamps (created, last activity)
- Expiration status
- Context summary (entry count, recent queries, top entities)
- Metadata

**Note:** Accessing a session updates its `last_activity` timestamp.
""",
    responses={
        200: {"description": "Session found"},
        404: {"description": "Session not found or expired"},
    },
)
async def get_session(
    session_id: Annotated[str, Path(description="Session ID")],
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> SessionResponse:
    """Get session details. Requires `read` scope."""
    manager = await get_session_manager()
    session = await manager.get_session(session_id)

    if session:
        _validate_org_id(ctx, session.organization_id)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    # Touch to update last_activity
    await manager.update_session(session)

    return _session_to_response(session)


@router.get(
    "",
    response_model=SessionListResponse,
    summary="List sessions",
    description="""
List sessions for an organization.

**Filters:**
- `organization_id`: Required organization filter
- `include_expired`: Include expired sessions (default: false)

**Note:** Sessions are returned in no particular order.
""",
    responses={
        200: {"description": "Sessions retrieved"},
    },
)
async def list_sessions(
    organization_id: Annotated[str, Query(description="Organization ID")],
    include_expired: Annotated[bool, Query(description="Include expired sessions")] = False,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> SessionListResponse:
    """List sessions for an organization. Requires `read` scope."""
    _validate_org_id(ctx, organization_id)
    manager = await get_session_manager()
    sessions = await manager.list_sessions(organization_id, include_expired)

    return SessionListResponse(
        sessions=[_session_to_response(s) for s in sessions],
        total_count=len(sessions),
    )


@router.delete(
    "/{session_id}",
    status_code=204,
    summary="Delete a session",
    description="""
Delete a session and all its context.

This operation is irreversible. All accumulated context will be lost.
""",
    responses={
        204: {"description": "Session deleted"},
        404: {"description": "Session not found"},
    },
)
async def delete_session(
    session_id: Annotated[str, Path(description="Session ID")],
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> None:
    """Delete a session. Requires `write` scope."""
    manager = await get_session_manager()
    session = await manager.get_session(session_id)
    if session:
        _validate_org_id(ctx, session.organization_id)

    deleted = await manager.delete_session(session_id)

    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")

    logger.info("Session deleted", session_id=session_id, key_id=ctx.key_id)


@router.post(
    "/{session_id}/context",
    response_model=ContextEntryResponse,
    status_code=201,
    summary="Add context entry",
    description="""
Add a context entry to a session.

**Context Types:**
- `query`: User or agent query
- `response`: System response
- `entity_viewed`: When an entity is viewed
- `uio_viewed`: When a UIO is viewed
- `action_taken`: When an action is taken

**Relevance Decay:**
Older context entries have their relevance score decayed over time.
Entries below the threshold are automatically pruned.
""",
    responses={
        201: {"description": "Context entry added"},
        404: {"description": "Session not found"},
    },
)
async def add_context_entry(
    session_id: Annotated[str, Path(description="Session ID")],
    request: AddContextEntryRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> ContextEntryResponse:
    """Add a context entry to a session. Requires `write` scope."""
    manager = await get_session_manager()
    session = await manager.get_session(session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    _validate_org_id(ctx, session.organization_id)

    # Validate context type
    try:
        context_type = ContextType(request.context_type)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid context type: {request.context_type}. See /sessions/context-types for valid types.",
        )

    from src.agents.context import ContextEntry

    entry = ContextEntry.create(
        context_type=context_type,
        content=request.content,
        metadata=request.metadata,
    )

    session.context.add_entry(entry)
    await manager.update_session(session)

    return ContextEntryResponse(
        entry_id=entry.entry_id,
        context_type=entry.context_type.value,
        timestamp=entry.timestamp,
    )


@router.post(
    "/{session_id}/interaction",
    response_model=dict[str, ContextEntryResponse],
    status_code=201,
    summary="Add query/response interaction",
    description="""
Add a complete query/response interaction to a session.

This is a convenience endpoint that adds both:
1. A `query` context entry
2. A `response` context entry (linked to the query)

Use this for tracking agent conversations.
""",
    responses={
        201: {"description": "Interaction added"},
        404: {"description": "Session not found"},
    },
)
async def add_interaction(
    session_id: Annotated[str, Path(description="Session ID")],
    request: AddInteractionRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> dict[str, ContextEntryResponse]:
    """Add a query/response interaction. Requires `write` scope."""
    manager = await get_session_manager()
    session = await manager.get_session(session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    _validate_org_id(ctx, session.organization_id)

    query_entry, response_entry = session.add_interaction(
        query=request.query,
        response=request.response,
        metadata=request.metadata,
    )
    await manager.update_session(session)

    return {
        "query": ContextEntryResponse(
            entry_id=query_entry.entry_id,
            context_type=query_entry.context_type.value,
            timestamp=query_entry.timestamp,
        ),
        "response": ContextEntryResponse(
            entry_id=response_entry.entry_id,
            context_type=response_entry.context_type.value,
            timestamp=response_entry.timestamp,
        ),
    }


@router.get(
    "/{session_id}/context",
    response_model=dict[str, Any],
    summary="Get full session context",
    description="""
Get the full context accumulated in a session.

Returns:
- All context entries with their relevance scores
- Mentioned entities and UIOs with counts
- Viewed threads
- Context summary statistics

**Note:** This may return a large amount of data for long-running sessions.
""",
    responses={
        200: {"description": "Context retrieved"},
        404: {"description": "Session not found"},
    },
)
async def get_session_context(
    session_id: Annotated[str, Path(description="Session ID")],
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> dict[str, Any]:
    """Get full session context. Requires `read` scope."""
    manager = await get_session_manager()
    session = await manager.get_session(session_id)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found or expired")

    _validate_org_id(ctx, session.organization_id)

    return {
        "session_id": session.session_id,
        "context": session.context.to_dict(),
        "summary": session.context.get_context_summary(),
    }


@router.post(
    "/cleanup",
    response_model=dict[str, int],
    summary="Cleanup expired sessions",
    description="""
Clean up all expired sessions.

This is an administrative endpoint that removes sessions that have
exceeded their TTL. Usually called periodically by a background job.

Returns the number of sessions cleaned up.
""",
    responses={
        200: {"description": "Cleanup completed"},
    },
)
async def cleanup_expired_sessions(
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> dict[str, int]:
    """Clean up expired sessions. Requires `admin` scope."""
    manager = await get_session_manager()
    cleaned = await manager.cleanup_expired()

    logger.info("Session cleanup completed", cleaned_count=cleaned, key_id=ctx.key_id)

    return {"cleaned": cleaned}
