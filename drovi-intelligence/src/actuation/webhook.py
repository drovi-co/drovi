"""Outbound webhook helper for actuation drivers."""

from __future__ import annotations

from typing import Any

import httpx
import structlog

from src.config import get_settings
from src.connectors.http import request_with_retry

logger = structlog.get_logger()


async def send_actuation_webhook(
    *,
    driver: str,
    action: str,
    organization_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    settings = get_settings()
    url = settings.actuation_webhook_url
    if not url:
        logger.info("Actuation webhook skipped (no URL)", driver=driver, action=action)
        return {"status": "queued", "detail": "No webhook configured"}

    headers = {"Content-Type": "application/json"}
    if settings.actuation_webhook_secret:
        headers["X-Drovi-Webhook-Secret"] = settings.actuation_webhook_secret

    body = {
        "driver": driver,
        "action": action,
        "organization_id": organization_id,
        "payload": payload,
    }

    async with httpx.AsyncClient(timeout=settings.actuation_webhook_timeout_seconds) as client:
        response = await request_with_retry(
            client,
            "POST",
            url,
            json=body,
            headers=headers,
            max_attempts=3,
        )

    if response.status_code >= 400:
        logger.warning(
            "Actuation webhook failed",
            driver=driver,
            status_code=response.status_code,
            body=response.text,
        )
        return {"status": "failed", "detail": response.text}

    try:
        return response.json()
    except Exception:
        return {"status": "sent", "detail": response.text}
