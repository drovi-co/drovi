"""
Unit tests for API Key management.

Tests key generation, hashing, and validation.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from src.auth.api_key import (
    generate_api_key,
    hash_api_key,
    validate_api_key,
    create_api_key,
    revoke_api_key,
    list_api_keys,
    KEY_PREFIX_LIVE,
    KEY_PREFIX_TEST,
)

pytestmark = pytest.mark.unit


# =============================================================================
# Key Generation Tests
# =============================================================================


class TestGenerateAPIKey:
    """Tests for API key generation."""

    def test_generate_live_key(self):
        """Test generating a live API key."""
        full_key, key_prefix, key_hash = generate_api_key(is_test=False)

        assert full_key.startswith(KEY_PREFIX_LIVE)
        assert key_prefix == full_key[:8]
        assert len(key_hash) == 64  # SHA-256 hex

    def test_generate_test_key(self):
        """Test generating a test API key."""
        full_key, key_prefix, key_hash = generate_api_key(is_test=True)

        assert full_key.startswith(KEY_PREFIX_TEST)
        assert key_prefix == full_key[:8]

    def test_generate_unique_keys(self):
        """Test that generated keys are unique."""
        keys = set()
        for _ in range(100):
            full_key, _, _ = generate_api_key()
            keys.add(full_key)

        assert len(keys) == 100

    def test_key_prefix_identification(self):
        """Test that key prefix allows identification."""
        full_key, key_prefix, _ = generate_api_key()

        assert full_key.startswith(key_prefix)
        assert len(key_prefix) == 8


# =============================================================================
# Key Hashing Tests
# =============================================================================


class TestHashAPIKey:
    """Tests for API key hashing."""

    def test_hash_produces_sha256(self):
        """Test that hash produces SHA-256 output."""
        key_hash = hash_api_key("sk_live_test123")

        assert len(key_hash) == 64
        assert all(c in "0123456789abcdef" for c in key_hash)

    def test_hash_is_consistent(self):
        """Test that same key produces same hash."""
        key = "sk_live_test123"

        hash1 = hash_api_key(key)
        hash2 = hash_api_key(key)

        assert hash1 == hash2

    def test_different_keys_different_hashes(self):
        """Test that different keys produce different hashes."""
        hash1 = hash_api_key("sk_live_key1")
        hash2 = hash_api_key("sk_live_key2")

        assert hash1 != hash2


# =============================================================================
# Key Validation Tests
# =============================================================================


class TestValidateAPIKey:
    """Tests for API key validation."""

    @pytest.mark.asyncio
    async def test_validate_valid_key(self):
        """Test validating a valid API key."""
        with patch("src.db.client.get_db_pool") as mock_pool:
            mock_conn = AsyncMock()
            mock_conn.fetchrow.return_value = {
                "id": "key_123",
                "organization_id": "org_456",
                "scopes": ["read", "write"],
                "rate_limit_per_minute": 100,
                "expires_at": None,
                "revoked_at": None,
                "name": "Test Key",
                "last_used_at": None,
            }
            mock_conn.execute.return_value = None

            # Create async context manager mock for pool.acquire()
            mock_acquire_cm = MagicMock()
            mock_acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acquire_cm.__aexit__ = AsyncMock(return_value=None)

            mock_pool_instance = MagicMock()
            mock_pool_instance.acquire.return_value = mock_acquire_cm
            mock_pool.return_value = mock_pool_instance

            result = await validate_api_key("sk_live_validkey123")

            assert result is not None
            assert result.id == "key_123"
            assert result.organization_id == "org_456"
            assert result.scopes == ["read", "write"]

    @pytest.mark.asyncio
    async def test_validate_invalid_format(self):
        """Test validating key with invalid format."""
        result = await validate_api_key("invalid_key_format")

        assert result is None

    @pytest.mark.asyncio
    async def test_validate_empty_key(self):
        """Test validating empty key."""
        result = await validate_api_key("")

        assert result is None

    @pytest.mark.asyncio
    async def test_validate_none_key(self):
        """Test validating None key."""
        result = await validate_api_key(None)

        assert result is None

    @pytest.mark.asyncio
    async def test_validate_key_not_found(self):
        """Test validating key not in database."""
        with patch("src.db.client.get_db_pool") as mock_pool:
            mock_conn = AsyncMock()
            mock_conn.fetchrow.return_value = None

            mock_acquire_cm = MagicMock()
            mock_acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acquire_cm.__aexit__ = AsyncMock(return_value=None)

            mock_pool_instance = MagicMock()
            mock_pool_instance.acquire.return_value = mock_acquire_cm
            mock_pool.return_value = mock_pool_instance

            result = await validate_api_key("sk_live_notfound123")

            assert result is None

    @pytest.mark.asyncio
    async def test_validate_updates_last_used(self):
        """Test that validation updates last_used_at."""
        with patch("src.db.client.get_db_pool") as mock_pool:
            mock_conn = AsyncMock()
            mock_conn.fetchrow.return_value = {
                "id": "key_123",
                "organization_id": "org_456",
                "scopes": [],
                "rate_limit_per_minute": 100,
                "expires_at": None,
                "revoked_at": None,
                "name": "Test Key",
                "last_used_at": None,
            }
            mock_conn.execute.return_value = None

            mock_acquire_cm = MagicMock()
            mock_acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acquire_cm.__aexit__ = AsyncMock(return_value=None)

            mock_pool_instance = MagicMock()
            mock_pool_instance.acquire.return_value = mock_acquire_cm
            mock_pool.return_value = mock_pool_instance

            await validate_api_key("sk_live_validkey123")

            # Should have called UPDATE for last_used_at
            mock_conn.execute.assert_called_once()
            assert "last_used_at" in str(mock_conn.execute.call_args)


# =============================================================================
# Key Creation Tests
# =============================================================================


class TestCreateAPIKey:
    """Tests for API key creation."""

    @pytest.mark.asyncio
    async def test_create_key(self):
        """Test creating a new API key."""
        with patch("src.db.client.get_db_pool") as mock_pool:
            mock_conn = AsyncMock()
            mock_conn.fetchval.return_value = "key_123"

            mock_acquire_cm = MagicMock()
            mock_acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acquire_cm.__aexit__ = AsyncMock(return_value=None)

            mock_pool_instance = MagicMock()
            mock_pool_instance.acquire.return_value = mock_acquire_cm
            mock_pool.return_value = mock_pool_instance

            full_key, key_id = await create_api_key(
                organization_id="org_456",
                name="Test Key",
            )

            assert full_key.startswith(KEY_PREFIX_LIVE)
            assert key_id == "key_123"

    @pytest.mark.asyncio
    async def test_create_test_key(self):
        """Test creating a test API key."""
        with patch("src.db.client.get_db_pool") as mock_pool:
            mock_conn = AsyncMock()
            mock_conn.fetchval.return_value = "key_123"

            mock_acquire_cm = MagicMock()
            mock_acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acquire_cm.__aexit__ = AsyncMock(return_value=None)

            mock_pool_instance = MagicMock()
            mock_pool_instance.acquire.return_value = mock_acquire_cm
            mock_pool.return_value = mock_pool_instance

            full_key, _ = await create_api_key(
                organization_id="org_456",
                name="Test Key",
                is_test=True,
            )

            assert full_key.startswith(KEY_PREFIX_TEST)

    @pytest.mark.asyncio
    async def test_create_key_with_custom_scopes(self):
        """Test creating key with custom scopes."""
        with patch("src.db.client.get_db_pool") as mock_pool:
            mock_conn = AsyncMock()
            mock_conn.fetchval.return_value = "key_123"

            mock_acquire_cm = MagicMock()
            mock_acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acquire_cm.__aexit__ = AsyncMock(return_value=None)

            mock_pool_instance = MagicMock()
            mock_pool_instance.acquire.return_value = mock_acquire_cm
            mock_pool.return_value = mock_pool_instance

            await create_api_key(
                organization_id="org_456",
                name="Admin Key",
                scopes=["admin"],
            )

            # Check that scopes were passed to INSERT
            call_args = mock_conn.fetchval.call_args
            assert ["admin"] in call_args[0]

    @pytest.mark.asyncio
    async def test_create_key_with_expiry(self):
        """Test creating key with expiration."""
        with patch("src.db.client.get_db_pool") as mock_pool:
            mock_conn = AsyncMock()
            mock_conn.fetchval.return_value = "key_123"

            mock_acquire_cm = MagicMock()
            mock_acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acquire_cm.__aexit__ = AsyncMock(return_value=None)

            mock_pool_instance = MagicMock()
            mock_pool_instance.acquire.return_value = mock_acquire_cm
            mock_pool.return_value = mock_pool_instance

            expires_at = datetime.utcnow() + timedelta(days=30)

            await create_api_key(
                organization_id="org_456",
                name="Temp Key",
                expires_at=expires_at,
            )

            call_args = mock_conn.fetchval.call_args
            assert expires_at in call_args[0]


# =============================================================================
# Key Revocation Tests
# =============================================================================


class TestRevokeAPIKey:
    """Tests for API key revocation."""

    @pytest.mark.asyncio
    async def test_revoke_key(self):
        """Test revoking an API key."""
        with patch("src.db.client.get_db_pool") as mock_pool:
            mock_conn = AsyncMock()
            mock_conn.execute.return_value = "UPDATE 1"

            mock_acquire_cm = MagicMock()
            mock_acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acquire_cm.__aexit__ = AsyncMock(return_value=None)

            mock_pool_instance = MagicMock()
            mock_pool_instance.acquire.return_value = mock_acquire_cm
            mock_pool.return_value = mock_pool_instance

            result = await revoke_api_key("key_123", "org_456")

            assert result is True

    @pytest.mark.asyncio
    async def test_revoke_nonexistent_key(self):
        """Test revoking a key that doesn't exist."""
        with patch("src.db.client.get_db_pool") as mock_pool:
            mock_conn = AsyncMock()
            mock_conn.execute.return_value = "UPDATE 0"

            mock_acquire_cm = MagicMock()
            mock_acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acquire_cm.__aexit__ = AsyncMock(return_value=None)

            mock_pool_instance = MagicMock()
            mock_pool_instance.acquire.return_value = mock_acquire_cm
            mock_pool.return_value = mock_pool_instance

            result = await revoke_api_key("nonexistent", "org_456")

            assert result is False

    @pytest.mark.asyncio
    async def test_revoke_already_revoked(self):
        """Test revoking an already revoked key."""
        with patch("src.db.client.get_db_pool") as mock_pool:
            mock_conn = AsyncMock()
            mock_conn.execute.return_value = "UPDATE 0"

            mock_acquire_cm = MagicMock()
            mock_acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acquire_cm.__aexit__ = AsyncMock(return_value=None)

            mock_pool_instance = MagicMock()
            mock_pool_instance.acquire.return_value = mock_acquire_cm
            mock_pool.return_value = mock_pool_instance

            result = await revoke_api_key("key_123", "org_456")

            assert result is False


