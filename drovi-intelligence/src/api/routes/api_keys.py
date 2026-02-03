"""
API Key Management Routes.

Provides endpoints for:
- Creating API keys
- Listing API keys for an organization
- Revoking API keys
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.auth.middleware import (
    APIKeyContext,
    get_api_key_context,
    require_scope,
)
from src.auth.api_key import (
    create_api_key,
    list_api_keys,
    revoke_api_key,
)
from src.auth.scopes import Scope, get_default_scopes, get_all_scopes
from src.audit.log import record_audit_event


router = APIRouter(prefix="/api-keys", tags=["API Keys"])


# =============================================================================
# Request/Response Models
# =============================================================================


class CreateAPIKeyRequest(BaseModel):
    """Request to create an API key."""

    name: str = Field(..., min_length=1, max_length=255, description="Name for the API key")
    scopes: list[str] | None = Field(
        None,
        description="Scopes for the key. Defaults to read, write, mcp.",
    )
    expires_at: datetime | None = Field(
        None,
        description="Optional expiration timestamp",
    )
    rate_limit_per_minute: int = Field(
        100,
        ge=1,
        le=10000,
        description="Rate limit per minute",
    )
    is_test: bool = Field(
        False,
        description="Create a test key (sk_test_ prefix)",
    )


class CreateAPIKeyResponse(BaseModel):
    """Response with the created API key."""

    id: str
    key: str = Field(..., description="Full API key - only shown once!")
    key_prefix: str = Field(..., description="Key prefix for identification")
    name: str
    scopes: list[str]
    rate_limit_per_minute: int
    expires_at: datetime | None
    created_at: datetime


class APIKeyInfo(BaseModel):
    """API key information (without the actual key)."""

    id: str
    key_prefix: str
    name: str
    scopes: list[str]
    rate_limit_per_minute: int
    created_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None
    last_used_at: datetime | None


class APIKeyListResponse(BaseModel):
    """Response for listing API keys."""

    items: list[APIKeyInfo]
    total: int


class RevokeAPIKeyRequest(BaseModel):
    """Request to revoke an API key."""

    pass  # No body needed, key_id from path


class ScopesResponse(BaseModel):
    """Available scopes information."""

    available_scopes: list[str]
    default_scopes: list[str]


# =============================================================================
# Endpoints
# =============================================================================


@router.post("", response_model=CreateAPIKeyResponse)
async def create_key(
    request: CreateAPIKeyRequest,
    ctx: APIKeyContext = Depends(require_scope(Scope.MANAGE_KEYS)),
):
    """
    Create a new API key.

    Requires the `manage:keys` scope.

    **Important:** The full API key is only returned once in this response.
    Store it securely - it cannot be retrieved later.
    """
    scopes = request.scopes or get_default_scopes()

    # Validate requested scopes
    all_scopes = get_all_scopes()
    for scope in scopes:
        if scope not in all_scopes:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid scope: {scope}. Available scopes: {all_scopes}",
            )

    # Non-admin users cannot grant admin or higher scopes
    if not ctx.has_scope(Scope.ADMIN):
        restricted = {"admin", "internal", "manage:keys"}
        requested_restricted = set(scopes) & restricted
        if requested_restricted:
            raise HTTPException(
                status_code=403,
                detail=f"Cannot grant restricted scopes: {requested_restricted}",
            )

    full_key, key_id = await create_api_key(
        organization_id=ctx.organization_id,
        name=request.name,
        scopes=scopes,
        rate_limit_per_minute=request.rate_limit_per_minute,
        expires_at=request.expires_at,
        is_test=request.is_test,
    )

    await record_audit_event(
        organization_id=ctx.organization_id,
        action="api_key_created",
        actor_type="api_key",
        actor_id=ctx.key_id,
        resource_type="api_key",
        resource_id=str(key_id),
    )

    return CreateAPIKeyResponse(
        id=str(key_id),
        key=full_key,
        key_prefix=full_key[:8],
        name=request.name,
        scopes=scopes,
        rate_limit_per_minute=request.rate_limit_per_minute,
        expires_at=request.expires_at,
        created_at=datetime.utcnow(),
    )


@router.get("", response_model=APIKeyListResponse)
async def list_keys(
    ctx: APIKeyContext = Depends(require_scope(Scope.MANAGE_KEYS)),
):
    """
    List all API keys for the organization.

    Requires the `manage:keys` scope.

    Note: The actual key values are never returned, only prefixes.
    """
    keys = await list_api_keys(ctx.organization_id)

    items = [
        APIKeyInfo(
            id=str(k["id"]),
            key_prefix=k["key_prefix"],
            name=k["name"],
            scopes=k["scopes"],
            rate_limit_per_minute=k["rate_limit_per_minute"],
            created_at=k["created_at"],
            expires_at=k.get("expires_at"),
            revoked_at=k.get("revoked_at"),
            last_used_at=k.get("last_used_at"),
        )
        for k in keys
    ]

    return APIKeyListResponse(items=items, total=len(items))


@router.delete("/{key_id}")
async def revoke_key(
    key_id: str,
    ctx: APIKeyContext = Depends(require_scope(Scope.MANAGE_KEYS)),
):
    """
    Revoke an API key.

    Requires the `manage:keys` scope.

    Revoked keys cannot be used for authentication.
    """
    success = await revoke_api_key(key_id, ctx.organization_id)

    if not success:
        raise HTTPException(
            status_code=404,
            detail="API key not found or already revoked",
        )

    return {"status": "revoked", "key_id": key_id}


@router.get("/scopes", response_model=ScopesResponse)
async def get_scopes(
    ctx: APIKeyContext = Depends(get_api_key_context),
):
    """
    Get available and default scopes.

    Returns the list of all available scopes and the default scopes
    assigned to new API keys.
    """
    return ScopesResponse(
        available_scopes=get_all_scopes(),
        default_scopes=get_default_scopes(),
    )


@router.get("/me")
async def get_current_key_info(
    ctx: APIKeyContext = Depends(get_api_key_context),
):
    """
    Get information about the current API key.

    Returns the organization ID, scopes, and other metadata
    for the key used to authenticate this request.
    """
    return {
        "organization_id": ctx.organization_id,
        "scopes": ctx.scopes,
        "key_id": ctx.key_id,
        "key_name": ctx.key_name,
        "is_internal": ctx.is_internal,
        "rate_limit_per_minute": ctx.rate_limit_per_minute,
    }
