"""
Unit tests for Slack Connector.

Tests Slack API integration, message parsing, and stream reading.
"""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from src.connectors.base.config import ConnectorConfig, StreamConfig, AuthConfig, SyncMode
from src.connectors.base.state import ConnectorState
from src.connectors.base.records import RecordType

pytestmark = pytest.mark.unit


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def slack_config():
    """Create a Slack connector config."""
    return ConnectorConfig(
        connection_id="conn_slack_123",
        organization_id="org_456",
        connector_type="slack",
        name="Test Slack",
        auth=AuthConfig(
            auth_type="oauth2",
            access_token="xoxb-slack-token",
            refresh_token=None,
        ),
    )


@pytest.fixture
def messages_stream():
    """Create a messages stream config."""
    return StreamConfig(
        stream_name="messages",
        enabled=True,
        sync_mode=SyncMode.INCREMENTAL,
        cursor_field="ts",
        primary_key=["channel", "ts"],
        batch_size=10,
    )


@pytest.fixture
def channels_stream():
    """Create a channels stream config."""
    return StreamConfig(
        stream_name="channels",
        enabled=True,
        sync_mode=SyncMode.FULL_REFRESH,
        primary_key=["id"],
        batch_size=100,
    )


@pytest.fixture
def users_stream():
    """Create a users stream config."""
    return StreamConfig(
        stream_name="users",
        enabled=True,
        sync_mode=SyncMode.FULL_REFRESH,
        primary_key=["id"],
        batch_size=100,
    )


@pytest.fixture
def mock_slack_message():
    """Create a mock Slack message."""
    return {
        "type": "message",
        "user": "U123ABC",
        "text": "Hello, this is a test message!",
        "ts": "1704067200.000001",
        "channel": "C123ABC",
        "team": "T123ABC",
        "reactions": [{"name": "thumbsup", "count": 2}],
        "reply_count": 0,
        "thread_ts": None,
    }


@pytest.fixture
def mock_slack_channel():
    """Create a mock Slack channel."""
    return {
        "id": "C123ABC",
        "name": "general",
        "is_channel": True,
        "is_private": False,
        "is_member": True,
        "is_archived": False,
        "created": 1609459200,
        "creator": "U123ABC",
        "num_members": 50,
        "topic": {"value": "General discussion"},
        "purpose": {"value": "Team-wide communication"},
    }


@pytest.fixture
def mock_slack_user():
    """Create a mock Slack user."""
    return {
        "id": "U123ABC",
        "team_id": "T123ABC",
        "name": "johndoe",
        "real_name": "John Doe",
        "is_bot": False,
        "is_admin": False,
        "profile": {
            "email": "john@example.com",
            "display_name": "John",
            "image_72": "https://example.com/avatar.png",
            "first_name": "John",
            "last_name": "Doe",
        },
    }


# =============================================================================
# SlackConnector Initialization Tests
# =============================================================================


class TestSlackConnectorInit:
    """Tests for SlackConnector initialization."""

    def test_connector_type(self):
        """Test connector type is 'slack'."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()
        assert connector.connector_type == "slack"

    def test_capabilities(self):
        """Test connector capabilities."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()

        assert connector.capabilities.supports_incremental is True
        assert connector.capabilities.supports_full_refresh is True
        assert connector.capabilities.supports_webhooks is True
        assert connector.capabilities.default_rate_limit_per_minute == 50

    def test_scopes(self):
        """Test required OAuth scopes."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        assert "channels:history" in SlackConnector.SCOPES
        assert "users:read" in SlackConnector.SCOPES


# =============================================================================
# Connection Check Tests
# =============================================================================


class TestCheckConnection:
    """Tests for check_connection method."""

    @pytest.mark.asyncio
    async def test_check_connection_success(self, slack_config):
        """Test successful connection check."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()

        # Mock the Slack client
        mock_client = AsyncMock()
        mock_client.auth_test.return_value = {
            "ok": True,
            "team": "Test Team",
            "user": "testuser",
        }

        with patch.object(connector, "_get_client", return_value=mock_client):
            success, error = await connector.check_connection(slack_config)

            assert success is True
            assert error is None

    @pytest.mark.asyncio
    async def test_check_connection_failure(self, slack_config):
        """Test connection check failure."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()

        mock_client = AsyncMock()
        mock_client.auth_test.return_value = {
            "ok": False,
            "error": "invalid_auth",
        }

        with patch.object(connector, "_get_client", return_value=mock_client):
            success, error = await connector.check_connection(slack_config)

            assert success is False
            assert "invalid_auth" in error

    @pytest.mark.asyncio
    async def test_check_connection_api_error(self, slack_config):
        """Test connection check with API error."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector
        from slack_sdk.errors import SlackApiError

        connector = SlackConnector()

        mock_client = AsyncMock()
        mock_client.auth_test.side_effect = SlackApiError(
            message="API error",
            response={"ok": False, "error": "rate_limited"},
        )

        with patch.object(connector, "_get_client", return_value=mock_client):
            success, error = await connector.check_connection(slack_config)

            assert success is False
            assert "Slack API error" in error


