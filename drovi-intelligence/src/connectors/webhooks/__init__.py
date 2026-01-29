"""
Webhook System

Handles both incoming webhooks (from external providers like Slack, Gmail)
and outgoing webhooks (notifying external systems of events).
"""

from src.connectors.webhooks.router import router as webhook_router
from src.connectors.webhooks.service import WebhookService, get_webhook_service

__all__ = [
    "webhook_router",
    "WebhookService",
    "get_webhook_service",
]
