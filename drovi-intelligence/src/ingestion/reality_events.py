"""Persist reality events into Unified Event Model."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import uuid4

from src.db import get_db_pool
from src.ingestion.event_types import normalize_event_type
from src.ingestion.unified_event import (
    build_event_hash,
    build_source_fingerprint,
    build_uem_metadata,
)


def _normalize_participants(participants: list[dict] | None) -> list[dict]:
    normalized = []
    for participant in participants or []:
        if not isinstance(participant, dict):
            continue
        normalized.append({
            "email": participant.get("email"),
            "name": participant.get("name"),
            "role": participant.get("role"),
        })
    return normalized


async def persist_reality_event(
    *,
    organization_id: str,
    source_type: str,
    event_type: str,
    content_text: str | None = None,
    content_json: dict[str, Any] | list[Any] | None = None,
    participants: list[dict] | None = None,
    metadata: dict[str, Any] | None = None,
    source_id: str | None = None,
    source_account_id: str | None = None,
    conversation_id: str | None = None,
    message_id: str | None = None,
    captured_at: datetime | None = None,
    received_at: datetime | None = None,
    evidence_artifact_id: str | None = None,
) -> tuple[str, bool]:
    pool = await get_db_pool()
    event_type = normalize_event_type(event_type)
    captured_at = captured_at or received_at
    received_at = received_at or datetime.utcnow()

    source_fingerprint = build_source_fingerprint(
        source_type,
        source_id,
        conversation_id,
        message_id,
        event_type,
    )
    content_hash = build_event_hash(content_text, content_json, source_fingerprint)
    uem_metadata = build_uem_metadata(
        metadata,
        source_fingerprint,
        content_hash,
        captured_at,
        received_at,
    )

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id FROM unified_event
            WHERE organization_id = $1 AND content_hash = $2
            """,
            organization_id,
            content_hash,
        )
        if row:
            return row["id"], False

        event_id = str(uuid4())
        await conn.execute(
            """
            INSERT INTO unified_event (
                id, organization_id, source_type, source_id,
                source_account_id, conversation_id, message_id,
                event_type, content_text, content_json,
                participants, metadata, content_hash,
                captured_at, received_at, evidence_artifact_id
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7,
                $8, $9, $10,
                $11, $12, $13,
                $14, $15, $16
            )
            ON CONFLICT (organization_id, content_hash) DO NOTHING
            """,
            event_id,
            organization_id,
            source_type,
            source_id,
            source_account_id,
            conversation_id,
            message_id,
            event_type,
            content_text,
            json.dumps(content_json) if content_json is not None else None,
            json.dumps(_normalize_participants(participants)),
            json.dumps(uem_metadata),
            content_hash,
            captured_at,
            received_at,
            evidence_artifact_id,
        )

        return event_id, True
