"""
Productivity Connectors

Connectors for productivity tools like Notion, Google Docs, etc.
"""

from src.connectors.sources.productivity.notion.connector import NotionConnector
from src.connectors.sources.productivity.google_docs.connector import GoogleDocsConnector

__all__ = ["NotionConnector", "GoogleDocsConnector"]
