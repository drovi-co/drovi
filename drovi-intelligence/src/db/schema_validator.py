"""
Database Schema Validator

Validates that required tables and extensions exist on startup to prevent runtime errors.
"""

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()

# All tables required by the application
REQUIRED_TABLES = [
    # Core infrastructure tables
    "organizations",
    "users",
    "memberships",
    "invites",
    "connections",
    "oauth_tokens",
    "sync_states",
    "sync_job_history",
    "event_records",
    "webhook_subscriptions",
    "webhook_deliveries",
    "connector_webhook_inbox",
    "connector_webhook_outbox",
    # Contact table
    "contact",
    "contact_identity",
    # UIO core tables
    "unified_intelligence_object",
    "unified_object_source",
    "unified_object_timeline",
    "unified_object_embedding",
    "deduplication_candidate",
    "signal_candidate",
    "unified_event",
    "uio_contradiction",
    # UIO extension tables
    "uio_commitment_details",
    "uio_decision_details",
    "uio_claim_details",
    "uio_task_details",
    "uio_risk_details",
    "uio_brief_details",
    # Source tables
    "source_account",
    "conversation",
    "message",
    "participant",
    "attachment",
    "related_conversation",
    # Live session evidence tables
    "live_session",
    "transcript_segment",
    "evidence_artifact",
    "sensor_permission",
]

# Required PostgreSQL extensions
REQUIRED_EXTENSIONS = ["vector"]


async def validate_schema(session: AsyncSession) -> tuple[bool, list[str]]:
    """
    Validate that all required tables and extensions exist.

    Args:
        session: Async database session

    Returns:
        Tuple of (is_valid, missing_items)
    """
    missing: list[str] = []

    # Check extensions
    for ext in REQUIRED_EXTENSIONS:
        result = await session.execute(
            text("SELECT 1 FROM pg_extension WHERE extname = :ext"), {"ext": ext}
        )
        if not result.fetchone():
            missing.append(f"extension:{ext}")

    # Check tables
    for table in REQUIRED_TABLES:
        result = await session.execute(
            text("""
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = :table
            """),
            {"table": table},
        )
        if not result.fetchone():
            missing.append(f"table:{table}")

    is_valid = len(missing) == 0

    if not is_valid:
        logger.error(
            "Schema validation failed",
            missing_count=len(missing),
            missing_items=missing[:10],  # Log first 10
        )
    else:
        logger.info("Schema validation passed", table_count=len(REQUIRED_TABLES))

    return is_valid, missing


async def ensure_schema_or_fail(session: AsyncSession) -> None:
    """
    Validate schema and raise if invalid.

    Call this during application startup to ensure all required
    database objects exist before accepting requests.

    Args:
        session: Async database session

    Raises:
        RuntimeError: If schema validation fails
    """
    is_valid, missing = await validate_schema(session)

    if not is_valid:
        missing_summary = ", ".join(missing[:5])
        if len(missing) > 5:
            missing_summary += f"... and {len(missing) - 5} more"

        raise RuntimeError(
            f"Database schema validation failed. "
            f"Missing: {missing_summary}. "
            f"Run 'alembic upgrade head' to apply migrations."
        )


async def get_migration_status(session: AsyncSession) -> dict:
    """
    Get current migration status for diagnostics.

    Args:
        session: Async database session

    Returns:
        Dict with migration status info
    """
    # Check if alembic_version table exists
    result = await session.execute(
        text("""
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'alembic_version'
        """)
    )
    has_alembic = result.fetchone() is not None

    current_version = None
    if has_alembic:
        result = await session.execute(text("SELECT version_num FROM alembic_version"))
        row = result.fetchone()
        if row:
            current_version = row[0]

    # Count existing tables
    result = await session.execute(
        text("""
            SELECT COUNT(*) FROM information_schema.tables
            WHERE table_schema = 'public'
        """)
    )
    table_count = result.scalar() or 0

    is_valid, missing = await validate_schema(session)

    return {
        "alembic_initialized": has_alembic,
        "current_version": current_version,
        "total_tables": table_count,
        "required_tables": len(REQUIRED_TABLES),
        "missing_count": len(missing),
        "is_valid": is_valid,
        "missing_items": missing[:10] if missing else [],
    }
