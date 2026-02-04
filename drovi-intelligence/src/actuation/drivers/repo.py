"""Repository actuation driver."""

from __future__ import annotations

from src.actuation.drivers.webhook_driver import WebhookDriver
from src.actuation.models import ActionTier


class RepoDriver(WebhookDriver):
    name = "repo"
    default_tier = ActionTier.HIGH
    default_action = "open_pr"