# =============================================================================
# Key Listing Tests
# =============================================================================


class TestListAPIKeys:
    """Tests for listing API keys."""

    @pytest.mark.asyncio
    async def test_list_keys(self):
        """Test listing API keys for an organization."""
        with patch("src.db.client.get_db_pool") as mock_pool:
            mock_conn = AsyncMock()
            mock_conn.fetch.return_value = [
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
                    "last_used_at": None,
                },
            ]

            mock_acquire_cm = MagicMock()
            mock_acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acquire_cm.__aexit__ = AsyncMock(return_value=None)

            mock_pool_instance = MagicMock()
            mock_pool_instance.acquire.return_value = mock_acquire_cm
            mock_pool.return_value = mock_pool_instance

            result = await list_api_keys("org_456")

            assert len(result) == 2
            assert result[0]["id"] == "key_1"
            assert result[1]["id"] == "key_2"

    @pytest.mark.asyncio
    async def test_list_keys_empty(self):
        """Test listing keys when none exist."""
        with patch("src.db.client.get_db_pool") as mock_pool:
            mock_conn = AsyncMock()
            mock_conn.fetch.return_value = []

            mock_acquire_cm = MagicMock()
            mock_acquire_cm.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_acquire_cm.__aexit__ = AsyncMock(return_value=None)

            mock_pool_instance = MagicMock()
            mock_pool_instance.acquire.return_value = mock_acquire_cm
            mock_pool.return_value = mock_pool_instance

            result = await list_api_keys("org_456")

            assert result == []
