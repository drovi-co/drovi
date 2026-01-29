"""
Microsoft Teams Connector

Extracts messages and channels from Microsoft Teams via Graph API.
"""

from src.connectors.sources.messaging.teams.connector import TeamsConnector

__all__ = ["TeamsConnector"]
