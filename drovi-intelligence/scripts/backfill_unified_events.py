#!/usr/bin/env python3
"""
Backfill unified_event from existing conversation/message records.
"""

import asyncio
import hashlib
import os

import asyncpg

from src.config import get_settings


def _hash_event(content: str, source_fingerprint: str) -> str:
    payload = f"{source_fingerprint}::{content}".encode("utf-8", errors="ignore")
    return hashlib.sha256(payload).hexdigest()


def _event_type_from_conversation(conv_type: str | None) -> str:
    mapping = {
        "thread": "message",
        "channel": "message",
        "chat": "message",
        "event": "meeting",
        "meeting": "meeting",
        "call": "call",
        "recording": "recording",
        "page": "document",
        "document": "document",
    }
    return mapping.get(conv_type or "", "other")


async def main() -> None:
    settings = get_settings()
    db_url = str(settings.database_url).replace("postgresql+asyncpg://", "postgresql://")
    limit = int(os.getenv("BACKFILL_BATCH", "500"))

    conn = await asyncpg.connect(db_url)
    offset = 0
    total = 0

    while True:
        rows = await conn.fetch(
            """
            SELECT
                m.id as message_id,
                m.body_text as content_text,
                m.sent_at as captured_at,
                m.received_at as received_at,
                m.external_id as message_external_id,
                c.external_id as conversation_external_id,
                c.conversation_type as conversation_type,
                c.source_account_id as source_account_id,
                sa.organization_id as organization_id,
                sa.type as source_type
            FROM message m
            JOIN conversation c ON m.conversation_id = c.id
            JOIN source_account sa ON c.source_account_id = sa.id
            ORDER BY m.created_at ASC
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )

        if not rows:
            break

        for row in rows:
            content_text = row["content_text"] or ""
            source_fingerprint = "|".join(
                [
                    row["source_type"] or "",
                    row["conversation_external_id"] or "",
                    row["message_external_id"] or "",
                ]
            )
            content_hash = _hash_event(content_text, source_fingerprint)

            exists = await conn.fetchval(
                """
                SELECT 1 FROM unified_event
                WHERE organization_id = $1 AND content_hash = $2
                """,
                row["organization_id"],
                content_hash,
            )
            if exists:
                continue

            await conn.execute(
                """
                INSERT INTO unified_event (
                    id, organization_id, source_type, source_id,
                    source_account_id, conversation_id, message_id,
                    event_type, content_text, content_json,
                    participants, metadata, content_hash,
                    captured_at, received_at, evidence_artifact_id
                ) VALUES (
                    gen_random_uuid(), $1, $2, $3,
                    $4, $5, $6,
                    $7, $8, $9,
                    $10, $11, $12,
                    $13, $14, $15
                )
                ON CONFLICT (organization_id, content_hash) DO NOTHING
                """,
                row["organization_id"],
                row["source_type"] or "api",
                row["conversation_external_id"],
                row["source_account_id"],
                row["conversation_external_id"],
                row["message_external_id"],
                _event_type_from_conversation(row["conversation_type"]),
                content_text,
                "{}",
                "[]",
                "{}",
                content_hash,
                row["captured_at"],
                row["received_at"],
                None,
            )
            total += 1

        offset += limit

    await conn.close()
    print(f"Backfilled {total} unified_event rows")


if __name__ == "__main__":
    asyncio.run(main())
