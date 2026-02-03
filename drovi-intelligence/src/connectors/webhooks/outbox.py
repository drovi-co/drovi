"""
Webhook outbox publisher.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import structlog

from src.db.client import get_db_pool
from src.db.rls import set_rls_context
from src.streaming import get_kafka_producer, is_streaming_enabled

logger = structlog.get_logger()


async def flush_webhook_outbox(limit: int = 100) -> int:
    """Publish pending webhook outbox entries to Kafka."""
    if not is_streaming_enabled():
        return 0

    producer = await get_kafka_producer()
    pool = await get_db_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, organization_id, payload
            FROM connector_webhook_outbox
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT $1
            """,
            limit,
        )

    published_count = 0
    for row in rows:
        outbox_id = str(row["id"])
        organization_id = row["organization_id"]
        payload: dict[str, Any] = row["payload"] or {}

        set_rls_context(organization_id, is_internal=True)
        try:
            await producer.produce_raw_event(
                organization_id=organization_id,
                source_type="connector_webhook",
                event_type="connector.webhook",
                payload=payload,
                source_id=str(payload.get("inbox_id") or outbox_id),
            )

            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE connector_webhook_outbox
                    SET status = 'published', published_at = $2, last_attempt_at = $2,
                        attempt_count = attempt_count + 1
                    WHERE id = $1
                    """,
                    outbox_id,
                    datetime.utcnow(),
                )
            published_count += 1

        except Exception as e:
            logger.warning(
                "Failed to publish webhook outbox entry",
                outbox_id=outbox_id,
                error=str(e),
            )
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE connector_webhook_outbox
                    SET status = 'failed', last_attempt_at = $2, attempt_count = attempt_count + 1
                    WHERE id = $1
                    """,
                    outbox_id,
                    datetime.utcnow(),
                )
        finally:
            set_rls_context(None, is_internal=False)

    return published_count
