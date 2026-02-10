"""
FastAPI Authentication Middleware for Drovi Intelligence API.

Provides multiple authentication methods:
1. Session cookies (for Pilot Surface frontend)
2. Internal service JWT (for internal services)
3. API keys (for external integrations)

Authentication priority:
1. Session cookie (if present and valid)
2. Internal service JWT (if present and valid)
3. API key (required if no other auth method works)

IMPORTANT: Prefer `get_auth_context()` for new code. The legacy
`get_api_key_context()` remains for backward compatibility but returns the same
`AuthContext` object (via an alias) so the request handling model is unified.
"""

import os
from datetime import datetime
from typing import Callable

import structlog
from fastapi import Cookie, Depends, HTTPException, Request, Header
from fastapi.security import APIKeyHeader

from src.auth.api_key import validate_api_key
from src.auth.admin_accounts import verify_admin_jwt, validate_admin_email
from src.auth.context import AuthContext, AuthMetadata, AuthType, get_scopes_for_role
from src.auth.internal_service_jwt import verify_internal_jwt
from src.auth.pilot_accounts import verify_jwt
from src.auth.scopes import Scope
from src.auth.rate_limit import check_rate_limit, RateLimitResult
from src.db.rls import set_rls_context
from src.config import get_settings

logger = structlog.get_logger()

# Default rate limit for when Redis is unavailable
DEFAULT_RATE_LIMIT = 100

# Headers
API_KEY_HEADER = "X-API-Key"
INTERNAL_SERVICE_HEADER = "X-Internal-Service-Token"
ADMIN_SESSION_COOKIE = "admin_session"

# Development-only legacy bypass (static shared secret).
#
# This is intentionally disabled unless ENVIRONMENT=development/test.
# Production must use internal service JWTs.
LEGACY_INTERNAL_SERVICE_TOKEN = os.getenv("DROVI_INTERNAL_SERVICE_TOKEN")

# Security scheme for OpenAPI docs
api_key_header = APIKeyHeader(name=API_KEY_HEADER, auto_error=False)


#
# Backward compatibility: many routes still annotate `ctx: APIKeyContext` and
# expect `ctx.key_id` / `ctx.key_name` properties. We alias the legacy name to
# `AuthContext` so there is exactly one request auth model.
#
APIKeyContext = AuthContext


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


