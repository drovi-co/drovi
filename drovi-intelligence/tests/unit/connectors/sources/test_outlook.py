"""
Unit tests for Outlook Connector.

Tests Microsoft Graph API integration, message parsing, and stream reading.
"""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

from src.connectors.base.config import ConnectorConfig, StreamConfig, AuthConfig, SyncMode
from src.connectors.base.state import ConnectorState

pytestmark = pytest.mark.unit


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def outlook_config():
    """Create an Outlook connector config."""
    return ConnectorConfig(
        connection_id="conn_outlook_123",
        organization_id="org_456",
        connector_type="outlook",
        name="Test Outlook",
        auth=AuthConfig(
            auth_type="oauth2",
            access_token="eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9...",
            refresh_token="0.ARgAv4j5cvGGr...",
            extra={
                "client_id": "client_id_uuid",
                "client_secret": "client_secret",
                "tenant_id": "tenant_id_uuid",
            },
        ),
        credentials={"access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9..."},
    )


@pytest.fixture
def messages_stream():
    """Create a messages stream config."""
    return StreamConfig(
        stream_name="messages",
        enabled=True,
        sync_mode=SyncMode.INCREMENTAL,
        cursor_field="receivedDateTime",
        primary_key=["id"],
        batch_size=10,
    )


@pytest.fixture
def mock_outlook_message():
    """Create a mock Outlook message."""
    return {
        "id": "AAMkAGU1...",
        "conversationId": "AAQkAGU1...",
        "subject": "Test Email Subject",
        "bodyPreview": "This is a preview of the email...",
        "body": {
            "contentType": "text",
            "content": "This is the full body of the email.",
        },
        "from": {
            "emailAddress": {
                "name": "John Doe",
                "address": "john@example.com",
            }
        },
        "toRecipients": [
            {
                "emailAddress": {
                    "name": "Jane Smith",
                    "address": "jane@example.com",
                }
            }
        ],
        "ccRecipients": [
            {
                "emailAddress": {
                    "name": "Bob Wilson",
                    "address": "bob@example.com",
                }
            }
        ],
        "receivedDateTime": "2024-01-01T12:00:00Z",
        "sentDateTime": "2024-01-01T11:59:00Z",
        "isRead": True,
        "importance": "normal",
        "categories": ["Work"],
        "hasAttachments": False,
    }


@pytest.fixture
def mock_outlook_folder():
    """Create a mock Outlook folder."""
    return {
        "id": "AAMkAGU1folder...",
        "displayName": "Inbox",
        "totalItemCount": 100,
        "unreadItemCount": 10,
        "parentFolderId": None,
    }


# =============================================================================
# OutlookConnector Initialization Tests
# =============================================================================


class TestOutlookConnectorInit:
    """Tests for OutlookConnector initialization."""

    def test_connector_type(self):
        """Test connector type is 'outlook'."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        connector = OutlookConnector()
        assert connector.connector_type == "outlook"

    def test_capabilities(self):
        """Test connector capabilities."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        connector = OutlookConnector()

        assert connector.capabilities.supports_incremental is True
        assert connector.capabilities.supports_full_refresh is True
        assert connector.capabilities.supports_webhooks is True

    def test_scopes(self):
        """Test required OAuth scopes."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        assert "Mail.Read" in OutlookConnector.SCOPES


# =============================================================================
# Connection Check Tests
# =============================================================================


class TestCheckConnection:
    """Tests for check_connection method."""

    @pytest.mark.asyncio
    async def test_check_connection_success(self, outlook_config):
        """Test successful connection check."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        connector = OutlookConnector()

        # Mock httpx response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "displayName": "John Doe",
            "mail": "john@example.com",
        }

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client_class.return_value = mock_client

            success, error = await connector.check_connection(outlook_config)

            assert success is True
            assert error is None

    @pytest.mark.asyncio
    async def test_check_connection_failure(self, outlook_config):
        """Test connection check failure."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        connector = OutlookConnector()

        # Mock httpx response with 401
        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch("httpx.AsyncClient") as mock_client_class:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=None)
            mock_client_class.return_value = mock_client

            success, error = await connector.check_connection(outlook_config)

            assert success is False
            assert "Invalid or expired access token" in error

    @pytest.mark.asyncio
    async def test_check_connection_missing_token(self):
        """Test connection check with missing token."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        connector = OutlookConnector()
        config = ConnectorConfig(
            connection_id="conn_outlook_123",
            organization_id="org_456",
            connector_type="outlook",
            name="Test Outlook",
            auth=AuthConfig(auth_type="oauth2"),
            credentials={},
        )

        success, error = await connector.check_connection(config)

        assert success is False
        assert "Missing access_token" in error


# =============================================================================
# Discover Streams Tests
# =============================================================================


