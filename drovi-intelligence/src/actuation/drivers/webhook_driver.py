"""Generic webhook-backed actuation driver."""

from __future__ import annotations

from typing import Any

from src.actuation.drivers.base import ActuatorDriver, DriverContext, DriverResult
from src.actuation.models import ActionTier
from src.actuation.webhook import send_actuation_webhook


class WebhookDriver(ActuatorDriver):
    """Base class for drivers that emit outbound webhooks."""

    name = "webhook"
    default_tier = ActionTier.MEDIUM
    default_action: str = "execute"

    async def draft(self, context: DriverContext, payload: dict[str, Any]) -> dict[str, Any]:
        return payload

    async def stage(self, context: DriverContext, draft: dict[str, Any]) -> dict[str, Any]:
        return draft

    async def execute(self, context: DriverContext, staged: dict[str, Any]) -> DriverResult:
        response = await send_actuation_webhook(
            driver=self.name,
            action=staged.get("action", self.default_action),
            organization_id=context.organization_id,
            payload=staged,
        )
        return DriverResult(
            status=response.get("status", "sent"),
            detail=response.get("detail"),
            data=response,
            rollback_payload=response.get("rollback_payload"),
        )
