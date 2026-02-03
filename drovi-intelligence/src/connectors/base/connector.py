"""
Base Connector Abstract Class

Provides the universal interface for all data source connectors.
Inspired by Airbyte CDK and Singer.io patterns.
"""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.records import Record, RecordBatch, RecordType, calculate_raw_data_hash
from src.connectors.base.state import ConnectorState

logger = structlog.get_logger()


@dataclass
class ConnectorCapabilities:
    """Describes what a connector can do."""

    # Sync modes
    supports_incremental: bool = True
    supports_full_refresh: bool = True

    # Features
    supports_backfill: bool = True
    supports_webhooks: bool = False
    supports_real_time: bool = False

    # Rate limiting
    default_rate_limit_per_minute: int = 60
    supports_concurrency: bool = True
    max_concurrent_streams: int = 3

    # Data
    supports_schema_discovery: bool = True


class BaseConnector(ABC):
    """
    Abstract base class for all data source connectors.

    Implements the Singer-style tap pattern with modern async support.
    Each connector must implement:
    - connector_type: Unique identifier (e.g., "gmail", "slack")
    - capabilities: What the connector supports
    - check_connection: Verify credentials
    - discover_streams: List available data streams
    - read_stream: Extract data from a stream

    Example usage:
        connector = GmailConnector()
        config = ConnectorConfig(...)
        state = ConnectorState(...)

        # Check connection
        success, error = await connector.check_connection(config)

        # Discover available streams
        streams = await connector.discover_streams(config)

        # Read data
        async for batch in connector.read_stream(config, streams[0], state):
            for record in batch.records:
                process(record)
    """

    @property
    @abstractmethod
    def connector_type(self) -> str:
        """
        Unique identifier for this connector type.

        Examples: "gmail", "slack", "notion", "salesforce"
        """
        pass

    @property
    @abstractmethod
    def capabilities(self) -> ConnectorCapabilities:
        """Describe connector capabilities."""
        pass

    @abstractmethod
    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """
        Verify that the connection credentials are valid.

        Args:
            config: Connector configuration with auth credentials

        Returns:
            Tuple of (success, error_message)
            If success is True, error_message will be None
        """
        pass

    @abstractmethod
    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """
        Discover available data streams for this connection.

        This is similar to Singer's CATALOG discovery.

        Args:
            config: Connector configuration

        Returns:
            List of available streams with their schemas
        """
        pass

    @abstractmethod
    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState | None = None,
    ) -> AsyncIterator[RecordBatch]:
        """
        Read data from a stream, yielding batches of records.

        Uses async iterator pattern for memory efficiency.
        Supports incremental sync via state/cursor.

        Args:
            config: Connector configuration
            stream: Stream configuration
            state: Optional state for incremental sync

        Yields:
            RecordBatch with records and updated cursor
        """
        # This is an abstract method that must use yield
        # The actual implementation must be an async generator
        yield  # type: ignore
        raise NotImplementedError

    async def read_all_streams(
        self,
        config: ConnectorConfig,
        state: ConnectorState | None = None,
    ) -> AsyncIterator[tuple[str, RecordBatch]]:
        """
        Read from all enabled streams.

        Args:
            config: Connector configuration
            state: Optional state for incremental sync

        Yields:
            Tuple of (stream_name, batch)
        """
        streams = config.get_enabled_streams()
        if not streams:
            # If no streams configured, discover and enable all
            streams = await self.discover_streams(config)

        for stream in streams:
            if not stream.enabled:
                continue

            logger.info(
                "Starting stream sync",
                connector_type=self.connector_type,
                stream=stream.stream_name,
            )

            try:
                async for batch in self.read_stream(config, stream, state):
                    yield stream.stream_name, batch
            except Exception as e:
                logger.error(
                    "Stream sync failed",
                    connector_type=self.connector_type,
                    stream=stream.stream_name,
                    error=str(e),
                )
                raise

    async def refresh_token(
        self,
        config: ConnectorConfig,
    ) -> ConnectorConfig:
        """
        Refresh OAuth2 tokens if needed.

        Default implementation does nothing.
        Override in connectors that support OAuth2.

        Args:
            config: Current configuration

        Returns:
            Updated configuration with new tokens
        """
        return config

    def get_default_streams(self) -> list[StreamConfig]:
        """
        Get default stream configurations for this connector.

        Override to provide sensible defaults.
        """
        return []

    def validate_config(self, config: ConnectorConfig) -> list[str]:
        """
        Validate connector configuration.

        Args:
            config: Configuration to validate

        Returns:
            List of validation errors (empty if valid)
        """
        errors = []

        if config.connector_type != self.connector_type:
            errors.append(
                f"Config connector_type '{config.connector_type}' "
                f"doesn't match '{self.connector_type}'"
            )

        if not config.is_authenticated:
            errors.append("Configuration is missing authentication credentials")

        return errors

    async def estimate_sync_size(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState | None = None,
    ) -> dict[str, Any]:
        """
        Estimate the size of data to be synced.

        Useful for progress tracking and resource planning.

        Returns:
            Dict with estimated_records, estimated_bytes, etc.
        """
        return {
            "estimated_records": None,
            "estimated_bytes": None,
            "is_estimate": True,
        }

    def create_record(
        self,
        record_id: str,
        stream_name: str,
        data: dict[str, Any],
        cursor_value: Any | None = None,
        record_type: RecordType | None = None,
    ) -> Record:
        """
        Helper to create a Record with connector metadata.

        Args:
            record_id: Unique ID within the source
            stream_name: Name of the stream
            data: Record data
            cursor_value: Value for incremental cursor

        Returns:
            Record instance
        """
        extracted_at = datetime.utcnow()
        # Generate hash for deduplication
        raw_data_hash = calculate_raw_data_hash(data)
        if cursor_value is None:
            cursor_value = extracted_at.isoformat()

        return Record(
            record_id=record_id,
            source_type=self.connector_type,
            stream_name=stream_name,
            data=data,
            record_type=record_type or RecordType.MESSAGE,
            cursor_value=cursor_value,
            raw_data_hash=raw_data_hash,
            extracted_at=extracted_at,
        )

    def get_rate_limit_key(self, config: ConnectorConfig) -> str:
        """Get a stable rate-limit key for connector HTTP calls."""
        return f"{self.connector_type}:{config.connection_id}"

    def get_rate_limit_per_minute(self) -> int | None:
        """Get the connector's default rate limit per minute."""
        try:
            return self.capabilities.default_rate_limit_per_minute
        except Exception:
            return None

    def create_batch(
        self,
        stream_name: str,
        connection_id: str,
    ) -> RecordBatch:
        """
        Helper to create an empty RecordBatch.

        Args:
            stream_name: Name of the stream
            connection_id: Connection ID

        Returns:
            Empty RecordBatch
        """
        return RecordBatch(
            stream_name=stream_name,
            connection_id=connection_id,
            started_at=datetime.utcnow(),
        )


