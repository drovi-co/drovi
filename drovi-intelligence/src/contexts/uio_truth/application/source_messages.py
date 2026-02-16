"""Helpers for resolving parsed source-message context."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any


@dataclass(slots=True, frozen=True)
class SourceMessageContext:
    message_id: str | None
    sender_email: str | None
    sender_name: str | None
    is_from_user: bool
    sent_at: datetime | None


def resolve_source_message_context(
    messages: list[Any] | tuple[Any, ...] | Any,
    message_id: str | None,
) -> SourceMessageContext | None:
    """Resolve sender/timestamp metadata from parsed messages."""
    if not messages:
        return None

    selected = None
    if message_id:
        for message in messages:
            if str(getattr(message, "id", "")) == str(message_id):
                selected = message
                break
    if selected is None:
        selected = messages[0]

    sent_at = getattr(selected, "sent_at", None)
    if isinstance(sent_at, datetime):
        sent_at = (
            sent_at.replace(tzinfo=UTC)
            if sent_at.tzinfo is None
            else sent_at.astimezone(UTC)
        )
    else:
        sent_at = None

    sender_email = getattr(selected, "sender_email", None)
    sender_name = getattr(selected, "sender_name", None)
    return SourceMessageContext(
        message_id=str(getattr(selected, "id", "") or "") or None,
        sender_email=str(sender_email).lower() if sender_email else None,
        sender_name=str(sender_name) if sender_name else None,
        is_from_user=bool(getattr(selected, "is_from_user", False)),
        sent_at=sent_at,
    )
