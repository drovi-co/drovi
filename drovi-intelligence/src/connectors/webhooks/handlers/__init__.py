"""
Webhook Handlers

Provider-specific handlers for processing incoming webhooks.
"""

from src.connectors.webhooks.handlers.slack import SlackWebhookHandler
from src.connectors.webhooks.handlers.gmail import GmailWebhookHandler
from src.connectors.webhooks.handlers.notion import NotionWebhookHandler
from src.connectors.webhooks.handlers.microsoft import MicrosoftWebhookHandler
from src.connectors.webhooks.handlers.teams import TeamsWebhookHandler
from src.connectors.webhooks.handlers.whatsapp import WhatsAppWebhookHandler

__all__ = [
    "SlackWebhookHandler",
    "GmailWebhookHandler",
    "NotionWebhookHandler",
    "MicrosoftWebhookHandler",
    "TeamsWebhookHandler",
    "WhatsAppWebhookHandler",
]
