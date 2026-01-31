"""
Security Middleware for Pilot Surface

Provides:
- CSRF token validation for state-changing requests
- Security headers (CSP, XSS, etc.)
- Request ID tracking
- Rate limiting by IP/org
"""

import secrets
import time
from typing import Callable

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from src.config import get_settings

logger = structlog.get_logger()

# =============================================================================
# CSRF Protection
# =============================================================================

CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"
CSRF_SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}


def generate_csrf_token() -> str:
    """Generate a secure CSRF token."""
    return secrets.token_urlsafe(32)


class CSRFMiddleware(BaseHTTPMiddleware):
    """
    CSRF protection middleware.

    - Sets CSRF token cookie on all responses
    - Validates CSRF header on state-changing requests (POST, PUT, DELETE, PATCH)
    - Excludes API key authenticated requests (they use bearer token auth)
    """

    def __init__(self, app: ASGIApp, exclude_paths: list[str] | None = None):
        super().__init__(app)
        self.exclude_paths = exclude_paths or [
            "/api/v1/analyze",  # API key auth
            "/api/v1/memory",  # API key auth
            "/api/v1/search",  # API key auth
            "/api/v1/graph",  # API key auth
            "/api/v1/webhooks",  # Webhook signatures
            "/health",
            "/metrics",
            "/docs",
            "/openapi.json",
        ]

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip CSRF for excluded paths
        if any(request.url.path.startswith(path) for path in self.exclude_paths):
            return await call_next(request)

        # Skip CSRF for safe methods
        if request.method in CSRF_SAFE_METHODS:
            response = await call_next(request)
            # Set CSRF cookie if not present
            if CSRF_COOKIE_NAME not in request.cookies:
                csrf_token = generate_csrf_token()
                response.set_cookie(
                    key=CSRF_COOKIE_NAME,
                    value=csrf_token,
                    httponly=False,  # JS needs to read this
                    secure=get_settings().environment == "production",
                    samesite="lax",
                    max_age=86400,  # 24 hours
                )
            return response

        # Validate CSRF for state-changing methods
        csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
        csrf_header = request.headers.get(CSRF_HEADER_NAME)

        if not csrf_cookie or not csrf_header:
            logger.warning(
                "CSRF validation failed: missing token",
                path=request.url.path,
                method=request.method,
            )
            return Response(
                content='{"detail": "CSRF token missing"}',
                status_code=403,
                media_type="application/json",
            )

        if not secrets.compare_digest(csrf_cookie, csrf_header):
            logger.warning(
                "CSRF validation failed: token mismatch",
                path=request.url.path,
                method=request.method,
            )
            return Response(
                content='{"detail": "CSRF token invalid"}',
                status_code=403,
                media_type="application/json",
            )

        return await call_next(request)


# =============================================================================
# Security Headers
# =============================================================================


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Add security headers to all responses.

    Headers:
    - X-Content-Type-Options: nosniff
    - X-Frame-Options: DENY
    - X-XSS-Protection: 1; mode=block
    - Referrer-Policy: strict-origin-when-cross-origin
    - Content-Security-Policy: (for HTML responses)
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)

        # Always add these headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Add CSP for HTML responses
        if response.headers.get("content-type", "").startswith("text/html"):
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline'; "
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: https:; "
                "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com; "
                "frame-ancestors 'none';"
            )

        return response


# =============================================================================
# Request ID Tracking
# =============================================================================


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Add unique request ID to all requests for tracing.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request_id = request.headers.get("X-Request-ID") or secrets.token_hex(8)

        # Add to request state for logging
        request.state.request_id = request_id

        # Bind to structlog context
        structlog.contextvars.bind_contextvars(request_id=request_id)

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id

        # Clear context
        structlog.contextvars.unbind_contextvars("request_id")

        return response


# =============================================================================
# Rate Limiting by IP
# =============================================================================


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Simple in-memory rate limiting by IP.

    For production, use Redis-based rate limiting.
    """

    def __init__(
        self,
        app: ASGIApp,
        requests_per_minute: int = 100,
        burst_limit: int = 20,
    ):
        super().__init__(app)
        self.requests_per_minute = requests_per_minute
        self.burst_limit = burst_limit
        self._requests: dict[str, list[float]] = {}

    def _get_client_ip(self, request: Request) -> str:
        """Get client IP from request, handling proxies."""
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    def _is_rate_limited(self, client_ip: str) -> tuple[bool, int]:
        """Check if client is rate limited."""
        now = time.time()
        window_start = now - 60  # 1 minute window

        # Get request times for this IP
        if client_ip not in self._requests:
            self._requests[client_ip] = []

        # Clean old requests
        self._requests[client_ip] = [
            t for t in self._requests[client_ip] if t > window_start
        ]

        request_count = len(self._requests[client_ip])

        # Check burst limit (requests in last second)
        recent_requests = sum(1 for t in self._requests[client_ip] if t > now - 1)
        if recent_requests >= self.burst_limit:
            return True, 1  # Retry after 1 second

        # Check minute limit
        if request_count >= self.requests_per_minute:
            oldest = min(self._requests[client_ip])
            retry_after = int(oldest + 60 - now) + 1
            return True, retry_after

        # Record this request
        self._requests[client_ip].append(now)
        return False, 0

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Skip rate limiting for health checks
        if request.url.path in ["/health", "/health/ready", "/health/live"]:
            return await call_next(request)

        client_ip = self._get_client_ip(request)
        is_limited, retry_after = self._is_rate_limited(client_ip)

        if is_limited:
            logger.warning(
                "Rate limit exceeded",
                client_ip=client_ip,
                path=request.url.path,
                retry_after=retry_after,
            )
            return Response(
                content='{"detail": "Rate limit exceeded"}',
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(retry_after)},
            )

        return await call_next(request)


# =============================================================================
# Production CORS Configuration
# =============================================================================


def get_cors_origins() -> list[str]:
    """
    Get allowed CORS origins based on environment.

    Production: Only allow specific pilot domains
    Development: Allow localhost
    """
    settings = get_settings()

    if settings.environment == "production":
        # In production, only allow configured origins
        return settings.cors_origins

    # In development, also allow common local ports
    dev_origins = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
        "http://localhost:8080",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8080",
    ]

    return list(set(settings.cors_origins + dev_origins))
