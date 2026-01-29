"""
Unit tests for Gmail Connector.

Tests Gmail API integration, message parsing, and stream reading.
"""

import pytest
import base64
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
def gmail_config():
    """Create a Gmail connector config."""
    return ConnectorConfig(
        connection_id="conn_gmail_123",
        organization_id="org_456",
        connector_type="gmail",
        name="Test Gmail",
        auth=AuthConfig(
            auth_type="oauth2",
            access_token="ya29.access_token",
            refresh_token="1//refresh_token",
            extra={
                "client_id": "client_id.apps.googleusercontent.com",
                "client_secret": "client_secret",
            },
        ),
    )


@pytest.fixture
def messages_stream():
    """Create a messages stream config."""
    return StreamConfig(
        stream_name="messages",
        enabled=True,
        sync_mode=SyncMode.INCREMENTAL,
        cursor_field="historyId",
        primary_key=["id"],
        batch_size=10,
    )


@pytest.fixture
def threads_stream():
    """Create a threads stream config."""
    return StreamConfig(
        stream_name="threads",
        enabled=True,
        sync_mode=SyncMode.INCREMENTAL,
        cursor_field="historyId",
        primary_key=["id"],
        batch_size=5,
    )


@pytest.fixture
def mock_gmail_message():
    """Create a mock Gmail message."""
    body_text = "Hello, this is a test email."
    encoded_body = base64.urlsafe_b64encode(body_text.encode()).decode()

    return {
        "id": "msg_123",
        "threadId": "thread_456",
        "historyId": "12345",
        "internalDate": "1704067200000",  # 2024-01-01
        "labelIds": ["INBOX", "IMPORTANT"],
        "snippet": "Hello, this is a test...",
        "payload": {
            "headers": [
                {"name": "From", "value": "John Doe <john@example.com>"},
                {"name": "To", "value": "Jane Smith <jane@example.com>"},
                {"name": "Cc", "value": "Bob <bob@example.com>"},
                {"name": "Subject", "value": "Test Subject"},
                {"name": "Date", "value": "Mon, 01 Jan 2024 12:00:00 +0000"},
            ],
            "body": {"data": encoded_body},
        },
    }


@pytest.fixture
def mock_gmail_thread(mock_gmail_message):
    """Create a mock Gmail thread."""
    return {
        "id": "thread_456",
        "historyId": "12345",
        "snippet": "Hello, this is a test...",
        "messages": [mock_gmail_message],
    }


# =============================================================================
# GmailConnector Initialization Tests
# =============================================================================


