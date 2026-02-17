"""
Unit tests for Authentication Middleware.

Tests API key authentication, internal service bypass, and scope checking.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from src.auth.context import AuthContext, AuthMetadata, AuthType
from src.auth.internal_service_jwt import create_internal_jwt
from src.auth.pilot_accounts import create_jwt
from src.auth.middleware import (
    get_api_key_context,
    get_optional_api_key_context,
    require_scope,
    is_public_path,
    INTERNAL_SERVICE_HEADER,
    API_KEY_HEADER,
)
from src.auth.scopes import Scope
from src.security.org_policy import OrgSecurityPolicy

pytestmark = pytest.mark.unit


# =============================================================================
# AuthContext Tests
# =============================================================================


class TestAuthContext:
    """Tests for AuthContext class (and legacy compatibility fields)."""

    def test_init(self):
        """Test AuthContext initialization."""
        ctx = AuthContext(
            organization_id="org_123",
            auth_subject_id="key_key_456",
            scopes=["read", "write"],
            metadata=AuthMetadata(
                auth_type=AuthType.API_KEY,
                key_id="key_456",
                key_name="Test Key",
            ),
            rate_limit_per_minute=100,
            is_internal=False,
        )

        assert ctx.organization_id == "org_123"
        assert ctx.scopes == ["read", "write"]
        assert ctx.key_id == "key_456"
        assert ctx.key_name == "Test Key"
        assert ctx.is_internal is False

    def test_has_scope_direct(self):
        """Test has_scope with direct scope match."""
        ctx = AuthContext(
            organization_id="org_123",
            auth_subject_id="key_test",
            scopes=["read", "write"],
            metadata=AuthMetadata(auth_type=AuthType.API_KEY, key_id="key_test"),
        )

        assert ctx.has_scope("read") is True
        assert ctx.has_scope("admin") is False

    def test_has_scope_wildcard(self):
        """Test has_scope with wildcard."""
        ctx = AuthContext(
            organization_id="org_123",
            auth_subject_id="key_test",
            scopes=["*"],
            metadata=AuthMetadata(auth_type=AuthType.API_KEY, key_id="key_test"),
        )

        assert ctx.has_scope("read") is True
        assert ctx.has_scope("admin") is True
        assert ctx.has_scope("anything") is True

    def test_has_scope_with_enum(self):
        """Test has_scope with Scope enum."""
        ctx = AuthContext(
            organization_id="org_123",
            auth_subject_id="key_test",
            scopes=["read"],
            metadata=AuthMetadata(auth_type=AuthType.API_KEY, key_id="key_test"),
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
        request.cookies = {}
        request.url = MagicMock()
        request.url.path = "/api/v1/uios"
        return request

    @pytest.mark.asyncio
    async def test_internal_service_bypass(self, mock_request):
        """Test internal service JWT bypasses API key auth."""
        token = create_internal_jwt(org_id="org_123", service="seed")
        mock_request.headers = {
            INTERNAL_SERVICE_HEADER: token,
        }
        mock_request.query_params = {"organization_id": "org_999"}  # ignored (org comes from JWT)

        ctx = await get_api_key_context(mock_request, api_key=None, session=None, authorization=None)

        assert ctx.is_internal is True
        assert ctx.organization_id == "org_123"
        assert ctx.has_scope(Scope.INTERNAL) is True
        assert ctx.key_id and ctx.key_id.startswith("internal:")

    @pytest.mark.asyncio
    async def test_internal_service_invalid_token(self, mock_request):
        """Test invalid internal service token is rejected."""
        mock_request.headers = {
            INTERNAL_SERVICE_HEADER: "wrong_token",
        }

        with pytest.raises(HTTPException) as exc_info:
            await get_api_key_context(mock_request, api_key=None, session=None, authorization=None)

        assert exc_info.value.status_code == 401
        assert "internal service token" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_legacy_internal_token_rejected_in_production(self, mock_request):
        """Static internal tokens must be disabled in production."""
        mock_request.headers = {
            INTERNAL_SERVICE_HEADER: "legacy_token",
            "X-Organization-ID": "org_123",
        }

        with patch("src.auth.middleware.LEGACY_INTERNAL_SERVICE_TOKEN", "legacy_token"), patch(
            "src.auth.middleware.get_settings",
            return_value=MagicMock(environment="production"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_api_key_context(mock_request, api_key=None, session=None, authorization=None)

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_missing_api_key(self, mock_request):
        """Test missing API key raises 401."""
        with pytest.raises(HTTPException) as exc_info:
            await get_api_key_context(mock_request, api_key=None, session=None, authorization=None)

        assert exc_info.value.status_code == 401
        assert "Missing authentication" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_invalid_api_key(self, mock_request):
        """Test invalid API key raises 401."""
        with patch(
            "src.auth.middleware.validate_api_key",
            new_callable=AsyncMock,
            return_value=None,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_api_key_context(
                    mock_request,
                    api_key="sk_live_invalid",
                    session=None,
                    authorization=None,
                )

            assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_revoked_api_key(self, mock_request):
        """Test revoked API key raises 401."""
        from src.auth.api_key import APIKeyInfo

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
                await get_api_key_context(mock_request, api_key="sk_live_test", session=None, authorization=None)

            assert exc_info.value.status_code == 401
            assert "revoked" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_expired_api_key(self, mock_request):
        """Test expired API key raises 401."""
        from src.auth.api_key import APIKeyInfo

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
                await get_api_key_context(mock_request, api_key="sk_live_test", session=None, authorization=None)

            assert exc_info.value.status_code == 401
            assert "expired" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_valid_api_key(self, mock_request):
        """Test valid API key returns context."""
        from src.auth.api_key import APIKeyInfo

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
            ctx = await get_api_key_context(
                mock_request,
                api_key="sk_live_valid",
                session=None,
                authorization=None,
            )

            assert ctx.organization_id == "org_456"
            assert ctx.scopes == ["read", "write"]
            assert ctx.is_internal is False

    @pytest.mark.asyncio
    async def test_session_password_auth_blocked_by_sso_policy(self, mock_request):
        """Password sessions should be denied when org enforces SSO without fallback."""
        session_token = create_jwt(
            user_id="user_1",
            org_id="org_123",
            role="pilot_member",
            email="member@example.com",
            auth_method="password",
        )
        policy = OrgSecurityPolicy(
            organization_id="org_123",
            sso_enforced=True,
            password_fallback_enabled=False,
        )

        with patch("src.auth.middleware._resolve_membership_role", new_callable=AsyncMock, return_value="pilot_member"), patch(
            "src.auth.middleware.get_org_security_policy",
            new_callable=AsyncMock,
            return_value=policy,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_api_key_context(
                    mock_request,
                    api_key=None,
                    session=session_token,
                    authorization=None,
                )

        assert exc_info.value.status_code == 401
        assert "SSO" in str(exc_info.value.detail)

    @pytest.mark.asyncio
    async def test_api_key_denied_by_ip_allowlist(self, mock_request):
        """Requests outside org allowlist must be blocked."""
        from src.auth.api_key import APIKeyInfo

        mock_request.headers = {"X-Forwarded-For": "198.51.100.10"}
        policy = OrgSecurityPolicy(
            organization_id="org_456",
            ip_allowlist=("10.0.0.0/8",),
        )

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
        ), patch(
            "src.auth.middleware.get_org_security_policy",
            new_callable=AsyncMock,
            return_value=policy,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_api_key_context(
                    mock_request,
                    api_key="sk_live_valid",
                    session=None,
                    authorization=None,
                )

        assert exc_info.value.status_code == 403
        assert "allowlist" in str(exc_info.value.detail).lower()


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
        request.cookies = {}
        request.url = MagicMock()
        request.url.path = "/api/v1/uios"
        return request

    @pytest.mark.asyncio
    async def test_returns_none_for_missing_key(self, mock_request):
        """Test returns None when no key provided."""
        ctx = await get_optional_api_key_context(mock_request, api_key=None)

        assert ctx is None

    @pytest.mark.asyncio
    async def test_returns_context_for_valid_key(self, mock_request):
        """Test returns context for valid key."""
        from src.auth.api_key import APIKeyInfo

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
        ctx = AuthContext(
            organization_id="org_123",
            auth_subject_id="key_test",
            scopes=["read", "write"],
            metadata=AuthMetadata(auth_type=AuthType.API_KEY, key_id="key_test"),
        )

        check_fn = require_scope("read")

        result_ctx = await check_fn(ctx=ctx)
        assert result_ctx.organization_id == "org_123"

    @pytest.mark.asyncio
    async def test_scope_denied(self):
        """Test raises 403 when scope is denied."""
        ctx = AuthContext(
            organization_id="org_123",
            auth_subject_id="key_test",
            scopes=["read"],
            metadata=AuthMetadata(auth_type=AuthType.API_KEY, key_id="key_test"),
        )

        check_fn = require_scope("admin")

        with pytest.raises(HTTPException) as exc_info:
            await check_fn(ctx=ctx)

        assert exc_info.value.status_code == 403
        assert "Insufficient permissions" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_scope_with_enum(self):
        """Test scope check with Scope enum."""
        ctx = AuthContext(
            organization_id="org_123",
            auth_subject_id="key_test",
            scopes=["admin"],
            metadata=AuthMetadata(auth_type=AuthType.API_KEY, key_id="key_test"),
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
