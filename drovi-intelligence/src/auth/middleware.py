"""
FastAPI Authentication Middleware for Drovi Intelligence API.

Provides API key authentication with internal service bypass for the Drovi app.

Internal Service Authentication:
- The Drovi TypeScript app communicates with this backend using an internal service token
- This bypasses external API key requirements for internal app requests
- Set DROVI_INTERNAL_SERVICE_TOKEN environment variable to enable
"""

import os
from datetime import datetime
from functools import wraps
from typing import Callable

import structlog
from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyHeader

from src.auth.api_key import validate_api_key, APIKeyInfo
from src.auth.scopes import has_scope, Scope
from src.auth.rate_limit import check_rate_limit, RateLimitResult

logger = structlog.get_logger()

# Default rate limit for when Redis is unavailable
DEFAULT_RATE_LIMIT = 100

# Headers
API_KEY_HEADER = "X-API-Key"
INTERNAL_SERVICE_HEADER = "X-Internal-Service-Token"

# Internal service token (shared secret with Drovi TypeScript app)
# Try os.getenv first, then fall back to hardcoded dev token for local development
INTERNAL_SERVICE_TOKEN = os.getenv("DROVI_INTERNAL_SERVICE_TOKEN") or "dev-test-token-drovi-2024"

# Security scheme for OpenAPI docs
api_key_header = APIKeyHeader(name=API_KEY_HEADER, auto_error=False)


class APIKeyContext:
    """
    Context for an authenticated request.

    Contains organization ID, scopes, and metadata about the API key.
    """

    def __init__(
        self,
        organization_id: str,
        scopes: list[str],
        key_id: str | None = None,
        key_name: str | None = None,
        is_internal: bool = False,
        rate_limit_per_minute: int = 100,
    ):
        self.organization_id = organization_id
        self.scopes = scopes
        self.key_id = key_id
        self.key_name = key_name
        self.is_internal = is_internal
        self.rate_limit_per_minute = rate_limit_per_minute

    def has_scope(self, scope: str | Scope) -> bool:
        """Check if this context has the required scope."""
        scope_str = scope.value if isinstance(scope, Scope) else scope
        return has_scope(self.scopes, scope_str)


async def _extract_org_id_from_request(request: Request) -> str | None:
    """
    Extract organization_id from request body or query params.

    For internal service requests, we need to get the org_id from the request
    since there's no API key to look it up from.
    """
    # Try query params first
    org_id = request.query_params.get("organization_id")
    if org_id:
        return org_id

    # Try to get from body (if JSON)
    try:
        # Cache the body so it can be read again later
        body = await request.body()
        if body:
            import json
            data = json.loads(body)
            if isinstance(data, dict):
                return data.get("organization_id") or data.get("organizationId")
    except Exception:
        pass

    return None


async def get_api_key_context(
    request: Request,
    api_key: str | None = Depends(api_key_header),
) -> APIKeyContext:
    """
    FastAPI dependency for API key authentication.

    Validates the API key or internal service token and returns context.

    The Drovi app uses an internal service token that bypasses external API key auth.
    This allows the internal app to access all endpoints without needing API keys.

    Args:
        request: The FastAPI request
        api_key: API key from X-API-Key header

    Returns:
        APIKeyContext with organization and scope information

    Raises:
        HTTPException: If authentication fails
    """
    # Check for internal service token first (Drovi app bypass)
    internal_token = request.headers.get(INTERNAL_SERVICE_HEADER)

    if internal_token and INTERNAL_SERVICE_TOKEN:
        if internal_token == INTERNAL_SERVICE_TOKEN:
            # Internal service - extract org_id from request
            org_id = await _extract_org_id_from_request(request)

            if not org_id:
                # For some endpoints, org_id might not be required
                # Use a placeholder that indicates internal access
                org_id = request.query_params.get("organization_id", "internal")

            logger.debug(
                "Internal service authentication",
                organization_id=org_id,
                path=request.url.path,
            )

            return APIKeyContext(
                organization_id=org_id,
                scopes=["*"],  # Full access for internal app
                key_id="internal",
                key_name="Drovi Internal Service",
                is_internal=True,
                rate_limit_per_minute=10000,  # High limit for internal
            )
        else:
            logger.warning(
                "Invalid internal service token",
                path=request.url.path,
            )
            raise HTTPException(
                status_code=401,
                detail="Invalid internal service token",
            )

    # External API key validation
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="Missing API key. Include X-API-Key header.",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    # Validate the API key
    key_info = await validate_api_key(api_key)

    if not key_info:
        logger.warning(
            "Invalid API key",
            key_prefix=api_key[:8] if len(api_key) > 8 else "***",
        )
        raise HTTPException(
            status_code=401,
            detail="Invalid API key",
        )

    # Check if revoked
    if key_info.revoked_at:
        logger.warning(
            "Revoked API key used",
            key_id=key_info.id,
        )
        raise HTTPException(
            status_code=401,
            detail="API key has been revoked",
        )

    # Check if expired
    if key_info.expires_at and key_info.expires_at < datetime.utcnow():
        logger.warning(
            "Expired API key used",
            key_id=key_info.id,
            expired_at=key_info.expires_at.isoformat(),
        )
        raise HTTPException(
            status_code=401,
            detail="API key has expired",
        )

    logger.debug(
        "API key authenticated",
        key_id=key_info.id,
        organization_id=key_info.organization_id,
        scopes=key_info.scopes,
    )

    return APIKeyContext(
        organization_id=key_info.organization_id,
        scopes=key_info.scopes,
        key_id=key_info.id,
        key_name=key_info.name,
        is_internal=False,
        rate_limit_per_minute=key_info.rate_limit_per_minute,
    )


