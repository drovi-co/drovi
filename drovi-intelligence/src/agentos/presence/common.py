from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any

from src.kernel.time import utc_now


APPROVAL_PATTERN = re.compile(
    r"^\s*(approve|deny)\s+(agapr_[A-Za-z0-9]+)(?:\s*[:\-]\s*(.+))?\s*$",
    flags=re.IGNORECASE,
)
MENTION_PATTERN = re.compile(r"@([A-Za-z0-9_\-.]+)")


def row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping if hasattr(row, "_mapping") else row)


def coerce_datetime(value: datetime | str | None) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return utc_now()


def normalize_email(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    return normalized or None


def normalize_recipients(value: list[str] | None) -> list[str]:
    if not value:
        return []
    recipients: list[str] = []
    for item in value:
        email = normalize_email(item)
        if email:
            recipients.append(email)
    return sorted(set(recipients))


def slug(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "agent"


def topic_key(channel_type: str, organization_id: str) -> str:
    digest = hashlib.sha256(f"{organization_id}:{channel_type}".encode("utf-8")).hexdigest()[:10]
    return f"{organization_id}:{channel_type}:{digest}"


def build_external_thread_id(
    *,
    channel_type: str,
    sender: str,
    subject: str | None,
    explicit_target: str | None,
    raw_payload: dict[str, Any] | None,
) -> str:
    payload = raw_payload or {}
    if channel_type == "slack":
        thread_ts = payload.get("thread_ts") or payload.get("ts")
        if thread_ts:
            return str(thread_ts)
    if channel_type == "teams":
        conversation_id = payload.get("conversation_id") or payload.get("replyToId") or payload.get("id")
        if conversation_id:
            return str(conversation_id)
    if payload.get("message_id"):
        return str(payload["message_id"])
    seed = f"{channel_type}:{explicit_target or sender}:{subject or ''}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]
    return f"{channel_type}-{digest}"


def build_continuity_key(
    *,
    channel_type: str,
    sender: str,
    channel_target: str,
    subject: str | None,
) -> str:
    subject_key = re.sub(r"\s+", " ", (subject or "").strip().lower())[:80]
    return f"{channel_type}:{channel_target.lower()}:{sender}:{subject_key}"
