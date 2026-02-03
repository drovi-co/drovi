"""
Unit tests for BaseConnector and ConnectorRegistry.

Tests the abstract connector interface and registration system.
"""

import pytest
from collections.abc import AsyncIterator
from datetime import datetime
from unittest.mock import AsyncMock, patch, MagicMock

from src.connectors.base.connector import (
    BaseConnector,
    ConnectorCapabilities,
    ConnectorRegistry,
)
from src.connectors.base.config import (
    ConnectorConfig,
    AuthConfig,
    AuthType,
    StreamConfig,
    SyncMode,
)
from src.connectors.base.state import ConnectorState
from src.connectors.base.records import Record, RecordBatch

pytestmark = pytest.mark.unit


# =============================================================================
# Test Fixtures
# =============================================================================


class MockConnector(BaseConnector):
    """Concrete implementation for testing."""

    @property
    def connector_type(self) -> str:
        return "mock"

    @property
    def capabilities(self) -> ConnectorCapabilities:
        return ConnectorCapabilities(
            supports_incremental=True,
            supports_full_refresh=True,
            supports_webhooks=True,
        )

    async def check_connection(self, config: ConnectorConfig) -> tuple[bool, str | None]:
        if config.auth.access_token == "valid_token":
            return True, None
        return False, "Invalid token"

    async def discover_streams(self, config: ConnectorConfig) -> list[StreamConfig]:
        return [
            StreamConfig(stream_name="messages", enabled=True),
            StreamConfig(stream_name="threads", enabled=True),
        ]

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState | None = None,
    ) -> AsyncIterator[RecordBatch]:
        batch = self.create_batch(stream.stream_name, config.connection_id)
        record = self.create_record(
            record_id="record_1",
            stream_name=stream.stream_name,
            data={"content": "test message"},
            cursor_value="cursor_1",
        )
        batch.add_record(record)
        batch.complete(next_cursor={"cursor": "cursor_1"}, has_more=False)
        yield batch


@pytest.fixture
def mock_connector():
    """Create a mock connector instance."""
    return MockConnector()


@pytest.fixture
def valid_config():
    """Create a valid connector configuration."""
    return ConnectorConfig(
        connection_id="conn_123",
        organization_id="org_456",
        connector_type="mock",
        name="Test Connection",
        auth=AuthConfig(
            auth_type=AuthType.OAUTH2,
            access_token="valid_token",
            refresh_token="refresh_token",
        ),
        streams=[
            StreamConfig(stream_name="messages", enabled=True),
            StreamConfig(stream_name="threads", enabled=False),
        ],
    )


@pytest.fixture
def invalid_config():
    """Create an invalid connector configuration."""
    return ConnectorConfig(
        connection_id="conn_123",
        organization_id="org_456",
        connector_type="wrong_type",
        name="Invalid Connection",
        auth=AuthConfig(auth_type=AuthType.NONE),
    )


# =============================================================================
# ConnectorCapabilities Tests
# =============================================================================


class TestConnectorCapabilities:
    """Tests for ConnectorCapabilities dataclass."""

    def test_default_values(self):
        """Test default capability values."""
        caps = ConnectorCapabilities()

        assert caps.supports_incremental is True
        assert caps.supports_full_refresh is True
        assert caps.supports_backfill is True
        assert caps.supports_webhooks is False
        assert caps.supports_real_time is False
        assert caps.default_rate_limit_per_minute == 60
        assert caps.supports_concurrency is True
        assert caps.max_concurrent_streams == 3
        assert caps.supports_schema_discovery is True

    def test_custom_values(self):
        """Test custom capability values."""
        caps = ConnectorCapabilities(
            supports_incremental=False,
            supports_webhooks=True,
            default_rate_limit_per_minute=100,
        )

        assert caps.supports_incremental is False
        assert caps.supports_webhooks is True
        assert caps.default_rate_limit_per_minute == 100

    def test_all_false(self):
        """Test with all capabilities disabled."""
        caps = ConnectorCapabilities(
            supports_incremental=False,
            supports_full_refresh=False,
            supports_backfill=False,
            supports_webhooks=False,
            supports_real_time=False,
            supports_concurrency=False,
            supports_schema_discovery=False,
        )

        assert caps.supports_incremental is False
        assert caps.supports_full_refresh is False


# =============================================================================
# BaseConnector Tests
# =============================================================================


