"""
FastAPI Authentication Middleware for Drovi Intelligence API.

Provides multiple authentication methods:
1. Session cookies (for Pilot Surface frontend)
2. Internal service token (for internal services)
3. API keys (for external integrations)

Authentication priority:
1. Session cookie (if present and valid)
2. Internal service token (if present and valid)
3. API key (required if no other auth method works)

IMPORTANT: Use `get_auth_context()` for new code. The `get_api_key_context()`
is kept for backward compatibility but should not be used in new code.
"""

import os
from datetime import datetime
from functools import wraps
from typing import Callable

import structlog
from fastapi import Cookie, Depends, HTTPException, Request, Header
from fastapi.security import APIKeyHeader

from src.auth.api_key import validate_api_key, APIKeyInfo
from src.auth.admin_accounts import verify_admin_jwt, validate_admin_email
from src.auth.context import AuthContext, AuthMetadata, AuthType, get_scopes_for_role
from src.auth.pilot_accounts import verify_jwt
from src.auth.scopes import has_scope, Scope
from src.auth.rate_limit import check_rate_limit, RateLimitResult
from src.db.rls import set_rls_context

logger = structlog.get_logger()

# Default rate limit for when Redis is unavailable
DEFAULT_RATE_LIMIT = 100

# Headers
API_KEY_HEADER = "X-API-Key"
INTERNAL_SERVICE_HEADER = "X-Internal-Service-Token"
ADMIN_SESSION_COOKIE = "admin_session"

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


