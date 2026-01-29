"""
UIO API Routes

CRUD and lifecycle management for Universal Intelligence Objects.
Provides endpoints for:
- Listing and filtering UIOs
- Getting UIO details
- Status changes (with validation)
- User corrections
- UIO merging
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.orchestrator.state import UIOStatus
from src.uio.manager import get_uio_manager

router = APIRouter(prefix="/uios", tags=["uios"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    """Validate organization_id matches auth context."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


# =============================================================================
# Request/Response Models
# =============================================================================


class UIOListResponse(BaseModel):
    """Response for listing UIOs."""

    items: list[dict]
    total: int
    limit: int
    offset: int


class StatusChangeRequest(BaseModel):
    """Request to change UIO status."""

    status: Literal["draft", "active", "in_progress", "completed", "cancelled", "archived"]
    user_id: str | None = None


class CorrectionRequest(BaseModel):
    """Request to apply user corrections."""

    corrections: dict = Field(
        ...,
        description="Dict of field names to corrected values",
        examples=[{"title": "Corrected title", "due_date": "2024-02-01"}],
    )
    user_id: str


class MergeRequest(BaseModel):
    """Request to merge UIOs."""

    target_uio_id: str = Field(..., description="UIO to merge into")
    strategy: Literal["newest_wins", "highest_confidence", "manual"] = "newest_wins"
    manual_resolution: dict | None = Field(
        None,
        description="Field values for manual strategy",
    )


class CreateUIORequest(BaseModel):
    """Request to create a UIO manually."""

    type: Literal["commitment", "decision", "task", "claim", "risk"]
    data: dict = Field(..., description="UIO-specific data")
    source_type: str = "manual"
    source_id: str | None = None


# =============================================================================
# List/Query Endpoints
# =============================================================================


