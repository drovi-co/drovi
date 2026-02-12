"""Unified Object Source (evidence span) persistence helpers.

The `unified_object_source` table is the canonical link between a truth object (UIO)
and the evidence span (quote) it came from. Many UIO persisters write to this table;
centralizing the insert avoids subtle schema drift and keeps the code DRY.
"""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import text

from src.contexts.evidence.application.quotes import segment_hash_from_quote
from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope


async def insert_uio_source(
    *,
    session,
    envelope: PersistEnvelope,
    uio_id: str,
    role: str,
    message_id: str | None,
    quoted_text: str | None,
    quoted_text_start: int | None = None,
    quoted_text_end: int | None = None,
    extracted_title: str | None = None,
    extracted_due_date: datetime | None = None,
    extracted_status: str | None = None,
    confidence: float | None,
    now: datetime,
    source_timestamp: datetime | None = None,
    detection_method: str = "llm_extraction",
) -> str:
    """Insert a `unified_object_source` row and return its id.

    Notes:
    - We keep timestamps explicit (`now`, `source_timestamp`) so callers can reuse a single
      clock value across multiple inserts for the same persisted entity.
    - `quoted_text_start/end` are stored as text in the current schema; we accept ints
      because upstream extraction often emits offsets as integers.
    """

    source_id = str(uuid4())
    await session.execute(
        text(
            """
            INSERT INTO unified_object_source (
                id, unified_object_id, source_type,
                source_account_id, role,
                conversation_id, message_id,
                quoted_text, quoted_text_start, quoted_text_end,
                segment_hash, extracted_title,
                extracted_due_date, extracted_status,
                confidence, added_at, source_timestamp,
                detection_method,
                created_at
            ) VALUES (
                :id, :uio_id, :source_type,
                :source_account_id, :role,
                :conversation_id, :message_id,
                :quoted_text, :quoted_text_start, :quoted_text_end,
                :segment_hash, :extracted_title,
                :extracted_due_date, :extracted_status,
                :confidence, :now, :source_timestamp,
                :detection_method,
                :now
            )
            """
        ),
        {
            "id": source_id,
            "uio_id": uio_id,
            "source_type": envelope.source_type or "email",
            "source_account_id": envelope.source_account_id,
            "role": role,
            "conversation_id": envelope.conversation_id,
            "message_id": message_id,
            "quoted_text": quoted_text,
            "quoted_text_start": quoted_text_start,
            "quoted_text_end": quoted_text_end,
            "segment_hash": segment_hash_from_quote(quoted_text),
            "extracted_title": extracted_title,
            "extracted_due_date": extracted_due_date,
            "extracted_status": extracted_status,
            "confidence": confidence if confidence is not None else 0.5,
            "now": now,
            "source_timestamp": source_timestamp or now,
            "detection_method": detection_method,
        },
    )
    return source_id


async def insert_uio_sources_batch(
    *,
    session,
    envelope: PersistEnvelope,
    uio_id: str,
    inserts: list[dict[str, object]],
    now: datetime,
) -> list[str]:
    """Insert many `unified_object_source` rows in one executemany call.

    This is primarily used for *supporting evidence spans* where we can amortize
    round-trips to Postgres. Callers can keep `insert_uio_source` for the origin
    evidence span when they need the generated id immediately.
    """
    if not inserts:
        return []

    params_list: list[dict[str, object]] = []
    ids: list[str] = []

    for ins in inserts:
        source_id = str(uuid4())
        ids.append(source_id)

        quoted_text = ins.get("quoted_text") if isinstance(ins, dict) else None
        params_list.append(
            {
                "id": source_id,
                "uio_id": uio_id,
                "source_type": envelope.source_type or "email",
                "source_account_id": envelope.source_account_id,
                "role": str(ins.get("role") or "supporting"),
                "conversation_id": envelope.conversation_id,
                "message_id": ins.get("message_id"),
                "quoted_text": quoted_text,
                "quoted_text_start": ins.get("quoted_text_start"),
                "quoted_text_end": ins.get("quoted_text_end"),
                "segment_hash": segment_hash_from_quote(quoted_text if isinstance(quoted_text, str) else None),
                "extracted_title": ins.get("extracted_title"),
                "extracted_due_date": ins.get("extracted_due_date"),
                "extracted_status": ins.get("extracted_status"),
                "confidence": float(ins.get("confidence") or 0.5),
                "now": now,
                "source_timestamp": ins.get("source_timestamp") or now,
                "detection_method": str(ins.get("detection_method") or "llm_extraction"),
            }
        )

    await session.execute(
        text(
            """
            INSERT INTO unified_object_source (
                id, unified_object_id, source_type,
                source_account_id, role,
                conversation_id, message_id,
                quoted_text, quoted_text_start, quoted_text_end,
                segment_hash, extracted_title,
                extracted_due_date, extracted_status,
                confidence, added_at, source_timestamp,
                detection_method,
                created_at
            ) VALUES (
                :id, :uio_id, :source_type,
                :source_account_id, :role,
                :conversation_id, :message_id,
                :quoted_text, :quoted_text_start, :quoted_text_end,
                :segment_hash, :extracted_title,
                :extracted_due_date, :extracted_status,
                :confidence, :now, :source_timestamp,
                :detection_method,
                :now
            )
            """
        ),
        params_list,
    )

    return ids
