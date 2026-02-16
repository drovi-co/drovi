"""
Unit tests for Rate Limiting.

Tests the token bucket rate limiter and middleware integration.
"""

import pytest
import time
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from src.auth.rate_limit import (
    RateLimitResult,
    TokenBucketRateLimiter,
    check_rate_limit,
    get_rate_limiter,
)
from src.auth.middleware import (
    APIKeyContext,
    check_rate_limit_for_context,
    require_rate_limit,
    require_scope_with_rate_limit,
)
from src.auth.context import AuthMetadata, AuthType
from src.auth.scopes import Scope

pytestmark = pytest.mark.unit


def _auth_ctx(
    *,
    org_id: str = "org_123",
    scopes: list[str] | None = None,
    key_id: str | None = "key_123",
    is_internal: bool = False,
    rate_limit_per_minute: int = 100,
) -> APIKeyContext:
    return APIKeyContext(
        organization_id=org_id,
        auth_subject_id=(
            f"service_{key_id or 'internal'}" if is_internal else f"key_{key_id or 'anonymous'}"
        ),
        scopes=scopes or ["read"],
        metadata=AuthMetadata(
            auth_type=AuthType.INTERNAL_SERVICE if is_internal else AuthType.API_KEY,
            key_id=key_id,
            key_name="Test Key" if key_id else None,
            service_name="internal" if is_internal else None,
        ),
        rate_limit_per_minute=rate_limit_per_minute,
        is_internal=is_internal,
    )


# =============================================================================
# RateLimitResult Tests
# =============================================================================


class TestRateLimitResult:
    """Tests for RateLimitResult named tuple."""

    def test_create_result(self):
        """Test creating a rate limit result."""
        result = RateLimitResult(
            allowed=True,
            remaining=99,
            reset_at=time.time() + 60,
            limit=100,
        )

        assert result.allowed is True
        assert result.remaining == 99
        assert result.limit == 100

    def test_result_denied(self):
        """Test creating a denied result."""
        result = RateLimitResult(
            allowed=False,
            remaining=0,
            reset_at=time.time() + 60,
            limit=100,
        )

        assert result.allowed is False
        assert result.remaining == 0


# =============================================================================
# TokenBucketRateLimiter Tests
# =============================================================================


