"""
Connector webhook inbox/outbox helpers.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any
from uuid import uuid4

import structlog

from src.db.client import get_db_pool
from src.db.rls import set_rls_context
from src.streaming import get_kafka_producer, is_streaming_enabled

logger = structlog.get_logger()


def _build_idempotency_key(
    provider: str,
    connection_id: str,
    payload: dict[str, Any],
    event_id: str | None = None,
) -> str:
    if event_id:
        return f"{provider}:{connection_id}:{event_id}"
    payload_str = json.dumps(payload, sort_keys=True, default=str)
    digest = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()[:20]
    return f"{provider}:{connection_id}:{digest}"


async def enqueue_webhook_event(
    provider: str,
    connection_id: str,
    organization_id: str,
    event_type: str,
    payload: dict[str, Any],
    sync_params: dict[str, Any] | None = None,
    streams: list[str] | None = None,
    event_id: str | None = None,
) -> dict[str, Any]:
    """
    Persist inbound webhook event and publish to Kafka outbox.
    """
    idempotency_key = _build_idempotency_key(provider, connection_id, payload, event_id=event_id)
    inbox_id = str(uuid4())
    outbox_id = str(uuid4())
    sync_params = sync_params or {}
    streams = streams or []

    set_rls_context(organization_id, is_internal=True)

    pool = await get_db_pool()
    try:
        async with pool.acquire() as conn:
            inserted = await conn.fetchval(
                """
                INSERT INTO connector_webhook_inbox (
                    id, provider, connection_id, organization_id, idempotency_key, event_type, payload, status, received_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING id
                """,
                inbox_id,
                provider,
                connection_id,
                organization_id,
                idempotency_key,
                event_type,
                payload,
                datetime.utcnow(),
            )

            if not inserted:
                logger.info(
                    "Webhook event already ingested",
                    provider=provider,
                    connection_id=connection_id,
                    idempotency_key=idempotency_key,
                )
                return {"inserted": False, "idempotency_key": idempotency_key}

            await conn.execute(
                """
                INSERT INTO connector_webhook_outbox (
                    id, inbox_id, provider, organization_id, event_type, payload, status, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
                """,
                outbox_id,
                inserted,
                provider,
                organization_id,
                event_type,
                {
                    "provider": provider,
                    "connection_id": connection_id,
                    "organization_id": organization_id,
                    "event_type": event_type,
                    "payload": payload,
                    "sync_params": sync_params,
                    "streams": streams,
                    "inbox_id": inserted,
                    "outbox_id": outbox_id,
                },
                datetime.utcnow(),
            )
    finally:
        set_rls_context(None, is_internal=False)

    published = False
    if is_streaming_enabled():
        try:
            producer = await get_kafka_producer()
            await producer.produce_raw_event(
                organization_id=organization_id,
                source_type="connector_webhook",
                event_type="connector.webhook",
                payload={
                    "provider": provider,
                    "connection_id": connection_id,
                    "organization_id": organization_id,
                    "event_type": event_type,
                    "payload": payload,
                    "sync_params": sync_params,
                    "streams": streams,
                    "inbox_id": inbox_id,
                    "outbox_id": outbox_id,
                },
                source_id=inbox_id,
                priority="urgent",
            )
            published = True
        except Exception as e:
            logger.warning(
                "Failed to publish webhook to Kafka",
                provider=provider,
                connection_id=connection_id,
                error=str(e),
            )

    # Update outbox status if published
    if published:
        set_rls_context(organization_id, is_internal=True)
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE connector_webhook_outbox
                SET status = 'published', published_at = $2, last_attempt_at = $2, attempt_count = attempt_count + 1
                WHERE id = $1
                """,
                outbox_id,
                datetime.utcnow(),
            )
            await conn.execute(
                """
                UPDATE connector_webhook_inbox
                SET status = 'queued'
                WHERE id = $1
                """,
                inbox_id,
            )
        set_rls_context(None, is_internal=False)

    return {
        "inserted": True,
        "idempotency_key": idempotency_key,
        "inbox_id": inbox_id,
        "outbox_id": outbox_id,
        "published": published,
        "kafka_enabled": is_streaming_enabled(),
    }
