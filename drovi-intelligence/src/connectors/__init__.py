"""Universal Connector System.

This package contains connector implementations and shared connector utilities.

Important:
- Keep imports in this module *lightweight*. Importing `src.connectors.<submodule>`
  (e.g. `src.connectors.http`) will execute this `__init__` first, so eager imports
  here can create circular-import failures across the codebase.
- Connector implementations are available via lazy attribute access to preserve
  backwards-compatible import paths without import-time side effects.
"""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING

from src.connectors.base.connector import BaseConnector, ConnectorCapabilities, ConnectorRegistry
from src.connectors.base.config import AuthConfig, ConnectorConfig, StreamConfig
from src.connectors.base.records import Record, RecordBatch
from src.connectors.base.state import ConnectorState, SyncCheckpoint

if TYPE_CHECKING:  # pragma: no cover
    from src.connectors.sources.calendar.google_calendar import GoogleCalendarConnector as GoogleCalendarConnector
    from src.connectors.sources.crm.hubspot import HubSpotConnector as HubSpotConnector
    from src.connectors.sources.databases.mongodb import MongoDBConnector as MongoDBConnector
    from src.connectors.sources.databases.mysql import MySQLConnector as MySQLConnector
    from src.connectors.sources.databases.postgres import PostgresConnector as PostgresConnector
    from src.connectors.sources.email.gmail.connector import GmailConnector as GmailConnector
    from src.connectors.sources.email.outlook.connector import OutlookConnector as OutlookConnector
    from src.connectors.sources.files.documents import DocumentConnector as DocumentConnector
    from src.connectors.sources.messaging.slack.connector import SlackConnector as SlackConnector
    from src.connectors.sources.messaging.teams.connector import TeamsConnector as TeamsConnector
    from src.connectors.sources.messaging.whatsapp.connector import WhatsAppConnector as WhatsAppConnector
    from src.connectors.sources.productivity.google_docs.connector import GoogleDocsConnector as GoogleDocsConnector
    from src.connectors.sources.productivity.notion.connector import NotionConnector as NotionConnector
    from src.connectors.sources.storage.bigquery import BigQueryConnector as BigQueryConnector
    from src.connectors.sources.storage.s3 import S3Connector as S3Connector


_LAZY_CONNECTORS: dict[str, str] = {
    # Email
    "GmailConnector": "src.connectors.sources.email.gmail.connector",
    "OutlookConnector": "src.connectors.sources.email.outlook.connector",
    # Messaging
    "SlackConnector": "src.connectors.sources.messaging.slack.connector",
    "TeamsConnector": "src.connectors.sources.messaging.teams.connector",
    "WhatsAppConnector": "src.connectors.sources.messaging.whatsapp.connector",
    # Calendar
    "GoogleCalendarConnector": "src.connectors.sources.calendar.google_calendar",
    # Productivity
    "NotionConnector": "src.connectors.sources.productivity.notion.connector",
    "GoogleDocsConnector": "src.connectors.sources.productivity.google_docs.connector",
    # CRM
    "HubSpotConnector": "src.connectors.sources.crm.hubspot",
    # Storage
    "S3Connector": "src.connectors.sources.storage.s3",
    "BigQueryConnector": "src.connectors.sources.storage.bigquery",
    # Databases
    "PostgresConnector": "src.connectors.sources.databases.postgres",
    "MySQLConnector": "src.connectors.sources.databases.mysql",
    "MongoDBConnector": "src.connectors.sources.databases.mongodb",
    # Files
    "DocumentConnector": "src.connectors.sources.files.documents",
}


def __getattr__(name: str):  # pragma: no cover
    module_path = _LAZY_CONNECTORS.get(name)
    if not module_path:
        raise AttributeError(name)
    module = import_module(module_path)
    return getattr(module, name)


def __dir__():  # pragma: no cover
    return sorted(list(globals().keys()) + list(_LAZY_CONNECTORS.keys()))


__all__ = [
    # Base classes
    "BaseConnector",
    "ConnectorCapabilities",
    "ConnectorRegistry",
    "ConnectorConfig",
    "StreamConfig",
    "AuthConfig",
    "ConnectorState",
    "SyncCheckpoint",
    "Record",
    "RecordBatch",
    # Lazy connector exports
    *_LAZY_CONNECTORS.keys(),
]

