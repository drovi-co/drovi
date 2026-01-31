"""
Universal Connector System

Provides a modular, extensible framework for connecting to any data source.
Enables the intelligence backend to operate as a standalone system.
"""

from src.connectors.base.connector import BaseConnector, ConnectorCapabilities, ConnectorRegistry
from src.connectors.base.config import ConnectorConfig, StreamConfig, AuthConfig
from src.connectors.base.state import ConnectorState, SyncCheckpoint
from src.connectors.base.records import Record, RecordBatch

# =============================================================================
# PRIMARY CONNECTORS (User-facing data sources)
# =============================================================================

# Email
from src.connectors.sources.email.gmail.connector import GmailConnector
from src.connectors.sources.email.outlook.connector import OutlookConnector

# Messaging
from src.connectors.sources.messaging.slack.connector import SlackConnector
from src.connectors.sources.messaging.teams.connector import TeamsConnector
from src.connectors.sources.messaging.whatsapp.connector import WhatsAppConnector

# Calendar
from src.connectors.sources.calendar.google_calendar import GoogleCalendarConnector

# Productivity
from src.connectors.sources.productivity.notion.connector import NotionConnector
from src.connectors.sources.productivity.google_docs.connector import GoogleDocsConnector

# CRM
from src.connectors.sources.crm.hubspot import HubSpotConnector

# =============================================================================
# EXPORTS
# =============================================================================

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
    # Email connectors
    "GmailConnector",
    "OutlookConnector",
    # Messaging connectors
    "SlackConnector",
    "TeamsConnector",
    "WhatsAppConnector",
    # Calendar connectors
    "GoogleCalendarConnector",
    # Productivity connectors
    "NotionConnector",
    "GoogleDocsConnector",
    # CRM connectors
    "HubSpotConnector",
]
