"""CRM actuation driver."""

from __future__ import annotations

from src.actuation.drivers.webhook_driver import WebhookDriver
from src.actuation.models import ActionTier


class CRMDriver(WebhookDriver):
    name = "crm"
    default_tier = ActionTier.HIGH
    default_action = "update_record"
