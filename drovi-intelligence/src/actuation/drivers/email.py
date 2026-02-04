"""Email actuation driver (Resend-backed)."""

from __future__ import annotations

from typing import Any

from src.actuation.drivers.base import ActuatorDriver, DriverContext, DriverResult
from src.actuation.models import ActionTier
from src.notifications.resend import send_resend_email


class EmailDriver(ActuatorDriver):
    name = "email"
    default_tier = ActionTier.MEDIUM

    async def draft(self, context: DriverContext, payload: dict[str, Any]) -> dict[str, Any]:
        subject = payload.get("subject") or "Drovi Update"
        text = payload.get("text") or payload.get("body") or ""
        html = payload.get("html") or f"<pre>{text}</pre>"
        to_emails = payload.get("to") or payload.get("recipients") or []
        return {
            "to": to_emails,
            "subject": subject,
            "text": text,
            "html": html,
            "tags": payload.get("tags", {}),
        }

    async def stage(self, context: DriverContext, draft: dict[str, Any]) -> dict[str, Any]:
        recipients = draft.get("to") or []
        if isinstance(recipients, str):
            recipients = [recipients]
        if not recipients:
            raise ValueError("Email driver requires recipients")
        draft["to"] = recipients
        return draft

    async def execute(self, context: DriverContext, staged: dict[str, Any]) -> DriverResult:
        success = await send_resend_email(
            to_emails=staged["to"],
            subject=staged.get("subject", "Drovi Update"),
            html_body=staged.get("html", ""),
            text_body=staged.get("text", ""),
            tags=staged.get("tags"),
        )
        status = "sent" if success else "failed"
        rollback_payload = {
            "to": staged.get("to"),
            "subject": f"Correction: {staged.get('subject', 'Drovi Update')}",
            "text": staged.get("rollback_text", "Please disregard the previous message."),
            "html": staged.get("rollback_html", "<p>Please disregard the previous message.</p>"),
        }
        return DriverResult(status=status, data={"sent": success}, rollback_payload=rollback_payload)

    async def rollback(self, context: DriverContext, rollback_payload: dict[str, Any]) -> DriverResult:
        success = await send_resend_email(
            to_emails=rollback_payload.get("to", []),
            subject=rollback_payload.get("subject", "Correction"),
            html_body=rollback_payload.get("html", ""),
            text_body=rollback_payload.get("text", ""),
        )
        status = "sent" if success else "failed"
        return DriverResult(status=status, data={"sent": success})
