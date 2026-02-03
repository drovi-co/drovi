"""
Record normalization helpers.

Convert connector Records into pipeline-ready content + metadata.
"""

from dataclasses import dataclass
from typing import Any

from src.connectors.base.config import ConnectorConfig
from src.connectors.base.connector import BaseConnector
from src.connectors.base.records import Record, RecordType


@dataclass
class NormalizedRecord:
    """Normalized record data used by the intelligence pipeline."""

    content: str
    metadata: dict[str, Any]
    source_type: str
    conversation_id: str | None = None
    user_email: str | None = None
    user_name: str | None = None
    subject: str | None = None


def _fallback_content(record: Record) -> tuple[str, str | None]:
    data = record.data if isinstance(record.data, dict) else {}

    subject = (
        data.get("subject")
        or data.get("summary")
        or data.get("name")
        or data.get("title")
        or ""
    )
    body_text = (
        data.get("body_text")
        or data.get("text")
        or data.get("content")
        or data.get("content_text")
        or data.get("body_content")
        or data.get("body_preview")
        or data.get("snippet")
        or data.get("description")
        or data.get("notes")
        or ""
    )
    parts = []
    if subject:
        parts.append(f"Subject: {subject}")
    if body_text:
        parts.append(body_text)
    content = "\n\n".join(parts).strip()
    return content, subject or None


def normalize_record_for_pipeline(
    record: Record,
    connector: BaseConnector,
    config: ConnectorConfig,
    default_source_type: str,
) -> NormalizedRecord:
    """
    Normalize a Record into content + metadata for the intelligence pipeline.
    """
    data = record.data if isinstance(record.data, dict) else {}

    if record.record_type == RecordType.MESSAGE and hasattr(connector, "to_unified_message"):
        try:
            unified = connector.to_unified_message(record, config)
            subject = getattr(unified, "subject", None)
            body_text = getattr(unified, "body_text", "") or ""
            parts = []
            if subject:
                parts.append(f"Subject: {subject}")
            if body_text:
                parts.append(body_text)
            content = "\n\n".join(parts).strip()
            metadata = {
                "source_record_type": record.record_type.value,
                "raw": data,
                "subject": subject,
                "unified": unified.model_dump(),
            }
            return NormalizedRecord(
                content=content,
                metadata=metadata,
                source_type=default_source_type or getattr(unified, "source_type", "api"),
                conversation_id=getattr(unified, "conversation_id", None),
                user_email=getattr(unified, "sender_email", None),
                user_name=getattr(unified, "sender_name", None),
                subject=subject,
            )
        except Exception:
            # Fall back to generic content if normalization fails.
            pass

    content, subject = _fallback_content(record)
    metadata = {
        "source_record_type": record.record_type.value if hasattr(record, "record_type") else None,
        "raw": data,
        "subject": subject,
    }

    conversation_id = (
        data.get("thread_id")
        or data.get("conversation_id")
        or data.get("channel_id")
        or data.get("chat_id")
    )

    return NormalizedRecord(
        content=content,
        metadata=metadata,
        source_type=default_source_type,
        conversation_id=conversation_id,
        user_email=data.get("sender_email") or data.get("from"),
        user_name=data.get("sender_name") or data.get("from_name"),
        subject=subject,
    )
