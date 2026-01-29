"""
Changes API Routes

Provides change detection, entity versioning, and diff computation
for tracking modifications to intelligence objects over time.

OpenAPI Tags:
- changes: Change detection and version history
"""

from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Path
from pydantic import BaseModel, Field
import structlog

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.graph.changes import (
    ChangeTracker,
    get_change_tracker,
    DiffResult,
    FieldChange,
    ChangeType,
)

logger = structlog.get_logger()

router = APIRouter(prefix="/changes", tags=["Changes"])


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


class FieldChangeResponse(BaseModel):
    """A change to a single field."""

    field_name: str = Field(..., description="Name of the changed field")
    change_type: str = Field(..., description="Type of change: added, removed, modified")
    old_value: Any = Field(None, description="Previous value (null for added fields)")
    new_value: Any = Field(None, description="New value (null for removed fields)")

    model_config = {"json_schema_extra": {"example": {"field_name": "status", "change_type": "modified", "old_value": "pending", "new_value": "completed"}}}


class DiffResponse(BaseModel):
    """Diff between two versions of an entity."""

    entity_id: str = Field(..., description="Entity ID")
    entity_type: str = Field(..., description="Entity type")
    old_version: int | None = Field(None, description="Previous version number")
    new_version: int = Field(..., description="Current version number")
    is_new: bool = Field(..., description="Whether this is a new entity")
    is_deleted: bool = Field(..., description="Whether entity was deleted")
    change_summary: str = Field(..., description="Human-readable summary of changes")
    changes: list[FieldChangeResponse] = Field(default_factory=list, description="List of field changes")

    model_config = {"json_schema_extra": {"example": {"entity_id": "uio_123", "entity_type": "commitment", "old_version": 1, "new_version": 2, "is_new": False, "is_deleted": False, "change_summary": "Modified: status, due_date", "changes": []}}}


class ChangeRecordResponse(BaseModel):
    """A record of a change to an entity."""

    entity_id: str = Field(..., description="Entity ID")
    entity_type: str = Field(..., description="Entity type")
    change_type: str = Field(..., description="Type of change: created, updated, deleted")
    version: int = Field(..., description="Version number after change")
    timestamp: datetime = Field(..., description="When the change occurred")
    changed_by: str | None = Field(None, description="Who made the change")
    change_reason: str | None = Field(None, description="Reason for the change")
    diff: DiffResponse | None = Field(None, description="Detailed diff")

    model_config = {"json_schema_extra": {"example": {"entity_id": "uio_123", "entity_type": "commitment", "change_type": "updated", "version": 2, "timestamp": "2024-01-15T10:30:00Z", "changed_by": "user_456", "change_reason": "Status update", "diff": None}}}


class ChangesListResponse(BaseModel):
    """Response containing list of changes."""

    changes: list[ChangeRecordResponse] = Field(..., description="List of changes")
    total_count: int = Field(..., description="Total number of changes")
    since: datetime = Field(..., description="Start of time range")
    until: datetime = Field(..., description="End of time range")

    model_config = {"json_schema_extra": {"example": {"changes": [], "total_count": 0, "since": "2024-01-14T00:00:00Z", "until": "2024-01-15T00:00:00Z"}}}


class EntityHistoryResponse(BaseModel):
    """Version history for an entity."""

    entity_id: str = Field(..., description="Entity ID")
    entity_type: str = Field(..., description="Entity type")
    current_version: int = Field(..., description="Current version number")
    history: list[ChangeRecordResponse] = Field(..., description="Change history, newest first")

    model_config = {"json_schema_extra": {"example": {"entity_id": "uio_123", "entity_type": "commitment", "current_version": 3, "history": []}}}


class CompareVersionsRequest(BaseModel):
    """Request to compare two versions."""

    entity_id: str = Field(..., description="Entity ID")
    entity_type: str = Field(..., description="Entity type")
    version1: int = Field(..., description="First version (older)", ge=1)
    version2: int = Field(..., description="Second version (newer)", ge=1)

    model_config = {"json_schema_extra": {"example": {"entity_id": "uio_123", "entity_type": "commitment", "version1": 1, "version2": 3}}}


class ChangedEntitiesResponse(BaseModel):
    """Response containing IDs of changed entities."""

    entity_types: dict[str, list[str]] = Field(
        ..., description="Map of entity_type -> list of entity_ids"
    )
    total_count: int = Field(..., description="Total number of changed entities")
    since: datetime = Field(..., description="Changes since this time")

    model_config = {"json_schema_extra": {"example": {"entity_types": {"commitment": ["uio_123", "uio_456"], "decision": ["uio_789"]}, "total_count": 3, "since": "2024-01-14T00:00:00Z"}}}