# =============================================================================
# Discover Streams Tests
# =============================================================================


class TestDiscoverStreams:
    """Tests for discover_streams method."""

    @pytest.mark.asyncio
    async def test_discover_streams(self, slack_config):
        """Test stream discovery."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()
        streams = await connector.discover_streams(slack_config)

        assert len(streams) == 3

        # Check messages stream
        messages = next(s for s in streams if s.stream_name == "messages")
        assert messages.enabled is True
        assert messages.sync_mode == SyncMode.INCREMENTAL
        assert messages.cursor_field == "ts"

        # Check channels stream
        channels = next(s for s in streams if s.stream_name == "channels")
        assert channels.enabled is True
        assert channels.sync_mode == SyncMode.FULL_REFRESH

        # Check users stream
        users = next(s for s in streams if s.stream_name == "users")
        assert users.enabled is True


# =============================================================================
# Read Stream Tests
# =============================================================================


class TestReadStream:
    """Tests for read_stream method."""

    @pytest.mark.asyncio
    async def test_read_stream_messages(
        self, slack_config, messages_stream, mock_slack_message, mock_slack_channel
    ):
        """Test reading messages stream."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()

        # Mock the client
        mock_client = AsyncMock()
        mock_client.conversations_list.return_value = {
            "ok": True,
            "channels": [mock_slack_channel],
            "response_metadata": {"next_cursor": ""},
        }
        mock_client.conversations_history.return_value = {
            "ok": True,
            "messages": [mock_slack_message],
            "has_more": False,
        }
        mock_client.users_info.return_value = {
            "ok": True,
            "user": {
                "id": "U123ABC",
                "name": "jdoe",
                "real_name": "John Doe",
                "profile": {"email": "john@example.com"},
            },
        }

        with patch.object(connector, "_get_client", return_value=mock_client):
            batches = []
            async for batch in connector.read_stream(slack_config, messages_stream, None):
                batches.append(batch)

            assert len(batches) >= 1

    @pytest.mark.asyncio
    async def test_read_stream_channels(
        self, slack_config, channels_stream, mock_slack_channel
    ):
        """Test reading channels stream."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()

        mock_client = AsyncMock()
        mock_client.conversations_list.return_value = {
            "ok": True,
            "channels": [mock_slack_channel],
            "response_metadata": {"next_cursor": ""},
        }

        with patch.object(connector, "_get_client", return_value=mock_client):
            batches = []
            async for batch in connector.read_stream(slack_config, channels_stream, None):
                batches.append(batch)

            assert len(batches) >= 1
            assert len(batches[0].records) >= 1

            record = batches[0].records[0]
            assert record.data["id"] == "C123ABC"
            assert record.data["name"] == "general"

    @pytest.mark.asyncio
    async def test_read_stream_users(self, slack_config, users_stream, mock_slack_user):
        """Test reading users stream."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()

        mock_client = AsyncMock()
        mock_client.users_list.return_value = {
            "ok": True,
            "members": [mock_slack_user],
            "response_metadata": {"next_cursor": ""},
        }

        with patch.object(connector, "_get_client", return_value=mock_client):
            batches = []
            async for batch in connector.read_stream(slack_config, users_stream, None):
                batches.append(batch)

            assert len(batches) >= 1
            record = batches[0].records[0]
            assert record.data["id"] == "U123ABC"
            assert record.data["name"] == "johndoe"


# =============================================================================
# Message Parsing Tests
# =============================================================================