class TestGmailConnectorInit:
    """Tests for GmailConnector initialization."""

    def test_connector_type(self):
        """Test connector type is 'gmail'."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()
        assert connector.connector_type == "gmail"

    def test_capabilities(self):
        """Test connector capabilities."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()

        assert connector.capabilities.supports_incremental is True
        assert connector.capabilities.supports_full_refresh is True
        assert connector.capabilities.supports_webhooks is True
        assert connector.capabilities.default_rate_limit_per_minute == 250

    def test_scopes(self):
        """Test required OAuth scopes."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        assert "https://www.googleapis.com/auth/gmail.readonly" in GmailConnector.SCOPES


# =============================================================================
# Connection Check Tests
# =============================================================================


class TestCheckConnection:
    """Tests for check_connection method."""

    @pytest.mark.asyncio
    async def test_check_connection_success(self, gmail_config):
        """Test successful connection check."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()

        # Mock the Gmail service
        mock_service = MagicMock()
        mock_service.users().getProfile().execute.return_value = {
            "emailAddress": "user@example.com",
            "messagesTotal": 1000,
        }

        with patch.object(connector, "_get_service", return_value=mock_service):
            success, error = await connector.check_connection(gmail_config)

            assert success is True
            assert error is None

    @pytest.mark.asyncio
    async def test_check_connection_http_error(self, gmail_config):
        """Test connection check with HTTP error."""
        from src.connectors.sources.email.gmail.connector import GmailConnector
        from googleapiclient.errors import HttpError

        connector = GmailConnector()

        # Mock HTTP error
        mock_service = MagicMock()
        mock_resp = MagicMock()
        mock_resp.status = 401
        mock_service.users().getProfile().execute.side_effect = HttpError(
            mock_resp, b'{"error": "invalid_token"}'
        )

        with patch.object(connector, "_get_service", return_value=mock_service):
            success, error = await connector.check_connection(gmail_config)

            assert success is False
            assert "Gmail API error" in error

    @pytest.mark.asyncio
    async def test_check_connection_generic_error(self, gmail_config):
        """Test connection check with generic error."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()

        mock_service = MagicMock()
        mock_service.users().getProfile().execute.side_effect = Exception("Network error")

        with patch.object(connector, "_get_service", return_value=mock_service):
            success, error = await connector.check_connection(gmail_config)

            assert success is False
            assert "Connection error" in error


# =============================================================================
# Discover Streams Tests
# =============================================================================


class TestDiscoverStreams:
    """Tests for discover_streams method."""

    @pytest.mark.asyncio
    async def test_discover_streams(self, gmail_config):
        """Test stream discovery."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()
        streams = await connector.discover_streams(gmail_config)

        assert len(streams) == 3

        # Check messages stream
        messages = next(s for s in streams if s.stream_name == "messages")
        assert messages.enabled is True
        assert messages.sync_mode == SyncMode.INCREMENTAL
        assert messages.cursor_field == "historyId"

        # Check threads stream
        threads = next(s for s in streams if s.stream_name == "threads")
        assert threads.enabled is True
        assert threads.sync_mode == SyncMode.INCREMENTAL

        # Check labels stream
        labels = next(s for s in streams if s.stream_name == "labels")
        assert labels.enabled is False  # Optional by default
        assert labels.sync_mode == SyncMode.FULL_REFRESH


# =============================================================================
# Read Stream Tests
# =============================================================================


