"""
Source Connectors

Implementations of BaseConnector for various data sources.
"""

# Email
from src.connectors.sources.email.gmail.connector import GmailConnector
from src.connectors.sources.email.outlook.connector import OutlookConnector

# Messaging
from src.connectors.sources.messaging.slack.connector import SlackConnector

# Productivity
from src.connectors.sources.productivity.notion.connector import NotionConnector
from src.connectors.sources.productivity.google_docs.connector import GoogleDocsConnector

# Calendar
from src.connectors.sources.calendar.google_calendar import GoogleCalendarConnector

# CRM
from src.connectors.sources.crm.hubspot import HubSpotConnector

__all__ = [
    # Email
    "GmailConnector",
    "OutlookConnector",
    # Messaging
    "SlackConnector",
    # Productivity
    "NotionConnector",
    "GoogleDocsConnector",
    # Calendar
    "GoogleCalendarConnector",
    # CRM
    "HubSpotConnector",
]