class EntityAtTimeRequest(BaseModel):
    """Request to get entity state at a specific time."""

    entity_id: str = Field(..., description="Entity ID")
    entity_type: str = Field(..., description="Entity type")
    at_time: datetime = Field(..., description="Point in time to query")

    model_config = {"json_schema_extra": {"example": {"entity_id": "uio_123", "entity_type": "commitment", "at_time": "2024-01-10T00:00:00Z"}}}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def _diff_to_response(diff: DiffResult) -> DiffResponse:
    """Convert DiffResult to DiffResponse."""
    return DiffResponse(
        entity_id=diff.entity_id,
        entity_type=diff.entity_type,
        old_version=diff.old_version,
        new_version=diff.new_version,
        is_new=diff.is_new,
        is_deleted=diff.is_deleted,
        change_summary=diff.change_summary,
        changes=[
            FieldChangeResponse(
                field_name=c.field_name,
                change_type=c.change_type.value,
                old_value=c.old_value,
                new_value=c.new_value,
            )
            for c in diff.changes
        ],
    )


# =============================================================================
# API ENDPOINTS
# =============================================================================


@router.get(
    "",
    response_model=ChangesListResponse,
    summary="List changes",
    description="""
List all changes within a time range.

**Use Cases:**
- Sync changes to external systems
- Audit trail for compliance
- Debugging data issues
- Building change feeds

**Filters:**
- `since`: Start of time range (default: 24 hours ago)
- `until`: End of time range (default: now)
- `entity_types`: Comma-separated list of types to filter

**Note:** Returns changes newest-first, limited to 100 by default.

Requires `read` scope.
""",
    responses={
        200: {"description": "Changes retrieved"},
    },
)
async def list_changes(
    organization_id: Annotated[str, Query(description="Organization ID")],
    since: Annotated[datetime | None, Query(description="Start of time range")] = None,
    until: Annotated[datetime | None, Query(description="End of time range")] = None,
    entity_types: Annotated[str | None, Query(description="Comma-separated entity types")] = None,
    limit: Annotated[int, Query(description="Maximum results", ge=1, le=500)] = 100,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> ChangesListResponse:
    """List changes within a time range."""
    _validate_org_id(ctx, organization_id)

    # Default time range
    if since is None:
        since = datetime.utcnow() - timedelta(hours=24)
    if until is None:
        until = datetime.utcnow()

    # Parse entity types
    parsed_types = None
    if entity_types:
        parsed_types = [t.strip() for t in entity_types.split(",")]

    tracker = await get_change_tracker()

    try:
        changes = await tracker.get_changes_since(
            organization_id=organization_id,
            since=since,
            entity_types=parsed_types,
            limit=limit,
        )

        return ChangesListResponse(
            changes=[
                ChangeRecordResponse(
                    entity_id=c.entity_id,
                    entity_type=c.entity_type,
                    change_type=c.change_type,
                    version=c.version,
                    timestamp=c.timestamp,
                    changed_by=c.changed_by,
                    change_reason=c.change_reason,
                    diff=_diff_to_response(c.diff) if c.diff else None,
                )
                for c in changes
            ],
            total_count=len(changes),
            since=since,
            until=until,
        )

    except Exception as e:
        logger.error("Failed to list changes", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to list changes: {str(e)}")


@router.get(
    "/entities/{entity_type}/{entity_id}/history",
    response_model=EntityHistoryResponse,
    summary="Get entity history",
    description="""
Get the change history for a specific entity.

Returns all recorded changes to the entity, newest first.

**Use Cases:**
- View audit trail for an entity
- Debug data changes
- Understand evolution over time
- Revert to previous state (manual)

Requires `read` scope.
""",
    responses={
        200: {"description": "History retrieved"},
        404: {"description": "Entity not found"},
    },
)
async def get_entity_history(
    entity_type: Annotated[str, Path(description="Entity type (e.g., 'commitment', 'decision')")],
    entity_id: Annotated[str, Path(description="Entity ID")],
    limit: Annotated[int, Query(description="Maximum versions to return", ge=1, le=100)] = 10,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> EntityHistoryResponse:
    """Get change history for an entity."""
    tracker = await get_change_tracker()

    try:
        history = await tracker.get_entity_history(
            entity_id=entity_id,
            entity_type=entity_type,
            limit=limit,
        )

        if not history:
            raise HTTPException(status_code=404, detail="Entity not found or has no version history")

        current_version = history[0].version if history else 0

        return EntityHistoryResponse(
            entity_id=entity_id,
            entity_type=entity_type,
            current_version=current_version,
            history=[
                ChangeRecordResponse(
                    entity_id=c.entity_id,
                    entity_type=c.entity_type,
                    change_type=c.change_type,
                    version=c.version,
                    timestamp=c.timestamp,
                    changed_by=c.changed_by,
                    change_reason=c.change_reason,
                    diff=_diff_to_response(c.diff) if c.diff else None,
                )
                for c in history
            ],
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get entity history", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get entity history: {str(e)}")


@router.post(
    "/compare",
    response_model=DiffResponse,
    summary="Compare two versions",
    description="""
Compare two specific versions of an entity.

Returns a detailed diff showing:
- Fields that were added
- Fields that were removed
- Fields that were modified (with old and new values)

**Use Cases:**
- Understand what changed between versions
- Review changes before approval
- Debug data inconsistencies

Requires `read` scope.
""",
    responses={
        200: {"description": "Diff computed"},
        404: {"description": "One or both versions not found"},
    },
)
async def compare_versions(
    request: CompareVersionsRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> DiffResponse:
    """Compare two versions of an entity."""
    tracker = await get_change_tracker()

    try:
        diff = await tracker.compare_versions(
            entity_id=request.entity_id,
            entity_type=request.entity_type,
            version1=request.version1,
            version2=request.version2,
        )

        if not diff:
            raise HTTPException(
                status_code=404,
                detail=f"Could not find versions {request.version1} and/or {request.version2}",
            )

        return _diff_to_response(diff)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to compare versions", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to compare versions: {str(e)}")


@router.get(
    "/changed-entities",
    response_model=ChangedEntitiesResponse,
    summary="Get changed entity IDs",
    description="""
Get IDs of all entities that changed since a specific time.

Returns a map of entity_type -> list of entity_ids.

**Use Cases:**
- Incremental sync (only fetch changed entities)
- Cache invalidation
- Notification targeting
- Batch processing

This is more efficient than listing full changes when you only
need to know WHAT changed, not HOW it changed.

Requires `read` scope.
""",
    responses={
        200: {"description": "Changed entities retrieved"},
    },
)
async def get_changed_entities(
    organization_id: Annotated[str, Query(description="Organization ID")],
    since: Annotated[datetime, Query(description="Changes since this time")],
    entity_types: Annotated[str | None, Query(description="Comma-separated entity types")] = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> ChangedEntitiesResponse:
    """Get IDs of changed entities."""
    _validate_org_id(ctx, organization_id)

    parsed_types = None
    if entity_types:
        parsed_types = [t.strip() for t in entity_types.split(",")]

    tracker = await get_change_tracker()

    try:
        changed = await tracker.get_changed_entities(
            organization_id=organization_id,
            since=since,
            entity_types=parsed_types,
        )

        total = sum(len(ids) for ids in changed.values())

        return ChangedEntitiesResponse(
            entity_types=changed,
            total_count=total,
            since=since,
        )

    except Exception as e:
        logger.error("Failed to get changed entities", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get changed entities: {str(e)}")


@router.post(
    "/at-time",
    response_model=dict[str, Any],
    summary="Get entity state at time",
    description="""
Get the state of an entity as it was at a specific point in time.

**Use Cases:**
- Historical reporting
- Audit queries ("What did we know on date X?")
- Debugging past decisions
- Compliance investigations

Returns the full entity data as it existed at the specified time.

Requires `read` scope.
""",
    responses={
        200: {"description": "Entity state retrieved"},
        404: {"description": "Entity did not exist at that time"},
    },
)
async def get_entity_at_time(
    request: EntityAtTimeRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> dict[str, Any]:
    """Get entity state at a specific time."""
    tracker = await get_change_tracker()

    try:
        data = await tracker.get_entity_at_time(
            entity_id=request.entity_id,
            entity_type=request.entity_type,
            at_time=request.at_time,
        )

        if not data:
            raise HTTPException(
                status_code=404,
                detail=f"Entity {request.entity_id} did not exist at {request.at_time.isoformat()}",
            )

        return {
            "entity_id": request.entity_id,
            "entity_type": request.entity_type,
            "at_time": request.at_time.isoformat(),
            "data": data,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to get entity at time", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to get entity at time: {str(e)}")
