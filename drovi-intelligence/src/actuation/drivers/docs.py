"""Docs actuation driver."""

from __future__ import annotations

from src.actuation.drivers.webhook_driver import WebhookDriver
from src.actuation.models import ActionTier


class DocsDriver(WebhookDriver):
    name = "docs"
    default_tier = ActionTier.MEDIUM
    default_action = "update_document"
