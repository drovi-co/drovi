"""
Record normalization helpers.

Convert connector Records into pipeline-ready content + metadata.
"""

from dataclasses import dataclass
from datetime import datetime
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


def _build_base_metadata(record: Record) -> dict[str, Any]:
    extracted_at = record.extracted_at
    extracted_at_value: str | None = None
    if isinstance(extracted_at, datetime):
        extracted_at_value = extracted_at.isoformat()
    elif extracted_at is not None:
        extracted_at_value = str(extracted_at)

    return {
        "record_id": record.record_id,
        "stream_name": record.stream_name,
        "record_type": record.record_type.value if hasattr(record, "record_type") else None,
        "source_type": record.source_type,
        "cursor_value": record.cursor_value,
        "raw_data_hash": record.raw_data_hash,
        "extracted_at": extracted_at_value,
    }


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


def _document_content(record: Record) -> tuple[str, str | None]:
    data = record.data if isinstance(record.data, dict) else {}
    title = (
        data.get("title")
        or data.get("name")
        or data.get("subject")
        or data.get("summary")
        or ""
    )
    body_text = (
        data.get("content_text")
        or data.get("content")
        or data.get("body_text")
        or data.get("text")
        or ""
    )

    parts = []
    if title:
        parts.append(f"Title: {title}")
    if body_text:
        parts.append(body_text)
    content = "\n\n".join(parts).strip()
    return content, title or None


def _event_content(record: Record) -> tuple[str, str | None]:
    data = record.data if isinstance(record.data, dict) else {}
    title = (
        data.get("summary")
        or data.get("title")
        or data.get("subject")
        or data.get("name")
        or ""
    )
    description = (
        data.get("description")
        or data.get("body")
        or data.get("notes")
        or ""
    )
    start_time = (
        data.get("start_time")
        or data.get("start")
        or data.get("startDateTime")
        or data.get("start_date")
    )
    end_time = (
        data.get("end_time")
        or data.get("end")
        or data.get("endDateTime")
        or data.get("end_date")
    )

    parts = []
    if title:
        parts.append(f"Event: {title}")
    if description:
        parts.append(description)
    if start_time or end_time:
        if start_time and end_time:
            parts.append(f"Time: {start_time} → {end_time}")
        else:
            parts.append(f"Time: {start_time or end_time}")

    content = "\n\n".join(parts).strip()
    return content, title or None


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
    base_metadata = _build_base_metadata(record)

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
                **base_metadata,
                "source_record_type": record.record_type.value,
                "raw": data,
                "subject": subject,
                "unified": unified.model_dump(),
            }
            return NormalizedRecord(
                content=content,
                metadata=metadata,
                source_type=default_source_type or getattr(unified, "source_type", record.source_type),
                conversation_id=getattr(unified, "conversation_id", None),
                user_email=getattr(unified, "sender_email", None),
                user_name=getattr(unified, "sender_name", None),
                subject=subject,
            )
        except Exception:
            # Fall back to generic content if normalization fails.
            pass

    if record.record_type == RecordType.DOCUMENT:
        content, subject = _document_content(record)
        metadata = {
            **base_metadata,
            "source_record_type": record.record_type.value,
            "raw": data,
            "subject": subject,
        }
        return NormalizedRecord(
            content=content,
            metadata=metadata,
            source_type=default_source_type or record.source_type,
            user_email=data.get("owner_email") or data.get("author_email"),
            user_name=data.get("owner_name") or data.get("author_name"),
            subject=subject,
        )

    if record.record_type == RecordType.EVENT:
        content, subject = _event_content(record)
        organizer_email = data.get("organizer_email")
        organizer_name = data.get("organizer_name")
        organizer = data.get("organizer")
        if isinstance(organizer, dict):
            organizer_email = organizer_email or organizer.get("email")
            organizer_name = organizer_name or organizer.get("display_name") or organizer.get("name")
        metadata = {
            **base_metadata,
            "source_record_type": record.record_type.value,
            "raw": data,
            "subject": subject,
        }
        return NormalizedRecord(
            content=content,
            metadata=metadata,
            source_type=default_source_type or record.source_type,
            user_email=organizer_email,
            user_name=organizer_name,
            subject=subject,
        )

    content, subject = _fallback_content(record)
    metadata = {
        **base_metadata,
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
        source_type=default_source_type or record.source_type,
        conversation_id=conversation_id,
        user_email=data.get("sender_email") or data.get("from"),
        user_name=data.get("sender_name") or data.get("from_name"),
        subject=subject,
    )