async def get_api_key_context(
    request: Request,
    api_key: str | None = Depends(api_key_header),
    session: str | None = Cookie(default=None),
    authorization: str | None = Header(default=None),
) -> APIKeyContext:
    """
    Legacy dependency kept for backward compatibility.

    New code should depend on `get_auth_context()`. This function returns the
    same `AuthContext` instance (via the `APIKeyContext = AuthContext` alias)
    so request handling is unified.
    """
    return await get_auth_context(
        request=request,
        api_key=api_key,
        session=session,
        authorization=authorization,
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
    2. Internal service JWT (X-Internal-Service-Token header)
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
    # When calling this dependency directly in unit tests, FastAPI param defaults
    # (Cookie/Header objects) can leak in. Treat non-strings as missing.
    session_str: str | None = session if isinstance(session, str) else None

    # 0. Admin session (admin.drovi.co)
    is_admin_client = request.headers.get("X-Drovi-Client") == "admin"
    path_is_admin = request.url.path.startswith("/api/v1/admin")
    admin_cookie_token = request.cookies.get(ADMIN_SESSION_COOKIE)
    # When unit-testing this dependency by calling it directly, the default
    # values may be FastAPI parameter objects. Treat non-strings as missing.
    auth_header: str | None = authorization if isinstance(authorization, str) else None
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
                    key_id=f"admin:{admin_token.email}",
                    key_name=f"Admin: {admin_token.email}",
                    service_name="Drovi Admin Session",
                ),
                rate_limit_per_minute=10000,
                is_internal=True,
            )
        if not api_key and not session_str and not auth_header and not request.headers.get(INTERNAL_SERVICE_HEADER):
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
    token_str: str | None = session_str
    # Admin clients must never authenticate via the pilot session cookie.
    if is_admin_client and not (auth_header and auth_header.startswith("Bearer ")):
        token_str = None
    if auth_header and auth_header.startswith("Bearer "):
        if is_admin_client or not token_str:
            token_str = auth_header[7:]

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
                    key_id=f"session:{token.sub}",
                    key_name=f"Session: {token.email}",
                ),
                rate_limit_per_minute=1000,
                is_internal=False,  # Session users are not internal
            )

    # Also allow admin tokens via Authorization header.
    if auth_header and auth_header.startswith("Bearer "):
        admin_token = verify_admin_jwt(auth_header[7:])
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
                    key_id=f"admin:{admin_token.email}",
                    key_name=f"Admin: {admin_token.email}",
                    service_name="Drovi Admin Session",
                ),
                rate_limit_per_minute=10000,
                is_internal=True,
            )

    # 2. Check for internal service auth (service-to-service)
    internal_token = request.headers.get(INTERNAL_SERVICE_HEADER)

    if internal_token:
        settings = get_settings()

        # Preferred: short-lived internal JWT with org binding in the claims.
        internal_jwt = verify_internal_jwt(internal_token)
        if internal_jwt and internal_jwt.org_id:
            service = internal_jwt.sub or "internal"
            org_id = internal_jwt.org_id
            scopes = internal_jwt.scopes or [Scope.ADMIN.value, Scope.INTERNAL.value]

            logger.debug(
                "internal_jwt_authentication_success",
                organization_id=org_id,
                service=service,
                path=request.url.path,
            )

            set_rls_context(org_id, is_internal=True)
            return AuthContext(
                organization_id=org_id,
                auth_subject_id=f"service_{service}",
                scopes=scopes,
                metadata=AuthMetadata(
                    auth_type=AuthType.INTERNAL_SERVICE,
                    service_name=service,
                    key_id=f"internal:{service}",
                    key_name=f"Internal: {service}",
                ),
                rate_limit_per_minute=10000,
                is_internal=True,
            )

        # Legacy dev-only bypass (static token). Guarded so it is impossible in prod.
        if settings.environment in ("development", "test") and LEGACY_INTERNAL_SERVICE_TOKEN:
            if internal_token == LEGACY_INTERNAL_SERVICE_TOKEN:
                org_id = request.headers.get("X-Organization-ID")
                if not org_id:
                    raise HTTPException(
                        status_code=400,
                        detail="X-Organization-ID header required for legacy internal auth (dev only)",
                    )

                logger.debug(
                    "legacy_internal_token_authentication_success",
                    organization_id=org_id,
                    path=request.url.path,
                )

                set_rls_context(org_id, is_internal=True)
                return AuthContext(
                    organization_id=org_id,
                    auth_subject_id="service_legacy_dev",
                    scopes=[Scope.ADMIN.value, Scope.INTERNAL.value],
                    metadata=AuthMetadata(
                        auth_type=AuthType.INTERNAL_SERVICE,
                        service_name="legacy_dev_token",
                        key_id="internal:legacy_dev",
                        key_name="Internal: legacy dev token",
                    ),
                    rate_limit_per_minute=10000,
                    is_internal=True,
                )

        logger.warning("invalid_internal_service_token", path=request.url.path)
        raise HTTPException(status_code=401, detail="Invalid internal service token")

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
        ctx: APIKeyContext = Depends(get_auth_context),
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
        return await get_auth_context(request, api_key)
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
    # Use a stable subject identifier for rate limiting.
    key = ctx.key_id or ctx.auth_subject_id
    return await check_rate_limit(key, limit)


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
        ctx: APIKeyContext = Depends(get_auth_context),
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
        ctx: APIKeyContext = Depends(get_auth_context),
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