class TestReadStream:
    """Tests for read_stream method."""

    @pytest.mark.asyncio
    async def test_read_stream_messages(self, gmail_config, messages_stream, mock_gmail_message):
        """Test reading messages stream."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()

        # Mock the service
        mock_service = MagicMock()
        mock_service.users().messages().list().execute.return_value = {
            "messages": [{"id": "msg_123", "threadId": "thread_456"}],
            "nextPageToken": None,
        }
        mock_service.users().messages().get().execute.return_value = mock_gmail_message

        with patch.object(connector, "_get_service", return_value=mock_service):
            batches = []
            async for batch in connector.read_stream(gmail_config, messages_stream, None):
                batches.append(batch)

            assert len(batches) >= 1
            assert len(batches[0].records) >= 1

            record = batches[0].records[0]
            assert record.record_type == RecordType.MESSAGE
            assert record.data["id"] == "msg_123"

    @pytest.mark.asyncio
    async def test_read_stream_threads(self, gmail_config, threads_stream, mock_gmail_thread):
        """Test reading threads stream."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()

        # Mock the service
        mock_service = MagicMock()
        mock_service.users().threads().list().execute.return_value = {
            "threads": [{"id": "thread_456"}],
            "nextPageToken": None,
        }
        mock_service.users().threads().get().execute.return_value = mock_gmail_thread

        with patch.object(connector, "_get_service", return_value=mock_service):
            batches = []
            async for batch in connector.read_stream(gmail_config, threads_stream, None):
                batches.append(batch)

            assert len(batches) >= 1
            record = batches[0].records[0]
            assert record.record_type == RecordType.CONVERSATION
            assert record.data["id"] == "thread_456"

    @pytest.mark.asyncio
    async def test_read_stream_unknown_stream(self, gmail_config):
        """Test reading unknown stream raises error."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()

        unknown_stream = StreamConfig(
            stream_name="unknown",
            enabled=True,
            sync_mode=SyncMode.FULL_REFRESH,
        )

        mock_service = MagicMock()
        with patch.object(connector, "_get_service", return_value=mock_service):
            with pytest.raises(ValueError, match="Unknown stream"):
                async for _ in connector.read_stream(gmail_config, unknown_stream, None):
                    pass


# =============================================================================
# Incremental Sync Tests
# =============================================================================


class TestIncrementalSync:
    """Tests for incremental sync functionality."""

    @pytest.mark.asyncio
    async def test_incremental_sync_with_history(
        self, gmail_config, messages_stream, mock_gmail_message
    ):
        """Test incremental sync using history API."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()

        # Create state with cursor
        state = ConnectorState(connection_id=gmail_config.connection_id, connector_type="gmail")
        state.update_cursor("messages", {"historyId": "10000"})

        # Mock the service
        mock_service = MagicMock()
        mock_service.users().history().list().execute.return_value = {
            "history": [
                {
                    "messagesAdded": [{"message": {"id": "msg_123"}}],
                }
            ],
            "historyId": "10001",
            "nextPageToken": None,
        }
        mock_service.users().messages().get().execute.return_value = mock_gmail_message

        with patch.object(connector, "_get_service", return_value=mock_service):
            batches = []
            async for batch in connector.read_stream(gmail_config, messages_stream, state):
                batches.append(batch)

            # Should have used history API
            mock_service.users().history().list.assert_called()

    @pytest.mark.asyncio
    async def test_full_refresh_without_state(
        self, gmail_config, messages_stream, mock_gmail_message
    ):
        """Test full refresh when no state exists."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()

        # Mock the service
        mock_service = MagicMock()
        mock_service.users().messages().list().execute.return_value = {
            "messages": [{"id": "msg_123"}],
            "nextPageToken": None,
        }
        mock_service.users().messages().get().execute.return_value = mock_gmail_message

        with patch.object(connector, "_get_service", return_value=mock_service):
            batches = []
            async for batch in connector.read_stream(gmail_config, messages_stream, None):
                batches.append(batch)

            # Should have used messages.list (full refresh)
            mock_service.users().messages().list.assert_called()


# =============================================================================
# Message Parsing Tests
# =============================================================================


class TestMessageParsing:
    """Tests for message parsing functionality."""

    def test_parse_message_basic(self, gmail_config, mock_gmail_message):
        """Test basic message parsing."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()
        record = connector._parse_message(mock_gmail_message, gmail_config)

        assert record.record_id == "msg_123"
        assert record.data["subject"] == "Test Subject"
        assert record.data["sender_email"] == "john@example.com"
        assert record.data["sender_name"] == "John Doe"
        assert "jane@example.com" in record.data["recipient_emails"]
        assert "bob@example.com" in record.data["cc_emails"]
        assert record.data["is_read"] is True  # UNREAD not in labels

    def test_parse_message_unread(self, gmail_config, mock_gmail_message):
        """Test parsing unread message."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        mock_gmail_message["labelIds"].append("UNREAD")

        connector = GmailConnector()
        record = connector._parse_message(mock_gmail_message, gmail_config)

        assert record.data["is_read"] is False

    def test_extract_body_plain_text(self, gmail_config):
        """Test extracting plain text body."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        body_text = "Plain text body content"
        encoded = base64.urlsafe_b64encode(body_text.encode()).decode()

        payload = {"body": {"data": encoded}}

        connector = GmailConnector()
        result = connector._extract_body(payload)

        assert result == body_text

    def test_extract_body_multipart(self, gmail_config):
        """Test extracting body from multipart message."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        body_text = "Multipart plain text"
        encoded = base64.urlsafe_b64encode(body_text.encode()).decode()

        payload = {
            "body": {},
            "parts": [
                {"mimeType": "text/plain", "body": {"data": encoded}},
                {"mimeType": "text/html", "body": {"data": "html_data"}},
            ],
        }

        connector = GmailConnector()
        result = connector._extract_body(payload)

        assert result == body_text


# =============================================================================
# Thread Parsing Tests
# =============================================================================


class TestThreadParsing:
    """Tests for thread parsing functionality."""

    def test_parse_thread(self, gmail_config, mock_gmail_thread):
        """Test thread parsing."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()
        record = connector._parse_thread(mock_gmail_thread, gmail_config)

        assert record.record_id == "thread_456"
        assert record.data["message_count"] == 1
        assert "john@example.com" in record.data["participants"]
        assert "jane@example.com" in record.data["participants"]

    def test_parse_thread_multiple_messages(self, gmail_config, mock_gmail_message):
        """Test parsing thread with multiple messages."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        # Create second message
        second_message = dict(mock_gmail_message)
        second_message["id"] = "msg_124"
        second_message["payload"] = {
            "headers": [
                {"name": "From", "value": "Another Person <another@example.com>"},
                {"name": "To", "value": "John Doe <john@example.com>"},
            ],
        }

        thread = {
            "id": "thread_multi",
            "historyId": "12345",
            "snippet": "Multi-message thread",
            "messages": [mock_gmail_message, second_message],
        }

        connector = GmailConnector()
        record = connector._parse_thread(thread, gmail_config)

        assert record.data["message_count"] == 2
        assert "another@example.com" in record.data["participants"]


# =============================================================================
# Unified Message Conversion Tests
# =============================================================================


class TestUnifiedMessageConversion:
    """Tests for converting to UnifiedMessage."""

    def test_to_unified_message(self, gmail_config, mock_gmail_message):
        """Test conversion to UnifiedMessage."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()
        record = connector._parse_message(mock_gmail_message, gmail_config)

        unified = connector.to_unified_message(record, gmail_config)

        assert unified.id == "gmail:msg_123"
        assert unified.source_type == "gmail"
        assert unified.source_id == "msg_123"
        assert unified.connection_id == gmail_config.connection_id
        assert unified.organization_id == gmail_config.organization_id
        assert unified.subject == "Test Subject"
        assert unified.sender_email == "john@example.com"
        assert unified.thread_id == "thread_456"
        assert unified.is_reply is True  # Has thread_id