class TestTokenBucketRateLimiter:
    """Tests for TokenBucketRateLimiter class."""

    def test_init_default(self):
        """Test default initialization."""
        limiter = TokenBucketRateLimiter()

        assert limiter.key_prefix == "ratelimit:"
        assert limiter.window_seconds == 60

    def test_init_custom(self):
        """Test custom initialization."""
        limiter = TokenBucketRateLimiter(
            key_prefix="custom:",
            window_seconds=30,
        )

        assert limiter.key_prefix == "custom:"
        assert limiter.window_seconds == 30

    @pytest.mark.asyncio
    async def test_check_redis_unavailable(self):
        """Test check fails open when Redis unavailable."""
        limiter = TokenBucketRateLimiter()

        # Patch _get_redis to return None (Redis unavailable)
        with patch.object(limiter, "_get_redis", new_callable=AsyncMock, return_value=None):
            result = await limiter.check("key_123", limit=100)

            assert result.allowed is True
            assert result.remaining == 100
            assert result.limit == 100

    @pytest.mark.asyncio
    async def test_check_under_limit(self):
        """Test check when under limit."""
        limiter = TokenBucketRateLimiter()

        # Mock Redis with pipeline - pipeline() returns a sync context manager
        mock_redis = MagicMock()
        mock_pipeline = MagicMock()
        mock_pipeline.__aenter__ = AsyncMock(return_value=mock_pipeline)
        mock_pipeline.__aexit__ = AsyncMock(return_value=None)
        mock_pipeline.execute = AsyncMock(return_value=[None, 50, None, None])  # zcard returns 50
        mock_redis.pipeline.return_value = mock_pipeline

        with patch.object(limiter, "_get_redis", new_callable=AsyncMock, return_value=mock_redis):
            result = await limiter.check("key_123", limit=100)

            assert result.allowed is True
            assert result.remaining == 49  # 100 - 50 - 1

    @pytest.mark.asyncio
    async def test_check_at_limit(self):
        """Test check when at limit."""
        limiter = TokenBucketRateLimiter()

        # Mock Redis with pipeline - pipeline() returns a sync context manager
        mock_redis = MagicMock()
        mock_redis.zrem = AsyncMock()  # zrem is async
        mock_pipeline = MagicMock()
        mock_pipeline.__aenter__ = AsyncMock(return_value=mock_pipeline)
        mock_pipeline.__aexit__ = AsyncMock(return_value=None)
        mock_pipeline.execute = AsyncMock(return_value=[None, 100, None, None])  # zcard returns 100 (at limit)
        mock_redis.pipeline.return_value = mock_pipeline

        with patch.object(limiter, "_get_redis", new_callable=AsyncMock, return_value=mock_redis):
            result = await limiter.check("key_123", limit=100)

            assert result.allowed is False
            assert result.remaining == 0
            # Should have called zrem to remove the denied request
            mock_redis.zrem.assert_called_once()

    @pytest.mark.asyncio
    async def test_check_with_cost(self):
        """Test check with custom cost."""
        limiter = TokenBucketRateLimiter()

        # Mock Redis with pipeline - pipeline() returns a sync context manager
        mock_redis = MagicMock()
        mock_pipeline = MagicMock()
        mock_pipeline.__aenter__ = AsyncMock(return_value=mock_pipeline)
        mock_pipeline.__aexit__ = AsyncMock(return_value=None)
        mock_pipeline.execute = AsyncMock(return_value=[None, 90, None, None])  # zcard returns 90
        mock_redis.pipeline.return_value = mock_pipeline

        with patch.object(limiter, "_get_redis", new_callable=AsyncMock, return_value=mock_redis):
            result = await limiter.check("key_123", limit=100, cost=5)

            assert result.allowed is True
            assert result.remaining == 5  # 100 - 90 - 5

    @pytest.mark.asyncio
    async def test_check_exception_fails_open(self):
        """Test check fails open on exception."""
        limiter = TokenBucketRateLimiter()

        # Mock Redis that raises exception
        mock_redis = AsyncMock()
        mock_redis.pipeline.side_effect = Exception("Redis error")

        with patch.object(limiter, "_get_redis", new_callable=AsyncMock, return_value=mock_redis):
            result = await limiter.check("key_123", limit=100)

            assert result.allowed is True  # Fail open
            assert result.limit == 100

    @pytest.mark.asyncio
    async def test_get_usage_redis_unavailable(self):
        """Test get_usage when Redis unavailable."""
        limiter = TokenBucketRateLimiter()

        with patch.object(limiter, "_get_redis", new_callable=AsyncMock, return_value=None):
            usage = await limiter.get_usage("key_123")

            assert usage["count"] == 0
            assert usage["window_seconds"] == 60

    @pytest.mark.asyncio
    async def test_get_usage_success(self):
        """Test get_usage success."""
        limiter = TokenBucketRateLimiter()

        mock_redis = AsyncMock()
        mock_redis.zcount.return_value = 42

        with patch.object(limiter, "_get_redis", new_callable=AsyncMock, return_value=mock_redis):
            usage = await limiter.get_usage("key_123")

            assert usage["count"] == 42
            assert usage["window_seconds"] == 60

    @pytest.mark.asyncio
    async def test_reset_redis_unavailable(self):
        """Test reset when Redis unavailable."""
        limiter = TokenBucketRateLimiter()

        with patch.object(limiter, "_get_redis", new_callable=AsyncMock, return_value=None):
            result = await limiter.reset("key_123")

            assert result is False

    @pytest.mark.asyncio
    async def test_reset_success(self):
        """Test reset success."""
        limiter = TokenBucketRateLimiter()

        mock_redis = AsyncMock()

        with patch.object(limiter, "_get_redis", new_callable=AsyncMock, return_value=mock_redis):
            result = await limiter.reset("key_123")

            assert result is True
            mock_redis.delete.assert_called_once_with("ratelimit:key_123")


# =============================================================================
# Global Rate Limiter Tests
# =============================================================================


