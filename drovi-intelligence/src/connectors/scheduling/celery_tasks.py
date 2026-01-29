"""
Celery Tasks

Distributed tasks for sync operations, maintenance, and background processing.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Any

import structlog

from src.connectors.scheduling.celery_app import celery_app

logger = structlog.get_logger()


def run_async(coro):
    """Run async function in sync context."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, name="src.connectors.scheduling.celery_tasks.sync_connection")
def sync_connection(
    self,
    connection_id: str,
    streams: list[str] | None = None,
    full_refresh: bool = False,
) -> dict[str, Any]:
    """
    Sync a single connection.

    Args:
        connection_id: The connection to sync
        streams: Optional list of specific streams to sync
        full_refresh: If True, ignore incremental state

    Returns:
        Sync result summary
    """
    return run_async(_sync_connection_async(
        self, connection_id, streams, full_refresh
    ))


async def _sync_connection_async(
    task,
    connection_id: str,
    streams: list[str] | None,
    full_refresh: bool,
) -> dict[str, Any]:
    """Async implementation of sync_connection."""
    from src.connectors.scheduling.scheduler import get_scheduler
    from src.db.client import get_db_pool

    logger.info(
        "Starting connection sync",
        connection_id=connection_id,
        streams=streams,
        full_refresh=full_refresh,
        task_id=task.request.id,
    )

    start_time = datetime.utcnow()

    try:
        # Get connection config from database
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, organization_id, connector_type, name, config
                FROM connections
                WHERE id = $1 AND status = 'active'
                """,
                connection_id,
            )

            if not row:
                return {
                    "status": "failed",
                    "error": f"Connection not found: {connection_id}",
                }

        # Use scheduler to execute sync
        scheduler = get_scheduler()
        from src.connectors.base.config import ConnectorConfig

        config = ConnectorConfig(
            connection_id=row["id"],
            organization_id=row["organization_id"],
            connector_type=row["connector_type"],
            name=row["name"],
            credentials=row["config"].get("credentials", {}),
            settings=row["config"].get("settings", {}),
        )

        job = await scheduler.trigger_sync(
            config=config,
            streams=streams,
            full_refresh=full_refresh,
        )

        # Wait for job completion (with timeout)
        timeout = 3600  # 1 hour
        start = datetime.utcnow()

        while True:
            status = scheduler.get_job_status(job.job_id)
            if status and hasattr(status, 'status'):
                if status.status.value in ('completed', 'failed'):
                    break

            if (datetime.utcnow() - start).total_seconds() > timeout:
                return {
                    "status": "timeout",
                    "job_id": job.job_id,
                }

            await asyncio.sleep(5)

        duration = (datetime.utcnow() - start_time).total_seconds()

        return {
            "status": "completed" if status.status.value == "completed" else "failed",
            "job_id": job.job_id,
            "records_synced": getattr(status, 'records_synced', 0),
            "duration_seconds": duration,
            "error": getattr(status, 'error_message', None),
        }

    except Exception as e:
        logger.error(
            "Connection sync failed",
            connection_id=connection_id,
            error=str(e),
        )
        return {
            "status": "failed",
            "error": str(e),
        }


@celery_app.task(name="src.connectors.scheduling.celery_tasks.sync_scheduled_connections")
def sync_scheduled_connections() -> dict[str, Any]:
    """
    Check for connections due for sync and queue them.

    This runs periodically via Celery Beat.
    """
    return run_async(_sync_scheduled_connections_async())


async def _sync_scheduled_connections_async() -> dict[str, Any]:
    """Async implementation of sync_scheduled_connections."""
    from src.db.client import get_db_pool

    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            # Get connections due for sync
            rows = await conn.fetch(
                """
                SELECT
                    c.id,
                    c.connector_type,
                    c.config->>'sync_interval_minutes' as interval_minutes,
                    MAX(sj.completed_at) as last_sync
                FROM connections c
                LEFT JOIN sync_jobs sj ON c.id = sj.connection_id AND sj.status = 'completed'
                WHERE c.status = 'active'
                GROUP BY c.id
                HAVING MAX(sj.completed_at) IS NULL
                    OR MAX(sj.completed_at) < NOW() - INTERVAL '1 minute' *
                        COALESCE((c.config->>'sync_interval_minutes')::int, 15)
                LIMIT 50
                """
            )

        queued = 0
        for row in rows:
            # Queue sync task
            sync_connection.apply_async(
                args=[row["id"]],
                queue="sync",
            )
            queued += 1

        logger.info(
            "Queued scheduled syncs",
            connections_queued=queued,
        )

        return {"queued": queued}

    except Exception as e:
        logger.error("Failed to queue scheduled syncs", error=str(e))
        return {"error": str(e)}


@celery_app.task(name="src.connectors.scheduling.celery_tasks.refresh_expiring_tokens")
def refresh_expiring_tokens() -> dict[str, Any]:
    """
    Refresh OAuth tokens that are about to expire.
    """
    return run_async(_refresh_expiring_tokens_async())


async def _refresh_expiring_tokens_async() -> dict[str, Any]:
    """Async implementation of refresh_expiring_tokens."""
    from src.connectors.auth.token_manager import get_token_manager

    try:
        token_manager = await get_token_manager()
        refreshed = await token_manager.refresh_expiring_tokens()

        logger.info(
            "Refreshed expiring tokens",
            count=refreshed,
        )

        return {"refreshed": refreshed}

    except Exception as e:
        logger.error("Failed to refresh tokens", error=str(e))
        return {"error": str(e)}


@celery_app.task(name="src.connectors.scheduling.celery_tasks.compute_memory_decay")
def compute_memory_decay() -> dict[str, Any]:
    """
    Run daily memory decay computation.
    """
    return run_async(_compute_memory_decay_async())


async def _compute_memory_decay_async() -> dict[str, Any]:
    """Async implementation of compute_memory_decay."""
    from src.jobs.decay import get_decay_job

    try:
        decay_job = await get_decay_job()
        result = await decay_job.run()

        logger.info(
            "Memory decay computation completed",
            nodes_updated=result.get("nodes_updated", 0),
            nodes_archived=result.get("nodes_archived", 0),
        )

        return result

    except Exception as e:
        logger.error("Memory decay computation failed", error=str(e))
        return {"error": str(e)}


@celery_app.task(name="src.connectors.scheduling.celery_tasks.cleanup_old_jobs")
def cleanup_old_jobs() -> dict[str, Any]:
    """
    Clean up old sync job records.
    """
    return run_async(_cleanup_old_jobs_async())


async def _cleanup_old_jobs_async() -> dict[str, Any]:
    """Async implementation of cleanup_old_jobs."""
    from src.db.client import get_db_pool

    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            # Delete jobs older than 30 days
            result = await conn.execute(
                """
                DELETE FROM sync_jobs
                WHERE completed_at < NOW() - INTERVAL '30 days'
                """
            )

        deleted = int(result.split()[-1]) if result else 0

        logger.info(
            "Cleaned up old sync jobs",
            deleted=deleted,
        )

        return {"deleted": deleted}

    except Exception as e:
        logger.error("Failed to cleanup old jobs", error=str(e))
        return {"error": str(e)}


@celery_app.task(
    bind=True,
    name="src.connectors.scheduling.celery_tasks.process_webhook",
    queue="priority",
)
def process_webhook(
    self,
    provider: str,
    payload: dict[str, Any],
    connection_id: str | None = None,
) -> dict[str, Any]:
    """
    Process an incoming webhook and trigger incremental sync.

    Args:
        provider: Webhook provider (slack, gmail, etc.)
        payload: Webhook payload
        connection_id: Optional specific connection ID

    Returns:
        Processing result
    """
    return run_async(_process_webhook_async(
        self, provider, payload, connection_id
    ))


async def _process_webhook_async(
    task,
    provider: str,
    payload: dict[str, Any],
    connection_id: str | None,
) -> dict[str, Any]:
    """Async implementation of process_webhook."""
    logger.info(
        "Processing webhook",
        provider=provider,
        task_id=task.request.id,
    )

    try:
        if provider == "slack":
            from src.connectors.webhooks.handlers.slack import SlackWebhookHandler
            handler = SlackWebhookHandler()
            await handler.handle_event(payload)

        elif provider == "gmail":
            from src.connectors.webhooks.handlers.gmail import GmailWebhookHandler
            handler = GmailWebhookHandler()
            await handler.handle_notification(payload)

        elif provider == "teams":
            from src.connectors.webhooks.handlers.teams import TeamsWebhookHandler
            handler = TeamsWebhookHandler()
            result = await handler.handle_notification(payload)
            return {"status": "processed", **result}

        elif provider == "whatsapp":
            from src.connectors.webhooks.handlers.whatsapp import WhatsAppWebhookHandler
            handler = WhatsAppWebhookHandler()
            result = await handler.handle_webhook(payload)
            return {"status": "processed", **result}

        else:
            logger.warning(f"Unknown webhook provider: {provider}")
            return {"status": "ignored", "reason": f"Unknown provider: {provider}"}

        return {"status": "processed"}

    except Exception as e:
        logger.error(
            "Webhook processing failed",
            provider=provider,
            error=str(e),
        )
        return {"status": "failed", "error": str(e)}


@celery_app.task(
    bind=True,
    name="src.connectors.scheduling.celery_tasks.analyze_content",
    queue="default",
)
def analyze_content(
    self,
    content: str,
    organization_id: str,
    source_type: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Run intelligence extraction on content.

    Args:
        content: Text content to analyze
        organization_id: Organization ID
        source_type: Type of content source
        metadata: Additional metadata

    Returns:
        Extraction results
    """
    return run_async(_analyze_content_async(
        self, content, organization_id, source_type, metadata
    ))


