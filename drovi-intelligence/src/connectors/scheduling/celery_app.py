"""
Celery Application

Distributed task queue for production-scale sync operations.
Use this instead of APScheduler for multi-worker deployments.
"""

from celery import Celery
from kombu import Queue

from src.config import get_settings

settings = get_settings()

# Create Celery app
celery_app = Celery(
    "drovi_intelligence",
    broker=settings.redis_url if hasattr(settings, 'redis_url') else "redis://localhost:6379/0",
    backend=settings.redis_url if hasattr(settings, 'redis_url') else "redis://localhost:6379/0",
)

# Configure Celery
celery_app.conf.update(
    # Task settings
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,

    # Queue settings
    task_queues=(
        Queue("default", routing_key="default"),
        Queue("sync", routing_key="sync.#"),
        Queue("priority", routing_key="priority.#"),
    ),
    task_default_queue="default",
    task_default_exchange="default",
    task_default_routing_key="default",

    # Worker settings
    worker_prefetch_multiplier=1,  # Fair scheduling
    worker_concurrency=4,

    # Task execution settings
    task_acks_late=True,  # Acknowledge after completion
    task_reject_on_worker_lost=True,
    task_time_limit=3600,  # 1 hour max
    task_soft_time_limit=3300,  # Soft limit 55 minutes

    # Result settings
    result_expires=86400,  # 24 hours

    # Retry settings
    task_annotations={
        "src.connectors.scheduling.celery_tasks.*": {
            "rate_limit": "10/m",
            "max_retries": 3,
        }
    },

    # Beat schedule for periodic tasks
    beat_schedule={
        "sync-scheduled-connections": {
            "task": "src.connectors.scheduling.celery_tasks.sync_scheduled_connections",
            "schedule": 60.0,  # Every minute, check for due syncs
        },
        "refresh-oauth-tokens": {
            "task": "src.connectors.scheduling.celery_tasks.refresh_expiring_tokens",
            "schedule": 300.0,  # Every 5 minutes
        },
        "compute-memory-decay": {
            "task": "src.connectors.scheduling.celery_tasks.compute_memory_decay",
            "schedule": 86400.0,  # Daily
        },
        "cleanup-old-jobs": {
            "task": "src.connectors.scheduling.celery_tasks.cleanup_old_jobs",
            "schedule": 3600.0,  # Hourly
        },
        "process-webhook-retries": {
            "task": "src.connectors.scheduling.celery_tasks.process_webhook_retries",
            "schedule": 60.0,  # Every minute
        },
        "cleanup-webhook-deliveries": {
            "task": "src.connectors.scheduling.celery_tasks.cleanup_webhook_deliveries",
            "schedule": 86400.0,  # Daily
        },
        "cleanup-event-records": {
            "task": "src.connectors.scheduling.celery_tasks.cleanup_event_records",
            "schedule": 86400.0,  # Daily
        },
    },
)


def get_celery_app() -> Celery:
    """Get the Celery application instance."""
    return celery_app