class TestGlobalRateLimiter:
    """Tests for global rate limiter functions."""

    @pytest.mark.asyncio
    async def test_get_rate_limiter_singleton(self):
        """Test get_rate_limiter returns same instance."""
        # Reset global
        import src.auth.rate_limit
        src.auth.rate_limit._rate_limiter = None

        limiter1 = await get_rate_limiter()
        limiter2 = await get_rate_limiter()

        assert limiter1 is limiter2

    @pytest.mark.asyncio
    async def test_check_rate_limit_convenience(self):
        """Test check_rate_limit convenience function."""
        with patch(
            "src.auth.rate_limit.get_rate_limiter",
            new_callable=AsyncMock,
        ) as mock_get:
            mock_limiter = AsyncMock()
            mock_limiter.check.return_value = RateLimitResult(
                allowed=True,
                remaining=99,
                reset_at=time.time() + 60,
                limit=100,
            )
            mock_get.return_value = mock_limiter

            result = await check_rate_limit("key_123", 100)

            assert result.allowed is True
            mock_limiter.check.assert_called_once_with("key_123", 100)


# =============================================================================
# Middleware Integration Tests
# =============================================================================


class TestCheckRateLimitForContext:
    """Tests for check_rate_limit_for_context function."""

    @pytest.mark.asyncio
    async def test_internal_service_not_limited(self):
        """Test internal service is not rate limited."""
        ctx = _auth_ctx(
            scopes=["*"],
            key_id="internal",
            is_internal=True,
            rate_limit_per_minute=10000,
        )

        result = await check_rate_limit_for_context(ctx)

        assert result.allowed is True
        assert result.remaining == 10000

    @pytest.mark.asyncio
    async def test_external_key_rate_limited(self):
        """Test external key is rate limited."""
        ctx = _auth_ctx(scopes=["read"], key_id="key_123", is_internal=False, rate_limit_per_minute=100)

        with patch(
            "src.auth.middleware.check_rate_limit",
            new_callable=AsyncMock,
            return_value=RateLimitResult(
                allowed=True,
                remaining=99,
                reset_at=time.time() + 60,
                limit=100,
            ),
        ) as mock_check:
            result = await check_rate_limit_for_context(ctx)

            assert result.allowed is True
            mock_check.assert_called_once_with("key_123", 100)


class TestRequireRateLimit:
    """Tests for require_rate_limit dependency."""

    @pytest.fixture
    def mock_request(self):
        """Create a mock request."""
        request = MagicMock()
        request.state = MagicMock()
        return request

    @pytest.mark.asyncio
    async def test_rate_limit_allowed(self, mock_request):
        """Test request allowed under rate limit."""
        ctx = _auth_ctx(scopes=["read"], key_id="key_123", is_internal=False, rate_limit_per_minute=100)

        with patch(
            "src.auth.middleware.check_rate_limit_for_context",
            new_callable=AsyncMock,
            return_value=RateLimitResult(
                allowed=True,
                remaining=99,
                reset_at=time.time() + 60,
                limit=100,
            ),
        ):
            check_fn = require_rate_limit()

            # ctx is passed explicitly; the auth dependency is not invoked.
            result = await check_fn(mock_request, ctx)

            assert result.organization_id == "org_123"
            assert mock_request.state.rate_limit_remaining == 99

    @pytest.mark.asyncio
    async def test_rate_limit_exceeded(self, mock_request):
        """Test request rejected when rate limit exceeded."""
        ctx = _auth_ctx(scopes=["read"], key_id="key_123", is_internal=False, rate_limit_per_minute=100)

        with patch(
            "src.auth.middleware.check_rate_limit_for_context",
            new_callable=AsyncMock,
            return_value=RateLimitResult(
                allowed=False,
                remaining=0,
                reset_at=time.time() + 60,
                limit=100,
            ),
        ):
            check_fn = require_rate_limit()

            with pytest.raises(HTTPException) as exc_info:
                await check_fn(mock_request, ctx)

            assert exc_info.value.status_code == 429
            assert "Rate limit exceeded" in exc_info.value.detail