# =============================================================================
# Batch Handling Tests
# =============================================================================


class TestBatchHandling:
    """Tests for batch handling."""

    @pytest.mark.asyncio
    async def test_batch_size_respected(self, gmail_config):
        """Test that batch size is respected."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()

        # Create stream with small batch size
        stream = StreamConfig(
            stream_name="messages",
            enabled=True,
            sync_mode=SyncMode.FULL_REFRESH,
            batch_size=2,
        )

        # Mock service to return many messages
        mock_service = MagicMock()
        mock_service.users().messages().list().execute.return_value = {
            "messages": [{"id": f"msg_{i}"} for i in range(5)],
            "nextPageToken": None,
        }

        body = base64.urlsafe_b64encode(b"Test").decode()
        mock_service.users().messages().get().execute.return_value = {
            "id": "msg_1",
            "threadId": "thread_1",
            "historyId": "123",
            "labelIds": [],
            "payload": {
                "headers": [
                    {"name": "From", "value": "test@example.com"},
                    {"name": "Subject", "value": "Test"},
                ],
                "body": {"data": body},
            },
        }

        with patch.object(connector, "_get_service", return_value=mock_service):
            batches = []
            async for batch in connector.read_stream(gmail_config, stream, None):
                batches.append(batch)

            # Should have multiple batches due to small batch size
            assert len(batches) >= 2

    @pytest.mark.asyncio
    async def test_cursor_in_batch(self, gmail_config, messages_stream, mock_gmail_message):
        """Test that cursor is set correctly in batch."""
        from src.connectors.sources.email.gmail.connector import GmailConnector

        connector = GmailConnector()

        mock_service = MagicMock()
        mock_service.users().messages().list().execute.return_value = {
            "messages": [{"id": "msg_123"}],
            "nextPageToken": None,
        }
        mock_service.users().messages().get().execute.return_value = mock_gmail_message

        with patch.object(connector, "_get_service", return_value=mock_service):
            batches = []
            async for batch in connector.read_stream(gmail_config, messages_stream, None):
                batches.append(batch)

            # Final batch should have cursor
            final_batch = batches[-1]
            assert final_batch.next_cursor is not None
            assert "historyId" in final_batch.next_cursor


# =============================================================================
# Registry Tests
# =============================================================================


class TestConnectorRegistry:
    """Tests for connector registration."""

    def test_gmail_connector_registered(self):
        """Test Gmail connector is registered."""
        from src.connectors.base.connector import ConnectorRegistry

        connector = ConnectorRegistry.get("gmail")
        assert connector is not None
        assert connector.connector_type == "gmail"