def require_scope(scope: str | Scope) -> Callable:
    """
    FastAPI dependency factory for requiring a specific scope.

    Usage:
        @router.get("/admin")
        async def admin_endpoint(
            ctx: APIKeyContext = Depends(require_scope(Scope.ADMIN))
        ):
            ...

    Args:
        scope: Required scope (string or Scope enum)

    Returns:
        FastAPI dependency that checks for the scope
    """
    scope_str = scope.value if isinstance(scope, Scope) else scope

    async def check_scope(
        ctx: APIKeyContext = Depends(get_api_key_context),
    ) -> APIKeyContext:
        if not ctx.has_scope(scope_str):
            logger.warning(
                "Insufficient permissions",
                required_scope=scope_str,
                granted_scopes=ctx.scopes,
                key_id=ctx.key_id,
            )
            raise HTTPException(
                status_code=403,
                detail=f"Insufficient permissions. Required scope: {scope_str}",
            )
        return ctx

    return check_scope


# Optional authentication - returns None if not authenticated
async def get_optional_api_key_context(
    request: Request,
    api_key: str | None = Depends(api_key_header),
) -> APIKeyContext | None:
    """
    Optional API key authentication.

    Returns APIKeyContext if authenticated, None otherwise.
    Does not raise HTTPException for missing/invalid keys.
    """
    try:
        return await get_api_key_context(request, api_key)
    except HTTPException:
        return None


# Public endpoints that don't require authentication
PUBLIC_PATHS = {
    "/",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/health",
    "/health/live",
    "/health/ready",
    "/metrics",
}


def is_public_path(path: str) -> bool:
    """Check if a path is public (no auth required)."""
    return path in PUBLIC_PATHS or path.startswith("/docs") or path.startswith("/redoc")


async def check_rate_limit_for_context(ctx: APIKeyContext) -> RateLimitResult:
    """
    Check rate limit for an API key context.

    Internal services have very high limits (or no limit).
    External API keys use their configured rate_limit_per_minute.

    Args:
        ctx: The API key context

    Returns:
        RateLimitResult with allowed status and remaining tokens
    """
    # Internal services get very high limits
    if ctx.is_internal:
        return RateLimitResult(
            allowed=True,
            remaining=ctx.rate_limit_per_minute or 10000,
            reset_at=0,
            limit=ctx.rate_limit_per_minute or 10000,
        )

    # Check rate limit for external keys
    limit = ctx.rate_limit_per_minute or DEFAULT_RATE_LIMIT
    return await check_rate_limit(ctx.key_id, limit)


def require_rate_limit() -> Callable:
    """
    FastAPI dependency factory that enforces rate limiting.

    Usage:
        @router.get("/resource")
        async def get_resource(
            ctx: APIKeyContext = Depends(require_rate_limit())
        ):
            ...

    This combines authentication with rate limiting. The context
    is first authenticated, then rate limited.

    Returns:
        FastAPI dependency that enforces rate limits
    """
    async def check_limit(
        request: Request,
        ctx: APIKeyContext = Depends(get_api_key_context),
    ) -> APIKeyContext:
        # Check rate limit
        result = await check_rate_limit_for_context(ctx)

        # Set rate limit headers on the response (via request state)
        request.state.rate_limit_limit = result.limit
        request.state.rate_limit_remaining = result.remaining
        request.state.rate_limit_reset = int(result.reset_at)

        if not result.allowed:
            logger.warning(
                "Rate limit exceeded",
                key_id=ctx.key_id,
                limit=result.limit,
            )
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please slow down.",
                headers={
                    "X-RateLimit-Limit": str(result.limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(result.reset_at)),
                    "Retry-After": str(int(result.reset_at - __import__('time').time())),
                },
            )

        return ctx

    return check_limit


def require_scope_with_rate_limit(scope: str | Scope) -> Callable:
    """
    FastAPI dependency factory that requires a scope AND enforces rate limiting.

    Combines scope checking with rate limiting in one dependency.

    Usage:
        @router.post("/admin/action")
        async def admin_action(
            ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN))
        ):
            ...

    Args:
        scope: Required scope (string or Scope enum)

    Returns:
        FastAPI dependency that checks scope and enforces rate limits
    """
    scope_str = scope.value if isinstance(scope, Scope) else scope

    async def check_scope_and_limit(
        request: Request,
        ctx: APIKeyContext = Depends(get_api_key_context),
    ) -> APIKeyContext:
        # Check scope first
        if not ctx.has_scope(scope_str):
            logger.warning(
                "Insufficient permissions",
                required_scope=scope_str,
                granted_scopes=ctx.scopes,
                key_id=ctx.key_id,
            )
            raise HTTPException(
                status_code=403,
                detail=f"Insufficient permissions. Required scope: {scope_str}",
            )

        # Then check rate limit
        result = await check_rate_limit_for_context(ctx)

        # Set rate limit headers on the response (via request state)
        request.state.rate_limit_limit = result.limit
        request.state.rate_limit_remaining = result.remaining
        request.state.rate_limit_reset = int(result.reset_at)

        if not result.allowed:
            logger.warning(
                "Rate limit exceeded",
                key_id=ctx.key_id,
                limit=result.limit,
            )
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please slow down.",
                headers={
                    "X-RateLimit-Limit": str(result.limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(result.reset_at)),
                    "Retry-After": str(int(result.reset_at - __import__('time').time())),
                },
            )

        return ctx

    return check_scope_and_limit
