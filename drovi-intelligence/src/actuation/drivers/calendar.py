"""Calendar actuation driver."""

from __future__ import annotations

from src.actuation.drivers.webhook_driver import WebhookDriver
from src.actuation.models import ActionTier


class CalendarDriver(WebhookDriver):
    name = "calendar"
    default_tier = ActionTier.MEDIUM
    default_action = "create_event"
