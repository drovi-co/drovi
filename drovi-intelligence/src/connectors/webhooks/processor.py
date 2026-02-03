"""
Webhook event processor for Kafka consumer.
"""

from __future__ import annotations

from typing import Any

import structlog

from src.connectors.scheduling.scheduler import SyncJobType, get_scheduler
from src.db.client import get_db_pool
from src.db.rls import set_rls_context

logger = structlog.get_logger()


async def process_connector_webhook_event(payload: dict[str, Any]) -> None:
    """
    Process a connector webhook event from Kafka and trigger a sync.
    """
    event_payload = payload
    if (
        "connection_id" not in event_payload
        and isinstance(event_payload.get("payload"), dict)
        and event_payload["payload"].get("connection_id")
    ):
        event_payload = event_payload["payload"]

    connection_id = event_payload.get("connection_id")
    organization_id = event_payload.get("organization_id")
    sync_params = event_payload.get("sync_params") or {}
    streams = event_payload.get("streams") or []
    full_refresh = event_payload.get("full_refresh")
    if full_refresh is None and "incremental" in event_payload:
        full_refresh = not bool(event_payload.get("incremental"))
    full_refresh = bool(full_refresh) if full_refresh is not None else False

    if not connection_id or not organization_id:
        logger.warning("Webhook event missing connection/org", payload=payload)
        return

    scheduler = get_scheduler()

    await scheduler.trigger_sync_by_id(
        connection_id=connection_id,
        organization_id=organization_id,
        streams=streams or None,
        full_refresh=full_refresh,
        job_type=SyncJobType.WEBHOOK,
        sync_params=sync_params,
    )

    inbox_id = payload.get("inbox_id")
    if inbox_id:
        set_rls_context(organization_id, is_internal=True)
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE connector_webhook_inbox
                SET status = 'processed', processed_at = now()
                WHERE id = $1
                """,
                inbox_id,
            )
        set_rls_context(None, is_internal=False)

    logger.info(
        "Webhook event scheduled sync",
        connection_id=connection_id,
        organization_id=organization_id,
        sync_params=sync_params,
    )
