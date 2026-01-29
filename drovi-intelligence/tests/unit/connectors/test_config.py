"""
Unit tests for Connector Configuration Classes.

Tests ConnectorConfig, AuthConfig, and StreamConfig.
"""

import pytest
from datetime import datetime, timedelta

from src.connectors.base.config import (
    AuthConfig,
    AuthType,
    ConnectorConfig,
    StreamConfig,
    SyncMode,
)

pytestmark = pytest.mark.unit


# =============================================================================
# AuthType Tests
# =============================================================================


class TestAuthType:
    """Tests for AuthType enum."""

    def test_oauth2_value(self):
        """Test OAuth2 enum value."""
        assert AuthType.OAUTH2.value == "oauth2"

    def test_api_key_value(self):
        """Test API key enum value."""
        assert AuthType.API_KEY.value == "api_key"

    def test_basic_value(self):
        """Test basic auth enum value."""
        assert AuthType.BASIC.value == "basic"

    def test_none_value(self):
        """Test none auth enum value."""
        assert AuthType.NONE.value == "none"

    def test_auth_types_are_strings(self):
        """Test all auth types are strings."""
        for auth_type in AuthType:
            assert isinstance(auth_type.value, str)


# =============================================================================
# SyncMode Tests
# =============================================================================


class TestSyncMode:
    """Tests for SyncMode enum."""

    def test_full_refresh_value(self):
        """Test full refresh enum value."""
        assert SyncMode.FULL_REFRESH.value == "full_refresh"

    def test_incremental_value(self):
        """Test incremental enum value."""
        assert SyncMode.INCREMENTAL.value == "incremental"


# =============================================================================
# AuthConfig Tests
# =============================================================================


class TestAuthConfig:
    """Tests for AuthConfig model."""

    def test_default_auth_type(self):
        """Test default auth type is OAuth2."""
        config = AuthConfig()

        assert config.auth_type == AuthType.OAUTH2

    def test_oauth2_config(self):
        """Test OAuth2 configuration."""
        expires_at = datetime.utcnow() + timedelta(hours=1)
        config = AuthConfig(
            auth_type=AuthType.OAUTH2,
            access_token="access_123",
            refresh_token="refresh_456",
            token_expires_at=expires_at,
            scopes=["read", "write"],
        )

        assert config.auth_type == AuthType.OAUTH2
        assert config.access_token == "access_123"
        assert config.refresh_token == "refresh_456"
        assert config.token_expires_at == expires_at
        assert config.scopes == ["read", "write"]

    def test_api_key_config(self):
        """Test API key configuration."""
        config = AuthConfig(
            auth_type=AuthType.API_KEY,
            api_key="key_123",
            api_secret="secret_456",
        )

        assert config.auth_type == AuthType.API_KEY
        assert config.api_key == "key_123"
        assert config.api_secret == "secret_456"

    def test_basic_auth_config(self):
        """Test basic auth configuration."""
        config = AuthConfig(
            auth_type=AuthType.BASIC,
            username="user",
            password="pass",
        )

        assert config.auth_type == AuthType.BASIC
        assert config.username == "user"
        assert config.password == "pass"

    def test_extra_fields(self):
        """Test extra fields are allowed."""
        config = AuthConfig(
            auth_type=AuthType.OAUTH2,
            extra={"tenant_id": "tenant_123"},
        )

        assert config.extra["tenant_id"] == "tenant_123"

    def test_empty_scopes_default(self):
        """Test scopes default to empty list."""
        config = AuthConfig()

        assert config.scopes == []

    def test_none_fields_default(self):
        """Test optional fields default to None."""
        config = AuthConfig()

        assert config.access_token is None
        assert config.refresh_token is None
        assert config.api_key is None


# =============================================================================
# StreamConfig Tests
# =============================================================================


