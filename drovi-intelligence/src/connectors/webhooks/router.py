"""
Webhook Router

FastAPI router for receiving webhooks from external providers.
Handles verification, parsing, and processing of incoming webhooks.
"""

import hashlib
import hmac
import json
from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, Header, HTTPException, Request

logger = structlog.get_logger()

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


# =============================================================================
# SLACK WEBHOOKS
# =============================================================================


@router.post("/slack")
async def slack_webhook(
    request: Request,
    x_slack_signature: str = Header(None, alias="X-Slack-Signature"),
    x_slack_request_timestamp: str = Header(None, alias="X-Slack-Request-Timestamp"),
):
    """
    Receive webhooks from Slack Events API.

    Handles:
    - URL verification challenges
    - Event callbacks (messages, reactions, etc.)
    """
    body = await request.body()

    # Verify signature
    if not await _verify_slack_signature(body, x_slack_signature, x_slack_request_timestamp):
        logger.warning("Invalid Slack signature")
        raise HTTPException(status_code=401, detail="Invalid signature")

    payload = json.loads(body)

    # Handle URL verification challenge
    if payload.get("type") == "url_verification":
        return {"challenge": payload.get("challenge")}

    # Handle event callbacks
    if payload.get("type") == "event_callback":
        event = payload.get("event", {})
        event_type = event.get("type")

        logger.info(
            "Slack event received",
            event_type=event_type,
            team_id=payload.get("team_id"),
        )

        # Queue for async processing
        await _queue_slack_event(payload)

        return {"ok": True}

    return {"ok": True}


async def _verify_slack_signature(
    body: bytes,
    signature: str | None,
    timestamp: str | None,
) -> bool:
    """Verify Slack request signature using HMAC-SHA256."""
    from src.config import get_settings

    if not signature or not timestamp:
        return False

    settings = get_settings()
    signing_secret = getattr(settings, "slack_signing_secret", None)
    if not signing_secret:
        logger.warning("Slack signing secret not configured, skipping verification")
        return True  # Allow in dev mode

    # Check timestamp to prevent replay attacks
    import time as time_module
    try:
        req_timestamp = int(timestamp)
        now = int(time_module.time())
        if abs(now - req_timestamp) > 300:  # 5 minute window
            return False
    except ValueError:
        return False

    # Compute signature
    sig_basestring = f"v0:{timestamp}:{body.decode('utf-8')}"
    computed_sig = "v0=" + hmac.new(
        signing_secret.encode(),
        sig_basestring.encode(),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(computed_sig, signature)


async def _queue_slack_event(payload: dict[str, Any]) -> None:
    """Queue a Slack event for async processing."""
    from src.connectors.webhooks.handlers.slack import SlackWebhookHandler

    handler = SlackWebhookHandler()
    await handler.handle_event(payload)


# =============================================================================
# GMAIL WEBHOOKS (PUSH NOTIFICATIONS)
# =============================================================================


@router.post("/gmail")
async def gmail_webhook(request: Request):
    """
    Receive push notifications from Gmail.

    Gmail uses Pub/Sub for push notifications.
    """
    body = await request.json()

    logger.info(
        "Gmail push notification received",
        message_id=body.get("message", {}).get("messageId"),
    )

    # Parse Pub/Sub message
    message = body.get("message", {})
    if message:
        import base64

        data = message.get("data", "")
        if data:
            decoded = base64.b64decode(data).decode("utf-8")
            notification = json.loads(decoded)

            # Queue for async processing
            await _queue_gmail_notification(notification)

    return {"ok": True}


async def _queue_gmail_notification(notification: dict[str, Any]) -> None:
    """Queue a Gmail notification for async processing."""
    from src.connectors.webhooks.handlers.gmail import GmailWebhookHandler

    handler = GmailWebhookHandler()
    await handler.handle_notification(notification)


# =============================================================================
# NOTION WEBHOOKS
# =============================================================================


@router.post("/notion")
async def notion_webhook(request: Request):
    """
    Receive webhooks from Notion.

    Note: Notion webhooks are still in beta.
    """
    body = await request.json()

    logger.info(
        "Notion webhook received",
        workspace_id=body.get("workspace_id"),
    )

    # Queue for async processing
    await _queue_notion_event(body)

    return {"ok": True}


async def _queue_notion_event(payload: dict[str, Any]) -> None:
    """Queue a Notion event for async processing."""
    # Placeholder for Notion handler
    logger.info("Notion event queued for processing", event=payload.get("type"))


# =============================================================================
# MICROSOFT GRAPH WEBHOOKS (OUTLOOK)
# =============================================================================


@router.post("/microsoft")
async def microsoft_webhook(
    request: Request,
    validation_token: str | None = None,
):
    """
    Receive webhooks from Microsoft Graph (Outlook, Teams, etc.).

    Handles:
    - Subscription validation
    - Change notifications
    """
    # Handle validation request
    if validation_token:
        return validation_token

    body = await request.json()

    # Process change notifications
    value = body.get("value", [])
    for notification in value:
        logger.info(
            "Microsoft Graph notification received",
            subscription_id=notification.get("subscriptionId"),
            change_type=notification.get("changeType"),
        )

        # Queue for async processing
        await _queue_microsoft_notification(notification)

    return {"ok": True}


async def _queue_microsoft_notification(notification: dict[str, Any]) -> None:
    """Queue a Microsoft notification for async processing."""
    # Placeholder for Microsoft handler
    logger.info(
        "Microsoft notification queued for processing",
        change_type=notification.get("changeType"),
    )


# =============================================================================
# GENERIC WEBHOOK ENDPOINT
# =============================================================================


@router.post("/{provider}")
async def generic_webhook(provider: str, request: Request):
    """
    Generic webhook endpoint for other providers.

    Accepts webhooks from any provider and logs them for debugging.
    """
    body = await request.body()

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        payload = {"raw": body.decode("utf-8", errors="replace")}

    logger.info(
        "Generic webhook received",
        provider=provider,
        payload_size=len(body),
    )

    return {"ok": True, "provider": provider}


# =============================================================================
# WEBHOOK STATUS
# =============================================================================


@router.get("/status")
async def webhook_status():
    """
    Get webhook system status.

    Returns information about webhook endpoints and recent activity.
    """
    return {
        "status": "active",
        "endpoints": {
            "slack": "/webhooks/slack",
            "gmail": "/webhooks/gmail",
            "notion": "/webhooks/notion",
            "microsoft": "/webhooks/microsoft",
        },
        "timestamp": datetime.utcnow().isoformat(),
    }
