"""
Universal Connector System

Provides a modular, extensible framework for connecting to any data source.
Enables the intelligence backend to operate as a standalone system.
"""

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
