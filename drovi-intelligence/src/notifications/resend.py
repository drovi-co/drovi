"""Resend email client."""

from __future__ import annotations

from typing import Iterable

import httpx
import structlog

from src.config import get_settings
from src.connectors.http import request_with_retry

logger = structlog.get_logger()


def _dedupe_emails(emails: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for email in emails:
        normalized = email.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


async def send_resend_email(
    *,
    to_emails: Iterable[str],
    subject: str,
    html_body: str,
    text_body: str,
    tags: dict[str, str] | None = None,
) -> bool:
    settings = get_settings()

    if not settings.resend_api_key or not settings.resend_from:
        logger.info(
            "Resend email skipped (missing configuration)",
            has_api_key=bool(settings.resend_api_key),
            has_from=bool(settings.resend_from),
        )
        return False

    recipients = _dedupe_emails(to_emails)
    if not recipients:
        logger.info("Resend email skipped (no recipients)", subject=subject)
        return False

    payload: dict[str, object] = {
        "from": settings.resend_from,
        "to": recipients,
        "subject": subject,
        "html": html_body,
        "text": text_body,
    }
    if settings.resend_reply_to:
        payload["reply_to"] = settings.resend_reply_to
    if tags:
        payload["tags"] = [{"name": key, "value": value} for key, value in tags.items()]

    url = settings.resend_api_url.rstrip("/") + "/emails"
    headers = {
        "Authorization": f"Bearer {settings.resend_api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=settings.resend_timeout_seconds) as client:
        response = await request_with_retry(
            client,
            "POST",
            url,
            headers=headers,
            json=payload,
            max_attempts=3,
        )

    if response.status_code >= 400:
        logger.warning(
            "Resend email failed",
            subject=subject,
            status_code=response.status_code,
            body=response.text,
        )
        return False

    logger.info(
        "Resend email sent",
        subject=subject,
        recipient_count=len(recipients),
    )
    return True
