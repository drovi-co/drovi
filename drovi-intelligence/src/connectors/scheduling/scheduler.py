"""
Connector Scheduler

Manages background sync jobs using APScheduler.
Supports both scheduled and on-demand sync operations.
"""

import asyncio
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Coroutine
from uuid import uuid4

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from pydantic import BaseModel, Field

from src.connectors.base.config import ConnectorConfig
from src.connectors.base.connector import BaseConnector, ConnectorRegistry
from src.connectors.base.state import ConnectorState

logger = structlog.get_logger()


class SyncJobStatus(str, Enum):
    """Status of a sync job."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SyncJobType(str, Enum):
    """Type of sync job."""

    SCHEDULED = "scheduled"      # Regular scheduled sync
    ON_DEMAND = "on_demand"      # Manual trigger
    BACKFILL = "backfill"        # Historical data backfill
    WEBHOOK = "webhook"          # Webhook-triggered sync


class SyncJob(BaseModel):
    """Represents a data sync job."""

    # Identity
    job_id: str = Field(default_factory=lambda: str(uuid4()))
    connection_id: str
    organization_id: str
    connector_type: str

    # Job type
    job_type: SyncJobType = SyncJobType.SCHEDULED

    # Scope
    streams: list[str] = Field(default_factory=list)  # Empty = all streams
    full_refresh: bool = False  # Force full refresh instead of incremental

    # Backfill settings
    backfill_start_date: datetime | None = None
    backfill_end_date: datetime | None = None

    # Scheduling
    schedule_cron: str | None = None
    schedule_interval_minutes: int | None = None

    # Status
    status: SyncJobStatus = SyncJobStatus.PENDING
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None

    # Progress
    records_synced: int = 0
    bytes_synced: int = 0

    # Metadata
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        """Pydantic config."""
        extra = "allow"


class SyncJobResult(BaseModel):
    """Result of a sync job execution."""

    job_id: str
    status: SyncJobStatus
    records_synced: int = 0
    bytes_synced: int = 0
    duration_seconds: float = 0.0
    error_message: str | None = None
    streams_completed: list[str] = Field(default_factory=list)
    streams_failed: list[str] = Field(default_factory=list)
    completed_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        """Pydantic config."""
        extra = "allow"


# Default sync schedules for different source types
DEFAULT_SYNC_SCHEDULES = {
    "gmail": {"interval_minutes": 5},
    "outlook": {"interval_minutes": 5},
    "slack": {"interval_minutes": 5},
    "notion": {"interval_minutes": 15},
    "google_docs": {"interval_minutes": 15},
    "calendar": {"interval_minutes": 15},
    "crm": {"interval_minutes": 60},
    "whatsapp": {"interval_minutes": 15},
}


class ConnectorScheduler:
    """
    Manages background sync jobs for connectors.

    Uses APScheduler for job scheduling with support for:
    - Interval-based scheduling (e.g., every 5 minutes)
    - Cron-based scheduling (e.g., daily at midnight)
    - On-demand job execution
    - Job status tracking

    Example usage:
        scheduler = ConnectorScheduler()
        await scheduler.start()

        # Schedule a connection for sync
        await scheduler.schedule_sync(connection_config)

        # Trigger immediate sync
        job = await scheduler.trigger_sync(connection_id)

        # Check job status
        status = scheduler.get_job_status(job.job_id)

        await scheduler.shutdown()
    """

    def __init__(self):
        """Initialize the scheduler."""
        self._scheduler = AsyncIOScheduler()
        self._running_jobs: dict[str, SyncJob] = {}
        self._job_history: dict[str, SyncJobResult] = {}
        self._sync_callback: Callable[[SyncJob], Coroutine[Any, Any, SyncJobResult]] | None = None

        # State storage (in-memory for now, should be persisted)
        self._connection_states: dict[str, ConnectorState] = {}

    async def start(self) -> None:
        """Start the scheduler."""
        if not self._scheduler.running:
            self._scheduler.start()
            logger.info("Connector scheduler started")

    async def shutdown(self) -> None:
        """Shutdown the scheduler gracefully."""
        if self._scheduler.running:
            self._scheduler.shutdown(wait=True)
            logger.info("Connector scheduler shutdown")

    def set_sync_callback(
        self,
        callback: Callable[[SyncJob], Coroutine[Any, Any, SyncJobResult]],
    ) -> None:
        """
        Set the callback function for executing sync jobs.

        The callback receives a SyncJob and should return a SyncJobResult.
        """
        self._sync_callback = callback

    async def schedule_sync(
        self,
        config: ConnectorConfig,
        interval_minutes: int | None = None,
        cron: str | None = None,
    ) -> str:
        """
        Schedule recurring sync for a connection.

        Args:
            config: Connector configuration
            interval_minutes: Sync interval in minutes (default from connector type)
            cron: Cron expression (alternative to interval)

        Returns:
            APScheduler job ID
        """
        # Get default interval if not specified
        if interval_minutes is None and cron is None:
            defaults = DEFAULT_SYNC_SCHEDULES.get(config.connector_type, {})
            interval_minutes = defaults.get("interval_minutes", 15)

        # Create job function
        async def sync_job():
            await self._execute_scheduled_sync(config)

        # Schedule with APScheduler
        if cron:
            trigger = CronTrigger.from_crontab(cron)
        else:
            trigger = IntervalTrigger(minutes=interval_minutes or 15)

        scheduler_job_id = f"sync_{config.connection_id}"

        # Remove existing job if any
        if self._scheduler.get_job(scheduler_job_id):
            self._scheduler.remove_job(scheduler_job_id)

        self._scheduler.add_job(
            sync_job,
            trigger=trigger,
            id=scheduler_job_id,
            name=f"Sync {config.connector_type} ({config.name})",
            replace_existing=True,
            coalesce=True,  # Skip missed runs
            max_instances=1,  # Don't overlap
        )

        logger.info(
            "Scheduled sync job",
            connection_id=config.connection_id,
            connector_type=config.connector_type,
            interval_minutes=interval_minutes,
            cron=cron,
        )

        return scheduler_job_id

    async def unschedule_sync(self, connection_id: str) -> bool:
        """
        Remove scheduled sync for a connection.

        Args:
            connection_id: Connection ID

        Returns:
            True if job was removed, False if not found
        """
        scheduler_job_id = f"sync_{connection_id}"
        job = self._scheduler.get_job(scheduler_job_id)

        if job:
            self._scheduler.remove_job(scheduler_job_id)
            logger.info("Unscheduled sync job", connection_id=connection_id)
            return True

        return False

    async def trigger_sync(
        self,
        config: ConnectorConfig,
        streams: list[str] | None = None,
        full_refresh: bool = False,
    ) -> SyncJob:
        """
        Trigger an immediate sync job.

        Args:
            config: Connector configuration
            streams: Specific streams to sync (None = all)
            full_refresh: Force full refresh instead of incremental

        Returns:
            SyncJob tracking object
        """
        job = SyncJob(
            connection_id=config.connection_id,
            organization_id=config.organization_id,
            connector_type=config.connector_type,
            job_type=SyncJobType.ON_DEMAND,
            streams=streams or [],
            full_refresh=full_refresh,
        )

        # Execute immediately in background
        asyncio.create_task(self._execute_sync(job, config))

        return job

    async def trigger_backfill(
        self,
        config: ConnectorConfig,
        start_date: datetime,
        end_date: datetime | None = None,
        streams: list[str] | None = None,
    ) -> SyncJob:
        """
        Trigger a historical backfill job.

        Args:
            config: Connector configuration
            start_date: Start of backfill range
            end_date: End of backfill range (default: now)
            streams: Specific streams to backfill

        Returns:
            SyncJob tracking object
        """
        job = SyncJob(
            connection_id=config.connection_id,
            organization_id=config.organization_id,
            connector_type=config.connector_type,
            job_type=SyncJobType.BACKFILL,
            streams=streams or [],
            full_refresh=True,
            backfill_start_date=start_date,
            backfill_end_date=end_date or datetime.utcnow(),
        )

        # Execute in background
        asyncio.create_task(self._execute_sync(job, config))

        return job

    def get_job_status(self, job_id: str) -> SyncJob | SyncJobResult | None:
        """
        Get status of a job.

        Returns SyncJob if running, SyncJobResult if completed.
        """
        if job_id in self._running_jobs:
            return self._running_jobs[job_id]
        return self._job_history.get(job_id)

    def list_running_jobs(self) -> list[SyncJob]:
        """List all currently running jobs."""
        return list(self._running_jobs.values())

    def list_scheduled_jobs(self) -> list[dict[str, Any]]:
        """List all scheduled jobs."""
        jobs = []
        for job in self._scheduler.get_jobs():
            jobs.append({
                "id": job.id,
                "name": job.name,
                "next_run_time": job.next_run_time,
                "trigger": str(job.trigger),
            })
        return jobs

    async def trigger_sync_by_id(
        self,
        connection_id: str,
        streams: list[str] | None = None,
        incremental: bool = True,
        sync_params: dict[str, Any] | None = None,
    ) -> SyncJob:
        """
        Trigger sync by connection ID (for webhook-triggered syncs).

        Looks up the connection config from the database.

        Args:
            connection_id: Connection ID
            streams: Specific streams to sync
            incremental: If True, use incremental sync (default)
            sync_params: Additional sync parameters

        Returns:
            SyncJob tracking object
        """
        from src.db.client import get_db_pool

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
                raise ValueError(f"Connection not found: {connection_id}")

            # Build config
            config = ConnectorConfig(
                connection_id=row["id"],
                organization_id=row["organization_id"],
                connector_type=row["connector_type"],
                name=row["name"],
                credentials=row["config"].get("credentials", {}),
                settings=row["config"].get("settings", {}),
            )

        job = SyncJob(
            connection_id=config.connection_id,
            organization_id=config.organization_id,
            connector_type=config.connector_type,
            job_type=SyncJobType.WEBHOOK,
            streams=streams or [],
            full_refresh=not incremental,
        )

        # Store sync params in job extras
        if sync_params:
            job.__dict__["sync_params"] = sync_params

        # Execute in background
        asyncio.create_task(self._execute_sync(job, config))

        return job

    async def _execute_scheduled_sync(self, config: ConnectorConfig) -> None:
        """Execute a scheduled sync job."""
        job = SyncJob(
            connection_id=config.connection_id,
            organization_id=config.organization_id,
            connector_type=config.connector_type,
            job_type=SyncJobType.SCHEDULED,
        )
        await self._execute_sync(job, config)

    async def _execute_sync(self, job: SyncJob, config: ConnectorConfig) -> SyncJobResult:
        """
        Execute a sync job.

        This is the core sync execution logic.
        """
        job.status = SyncJobStatus.RUNNING
        job.started_at = datetime.utcnow()
        self._running_jobs[job.job_id] = job

        logger.info(
            "Starting sync job",
            job_id=job.job_id,
            connection_id=job.connection_id,
            connector_type=job.connector_type,
            job_type=job.job_type.value,
        )

        try:
            # If a callback is set, use it
            if self._sync_callback:
                result = await self._sync_callback(job)
            else:
                # Default execution using connector
                result = await self._default_sync_execution(job, config)

            job.status = result.status
            job.completed_at = result.completed_at
            job.records_synced = result.records_synced
            job.bytes_synced = result.bytes_synced
            job.error_message = result.error_message

        except Exception as e:
            logger.error(
                "Sync job failed",
                job_id=job.job_id,
                error=str(e),
            )
            result = SyncJobResult(
                job_id=job.job_id,
                status=SyncJobStatus.FAILED,
                error_message=str(e),
                duration_seconds=(datetime.utcnow() - job.started_at).total_seconds(),
            )
            job.status = SyncJobStatus.FAILED
            job.error_message = str(e)

        finally:
            job.completed_at = datetime.utcnow()
            del self._running_jobs[job.job_id]
            self._job_history[job.job_id] = result

        logger.info(
            "Sync job completed",
            job_id=job.job_id,
            status=result.status.value,
            records_synced=result.records_synced,
            duration_seconds=result.duration_seconds,
        )

        return result

    async def _default_sync_execution(
        self,
        job: SyncJob,
        config: ConnectorConfig,
    ) -> SyncJobResult:
        """
        Default sync execution using connector directly.

        This runs the actual data extraction.
        """
        start_time = datetime.utcnow()
        records_synced = 0
        bytes_synced = 0
        streams_completed: list[str] = []
        streams_failed: list[str] = []

        # Get connector
        connector = ConnectorRegistry.create(job.connector_type)
        if not connector:
            return SyncJobResult(
                job_id=job.job_id,
                status=SyncJobStatus.FAILED,
                error_message=f"Unknown connector type: {job.connector_type}",
            )

        # Get or create state
        state = self._connection_states.get(job.connection_id)
        if not state:
            state = ConnectorState(
                connection_id=job.connection_id,
                connector_type=job.connector_type,
            )
            self._connection_states[job.connection_id] = state

        # Check connection
        success, error = await connector.check_connection(config)
        if not success:
            return SyncJobResult(
                job_id=job.job_id,
                status=SyncJobStatus.FAILED,
                error_message=f"Connection check failed: {error}",
            )

        # Get streams to sync
        if job.streams:
            streams = [s for s in config.streams if s.stream_name in job.streams]
        else:
            streams = config.get_enabled_streams()

        if not streams:
            streams = await connector.discover_streams(config)

        # Sync each stream
        for stream in streams:
            try:
                state.mark_sync_started(stream.stream_name)

                async for batch in connector.read_stream(config, stream, state):
                    records_synced += batch.record_count
                    bytes_synced += batch.byte_count

                    # Update state cursor
                    if batch.next_cursor:
                        state.update_cursor(stream.stream_name, batch.next_cursor)

                state.mark_sync_completed(
                    stream.stream_name,
                    records=batch.record_count,
                    bytes_count=batch.byte_count,
                )
                streams_completed.append(stream.stream_name)

            except Exception as e:
                logger.error(
                    "Stream sync failed",
                    stream=stream.stream_name,
                    error=str(e),
                )
                state.mark_sync_failed(stream.stream_name, str(e))
                streams_failed.append(stream.stream_name)

        duration = (datetime.utcnow() - start_time).total_seconds()
        status = SyncJobStatus.COMPLETED if not streams_failed else SyncJobStatus.FAILED

        return SyncJobResult(
            job_id=job.job_id,
            status=status,
            records_synced=records_synced,
            bytes_synced=bytes_synced,
            duration_seconds=duration,
            streams_completed=streams_completed,
            streams_failed=streams_failed,
            error_message=f"Failed streams: {streams_failed}" if streams_failed else None,
        )


# Global scheduler instance
_scheduler: ConnectorScheduler | None = None


def get_scheduler() -> ConnectorScheduler:
    """Get the global scheduler instance (sync version)."""
    global _scheduler
    if _scheduler is None:
        _scheduler = ConnectorScheduler()
    return _scheduler


async def get_scheduler_async() -> ConnectorScheduler:
    """Get the global scheduler instance (async version for webhook handlers)."""
    return get_scheduler()


async def init_scheduler() -> ConnectorScheduler:
    """Initialize and start the global scheduler."""
    scheduler = get_scheduler()
    await scheduler.start()
    return scheduler


async def shutdown_scheduler() -> None:
    """Shutdown the global scheduler."""
    global _scheduler
    if _scheduler:
        await _scheduler.shutdown()
        _scheduler = None