class TestStreamConfig:
    """Tests for StreamConfig model."""

    def test_required_stream_name(self):
        """Test stream_name is required."""
        config = StreamConfig(stream_name="messages")

        assert config.stream_name == "messages"

    def test_default_enabled(self):
        """Test default enabled is True."""
        config = StreamConfig(stream_name="messages")

        assert config.enabled is True

    def test_default_sync_mode(self):
        """Test default sync mode is incremental."""
        config = StreamConfig(stream_name="messages")

        assert config.sync_mode == SyncMode.INCREMENTAL

    def test_full_refresh_mode(self):
        """Test full refresh sync mode."""
        config = StreamConfig(
            stream_name="messages",
            sync_mode=SyncMode.FULL_REFRESH,
        )

        assert config.sync_mode == SyncMode.FULL_REFRESH

    def test_cursor_field(self):
        """Test cursor field configuration."""
        config = StreamConfig(
            stream_name="messages",
            cursor_field="updated_at",
        )

        assert config.cursor_field == "updated_at"

    def test_primary_key(self):
        """Test primary key configuration."""
        config = StreamConfig(
            stream_name="messages",
            primary_key=["id", "thread_id"],
        )

        assert config.primary_key == ["id", "thread_id"]

    def test_default_batch_size(self):
        """Test default batch size."""
        config = StreamConfig(stream_name="messages")

        assert config.batch_size == 100

    def test_custom_batch_size(self):
        """Test custom batch size."""
        config = StreamConfig(
            stream_name="messages",
            batch_size=50,
        )

        assert config.batch_size == 50

    def test_max_records_limit(self):
        """Test max records limit for testing."""
        config = StreamConfig(
            stream_name="messages",
            max_records=1000,
        )

        assert config.max_records == 1000

    def test_json_schema(self):
        """Test JSON schema configuration."""
        schema = {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "content": {"type": "string"},
            },
        }
        config = StreamConfig(
            stream_name="messages",
            json_schema=schema,
        )

        assert config.json_schema == schema


# =============================================================================
# ConnectorConfig Tests
# =============================================================================


