"""Email connectors."""

from src.connectors.sources.email.gmail.connector import GmailConnector
from src.connectors.sources.email.outlook.connector import OutlookConnector

__all__ = ["GmailConnector", "OutlookConnector"]