async def _resolve_membership_role(user_id: str, org_id: str) -> str | None:
    """
    Resolve the *current* membership role from the database.

    We do not rely on the JWT role claim because:
    - role changes must take effect immediately (no re-login),
    - removed users must not keep access via a stale token.
    """
    try:
        from sqlalchemy import text
        from src.db.client import get_db_session

        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT role
                    FROM memberships
                    WHERE user_id = :user_id AND org_id = :org_id
                    """
                ),
                {"user_id": user_id, "org_id": org_id},
            )
            row = result.fetchone()
            if not row:
                return None
            role = getattr(row, "role", None)
            return str(role) if role else None
    except Exception as exc:
        logger.warning("Failed to resolve membership role", error=str(exc))
        return None


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
    session: str | None = Cookie(default=None),
    authorization: str | None = Header(default=None),
) -> APIKeyContext:
    """
    FastAPI dependency for API key authentication.

    Supports multiple auth methods (in priority order):
    1. Session cookies (Pilot Surface frontend)
    2. Internal service token (internal services)
    3. API keys (external integrations)

    Args:
        request: The FastAPI request
        api_key: API key from X-API-Key header
        session: Session cookie from Pilot Surface

    Returns:
        APIKeyContext with organization and scope information

    Raises:
        HTTPException: If authentication fails
    """
    # Internal service token (Drovi app bypass)
    internal_token = request.headers.get(INTERNAL_SERVICE_HEADER)

    # 0. Admin session (admin.drovi.co)
    #
    # Admin auth is separate from pilot sessions and uses a distinct secret.
    is_admin_client = request.headers.get("X-Drovi-Client") == "admin"
    path_is_admin = request.url.path.startswith("/api/v1/admin")
    admin_cookie_token = request.cookies.get(ADMIN_SESSION_COOKIE)
    if admin_cookie_token and (is_admin_client or path_is_admin):
        admin_token = verify_admin_jwt(admin_cookie_token)
        if admin_token and validate_admin_email(admin_token.email):
            set_rls_context("internal", is_internal=True)
            return APIKeyContext(
                organization_id="internal",
                scopes=[Scope.ADMIN.value, Scope.INTERNAL.value],
                key_id=f"admin:{admin_token.email}",
                key_name=f"Admin: {admin_token.email}",
                is_internal=True,
                rate_limit_per_minute=10000,
            )
        # Invalid admin cookie. If no alternative auth method is present, fail
        # with a session-style 401 (instead of falling through to "Missing API key").
        if not internal_token and not api_key and not (session or authorization):
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired admin session",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # 1. Check for session cookie or Authorization bearer (Pilot Surface frontend)
    #
    # NOTE: In normal FastAPI operation, `session` and `authorization` will be
    # either `str` or `None`. When unit-testing this dependency by calling it
    # directly, the default values may be the `Cookie(...)` / `Header(...)`
    # parameter objects; treat non-strings as missing.
    #
    # When the admin client sends an Authorization header, prefer it over the
    # session cookie. On localhost the web-app session cookie leaks across
    # ports and would otherwise shadow the admin Bearer token.
    token_str = session if isinstance(session, str) else None
    auth_header = authorization if isinstance(authorization, str) else None

    # Admin clients must never authenticate via the pilot session cookie.
    # On localhost, the pilot cookie leaks across ports and would otherwise
    # trick the admin app into thinking it is logged in.
    if is_admin_client and not (auth_header and auth_header.startswith("Bearer ")):
        token_str = None
    if auth_header and auth_header.startswith("Bearer "):
        if is_admin_client or not token_str:
            token_str = auth_header[7:]

    if token_str:
        token = verify_jwt(token_str)
        if token:
            current_role = await _resolve_membership_role(token.sub, token.org_id)
            if not current_role:
                raise HTTPException(
                    status_code=401,
                    detail="Invalid or expired session",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            scopes = get_scopes_for_role(current_role)
            logger.debug(
                "Session authentication",
                user_id=token.sub,
                org_id=token.org_id,
                path=request.url.path,
            )
            set_rls_context(token.org_id, is_internal=False)
            return APIKeyContext(
                organization_id=token.org_id,
                scopes=scopes,
                key_id=f"session:{token.sub}",
                key_name=f"Session: {token.email}",
                is_internal=False,
                rate_limit_per_minute=1000,
            )
        # If the Bearer token is not a pilot JWT, it may be an admin session JWT.
        # Try admin verification before failing with a session-style 401.
        admin_token = verify_admin_jwt(token_str)
        if admin_token and validate_admin_email(admin_token.email):
            set_rls_context("internal", is_internal=True)
            return APIKeyContext(
                organization_id="internal",
                scopes=[Scope.ADMIN.value, Scope.INTERNAL.value],
                key_id=f"admin:{admin_token.email}",
                key_name=f"Admin: {admin_token.email}",
                is_internal=True,
                rate_limit_per_minute=10000,
            )
        # Invalid session token. If no alternative auth method is present, fail
        # with a session-style 401 (instead of falling through to "Missing API key").
        if not internal_token and not api_key:
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired session",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # 2. Check for internal service token (Drovi app bypass)
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

            set_rls_context(org_id, is_internal=True)
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

    set_rls_context(key_info.organization_id, is_internal=False)
    return APIKeyContext(
        organization_id=key_info.organization_id,
        scopes=key_info.scopes,
        key_id=key_info.id,
        key_name=key_info.name,
        is_internal=False,
        rate_limit_per_minute=key_info.rate_limit_per_minute,
    )


# =============================================================================
# UNIFIED AUTH CONTEXT (Recommended for new code)
# =============================================================================


async def get_auth_context(
    request: Request,
    api_key: str | None = Depends(api_key_header),
    session: str | None = Cookie(default=None),
    authorization: str | None = Header(default=None),
) -> AuthContext:
    """
    Unified authentication middleware - returns AuthContext for all auth types.

    This is the RECOMMENDED auth dependency for new code. It provides:
    - Role-based scopes for session users (not wildcard ["*"])
    - Immutable organization_id from JWT/API key (not from request body)
    - Comprehensive audit metadata
    - Consistent rate limiting

    Priority:
    1. Session cookie (Pilot Surface frontend)
    2. Internal service token (with X-Organization-ID header)
    3. API key (external integrations)

    Args:
        request: The FastAPI request
        api_key: API key from X-API-Key header
        session: Session cookie from Pilot Surface

    Returns:
        AuthContext with organization, scopes, and audit metadata

    Raises:
        HTTPException: If authentication fails
    """
    # 0. Admin session (admin.drovi.co)
    is_admin_client = request.headers.get("X-Drovi-Client") == "admin"
    path_is_admin = request.url.path.startswith("/api/v1/admin")
    admin_cookie_token = request.cookies.get(ADMIN_SESSION_COOKIE)
    auth_header: str | None = authorization
    if admin_cookie_token and (is_admin_client or path_is_admin):
        admin_token = verify_admin_jwt(admin_cookie_token)
        if admin_token and validate_admin_email(admin_token.email):
            set_rls_context("internal", is_internal=True)
            return AuthContext(
                organization_id="internal",
                auth_subject_id=f"admin_{admin_token.email}",
                scopes=[Scope.ADMIN.value, Scope.INTERNAL.value],
                metadata=AuthMetadata(
                    auth_type=AuthType.INTERNAL_SERVICE,
                    user_email=admin_token.email,
                    user_id=admin_token.sub,
                    service_name="Drovi Admin Session",
                ),
                rate_limit_per_minute=10000,
                is_internal=True,
            )
        if not api_key and not session and not auth_header and not request.headers.get(INTERNAL_SERVICE_HEADER):
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired admin session",
                headers={"WWW-Authenticate": "Bearer"},
            )

    # 1. Check for session cookie / Authorization bearer first (Pilot Surface frontend)
    #
    # When the admin client sends an Authorization header, prefer it over the
    # session cookie. On localhost the web-app session cookie leaks across
    # ports and would otherwise shadow the admin Bearer token.
    token_str: str | None = session
    # Admin clients must never authenticate via the pilot session cookie.
    if is_admin_client and not (authorization and authorization.startswith("Bearer ")):
        token_str = None
    if authorization and authorization.startswith("Bearer "):
        if is_admin_client or not token_str:
            token_str = authorization[7:]

    if token_str:
        token = verify_jwt(token_str)
        if token:
            # Get role-based scopes (not wildcard ["*"]), using DB role so changes
            # take effect immediately.
            current_role = await _resolve_membership_role(token.sub, token.org_id)
            if not current_role:
                raise HTTPException(
                    status_code=401,
                    detail="Invalid or expired session",
                    headers={"WWW-Authenticate": "Bearer"},
                )
            scopes = get_scopes_for_role(current_role)

            logger.debug(
                "session_authentication_success",
                user_id=token.sub,
                org_id=token.org_id,
                role=current_role,
                scopes=scopes,
                path=request.url.path,
            )

            set_rls_context(token.org_id, is_internal=False)
            return AuthContext(
                organization_id=token.org_id,
                auth_subject_id=f"user_{token.sub}",
                scopes=scopes,
                metadata=AuthMetadata(
                    auth_type=AuthType.SESSION,
                    user_email=token.email,
                    user_id=token.sub,
                ),
                rate_limit_per_minute=1000,
                is_internal=False,  # Session users are not internal
            )

    # Also allow admin tokens via Authorization header.
    if authorization and authorization.startswith("Bearer "):
        admin_token = verify_admin_jwt(authorization[7:])
        if admin_token and validate_admin_email(admin_token.email):
            set_rls_context("internal", is_internal=True)
            return AuthContext(
                organization_id="internal",
                auth_subject_id=f"admin_{admin_token.email}",
                scopes=[Scope.ADMIN.value, Scope.INTERNAL.value],
                metadata=AuthMetadata(
                    auth_type=AuthType.INTERNAL_SERVICE,
                    user_email=admin_token.email,
                    user_id=admin_token.sub,
                    service_name="Drovi Admin Session",
                ),
                rate_limit_per_minute=10000,
                is_internal=True,
            )

    # 2. Check for internal service token (Drovi app)
    internal_token = request.headers.get(INTERNAL_SERVICE_HEADER)

    if internal_token and INTERNAL_SERVICE_TOKEN:
        if internal_token == INTERNAL_SERVICE_TOKEN:
            # SECURITY: org_id MUST come from X-Organization-ID header, NOT request body
            org_id = request.headers.get("X-Organization-ID")

            if not org_id:
                # Fall back to query params for backward compatibility
                org_id = request.query_params.get("organization_id")

            if not org_id:
                logger.warning(
                    "internal_service_missing_org_header",
                    path=request.url.path,
                )
                raise HTTPException(
                    status_code=400,
                    detail="X-Organization-ID header required for internal service auth",
                )

            logger.debug(
                "internal_service_authentication_success",
                organization_id=org_id,
                path=request.url.path,
            )

            set_rls_context(org_id, is_internal=True)
            return AuthContext(
                organization_id=org_id,
                auth_subject_id="service_internal",
                scopes=[Scope.ADMIN.value, Scope.INTERNAL.value],
                metadata=AuthMetadata(
                    auth_type=AuthType.INTERNAL_SERVICE,
                    service_name="Drovi Internal Service",
                ),
                rate_limit_per_minute=10000,
                is_internal=True,
            )
        else:
            logger.warning(
                "invalid_internal_service_token",
                path=request.url.path,
            )
            raise HTTPException(
                status_code=401,
                detail="Invalid internal service token",
            )

    # 3. External API key validation
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="Missing authentication. Use session cookie or X-API-Key header.",
            headers={"WWW-Authenticate": "ApiKey"},
        )

    # Validate the API key
    key_info = await validate_api_key(api_key)

    if not key_info:
        logger.warning(
            "invalid_api_key",
            key_prefix=api_key[:8] if len(api_key) > 8 else "***",
        )
        raise HTTPException(
            status_code=401,
            detail="Invalid API key",
        )

    # Check if revoked
    if key_info.revoked_at:
        logger.warning(
            "revoked_api_key_used",
            key_id=key_info.id,
        )
        raise HTTPException(
            status_code=401,
            detail="API key has been revoked",
        )

    # Check if expired
    if key_info.expires_at and key_info.expires_at < datetime.utcnow():
        logger.warning(
            "expired_api_key_used",
            key_id=key_info.id,
            expired_at=key_info.expires_at.isoformat(),
        )
        raise HTTPException(
            status_code=401,
            detail="API key has expired",
        )

    logger.debug(
        "api_key_authentication_success",
        key_id=key_info.id,
        organization_id=key_info.organization_id,
        scopes=key_info.scopes,
    )

    set_rls_context(key_info.organization_id, is_internal=False)
    return AuthContext(
        organization_id=key_info.organization_id,
        auth_subject_id=f"key_{key_info.id}",
        scopes=key_info.scopes,
        metadata=AuthMetadata(
            auth_type=AuthType.API_KEY,
            key_id=key_info.id,
            key_name=key_info.name,
        ),
        rate_limit_per_minute=key_info.rate_limit_per_minute,
        is_internal=False,
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