class TestConnectorConfig:
    """Tests for ConnectorConfig model."""

    @pytest.fixture
    def basic_config(self):
        """Create a basic connector config."""
        return ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="My Gmail",
            auth=AuthConfig(
                auth_type=AuthType.OAUTH2,
                access_token="token_123",
            ),
        )

    def test_required_fields(self, basic_config):
        """Test required fields are set."""
        assert basic_config.connection_id == "conn_123"
        assert basic_config.organization_id == "org_456"
        assert basic_config.connector_type == "gmail"
        assert basic_config.name == "My Gmail"

    def test_default_status(self, basic_config):
        """Test default status is pending_auth."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(),
        )

        assert config.status == "pending_auth"

    def test_default_sync_mode(self, basic_config):
        """Test default sync mode."""
        assert basic_config.default_sync_mode == SyncMode.INCREMENTAL

    def test_default_sync_frequency(self, basic_config):
        """Test default sync frequency."""
        assert basic_config.sync_frequency_minutes == 5

    def test_empty_streams_default(self, basic_config):
        """Test streams default to empty list."""
        assert basic_config.streams == []

    def test_with_streams(self):
        """Test configuration with streams."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(
                auth_type=AuthType.OAUTH2,
                access_token="token",
            ),
            streams=[
                StreamConfig(stream_name="messages", enabled=True),
                StreamConfig(stream_name="threads", enabled=False),
            ],
        )

        assert len(config.streams) == 2

    def test_get_enabled_streams(self):
        """Test get_enabled_streams returns only enabled streams."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(auth_type=AuthType.OAUTH2, access_token="token"),
            streams=[
                StreamConfig(stream_name="messages", enabled=True),
                StreamConfig(stream_name="threads", enabled=False),
                StreamConfig(stream_name="labels", enabled=True),
            ],
        )

        enabled = config.get_enabled_streams()

        assert len(enabled) == 2
        assert enabled[0].stream_name == "messages"
        assert enabled[1].stream_name == "labels"

    def test_get_enabled_streams_none_enabled(self):
        """Test get_enabled_streams with all disabled."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(auth_type=AuthType.OAUTH2, access_token="token"),
            streams=[
                StreamConfig(stream_name="messages", enabled=False),
            ],
        )

        enabled = config.get_enabled_streams()

        assert enabled == []

    def test_get_stream_by_name(self):
        """Test get_stream returns stream by name."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(auth_type=AuthType.OAUTH2, access_token="token"),
            streams=[
                StreamConfig(stream_name="messages"),
                StreamConfig(stream_name="threads"),
            ],
        )

        stream = config.get_stream("messages")

        assert stream is not None
        assert stream.stream_name == "messages"

    def test_get_stream_not_found(self):
        """Test get_stream returns None for unknown stream."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(auth_type=AuthType.OAUTH2, access_token="token"),
        )

        stream = config.get_stream("nonexistent")

        assert stream is None

    def test_is_authenticated_oauth2_with_token(self):
        """Test is_authenticated for OAuth2 with token."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(
                auth_type=AuthType.OAUTH2,
                access_token="token_123",
            ),
        )

        assert config.is_authenticated is True

    def test_is_authenticated_oauth2_without_token(self):
        """Test is_authenticated for OAuth2 without token."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(auth_type=AuthType.OAUTH2),
        )

        assert config.is_authenticated is False

    def test_is_authenticated_api_key_with_key(self):
        """Test is_authenticated for API key with key."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="custom",
            name="Test",
            auth=AuthConfig(
                auth_type=AuthType.API_KEY,
                api_key="key_123",
            ),
        )

        assert config.is_authenticated is True

    def test_is_authenticated_api_key_without_key(self):
        """Test is_authenticated for API key without key."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="custom",
            name="Test",
            auth=AuthConfig(auth_type=AuthType.API_KEY),
        )

        assert config.is_authenticated is False

    def test_is_authenticated_basic_complete(self):
        """Test is_authenticated for basic auth with credentials."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="custom",
            name="Test",
            auth=AuthConfig(
                auth_type=AuthType.BASIC,
                username="user",
                password="pass",
            ),
        )

        assert config.is_authenticated is True

    def test_is_authenticated_basic_incomplete(self):
        """Test is_authenticated for basic auth without password."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="custom",
            name="Test",
            auth=AuthConfig(
                auth_type=AuthType.BASIC,
                username="user",
            ),
        )

        assert config.is_authenticated is False

    def test_is_authenticated_none(self):
        """Test is_authenticated for no auth required."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="custom",
            name="Test",
            auth=AuthConfig(auth_type=AuthType.NONE),
        )

        assert config.is_authenticated is True

    def test_token_needs_refresh_not_oauth(self):
        """Test token_needs_refresh returns False for non-OAuth."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="custom",
            name="Test",
            auth=AuthConfig(auth_type=AuthType.API_KEY, api_key="key"),
        )

        assert config.token_needs_refresh is False

    def test_token_needs_refresh_no_expiry(self):
        """Test token_needs_refresh returns False without expiry."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(
                auth_type=AuthType.OAUTH2,
                access_token="token",
            ),
        )

        assert config.token_needs_refresh is False

    def test_token_needs_refresh_not_expired(self):
        """Test token_needs_refresh returns False when not expired."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(
                auth_type=AuthType.OAUTH2,
                access_token="token",
                token_expires_at=datetime.utcnow() + timedelta(hours=1),
            ),
        )

        assert config.token_needs_refresh is False

    def test_token_needs_refresh_within_5_minutes(self):
        """Test token_needs_refresh returns True within 5 minutes of expiry."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(
                auth_type=AuthType.OAUTH2,
                access_token="token",
                token_expires_at=datetime.utcnow() + timedelta(minutes=3),
            ),
        )

        assert config.token_needs_refresh is True

    def test_token_needs_refresh_expired(self):
        """Test token_needs_refresh returns True when expired."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(
                auth_type=AuthType.OAUTH2,
                access_token="token",
                token_expires_at=datetime.utcnow() - timedelta(hours=1),
            ),
        )

        assert config.token_needs_refresh is True

    def test_backfill_settings(self):
        """Test backfill configuration."""
        backfill_date = datetime(2024, 1, 1)
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(auth_type=AuthType.OAUTH2, access_token="token"),
            backfill_start_date=backfill_date,
            backfill_enabled=True,
        )

        assert config.backfill_start_date == backfill_date
        assert config.backfill_enabled is True

    def test_provider_config(self):
        """Test provider-specific configuration."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(auth_type=AuthType.OAUTH2, access_token="token"),
            provider_config={
                "user_email": "user@example.com",
                "label_filter": "INBOX",
            },
        )

        assert config.provider_config["user_email"] == "user@example.com"
        assert config.provider_config["label_filter"] == "INBOX"

    def test_timestamps_set(self):
        """Test timestamps are set automatically."""
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="gmail",
            name="Test",
            auth=AuthConfig(auth_type=AuthType.OAUTH2, access_token="token"),
        )

        assert config.created_at is not None
        assert config.updated_at is not None