class ConnectorRegistry:
    """
    Registry for connector implementations.

    Provides factory methods for creating connectors by type.
    """

    _connectors: dict[str, type[BaseConnector]] = {}

    @classmethod
    def register(
        cls,
        connector_type_or_class: str | type[BaseConnector],
        connector_class: type[BaseConnector] | None = None,
    ) -> type[BaseConnector]:
        """
        Register a connector class.

        Can be used as a decorator:
            @ConnectorRegistry.register
            class GmailConnector(BaseConnector):
                ...

        Or called directly with type name:
            ConnectorRegistry.register("gmail", GmailConnector)
        """
        # Handle two-argument form: register("type", Class)
        if isinstance(connector_type_or_class, str):
            if connector_class is None:
                raise ValueError("connector_class must be provided when type is a string")
            connector_type = connector_type_or_class
            cls._connectors[connector_type] = connector_class
            logger.info("Registered connector", connector_type=connector_type)
            return connector_class

        # Handle decorator form: @register or register(Class)
        actual_class = connector_type_or_class
        connector_type = actual_class.__dict__.get("connector_type")
        if connector_type is None:
            raise ValueError(
                f"Connector {actual_class.__name__} must define connector_type property"
            )

        cls._connectors[connector_type] = actual_class
        logger.info("Registered connector", connector_type=connector_type)
        return actual_class

    @classmethod
    def get(cls, connector_type: str) -> type[BaseConnector] | None:
        """Get a connector class by type."""
        return cls._connectors.get(connector_type)

    @classmethod
    def create(cls, connector_type: str) -> BaseConnector | None:
        """Create a connector instance by type."""
        connector_class = cls.get(connector_type)
        if connector_class:
            return connector_class()
        return None

    @classmethod
    def list_available(cls) -> list[str]:
        """List all registered connector types."""
        return list(cls._connectors.keys())

    @classmethod
    def get_all(cls) -> dict[str, type[BaseConnector]]:
        """Get all registered connector classes."""
        return dict(cls._connectors)
