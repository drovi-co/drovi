"""Base connector abstractions."""

from src.connectors.base.connector import BaseConnector, ConnectorCapabilities
from src.connectors.base.config import ConnectorConfig, StreamConfig, AuthConfig
from src.connectors.base.state import ConnectorState, SyncCheckpoint
from src.connectors.base.records import Record, RecordBatch

__all__ = [
    "BaseConnector",
    "ConnectorCapabilities",
    "ConnectorConfig",
    "StreamConfig",
    "AuthConfig",
    "ConnectorState",
    "SyncCheckpoint",
    "Record",
    "RecordBatch",
]