class TestRequireScopeWithRateLimit:
    """Tests for require_scope_with_rate_limit dependency."""

    @pytest.fixture
    def mock_request(self):
        """Create a mock request."""
        request = MagicMock()
        request.state = MagicMock()
        return request

    @pytest.mark.asyncio
    async def test_scope_granted_under_limit(self, mock_request):
        """Test request allowed with scope and under rate limit."""
        ctx = _auth_ctx(scopes=["read", "write"], key_id="key_123", is_internal=False, rate_limit_per_minute=100)

        with patch(
            "src.auth.middleware.check_rate_limit_for_context",
            new_callable=AsyncMock,
            return_value=RateLimitResult(
                allowed=True,
                remaining=99,
                reset_at=time.time() + 60,
                limit=100,
            ),
        ):
            check_fn = require_scope_with_rate_limit(Scope.READ)

            result = await check_fn(mock_request, ctx)

            assert result.organization_id == "org_123"

    @pytest.mark.asyncio
    async def test_scope_denied(self, mock_request):
        """Test request rejected when scope missing."""
        ctx = _auth_ctx(scopes=["read"], key_id="key_123", is_internal=False, rate_limit_per_minute=100)

        check_fn = require_scope_with_rate_limit(Scope.WRITE)

        with pytest.raises(HTTPException) as exc_info:
            await check_fn(mock_request, ctx)

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_scope_granted_but_rate_limited(self, mock_request):
        """Test request rejected when scope ok but rate limited."""
        ctx = _auth_ctx(scopes=["read", "write"], key_id="key_123", is_internal=False, rate_limit_per_minute=100)

        with patch(
            "src.auth.middleware.check_rate_limit_for_context",
            new_callable=AsyncMock,
            return_value=RateLimitResult(
                allowed=False,
                remaining=0,
                reset_at=time.time() + 60,
                limit=100,
            ),
        ):
            check_fn = require_scope_with_rate_limit(Scope.READ)

            with pytest.raises(HTTPException) as exc_info:
                await check_fn(mock_request, ctx)

            assert exc_info.value.status_code == 429


# =============================================================================
# Rate Limit Headers Tests
# =============================================================================


class TestRateLimitHeaders:
    """Tests for rate limit response headers."""

    @pytest.fixture
    def mock_request(self):
        """Create a mock request."""
        request = MagicMock()
        request.state = MagicMock()
        return request

    @pytest.mark.asyncio
    async def test_headers_set_on_request_state(self, mock_request):
        """Test rate limit info is set on request state."""
        ctx = _auth_ctx(scopes=["read"], key_id="key_123", is_internal=False, rate_limit_per_minute=100)

        reset_time = time.time() + 60

        with patch(
            "src.auth.middleware.check_rate_limit_for_context",
            new_callable=AsyncMock,
            return_value=RateLimitResult(
                allowed=True,
                remaining=75,
                reset_at=reset_time,
                limit=100,
            ),
        ):
            check_fn = require_rate_limit()

            await check_fn(mock_request, ctx)

            assert mock_request.state.rate_limit_limit == 100
            assert mock_request.state.rate_limit_remaining == 75
            assert mock_request.state.rate_limit_reset == int(reset_time)

    @pytest.mark.asyncio
    async def test_headers_on_rate_limit_exceeded(self, mock_request):
        """Test headers are included in 429 response."""
        ctx = _auth_ctx(scopes=["read"], key_id="key_123", is_internal=False, rate_limit_per_minute=100)

        reset_time = time.time() + 60

        with patch(
            "src.auth.middleware.check_rate_limit_for_context",
            new_callable=AsyncMock,
            return_value=RateLimitResult(
                allowed=False,
                remaining=0,
                reset_at=reset_time,
                limit=100,
            ),
        ):
            check_fn = require_rate_limit()

            with pytest.raises(HTTPException) as exc_info:
                await check_fn(mock_request, ctx)

            headers = exc_info.value.headers
            assert "X-RateLimit-Limit" in headers
            assert "X-RateLimit-Remaining" in headers
            assert "X-RateLimit-Reset" in headers
            assert "Retry-After" in headers
            assert headers["X-RateLimit-Limit"] == "100"
            assert headers["X-RateLimit-Remaining"] == "0"
