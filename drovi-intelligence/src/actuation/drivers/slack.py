"""Slack actuation driver."""

from __future__ import annotations

from src.actuation.drivers.webhook_driver import WebhookDriver
from src.actuation.models import ActionTier


class SlackDriver(WebhookDriver):
    name = "slack"
    default_tier = ActionTier.LOW
    default_action = "post_message"
