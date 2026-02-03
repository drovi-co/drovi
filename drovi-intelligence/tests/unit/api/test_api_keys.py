"""
Unit tests for API Keys routes.

Tests key creation, listing, revocation, and scope management.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from src.auth.middleware import APIKeyContext
from src.auth.scopes import Scope

pytestmark = pytest.mark.unit


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def admin_context():
    """Create an admin API key context."""
    return APIKeyContext(
        organization_id="org_123",
        scopes=["admin", "read", "write", "mcp", "manage:keys"],
        key_id="key_admin",
        key_name="Admin Key",
        is_internal=False,
        rate_limit_per_minute=1000,
    )


@pytest.fixture
def regular_context():
    """Create a regular user API key context."""
    return APIKeyContext(
        organization_id="org_123",
        scopes=["read", "write", "mcp", "manage:keys"],
        key_id="key_user",
        key_name="User Key",
        is_internal=False,
        rate_limit_per_minute=100,
    )


@pytest.fixture
def internal_context():
    """Create an internal service context."""
    return APIKeyContext(
        organization_id="org_123",
        scopes=["*"],
        key_id="internal",
        key_name=None,
        is_internal=True,
        rate_limit_per_minute=None,
    )


@pytest.fixture
def no_manage_keys_context():
    """Create a context without manage:keys scope."""
    return APIKeyContext(
        organization_id="org_123",
        scopes=["read", "write"],
        key_id="key_limited",
        key_name="Limited Key",
        is_internal=False,
        rate_limit_per_minute=100,
    )


# =============================================================================
# CreateAPIKeyRequest Tests
# =============================================================================


class TestCreateAPIKeyRequest:
    """Tests for the create API key request model."""

    def test_valid_request(self):
        """Test valid create request."""
        from src.api.routes.api_keys import CreateAPIKeyRequest

        request = CreateAPIKeyRequest(
            name="Test Key",
            scopes=["read", "write"],
            rate_limit_per_minute=200,
            is_test=True,
        )

        assert request.name == "Test Key"
        assert request.scopes == ["read", "write"]
        assert request.rate_limit_per_minute == 200
        assert request.is_test is True

    def test_minimal_request(self):
        """Test minimal create request with defaults."""
        from src.api.routes.api_keys import CreateAPIKeyRequest

        request = CreateAPIKeyRequest(name="Minimal Key")

        assert request.name == "Minimal Key"
        assert request.scopes is None  # Will use defaults
        assert request.rate_limit_per_minute == 100
        assert request.is_test is False
        assert request.expires_at is None

    def test_request_with_expiry(self):
        """Test request with expiration."""
        from src.api.routes.api_keys import CreateAPIKeyRequest

        expires = datetime.utcnow() + timedelta(days=30)
        request = CreateAPIKeyRequest(
            name="Temp Key",
            expires_at=expires,
        )

        assert request.expires_at == expires


# =============================================================================
# Create Key Endpoint Tests
# =============================================================================


class TestCreateKeyEndpoint:
    """Tests for the create key endpoint."""

    @pytest.mark.asyncio
    async def test_create_key_success(self, admin_context):
        """Test successful key creation."""
        from src.api.routes.api_keys import create_key, CreateAPIKeyRequest

        request = CreateAPIKeyRequest(
            name="New Key",
            scopes=["read", "write"],
        )

        with patch(
            "src.api.routes.api_keys.create_api_key",
            new_callable=AsyncMock,
            return_value=("sk_live_abcd1234", "key_new123"),
        ), patch(
            "src.api.routes.api_keys.record_audit_event",
            new_callable=AsyncMock,
        ):
            response = await create_key(request, admin_context)

            assert response.id == "key_new123"
            assert response.key == "sk_live_abcd1234"
            assert response.key_prefix == "sk_live_"
            assert response.name == "New Key"
            assert response.scopes == ["read", "write"]

    @pytest.mark.asyncio
    async def test_create_key_default_scopes(self, admin_context):
        """Test key creation with default scopes."""
        from src.api.routes.api_keys import create_key, CreateAPIKeyRequest

        request = CreateAPIKeyRequest(name="Default Scopes Key")

        with patch(
            "src.api.routes.api_keys.create_api_key",
            new_callable=AsyncMock,
            return_value=("sk_live_xyz", "key_xyz"),
        ), patch(
            "src.api.routes.api_keys.record_audit_event",
            new_callable=AsyncMock,
        ):
            response = await create_key(request, admin_context)

            # Default scopes should include read, write, mcp
            assert "read" in response.scopes
            assert "write" in response.scopes
            assert "mcp" in response.scopes

    @pytest.mark.asyncio
    async def test_create_key_invalid_scope(self, admin_context):
        """Test key creation with invalid scope."""
        from src.api.routes.api_keys import create_key, CreateAPIKeyRequest

        request = CreateAPIKeyRequest(
            name="Bad Scopes",
            scopes=["read", "invalid_scope"],
        )

        with pytest.raises(HTTPException) as exc_info:
            await create_key(request, admin_context)

        assert exc_info.value.status_code == 400
        assert "Invalid scope" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_create_key_non_admin_restricted_scopes(self, regular_context):
        """Test non-admin cannot grant admin scopes."""
        from src.api.routes.api_keys import create_key, CreateAPIKeyRequest

        request = CreateAPIKeyRequest(
            name="Escalation Attempt",
            scopes=["read", "admin"],
        )

        with pytest.raises(HTTPException) as exc_info:
            await create_key(request, regular_context)

        assert exc_info.value.status_code == 403
        assert "restricted scopes" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_create_test_key(self, admin_context):
        """Test creating a test key."""
        from src.api.routes.api_keys import create_key, CreateAPIKeyRequest

        request = CreateAPIKeyRequest(
            name="Test Environment Key",
            is_test=True,
        )

        with patch(
            "src.api.routes.api_keys.create_api_key",
            new_callable=AsyncMock,
            return_value=("sk_test_testkey123", "key_test"),
        ) as mock_create, patch(
            "src.api.routes.api_keys.record_audit_event",
            new_callable=AsyncMock,
        ):
            response = await create_key(request, admin_context)

            mock_create.assert_called_once()
            call_kwargs = mock_create.call_args
            assert call_kwargs[1]["is_test"] is True


# =============================================================================
# List Keys Endpoint Tests
# =============================================================================


class TestListKeysEndpoint:
    """Tests for the list keys endpoint."""

    @pytest.mark.asyncio
    async def test_list_keys_success(self, admin_context):
        """Test successful key listing."""
        from src.api.routes.api_keys import list_keys

        mock_keys = [
            {
                "id": "key_1",
                "key_prefix": "sk_live_",
                "name": "Key 1",
                "scopes": ["read"],
                "rate_limit_per_minute": 100,
                "created_at": datetime.utcnow(),
                "expires_at": None,
                "revoked_at": None,
                "last_used_at": None,
            },
            {
                "id": "key_2",
                "key_prefix": "sk_live_",
                "name": "Key 2",
                "scopes": ["read", "write"],
                "rate_limit_per_minute": 200,
                "created_at": datetime.utcnow(),
                "expires_at": None,
                "revoked_at": None,
                "last_used_at": datetime.utcnow(),
            },
        ]

        with patch(
            "src.api.routes.api_keys.list_api_keys",
            new_callable=AsyncMock,
            return_value=mock_keys,
        ):
            response = await list_keys(admin_context)

            assert response.total == 2
            assert len(response.items) == 2
            assert response.items[0].id == "key_1"
            assert response.items[1].id == "key_2"

    @pytest.mark.asyncio
    async def test_list_keys_empty(self, admin_context):
        """Test listing when no keys exist."""
        from src.api.routes.api_keys import list_keys

        with patch(
            "src.api.routes.api_keys.list_api_keys",
            new_callable=AsyncMock,
            return_value=[],
        ):
            response = await list_keys(admin_context)

            assert response.total == 0
            assert response.items == []


# =============================================================================
# Revoke Key Endpoint Tests
# =============================================================================


class TestRevokeKeyEndpoint:
    """Tests for the revoke key endpoint."""

    @pytest.mark.asyncio
    async def test_revoke_key_success(self, admin_context):
        """Test successful key revocation."""
        from src.api.routes.api_keys import revoke_key

        with patch(
            "src.api.routes.api_keys.revoke_api_key",
            new_callable=AsyncMock,
            return_value=True,
        ):
            response = await revoke_key("key_123", admin_context)

            assert response["status"] == "revoked"
            assert response["key_id"] == "key_123"

    @pytest.mark.asyncio
    async def test_revoke_key_not_found(self, admin_context):
        """Test revoking non-existent key."""
        from src.api.routes.api_keys import revoke_key

        with patch(
            "src.api.routes.api_keys.revoke_api_key",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await revoke_key("nonexistent", admin_context)

            assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_revoke_already_revoked(self, admin_context):
        """Test revoking already revoked key."""
        from src.api.routes.api_keys import revoke_key

        with patch(
            "src.api.routes.api_keys.revoke_api_key",
            new_callable=AsyncMock,
            return_value=False,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await revoke_key("key_already_revoked", admin_context)

            assert exc_info.value.status_code == 404
            assert "already revoked" in exc_info.value.detail.lower()


# =============================================================================
# Scopes Endpoint Tests
# =============================================================================


class TestScopesEndpoint:
    """Tests for the scopes endpoint."""

    @pytest.mark.asyncio
    async def test_get_scopes(self, regular_context):
        """Test getting available scopes."""
        from src.api.routes.api_keys import get_scopes

        response = await get_scopes(regular_context)

        assert "read" in response.available_scopes
        assert "write" in response.available_scopes
        assert "admin" in response.available_scopes
        assert "mcp" in response.available_scopes

        assert "read" in response.default_scopes
        assert "write" in response.default_scopes


# =============================================================================
# Current Key Info Endpoint Tests
# =============================================================================


class TestCurrentKeyInfoEndpoint:
    """Tests for the current key info endpoint."""

    @pytest.mark.asyncio
    async def test_get_current_key_info(self, regular_context):
        """Test getting current key info."""
        from src.api.routes.api_keys import get_current_key_info

        response = await get_current_key_info(regular_context)

        assert response["organization_id"] == "org_123"
        assert response["scopes"] == ["read", "write", "mcp", "manage:keys"]
        assert response["key_id"] == "key_user"
        assert response["key_name"] == "User Key"
        assert response["is_internal"] is False
        assert response["rate_limit_per_minute"] == 100

    @pytest.mark.asyncio
    async def test_get_current_key_info_internal(self, internal_context):
        """Test getting info for internal service key."""
        from src.api.routes.api_keys import get_current_key_info

        response = await get_current_key_info(internal_context)

        assert response["organization_id"] == "org_123"
        assert response["scopes"] == ["*"]
        assert response["key_id"] == "internal"
        assert response["is_internal"] is True


# =============================================================================
# Authorization Tests
# =============================================================================


class TestAuthorization:
    """Tests for authorization on API key endpoints."""

    @pytest.mark.asyncio
    async def test_create_requires_manage_keys_scope(self, no_manage_keys_context):
        """Test that creating keys requires manage:keys scope."""
        from src.api.routes.api_keys import create_key, CreateAPIKeyRequest
        from src.auth.middleware import require_scope

        # The require_scope dependency will raise 403 for missing scope
        check_fn = require_scope(Scope.MANAGE_KEYS)

        with pytest.raises(HTTPException) as exc_info:
            await check_fn(ctx=no_manage_keys_context)

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_list_requires_manage_keys_scope(self, no_manage_keys_context):
        """Test that listing keys requires manage:keys scope."""
        from src.auth.middleware import require_scope

        check_fn = require_scope(Scope.MANAGE_KEYS)

        with pytest.raises(HTTPException) as exc_info:
            await check_fn(ctx=no_manage_keys_context)

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_revoke_requires_manage_keys_scope(self, no_manage_keys_context):
        """Test that revoking keys requires manage:keys scope."""
        from src.auth.middleware import require_scope

        check_fn = require_scope(Scope.MANAGE_KEYS)

        with pytest.raises(HTTPException) as exc_info:
            await check_fn(ctx=no_manage_keys_context)

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_internal_has_full_access(self, internal_context):
        """Test that internal service has full access."""
        from src.auth.middleware import require_scope

        check_fn = require_scope(Scope.MANAGE_KEYS)

        # Internal service with wildcard should pass
        result = await check_fn(ctx=internal_context)
        assert result.is_internal is True


# =============================================================================
# Response Model Tests
# =============================================================================


class TestResponseModels:
    """Tests for response models."""

    def test_api_key_info_model(self):
        """Test APIKeyInfo model."""
        from src.api.routes.api_keys import APIKeyInfo

        info = APIKeyInfo(
            id="key_123",
            key_prefix="sk_live_",
            name="Test Key",
            scopes=["read", "write"],
            rate_limit_per_minute=100,
            created_at=datetime.utcnow(),
            expires_at=None,
            revoked_at=None,
            last_used_at=None,
        )

        assert info.id == "key_123"
        assert info.key_prefix == "sk_live_"
        assert info.name == "Test Key"

    def test_create_api_key_response_model(self):
        """Test CreateAPIKeyResponse model."""
        from src.api.routes.api_keys import CreateAPIKeyResponse

        response = CreateAPIKeyResponse(
            id="key_123",
            key="sk_live_fullkey123456789",
            key_prefix="sk_live_",
            name="New Key",
            scopes=["read", "write"],
            rate_limit_per_minute=100,
            expires_at=None,
            created_at=datetime.utcnow(),
        )

        assert response.id == "key_123"
        assert response.key == "sk_live_fullkey123456789"
        assert "fullkey" in response.key  # Full key is returned

    def test_scopes_response_model(self):
        """Test ScopesResponse model."""
        from src.api.routes.api_keys import ScopesResponse

        response = ScopesResponse(
            available_scopes=["read", "write", "admin"],
            default_scopes=["read", "write"],
        )

        assert len(response.available_scopes) == 3
        assert len(response.default_scopes) == 2