class TestBaseConnector:
    """Tests for BaseConnector abstract class."""

    def test_cannot_instantiate_abstract(self):
        """Test that BaseConnector cannot be instantiated directly."""
        with pytest.raises(TypeError):
            BaseConnector()

    def test_connector_type(self, mock_connector):
        """Test connector_type property."""
        assert mock_connector.connector_type == "mock"

    def test_capabilities(self, mock_connector):
        """Test capabilities property."""
        caps = mock_connector.capabilities

        assert isinstance(caps, ConnectorCapabilities)
        assert caps.supports_incremental is True
        assert caps.supports_webhooks is True

    @pytest.mark.asyncio
    async def test_check_connection_valid(self, mock_connector, valid_config):
        """Test check_connection with valid credentials."""
        success, error = await mock_connector.check_connection(valid_config)

        assert success is True
        assert error is None

    @pytest.mark.asyncio
    async def test_check_connection_invalid(self, mock_connector, valid_config):
        """Test check_connection with invalid credentials."""
        valid_config.auth.access_token = "invalid_token"
        success, error = await mock_connector.check_connection(valid_config)

        assert success is False
        assert error == "Invalid token"

    @pytest.mark.asyncio
    async def test_discover_streams(self, mock_connector, valid_config):
        """Test discover_streams returns stream configurations."""
        streams = await mock_connector.discover_streams(valid_config)

        assert len(streams) == 2
        assert streams[0].stream_name == "messages"
        assert streams[1].stream_name == "threads"

    @pytest.mark.asyncio
    async def test_read_stream(self, mock_connector, valid_config):
        """Test read_stream yields record batches."""
        stream = valid_config.streams[0]
        batches = []

        async for batch in mock_connector.read_stream(valid_config, stream):
            batches.append(batch)

        assert len(batches) == 1
        assert batches[0].record_count == 1
        assert batches[0].records[0].record_id == "record_1"

    @pytest.mark.asyncio
    async def test_read_stream_with_state(self, mock_connector, valid_config):
        """Test read_stream with state for incremental sync."""
        stream = valid_config.streams[0]
        state = ConnectorState(
            connection_id=valid_config.connection_id,
            connector_type="mock",
        )
        state.update_cursor("messages", {"cursor": "prev_cursor"})

        batches = []
        async for batch in mock_connector.read_stream(valid_config, stream, state):
            batches.append(batch)

        assert len(batches) == 1

    @pytest.mark.asyncio
    async def test_read_all_streams(self, mock_connector, valid_config):
        """Test read_all_streams iterates enabled streams."""
        results = []

        async for stream_name, batch in mock_connector.read_all_streams(valid_config):
            results.append((stream_name, batch))

        # Only enabled streams (messages is enabled, threads is disabled)
        assert len(results) == 1
        assert results[0][0] == "messages"

    @pytest.mark.asyncio
    async def test_read_all_streams_discovers_if_none(self, mock_connector, valid_config):
        """Test read_all_streams discovers streams if none configured."""
        valid_config.streams = []  # No streams configured

        results = []
        async for stream_name, batch in mock_connector.read_all_streams(valid_config):
            results.append((stream_name, batch))

        # Should discover and use all streams
        assert len(results) == 2

    @pytest.mark.asyncio
    async def test_refresh_token_default(self, mock_connector, valid_config):
        """Test default refresh_token returns config unchanged."""
        result = await mock_connector.refresh_token(valid_config)

        assert result == valid_config

    def test_get_default_streams_empty(self, mock_connector):
        """Test get_default_streams returns empty list by default."""
        streams = mock_connector.get_default_streams()

        assert streams == []

    def test_validate_config_valid(self, mock_connector, valid_config):
        """Test validate_config with valid configuration."""
        errors = mock_connector.validate_config(valid_config)

        assert errors == []

    def test_validate_config_wrong_type(self, mock_connector, invalid_config):
        """Test validate_config with wrong connector type."""
        errors = mock_connector.validate_config(invalid_config)

        assert len(errors) >= 1
        assert "wrong_type" in errors[0]

    def test_validate_config_missing_auth(self, mock_connector, valid_config):
        """Test validate_config with missing authentication."""
        valid_config.auth = AuthConfig(auth_type=AuthType.OAUTH2)  # No token

        errors = mock_connector.validate_config(valid_config)

        assert len(errors) >= 1
        assert "authentication" in errors[0].lower()

    @pytest.mark.asyncio
    async def test_estimate_sync_size(self, mock_connector, valid_config):
        """Test estimate_sync_size returns none estimates."""
        stream = valid_config.streams[0]
        estimate = await mock_connector.estimate_sync_size(valid_config, stream)

        assert estimate["estimated_records"] is None
        assert estimate["estimated_bytes"] is None
        assert estimate["is_estimate"] is True

    def test_create_record(self, mock_connector):
        """Test create_record helper generates valid record."""
        record = mock_connector.create_record(
            record_id="rec_123",
            stream_name="messages",
            data={"content": "Hello"},
            cursor_value="cursor_123",
        )

        assert record.record_id == "rec_123"
        assert record.source_type == "mock"
        assert record.stream_name == "messages"
        assert record.data == {"content": "Hello"}
        assert record.cursor_value == "cursor_123"
        assert record.raw_data_hash is not None

    def test_create_record_generates_hash(self, mock_connector):
        """Test create_record generates consistent hash."""
        data = {"content": "Hello", "id": "123"}

        record1 = mock_connector.create_record("rec_1", "messages", data)
        record2 = mock_connector.create_record("rec_2", "messages", data)

        # Same data should produce same hash
        assert record1.raw_data_hash == record2.raw_data_hash

    def test_create_record_sets_cursor_default(self, mock_connector):
        """Test create_record populates cursor_value when omitted."""
        record = mock_connector.create_record(
            record_id="rec_cursor",
            stream_name="messages",
            data={"content": "Hello"},
        )

        assert record.cursor_value is not None

    def test_create_batch(self, mock_connector):
        """Test create_batch helper generates valid batch."""
        batch = mock_connector.create_batch("messages", "conn_123")

        assert batch.stream_name == "messages"
        assert batch.connection_id == "conn_123"
        assert batch.records == []
        assert batch.started_at is not None