@celery_app.task(name="src.connectors.scheduling.celery_tasks.process_webhook_retries")
def process_webhook_retries() -> dict[str, Any]:
    """
    Process pending webhook delivery retries.

    This runs periodically via Celery Beat (every minute).
    """
    return run_async(_process_webhook_retries_async())


async def _process_webhook_retries_async() -> dict[str, Any]:
    """Async implementation of process_webhook_retries."""
    from src.connectors.webhooks.service import get_webhook_service

    try:
        service = await get_webhook_service()
        retried = await service.retry_pending_deliveries()

        if retried > 0:
            logger.info("Processed webhook retries", count=retried)

        return {"retried": retried}

    except Exception as e:
        logger.error("Failed to process webhook retries", error=str(e))
        return {"error": str(e)}


@celery_app.task(name="src.connectors.scheduling.celery_tasks.cleanup_webhook_deliveries")
def cleanup_webhook_deliveries(days: int = 30) -> dict[str, Any]:
    """
    Clean up old webhook delivery records.

    Args:
        days: Delete deliveries older than this many days
    """
    return run_async(_cleanup_webhook_deliveries_async(days))


async def _cleanup_webhook_deliveries_async(days: int) -> dict[str, Any]:
    """Async implementation of cleanup_webhook_deliveries."""
    from src.connectors.webhooks.service import get_webhook_service

    try:
        service = await get_webhook_service()
        deleted = await service.cleanup_old_deliveries(days=days)

        logger.info("Cleaned up webhook deliveries", deleted=deleted, days=days)

        return {"deleted": deleted}

    except Exception as e:
        logger.error("Failed to cleanup webhook deliveries", error=str(e))
        return {"error": str(e)}