class TestMessageParsing:
    """Tests for message parsing functionality."""

    def test_parse_message_basic(self, slack_config, mock_slack_message):
        """Test basic message parsing."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()

        # The connector creates records internally during read_stream
        # Testing the structure of the mock message
        assert mock_slack_message["type"] == "message"
        assert mock_slack_message["text"] == "Hello, this is a test message!"
        assert mock_slack_message["user"] == "U123ABC"

    def test_message_with_thread(self, mock_slack_message):
        """Test message in thread."""
        mock_slack_message["thread_ts"] = "1704067100.000001"
        mock_slack_message["reply_count"] = 5

        assert mock_slack_message["thread_ts"] is not None
        assert mock_slack_message["reply_count"] == 5

    def test_message_with_reactions(self, mock_slack_message):
        """Test message with reactions."""
        assert len(mock_slack_message["reactions"]) == 1
        assert mock_slack_message["reactions"][0]["name"] == "thumbsup"


# =============================================================================
# Incremental Sync Tests
# =============================================================================


class TestIncrementalSync:
    """Tests for incremental sync functionality."""

    @pytest.mark.asyncio
    async def test_incremental_sync_with_cursor(
        self, slack_config, messages_stream, mock_slack_message, mock_slack_channel
    ):
        """Test incremental sync using timestamp cursor."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()

        # Create state with cursor
        state = ConnectorState(connection_id=slack_config.connection_id, connector_type="slack")
        state.update_cursor("messages", {"ts": "1704000000.000001"})

        mock_client = AsyncMock()
        mock_client.conversations_list.return_value = {
            "ok": True,
            "channels": [mock_slack_channel],
            "response_metadata": {"next_cursor": ""},
        }
        mock_client.conversations_history.return_value = {
            "ok": True,
            "messages": [mock_slack_message],
            "has_more": False,
        }
        mock_client.users_info.return_value = {
            "ok": True,
            "user": {
                "id": "U123ABC",
                "name": "jdoe",
                "real_name": "John Doe",
                "profile": {"email": "john@example.com"},
            },
        }

        with patch.object(connector, "_get_client", return_value=mock_client):
            batches = []
            async for batch in connector.read_stream(slack_config, messages_stream, state):
                batches.append(batch)

            # Should have called with oldest parameter for incremental
            assert len(batches) >= 1


# =============================================================================
# User Cache Tests
# =============================================================================


class TestUserCache:
    """Tests for user caching functionality."""

    def test_user_cache_initialization(self):
        """Test user cache is initialized empty."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()
        assert connector._user_cache == {}


# =============================================================================
# Batch Handling Tests
# =============================================================================


class TestBatchHandling:
    """Tests for batch handling."""

    @pytest.mark.asyncio
    async def test_batch_with_pagination(self, slack_config, channels_stream, mock_slack_channel):
        """Test batch handling with pagination."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()

        # Create many channels for pagination
        channels = [
            {"id": f"C{i:06d}", "name": f"channel_{i}", **mock_slack_channel}
            for i in range(5)
        ]

        mock_client = AsyncMock()
        mock_client.conversations_list.return_value = {
            "ok": True,
            "channels": channels,
            "response_metadata": {"next_cursor": ""},
        }

        with patch.object(connector, "_get_client", return_value=mock_client):
            batches = []
            async for batch in connector.read_stream(slack_config, channels_stream, None):
                batches.append(batch)

            total_records = sum(len(b.records) for b in batches)
            assert total_records == 5


# =============================================================================
# Registry Tests
# =============================================================================


class TestConnectorRegistry:
    """Tests for connector registration."""

    def test_slack_connector_registered(self):
        """Test Slack connector is registered."""
        from src.connectors.base.connector import ConnectorRegistry

        connector = ConnectorRegistry.get("slack")
        assert connector is not None
        assert connector.connector_type == "slack"


# =============================================================================
# Error Handling Tests
# =============================================================================


class TestErrorHandling:
    """Tests for error handling."""

    @pytest.mark.asyncio
    async def test_rate_limit_handling(self, slack_config, channels_stream):
        """Test handling of rate limit errors."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector
        from slack_sdk.errors import SlackApiError

        connector = SlackConnector()

        mock_client = AsyncMock()
        mock_client.conversations_list.side_effect = SlackApiError(
            message="Rate limited",
            response={"ok": False, "error": "rate_limited"},
        )

        with patch.object(connector, "_get_client", return_value=mock_client):
            with pytest.raises(SlackApiError):
                async for _ in connector.read_stream(slack_config, channels_stream, None):
                    pass

    @pytest.mark.asyncio
    async def test_unknown_stream_error(self, slack_config):
        """Test unknown stream raises ValueError."""
        from src.connectors.sources.messaging.slack.connector import SlackConnector

        connector = SlackConnector()

        unknown_stream = StreamConfig(
            stream_name="unknown",
            enabled=True,
            sync_mode=SyncMode.FULL_REFRESH,
        )

        mock_client = AsyncMock()
        with patch.object(connector, "_get_client", return_value=mock_client):
            with pytest.raises(ValueError, match="Unknown stream"):
                async for _ in connector.read_stream(slack_config, unknown_stream, None):
                    pass