class TestDiscoverStreams:
    """Tests for discover_streams method."""

    @pytest.mark.asyncio
    async def test_discover_streams(self, outlook_config):
        """Test stream discovery."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        connector = OutlookConnector()
        streams = await connector.discover_streams(outlook_config)

        assert len(streams) >= 2

        # Check messages stream
        messages = next(s for s in streams if s.stream_name == "messages")
        assert messages.sync_mode == "incremental"

        # Check folders stream
        folders = next(s for s in streams if s.stream_name == "folders")
        assert folders.sync_mode == "full_refresh"


# =============================================================================
# Message Parsing Tests
# =============================================================================


class TestMessageParsing:
    """Tests for message parsing functionality."""

    def test_message_structure(self, mock_outlook_message):
        """Test message structure."""
        assert mock_outlook_message["subject"] == "Test Email Subject"
        assert mock_outlook_message["from"]["emailAddress"]["address"] == "john@example.com"
        assert len(mock_outlook_message["toRecipients"]) == 1
        assert mock_outlook_message["isRead"] is True

    def test_message_recipients(self, mock_outlook_message):
        """Test message recipients parsing."""
        to_recipients = mock_outlook_message["toRecipients"]
        cc_recipients = mock_outlook_message["ccRecipients"]

        assert to_recipients[0]["emailAddress"]["address"] == "jane@example.com"
        assert cc_recipients[0]["emailAddress"]["address"] == "bob@example.com"


# =============================================================================
# OutlookMessage Dataclass Tests
# =============================================================================


class TestOutlookMessageDataclass:
    """Tests for OutlookMessage dataclass."""

    def test_parse_message(self, outlook_config, mock_outlook_message):
        """Test parsing Outlook message."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        connector = OutlookConnector()
        message = connector._parse_message(mock_outlook_message)

        assert message.id == "AAMkAGU1..."
        assert message.subject == "Test Email Subject"
        assert message.from_address["email"] == "john@example.com"
        assert message.from_address["name"] == "John Doe"
        assert len(message.to_recipients) == 1
        assert message.to_recipients[0]["email"] == "jane@example.com"
        assert message.is_read is True

    def test_message_to_record(self, outlook_config, mock_outlook_message):
        """Test converting message to record."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        connector = OutlookConnector()
        message = connector._parse_message(mock_outlook_message)
        record = connector._message_to_record(message)

        assert record["id"] == "AAMkAGU1..."
        assert record["type"] == "outlook_email"
        assert record["subject"] == "Test Email Subject"
        assert record["from_email"] == "john@example.com"
        assert "jane@example.com" in record["all_participants"]


# =============================================================================
# OutlookFolder Dataclass Tests
# =============================================================================


class TestOutlookFolderDataclass:
    """Tests for OutlookFolder dataclass."""

    def test_folder_structure(self, mock_outlook_folder):
        """Test folder structure."""
        assert mock_outlook_folder["displayName"] == "Inbox"
        assert mock_outlook_folder["totalItemCount"] == 100
        assert mock_outlook_folder["unreadItemCount"] == 10


# =============================================================================
# HTML to Text Tests
# =============================================================================


class TestHtmlToText:
    """Tests for HTML to text conversion."""

    def test_html_to_text_basic(self, outlook_config):
        """Test basic HTML to text conversion."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        connector = OutlookConnector()
        html = "<p>Hello <strong>World</strong></p>"

        text = connector._html_to_text(html)
        assert "Hello" in text
        assert "World" in text

    def test_html_to_text_with_br(self, outlook_config):
        """Test HTML to text with line breaks."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        connector = OutlookConnector()
        html = "Line 1<br>Line 2<br/>Line 3"

        text = connector._html_to_text(html)
        assert "Line 1" in text
        assert "Line 2" in text
        assert "Line 3" in text

    def test_html_to_text_with_entities(self, outlook_config):
        """Test HTML to text with entities."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        connector = OutlookConnector()
        html = "A &amp; B &lt; C &gt; D &quot;E&quot;"

        text = connector._html_to_text(html)
        assert "A & B" in text
        assert "< C >" in text

    def test_html_to_text_strips_scripts(self, outlook_config):
        """Test HTML to text strips script tags."""
        from src.connectors.sources.email.outlook.connector import OutlookConnector

        connector = OutlookConnector()
        html = "<p>Text</p><script>alert('x')</script><p>More text</p>"

        text = connector._html_to_text(html)
        assert "Text" in text
        assert "More text" in text
        assert "alert" not in text


# =============================================================================
# Registry Tests
# =============================================================================


class TestConnectorRegistry:
    """Tests for connector registration."""

    def test_outlook_connector_registered(self):
        """Test Outlook connector is registered."""
        from src.connectors.base.connector import ConnectorRegistry

        connector_class = ConnectorRegistry.get("outlook")
        assert connector_class is not None

        connector = connector_class()
        assert connector.connector_type == "outlook"
