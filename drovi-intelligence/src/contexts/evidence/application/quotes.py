"""Evidence quote helpers.

This module lives in the Evidence context because:
- quote spans are the atomic "proof" unit we attach to truth objects (UIOs)
- downstream policies (no-evidence => no-persist) are expressed in terms of quotes
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from src.ingestion.unified_event import build_segment_hash


def has_evidence(quoted_text: str | None) -> bool:
    """Return True when quoted evidence is present."""
    return bool(quoted_text and quoted_text.strip())


def segment_hash_from_quote(quoted_text: str | None) -> str | None:
    """Build a stable segment hash for a quote span, if present."""
    if not has_evidence(quoted_text):
        return None
    return build_segment_hash((quoted_text or "").strip())


def resolve_message_id(messages: Sequence[Any] | None, quoted_text: str | None) -> str | None:
    """Best-effort resolve the source message id for evidence linkage.

    This intentionally accepts `Any` because upstream "message" shapes vary across
    ingestion sources and tests. We only require `.id` and (optionally) `.content`.
    """
    if not messages:
        return None

    if quoted_text:
        needle = quoted_text.strip().lower()
        if needle:
            for message in messages:
                content = (getattr(message, "content", None) or "").lower()
                if needle in content:
                    message_id = getattr(message, "id", None)
                    return str(message_id) if message_id else None

    if len(messages) == 1:
        message_id = getattr(messages[0], "id", None)
        return str(message_id) if message_id else None

    # Fallback: first message.
    message_id = getattr(messages[0], "id", None)
    return str(message_id) if message_id else None