# =============================================================================
# ConnectorRegistry Tests
# =============================================================================


class TestConnectorRegistry:
    """Tests for ConnectorRegistry."""

    def setup_method(self):
        """Clear registry before each test."""
        ConnectorRegistry._connectors = {}

    def test_register_decorator(self):
        """Test registering connector via decorator."""
        # Create a mock connector class with connector_type in __dict__
        class TestConnector(BaseConnector):
            connector_type = "test_type"

            @property
            def capabilities(self):
                return ConnectorCapabilities()

            async def check_connection(self, config):
                return True, None

            async def discover_streams(self, config):
                return []

            async def read_stream(self, config, stream, state=None):
                yield

        # Register manually (since decorator creates instance)
        ConnectorRegistry._connectors["test_type"] = TestConnector

        assert "test_type" in ConnectorRegistry._connectors

    def test_get_registered_connector(self):
        """Test getting a registered connector class."""
        ConnectorRegistry._connectors["mock"] = MockConnector

        connector_class = ConnectorRegistry.get("mock")

        assert connector_class == MockConnector

    def test_get_unregistered_connector(self):
        """Test getting an unregistered connector returns None."""
        connector_class = ConnectorRegistry.get("nonexistent")

        assert connector_class is None

    def test_create_connector_instance(self):
        """Test creating connector instance."""
        ConnectorRegistry._connectors["mock"] = MockConnector

        connector = ConnectorRegistry.create("mock")

        assert isinstance(connector, MockConnector)
        assert connector.connector_type == "mock"

    def test_create_unregistered_returns_none(self):
        """Test creating unregistered connector returns None."""
        connector = ConnectorRegistry.create("nonexistent")

        assert connector is None

    def test_list_available(self):
        """Test listing available connector types."""
        ConnectorRegistry._connectors["mock"] = MockConnector
        ConnectorRegistry._connectors["other"] = MockConnector

        available = ConnectorRegistry.list_available()

        assert "mock" in available
        assert "other" in available

    def test_list_available_empty(self):
        """Test listing when no connectors registered."""
        available = ConnectorRegistry.list_available()

        assert available == []

    def test_get_all(self):
        """Test getting all registered connectors."""
        ConnectorRegistry._connectors["mock"] = MockConnector
        ConnectorRegistry._connectors["other"] = MockConnector

        all_connectors = ConnectorRegistry.get_all()

        assert len(all_connectors) == 2
        assert "mock" in all_connectors
        assert "other" in all_connectors


# =============================================================================
# Error Handling Tests
# =============================================================================


class TestConnectorErrorHandling:
    """Tests for connector error handling."""

    @pytest.mark.asyncio
    async def test_read_all_streams_handles_stream_error(self, mock_connector, valid_config):
        """Test read_all_streams handles errors in individual streams."""

        # Create a connector that raises an error
        class FailingConnector(MockConnector):
            async def read_stream(self, config, stream, state=None):
                if stream.stream_name == "messages":
                    raise ValueError("Stream error")
                yield self.create_batch(stream.stream_name, config.connection_id)

        connector = FailingConnector()
        valid_config.streams = [
            StreamConfig(stream_name="messages", enabled=True),
        ]

        with pytest.raises(ValueError, match="Stream error"):
            async for _ in connector.read_all_streams(valid_config):
                pass

    @pytest.mark.asyncio
    async def test_check_connection_network_error(self):
        """Test check_connection handles network errors."""

        class NetworkErrorConnector(MockConnector):
            async def check_connection(self, config):
                raise ConnectionError("Network unreachable")

        connector = NetworkErrorConnector()
        config = ConnectorConfig(
            connection_id="conn_123",
            organization_id="org_456",
            connector_type="mock",
            name="Test",
            auth=AuthConfig(auth_type=AuthType.OAUTH2, access_token="token"),
        )

        with pytest.raises(ConnectionError):
            await connector.check_connection(config)
