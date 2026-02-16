"""
Unit tests for Notion Connector.

Tests Notion API integration, page/database parsing, and stream reading.
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
def notion_config():
    """Create a Notion connector config."""
    return ConnectorConfig(
        connection_id="conn_notion_123",
        organization_id="org_456",
        connector_type="notion",
        name="Test Notion",
        auth=AuthConfig(
            auth_type="oauth2",
            access_token="secret_notion_token...",
            refresh_token=None,
            extra={
                "workspace_id": "workspace_uuid",
            },
        ),
        credentials={"access_token": "secret_notion_token..."},
    )


@pytest.fixture
def pages_stream():
    """Create a pages stream config."""
    return StreamConfig(
        stream_name="pages",
        enabled=True,
        sync_mode=SyncMode.INCREMENTAL,
        cursor_field="last_edited_time",
        primary_key=["id"],
        batch_size=10,
    )


@pytest.fixture
def databases_stream():
    """Create a databases stream config."""
    return StreamConfig(
        stream_name="databases",
        enabled=True,
        sync_mode=SyncMode.FULL_REFRESH,
        primary_key=["id"],
        batch_size=10,
    )


@pytest.fixture
def mock_notion_page():
    """Create a mock Notion page."""
    return {
        "object": "page",
        "id": "page_uuid_123",
        "created_time": "2024-01-01T10:00:00.000Z",
        "last_edited_time": "2024-01-01T12:00:00.000Z",
        "created_by": {"object": "user", "id": "user_123"},
        "last_edited_by": {"object": "user", "id": "user_456"},
        "parent": {"type": "workspace", "workspace": True},
        "archived": False,
        "properties": {
            "title": {
                "id": "title",
                "type": "title",
                "title": [
                    {
                        "type": "text",
                        "text": {"content": "Test Page Title"},
                        "plain_text": "Test Page Title",
                    }
                ],
            },
        },
        "url": "https://www.notion.so/Test-Page-Title-page_uuid_123",
    }


@pytest.fixture
def mock_notion_database():
    """Create a mock Notion database."""
    return {
        "object": "database",
        "id": "database_uuid_123",
        "created_time": "2024-01-01T10:00:00.000Z",
        "last_edited_time": "2024-01-01T12:00:00.000Z",
        "title": [
            {
                "type": "text",
                "text": {"content": "Test Database"},
                "plain_text": "Test Database",
            }
        ],
        "properties": {
            "Name": {
                "id": "title",
                "name": "Name",
                "type": "title",
                "title": {},
            },
            "Status": {
                "id": "prop_123",
                "name": "Status",
                "type": "select",
                "select": {
                    "options": [
                        {"name": "Todo", "color": "red"},
                        {"name": "Done", "color": "green"},
                    ]
                },
            },
        },
        "parent": {"type": "workspace", "workspace": True},
        "url": "https://www.notion.so/database_uuid_123",
        "archived": False,
    }


@pytest.fixture
def mock_notion_block():
    """Create a mock Notion block."""
    return {
        "object": "block",
        "id": "block_uuid_123",
        "parent": {"type": "page_id", "page_id": "page_uuid_123"},
        "created_time": "2024-01-01T10:00:00.000Z",
        "last_edited_time": "2024-01-01T12:00:00.000Z",
        "type": "paragraph",
        "paragraph": {
            "rich_text": [
                {
                    "type": "text",
                    "text": {"content": "This is paragraph content."},
                    "plain_text": "This is paragraph content.",
                }
            ],
        },
        "has_children": False,
    }


# =============================================================================
# NotionConnector Initialization Tests
# =============================================================================


class TestNotionConnectorInit:
    """Tests for NotionConnector initialization."""

    def test_connector_type(self):
        """Test connector type is 'notion'."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()
        assert connector.connector_type == "notion"

    def test_capabilities(self):
        """Test connector capabilities."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()

        assert connector.capabilities.supports_incremental is True
        assert connector.capabilities.supports_full_refresh is True


# =============================================================================
# Connection Check Tests
# =============================================================================


class TestCheckConnection:
    """Tests for check_connection method."""

    @pytest.mark.asyncio
    async def test_check_connection_success(self, notion_config):
        """Test successful connection check."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()

        # Mock httpx response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "object": "user",
            "id": "user_123",
            "name": "Test User",
            "type": "person",
        }

        with patch(
            "src.connectors.sources.productivity.notion.connector.connector_request",
            new_callable=AsyncMock,
            return_value=mock_response,
        ):
            success, error = await connector.check_connection(notion_config)

        assert success is True
        assert error is None

    @pytest.mark.asyncio
    async def test_check_connection_failure(self, notion_config):
        """Test connection check failure."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()

        # Mock httpx response with 401
        mock_response = MagicMock()
        mock_response.status_code = 401

        with patch(
            "src.connectors.sources.productivity.notion.connector.connector_request",
            new_callable=AsyncMock,
            return_value=mock_response,
        ):
            success, error = await connector.check_connection(notion_config)

        assert success is False
        assert "Invalid or expired access token" in error

    @pytest.mark.asyncio
    async def test_check_connection_missing_token(self):
        """Test connection check with missing token."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()
        config = ConnectorConfig(
            connection_id="conn_notion_123",
            organization_id="org_456",
            connector_type="notion",
            name="Test Notion",
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
    async def test_discover_streams(self, notion_config):
        """Test stream discovery."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()
        streams = await connector.discover_streams(notion_config)

        assert len(streams) >= 2

        # Check pages stream
        pages = next(s for s in streams if s.stream_name == "pages")
        assert pages.sync_mode == "incremental"
        assert pages.cursor_field == "last_edited_time"

        # Check databases stream
        databases = next(s for s in streams if s.stream_name == "databases")
        assert databases.sync_mode == "incremental"


# =============================================================================
# Page Content Tests
# =============================================================================


class TestPageContent:
    """Tests for page content extraction."""

    def test_page_title_extraction(self, mock_notion_page):
        """Test extracting page title."""
        title_prop = mock_notion_page["properties"]["title"]
        title_text = title_prop["title"][0]["plain_text"]

        assert title_text == "Test Page Title"

    def test_page_metadata(self, mock_notion_page):
        """Test page metadata."""
        assert mock_notion_page["id"] == "page_uuid_123"
        assert mock_notion_page["archived"] is False
        assert "last_edited_time" in mock_notion_page

    def test_block_content(self, mock_notion_block):
        """Test block content extraction."""
        paragraph = mock_notion_block["paragraph"]
        text = paragraph["rich_text"][0]["plain_text"]

        assert text == "This is paragraph content."


# =============================================================================
# Database Tests
# =============================================================================


class TestDatabaseParsing:
    """Tests for database parsing."""

    def test_database_title(self, mock_notion_database):
        """Test database title extraction."""
        title_text = mock_notion_database["title"][0]["plain_text"]
        assert title_text == "Test Database"

    def test_database_properties(self, mock_notion_database):
        """Test database properties."""
        properties = mock_notion_database["properties"]

        assert "Name" in properties
        assert "Status" in properties
        assert properties["Status"]["type"] == "select"


# =============================================================================
# Title and Text Extraction Tests
# =============================================================================


class TestTextExtraction:
    """Tests for title and text extraction helpers."""

    def test_extract_title(self, notion_config):
        """Test extracting title from properties."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()
        properties = {
            "Name": {
                "type": "title",
                "title": [{"plain_text": "Test Title"}],
            }
        }

        title = connector._extract_title(properties)
        assert title == "Test Title"

    def test_extract_title_untitled(self, notion_config):
        """Test extracting title when none exists."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()
        properties = {}

        title = connector._extract_title(properties)
        assert title == "Untitled"

    def test_extract_title_from_list(self, notion_config):
        """Test extracting title from rich text list."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()
        title_list = [
            {"plain_text": "Hello "},
            {"plain_text": "World"},
        ]

        result = connector._extract_title_from_list(title_list)
        assert result == "Hello World"

    def test_extract_title_from_empty_list(self, notion_config):
        """Test extracting title from empty list."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()

        result = connector._extract_title_from_list([])
        assert result == "Untitled"


# =============================================================================
# Block to Text Tests
# =============================================================================


class TestBlockToText:
    """Tests for block to text conversion."""

    def test_paragraph_block(self, notion_config):
        """Test converting paragraph block to text."""
        from src.connectors.sources.productivity.notion.connector import (
            NotionConnector,
            NotionBlock,
        )

        connector = NotionConnector()
        block = NotionBlock(
            id="block_1",
            type="paragraph",
            created_time="2024-01-01T00:00:00.000Z",
            last_edited_time="2024-01-01T00:00:00.000Z",
            has_children=False,
            content={"rich_text": [{"plain_text": "Paragraph text"}]},
        )

        text = connector._block_to_text(block)
        assert text == "Paragraph text"

    def test_heading_block(self, notion_config):
        """Test converting heading block to text."""
        from src.connectors.sources.productivity.notion.connector import (
            NotionConnector,
            NotionBlock,
        )

        connector = NotionConnector()
        block = NotionBlock(
            id="block_1",
            type="heading_1",
            created_time="2024-01-01T00:00:00.000Z",
            last_edited_time="2024-01-01T00:00:00.000Z",
            has_children=False,
            content={"rich_text": [{"plain_text": "Heading text"}]},
        )

        text = connector._block_to_text(block)
        assert text == "Heading text"

    def test_todo_block_checked(self, notion_config):
        """Test converting checked to-do block to text."""
        from src.connectors.sources.productivity.notion.connector import (
            NotionConnector,
            NotionBlock,
        )

        connector = NotionConnector()
        block = NotionBlock(
            id="block_1",
            type="to_do",
            created_time="2024-01-01T00:00:00.000Z",
            last_edited_time="2024-01-01T00:00:00.000Z",
            has_children=False,
            content={
                "checked": True,
                "rich_text": [{"plain_text": "Task done"}],
            },
        )

        text = connector._block_to_text(block)
        assert "☑" in text
        assert "Task done" in text

    def test_code_block(self, notion_config):
        """Test converting code block to text."""
        from src.connectors.sources.productivity.notion.connector import (
            NotionConnector,
            NotionBlock,
        )

        connector = NotionConnector()
        block = NotionBlock(
            id="block_1",
            type="code",
            created_time="2024-01-01T00:00:00.000Z",
            last_edited_time="2024-01-01T00:00:00.000Z",
            has_children=False,
            content={
                "language": "python",
                "rich_text": [{"plain_text": "print('hello')"}],
            },
        )

        text = connector._block_to_text(block)
        assert "```python" in text
        assert "print('hello')" in text


# =============================================================================
# Property Parsing Tests
# =============================================================================


class TestPropertyParsing:
    """Tests for database property parsing."""

    def test_parse_title_property(self, notion_config):
        """Test parsing title property."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()
        properties = {
            "Name": {
                "type": "title",
                "title": [{"plain_text": "Item Name"}],
            }
        }

        parsed = connector._parse_properties(properties)
        assert parsed["Name"] == "Item Name"

    def test_parse_rich_text_property(self, notion_config):
        """Test parsing rich text property."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()
        properties = {
            "Description": {
                "type": "rich_text",
                "rich_text": [{"plain_text": "Some description"}],
            }
        }

        parsed = connector._parse_properties(properties)
        assert parsed["Description"] == "Some description"

    def test_parse_select_property(self, notion_config):
        """Test parsing select property."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()
        properties = {
            "Status": {
                "type": "select",
                "select": {"name": "Done"},
            }
        }

        parsed = connector._parse_properties(properties)
        assert parsed["Status"] == "Done"

    def test_parse_multi_select_property(self, notion_config):
        """Test parsing multi-select property."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()
        properties = {
            "Tags": {
                "type": "multi_select",
                "multi_select": [{"name": "Tag1"}, {"name": "Tag2"}],
            }
        }

        parsed = connector._parse_properties(properties)
        assert parsed["Tags"] == ["Tag1", "Tag2"]

    def test_parse_checkbox_property(self, notion_config):
        """Test parsing checkbox property."""
        from src.connectors.sources.productivity.notion.connector import NotionConnector

        connector = NotionConnector()
        properties = {
            "Complete": {
                "type": "checkbox",
                "checkbox": True,
            }
        }

        parsed = connector._parse_properties(properties)
        assert parsed["Complete"] is True


# =============================================================================
# Rich Text Tests
# =============================================================================


class TestRichText:
    """Tests for rich text handling."""

    def test_plain_text_extraction(self, mock_notion_block):
        """Test plain text extraction from rich text."""
        paragraph = mock_notion_block["paragraph"]
        rich_text = paragraph["rich_text"]

        plain_text = "".join([rt["plain_text"] for rt in rich_text])
        assert plain_text == "This is paragraph content."

    def test_empty_rich_text(self):
        """Test handling empty rich text."""
        empty_block = {
            "type": "paragraph",
            "paragraph": {"rich_text": []},
        }

        rich_text = empty_block["paragraph"]["rich_text"]
        plain_text = "".join([rt.get("plain_text", "") for rt in rich_text])
        assert plain_text == ""


# =============================================================================
# Registry Tests
# =============================================================================


class TestConnectorRegistry:
    """Tests for connector registration."""

    def test_notion_connector_registered(self):
        """Test Notion connector is registered."""
        from src.connectors.base.connector import ConnectorRegistry

        connector_class = ConnectorRegistry.get("notion")
        assert connector_class is not None

        connector = connector_class()
        assert connector.connector_type == "notion"