@router.get("", response_model=UIOListResponse)
async def list_uios(
    organization_id: str,
    type: Literal["commitment", "decision", "task", "claim", "risk"] | None = None,
    status: Literal["draft", "active", "in_progress", "completed", "cancelled", "archived"] | None = None,
    needs_review: bool | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    List UIOs with filtering.

    Args:
        organization_id: Organization ID (required)
        type: Filter by UIO type
        status: Filter by status
        needs_review: Filter by review status
        limit: Maximum results (default 50)
        offset: Pagination offset

    Returns:
        List of UIOs matching filters

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio_status = UIOStatus(status) if status else None

    uios = await manager.list_uios(
        uio_type=type,
        status=uio_status,
        needs_review=needs_review,
        limit=limit,
        offset=offset,
    )

    return UIOListResponse(
        items=uios,
        total=len(uios),  # Would need count query for accurate total
        limit=limit,
        offset=offset,
    )


@router.get("/pending-review")
async def get_pending_review(
    organization_id: str,
    limit: int = Query(50, ge=1, le=200),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get UIOs pending review.

    Returns UIOs in DRAFT status that need human review.

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)
    uios = await manager.get_pending_review(limit=limit)

    return {
        "items": uios,
        "count": len(uios),
    }


# =============================================================================
# Single UIO Endpoints
# =============================================================================


@router.get("/{uio_id}")
async def get_uio(
    uio_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get a single UIO by ID.

    Args:
        uio_id: UIO ID
        organization_id: Organization ID

    Returns:
        UIO data or 404

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)
    uio = await manager.get_uio(uio_id)

    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    return uio


@router.post("")
async def create_uio(
    organization_id: str,
    request: CreateUIORequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Create a UIO manually.

    UIOs are typically created automatically during analysis,
    but this endpoint allows manual creation.

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio_id = await manager.create_uio(
        uio_type=request.type,
        data=request.data,
        source_type=request.source_type,
        source_id=request.source_id,
    )

    return {
        "id": uio_id,
        "type": request.type,
        "status": "draft",
        "message": "UIO created successfully",
    }


@router.patch("/{uio_id}")
async def update_uio(
    uio_id: str,
    organization_id: str,
    updates: dict,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Update UIO fields.

    For status changes, use PATCH /{uio_id}/status instead.
    For user corrections, use PATCH /{uio_id}/correct instead.

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    # This would directly update fields - simplified implementation
    manager = await get_uio_manager(organization_id)

    # Get current UIO to verify it exists
    uio = await manager.get_uio(uio_id)
    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    # Don't allow status changes via this endpoint
    if "status" in updates:
        raise HTTPException(
            status_code=400,
            detail="Use PATCH /{uio_id}/status for status changes",
        )

    # Apply correction (which handles the update)
    success = await manager.apply_correction(
        uio_id=uio_id,
        corrections=updates,
        user_id="api_update",  # Would come from auth
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to update UIO")

    return {
        "id": uio_id,
        "updated": True,
        "fields": list(updates.keys()),
    }


@router.delete("/{uio_id}")
async def delete_uio(
    uio_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Soft delete a UIO (archive it).

    UIOs are never hard deleted - they are archived instead.

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio = await manager.get_uio(uio_id)
    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    success = await manager.update_status(
        uio_id=uio_id,
        new_status=UIOStatus.ARCHIVED,
    )

    if not success:
        raise HTTPException(status_code=400, detail="Cannot archive UIO in current state")

    return {
        "id": uio_id,
        "status": "archived",
        "message": "UIO archived successfully",
    }


# =============================================================================
# Status Management
# =============================================================================


@router.patch("/{uio_id}/status")
async def update_status(
    uio_id: str,
    organization_id: str,
    request: StatusChangeRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Change UIO status.

    Valid transitions:
    - draft → active, cancelled
    - active → in_progress, completed, cancelled
    - in_progress → completed, cancelled, active
    - completed → archived
    - cancelled → archived

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio = await manager.get_uio(uio_id)
    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    new_status = UIOStatus(request.status)
    success = await manager.update_status(
        uio_id=uio_id,
        new_status=new_status,
        user_id=request.user_id,
    )

    if not success:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status transition from {uio.get('status')} to {request.status}",
        )

    return {
        "id": uio_id,
        "previous_status": uio.get("status"),
        "new_status": request.status,
        "message": "Status updated successfully",
    }


# =============================================================================
# User Corrections
# =============================================================================


@router.patch("/{uio_id}/correct")
async def apply_correction(
    uio_id: str,
    organization_id: str,
    request: CorrectionRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Apply user corrections to a UIO.

    Stores the original extraction for training data and
    marks the UIO as user-corrected.

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio = await manager.get_uio(uio_id)
    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    success = await manager.apply_correction(
        uio_id=uio_id,
        corrections=request.corrections,
        user_id=request.user_id,
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to apply correction")

    return {
        "id": uio_id,
        "corrected": True,
        "corrected_fields": list(request.corrections.keys()),
        "corrected_by": request.user_id,
        "message": "Correction applied successfully",
    }


# =============================================================================
# Merge
# =============================================================================


@router.post("/{uio_id}/merge/{target_uio_id}")
async def merge_uios(
    uio_id: str,
    target_uio_id: str,
    organization_id: str,
    request: MergeRequest | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Merge two UIOs.

    The source UIO (uio_id) will be archived and linked
    to the target UIO via MERGED_INTO relationship.

    Args:
        uio_id: Source UIO (will be archived)
        target_uio_id: Target UIO (will be updated)

    Requires `write` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    # Verify both UIOs exist
    source = await manager.get_uio(uio_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source UIO not found")

    target = await manager.get_uio(target_uio_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target UIO not found")

    strategy = request.strategy if request else "newest_wins"
    manual_resolution = request.manual_resolution if request else None

    success = await manager.merge_uios(
        source_uio_id=uio_id,
        target_uio_id=target_uio_id,
        merge_strategy=strategy,
        manual_resolution=manual_resolution,
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to merge UIOs")

    return {
        "source_uio_id": uio_id,
        "target_uio_id": target_uio_id,
        "merged": True,
        "strategy": strategy,
        "message": "UIOs merged successfully",
    }


# =============================================================================
# History and Related
# =============================================================================


@router.get("/{uio_id}/history")
async def get_uio_history(
    uio_id: str,
    organization_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get status change history for a UIO.

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio = await manager.get_uio(uio_id)
    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    history = await manager.get_uio_history(uio_id)

    return {
        "uio_id": uio_id,
        "history": history,
    }


@router.get("/{uio_id}/related")
async def get_related_uios(
    uio_id: str,
    organization_id: str,
    depth: int = Query(1, ge=1, le=3),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get UIOs related to this one in the graph.

    Follows relationships up to the specified depth.

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    manager = await get_uio_manager(organization_id)

    uio = await manager.get_uio(uio_id)
    if not uio:
        raise HTTPException(status_code=404, detail="UIO not found")

    related = await manager.get_related_uios(uio_id, depth=depth)

    return {
        "uio_id": uio_id,
        "related": related,
        "count": len(related),
    }
