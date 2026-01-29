"""
Unit tests for Authentication Middleware.

Tests API key authentication, internal service bypass, and scope checking.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
import os

from fastapi import HTTPException

from src.auth.middleware import (
    APIKeyContext,
    get_api_key_context,
    get_optional_api_key_context,
    require_scope,
    is_public_path,
    INTERNAL_SERVICE_HEADER,
    API_KEY_HEADER,
)
from src.auth.scopes import Scope

pytestmark = pytest.mark.unit


# =============================================================================
# APIKeyContext Tests
# =============================================================================


class TestAPIKeyContext:
    """Tests for APIKeyContext class."""

    def test_init(self):
        """Test APIKeyContext initialization."""
        ctx = APIKeyContext(
            organization_id="org_123",
            scopes=["read", "write"],
            key_id="key_456",
            key_name="Test Key",
            is_internal=False,
            rate_limit_per_minute=100,
        )

        assert ctx.organization_id == "org_123"
        assert ctx.scopes == ["read", "write"]
        assert ctx.key_id == "key_456"
        assert ctx.is_internal is False

    def test_has_scope_direct(self):
        """Test has_scope with direct scope match."""
        ctx = APIKeyContext(
            organization_id="org_123",
            scopes=["read", "write"],
        )

        assert ctx.has_scope("read") is True
        assert ctx.has_scope("admin") is False

    def test_has_scope_wildcard(self):
        """Test has_scope with wildcard."""
        ctx = APIKeyContext(
            organization_id="org_123",
            scopes=["*"],
        )

        assert ctx.has_scope("read") is True
        assert ctx.has_scope("admin") is True
        assert ctx.has_scope("anything") is True

    def test_has_scope_with_enum(self):
        """Test has_scope with Scope enum."""
        ctx = APIKeyContext(
            organization_id="org_123",
            scopes=["read"],
        )

        assert ctx.has_scope(Scope.READ) is True
        assert ctx.has_scope(Scope.WRITE) is False


# =============================================================================
# get_api_key_context Tests
# =============================================================================


class TestGetAPIKeyContext:
    """Tests for get_api_key_context dependency."""

    @pytest.fixture
    def mock_request(self):
        """Create a mock FastAPI request."""
        request = MagicMock()
        request.headers = {}
        request.query_params = {}
        request.url = MagicMock()
        request.url.path = "/api/v1/uios"
        return request

    @pytest.mark.asyncio
    async def test_internal_service_bypass(self, mock_request):
        """Test internal service token bypasses API key auth."""
        mock_request.headers = {
            INTERNAL_SERVICE_HEADER: "valid_internal_token",
        }
        mock_request.query_params = {"organization_id": "org_123"}

        with patch(
            "src.auth.middleware.INTERNAL_SERVICE_TOKEN",
            "valid_internal_token",
        ):
            ctx = await get_api_key_context(mock_request, api_key=None)

            assert ctx.is_internal is True
            assert ctx.organization_id == "org_123"
            assert ctx.scopes == ["*"]

    @pytest.mark.asyncio
    async def test_internal_service_invalid_token(self, mock_request):
        """Test invalid internal service token is rejected."""
        mock_request.headers = {
            INTERNAL_SERVICE_HEADER: "wrong_token",
        }

        with patch(
            "src.auth.middleware.INTERNAL_SERVICE_TOKEN",
            "valid_internal_token",
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_api_key_context(mock_request, api_key=None)

            assert exc_info.value.status_code == 401
            assert "internal service token" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_missing_api_key(self, mock_request):
        """Test missing API key raises 401."""
        with patch("src.auth.middleware.INTERNAL_SERVICE_TOKEN", None):
            with pytest.raises(HTTPException) as exc_info:
                await get_api_key_context(mock_request, api_key=None)

            assert exc_info.value.status_code == 401
            assert "Missing API key" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_invalid_api_key(self, mock_request):
        """Test invalid API key raises 401."""
        with patch("src.auth.middleware.INTERNAL_SERVICE_TOKEN", None):
            with patch(
                "src.auth.middleware.validate_api_key",
                new_callable=AsyncMock,
                return_value=None,
            ):
                with pytest.raises(HTTPException) as exc_info:
                    await get_api_key_context(mock_request, api_key="sk_live_invalid")

                assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_revoked_api_key(self, mock_request):
        """Test revoked API key raises 401."""
        from src.auth.api_key import APIKeyInfo

        with patch("src.auth.middleware.INTERNAL_SERVICE_TOKEN", None):
            with patch(
                "src.auth.middleware.validate_api_key",
                new_callable=AsyncMock,
                return_value=APIKeyInfo(
                    id="key_123",
                    organization_id="org_456",
                    scopes=["read"],
                    rate_limit_per_minute=100,
                    expires_at=None,
                    revoked_at=datetime.utcnow(),  # Revoked
                    name="Test Key",
                ),
            ):
                with pytest.raises(HTTPException) as exc_info:
                    await get_api_key_context(mock_request, api_key="sk_live_test")

                assert exc_info.value.status_code == 401
                assert "revoked" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_expired_api_key(self, mock_request):
        """Test expired API key raises 401."""
        from src.auth.api_key import APIKeyInfo

        with patch("src.auth.middleware.INTERNAL_SERVICE_TOKEN", None):
            with patch(
                "src.auth.middleware.validate_api_key",
                new_callable=AsyncMock,
                return_value=APIKeyInfo(
                    id="key_123",
                    organization_id="org_456",
                    scopes=["read"],
                    rate_limit_per_minute=100,
                    expires_at=datetime.utcnow() - timedelta(hours=1),  # Expired
                    revoked_at=None,
                    name="Test Key",
                ),
            ):
                with pytest.raises(HTTPException) as exc_info:
                    await get_api_key_context(mock_request, api_key="sk_live_test")

                assert exc_info.value.status_code == 401
                assert "expired" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_valid_api_key(self, mock_request):
        """Test valid API key returns context."""
        from src.auth.api_key import APIKeyInfo

        with patch("src.auth.middleware.INTERNAL_SERVICE_TOKEN", None):
            with patch(
                "src.auth.middleware.validate_api_key",
                new_callable=AsyncMock,
                return_value=APIKeyInfo(
                    id="key_123",
                    organization_id="org_456",
                    scopes=["read", "write"],
                    rate_limit_per_minute=100,
                    expires_at=None,
                    revoked_at=None,
                    name="Test Key",
                ),
            ):
                ctx = await get_api_key_context(mock_request, api_key="sk_live_valid")

                assert ctx.organization_id == "org_456"
                assert ctx.scopes == ["read", "write"]
                assert ctx.is_internal is False


# =============================================================================
# get_optional_api_key_context Tests
# =============================================================================


class TestGetOptionalAPIKeyContext:
    """Tests for optional authentication."""

    @pytest.fixture
    def mock_request(self):
        """Create a mock FastAPI request."""
        request = MagicMock()
        request.headers = {}
        request.query_params = {}
        request.url = MagicMock()
        request.url.path = "/api/v1/uios"
        return request

    @pytest.mark.asyncio
    async def test_returns_none_for_missing_key(self, mock_request):
        """Test returns None when no key provided."""
        with patch("src.auth.middleware.INTERNAL_SERVICE_TOKEN", None):
            ctx = await get_optional_api_key_context(mock_request, api_key=None)

            assert ctx is None

    @pytest.mark.asyncio
    async def test_returns_context_for_valid_key(self, mock_request):
        """Test returns context for valid key."""
        from src.auth.api_key import APIKeyInfo

        with patch("src.auth.middleware.INTERNAL_SERVICE_TOKEN", None):
            with patch(
                "src.auth.middleware.validate_api_key",
                new_callable=AsyncMock,
                return_value=APIKeyInfo(
                    id="key_123",
                    organization_id="org_456",
                    scopes=["read"],
                    rate_limit_per_minute=100,
                    expires_at=None,
                    revoked_at=None,
                    name="Test Key",
                ),
            ):
                ctx = await get_optional_api_key_context(
                    mock_request,
                    api_key="sk_live_valid",
                )

                assert ctx is not None
                assert ctx.organization_id == "org_456"


# =============================================================================
# require_scope Tests
# =============================================================================


class TestRequireScope:
    """Tests for scope requirement dependency."""

    @pytest.mark.asyncio
    async def test_scope_granted(self):
        """Test passes when scope is granted."""
        ctx = APIKeyContext(
            organization_id="org_123",
            scopes=["read", "write"],
        )

        check_fn = require_scope("read")

        # Create mock get_api_key_context that returns ctx
        with patch(
            "src.auth.middleware.get_api_key_context",
            new_callable=AsyncMock,
            return_value=ctx,
        ):
            # The check function needs a context
            result_ctx = await check_fn(ctx=ctx)
            assert result_ctx.organization_id == "org_123"

    @pytest.mark.asyncio
    async def test_scope_denied(self):
        """Test raises 403 when scope is denied."""
        ctx = APIKeyContext(
            organization_id="org_123",
            scopes=["read"],
        )

        check_fn = require_scope("admin")

        with pytest.raises(HTTPException) as exc_info:
            await check_fn(ctx=ctx)

        assert exc_info.value.status_code == 403
        assert "Insufficient permissions" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_scope_with_enum(self):
        """Test scope check with Scope enum."""
        ctx = APIKeyContext(
            organization_id="org_123",
            scopes=["admin"],
        )

        check_fn = require_scope(Scope.ADMIN)
        result_ctx = await check_fn(ctx=ctx)

        assert result_ctx is not None


# =============================================================================
# Public Path Tests
# =============================================================================


class TestIsPublicPath:
    """Tests for public path detection."""

    def test_root_is_public(self):
        """Test root path is public."""
        assert is_public_path("/") is True

    def test_health_is_public(self):
        """Test health endpoints are public."""
        assert is_public_path("/health") is True
        assert is_public_path("/health/live") is True
        assert is_public_path("/health/ready") is True

    def test_docs_is_public(self):
        """Test docs endpoints are public."""
        assert is_public_path("/docs") is True
        assert is_public_path("/docs/oauth2-redirect") is True
        assert is_public_path("/redoc") is True

    def test_metrics_is_public(self):
        """Test metrics endpoint is public."""
        assert is_public_path("/metrics") is True

    def test_api_is_not_public(self):
        """Test API endpoints are not public."""
        assert is_public_path("/api/v1/uios") is False
        assert is_public_path("/api/v1/search") is False
        assert is_public_path("/api/v1/analyze") is False
