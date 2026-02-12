"""UIO timeline event persistence.

Timeline is an append-only audit of "what happened" to a UIO over time.
"""

from __future__ import annotations

import json
from uuid import uuid4

from sqlalchemy import text

from src.kernel.time import utc_now_naive as utc_now


async def create_timeline_event(
    *,
    session,
    uio_id: str,
    event_type: str,
    event_description: str,
    source_type: str | None = None,
    source_id: str | None = None,
    source_name: str | None = None,
    quoted_text: str | None = None,
    previous_value: dict | None = None,
    new_value: dict | None = None,
    evidence_id: str | None = None,
    confidence: float | None = None,
    triggered_by: str = "system",
) -> None:
    """Insert a timeline event for a UIO."""
    event_id = str(uuid4())
    now = utc_now()

    if evidence_id:
        merged_new_value = dict(new_value or {})
        merged_new_value["evidence_id"] = evidence_id
        new_value = merged_new_value

    await session.execute(
        text(
            """
            INSERT INTO unified_object_timeline (
                id, unified_object_id,
                event_type, event_description,
                previous_value, new_value,
                source_type, source_id, source_name,
                quoted_text, triggered_by, confidence,
                event_at, created_at
            ) VALUES (
                :id, :uio_id,
                :event_type, :event_description,
                :previous_value, :new_value,
                :source_type, :source_id, :source_name,
                :quoted_text, :triggered_by, :confidence,
                :event_at, :created_at
            )
            """
        ),
        {
            "id": event_id,
            "uio_id": uio_id,
            "event_type": event_type,
            "event_description": event_description,
            "previous_value": json.dumps(previous_value) if previous_value else None,
            "new_value": json.dumps(new_value) if new_value else None,
            "source_type": source_type,
            "source_id": source_id,
            "source_name": source_name,
            "quoted_text": quoted_text[:1000] if quoted_text else None,
            "triggered_by": triggered_by,
            "confidence": confidence,
            "event_at": now,
            "created_at": now,
        },
    )