@celery_app.task(name="src.connectors.scheduling.celery_tasks.cleanup_event_records")
def cleanup_event_records(days: int = 30) -> dict[str, Any]:
    """
    Clean up old event records.

    Args:
        days: Delete events older than this many days
    """
    return run_async(_cleanup_event_records_async(days))


async def _cleanup_event_records_async(days: int) -> dict[str, Any]:
    """Async implementation of cleanup_event_records."""
    from src.events import get_event_publisher

    try:
        publisher = await get_event_publisher()
        deleted = await publisher.cleanup_old_events(days=days)

        logger.info("Cleaned up event records", deleted=deleted, days=days)

        return {"deleted": deleted}

    except Exception as e:
        logger.error("Failed to cleanup event records", error=str(e))
        return {"error": str(e)}


async def _analyze_content_async(
    task,
    content: str,
    organization_id: str,
    source_type: str,
    metadata: dict[str, Any] | None,
) -> dict[str, Any]:
    """Async implementation of analyze_content."""
    from src.orchestrator.runner import run_orchestrator

    try:
        result = await run_orchestrator(
            content=content,
            organization_id=organization_id,
            source_type=source_type,
            metadata=metadata or {},
        )

        return {
            "status": "completed",
            "uios_extracted": len(result.get("uios", [])),
            "entities_extracted": len(result.get("entities", [])),
        }

    except Exception as e:
        logger.error(
            "Content analysis failed",
            organization_id=organization_id,
            error=str(e),
        )
        return {"status": "failed", "error": str(e)}
