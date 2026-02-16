"""
Source account bridging for raw conversation/message persistence.

The raw PostgreSQL conversation/message tables still reference `source_account.id`,
while connector ingestion now passes `connections.id` as `source_account_id`.
This helper creates a compatible `source_account` row on demand for a connection.
"""

from __future__ import annotations

from datetime import datetime

import structlog

logger = structlog.get_logger()


async def ensure_source_account_for_persistence(
    *,
    conn,
    organization_id: str,
    source_account_id: str | None,
    source_type: str,
    user_email: str | None,
    now: datetime,
) -> str | None:
    """
    Return a valid `source_account.id` for raw conversation/message persistence.

    If `source_account_id` already exists in `source_account`, we return it as-is.
    If it looks like a `connections.id`, we materialize a compatible source_account row.
    """
    if not source_account_id:
        return None

    existing = await conn.fetchval(
        "SELECT id FROM source_account WHERE id = $1",
        source_account_id,
    )
    if existing:
        return str(existing)

    connection = await conn.fetchrow(
        """
        SELECT
            id::text AS id,
            organization_id,
            connector_type,
            name,
            created_by_user_id
        FROM connections
        WHERE id::text = $1
        """,
        source_account_id,
    )
    if not connection:
        logger.warning(
            "Skipping raw conversation persistence: source account not found",
            source_account_id=source_account_id,
        )
        return None

    connector_type = (connection["connector_type"] or source_type or "unknown").strip().lower()
    external_id = f"connection:{connection['id']}"

    # Reuse an existing source_account that already represents this connection,
    # even when its primary key differs from the connection UUID.
    existing_for_connection = await conn.fetchval(
        """
        SELECT id
        FROM source_account
        WHERE organization_id = $1
          AND type = $2
          AND external_id = $3
        LIMIT 1
        """,
        connection["organization_id"] or organization_id,
        connector_type,
        external_id,
    )
    if existing_for_connection:
        return str(existing_for_connection)

    added_by_user_id = connection["created_by_user_id"]
    if not added_by_user_id and user_email:
        added_by_user_id = await conn.fetchval(
            "SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1",
            user_email,
        )
    if not added_by_user_id:
        added_by_user_id = await conn.fetchval(
            "SELECT user_id FROM memberships WHERE org_id = $1 ORDER BY created_at ASC LIMIT 1",
            organization_id,
        )
    if not added_by_user_id:
        added_by_user_id = await conn.fetchval(
            "SELECT id FROM users ORDER BY created_at ASC LIMIT 1",
        )
    if not added_by_user_id:
        logger.warning(
            "Skipping source_account auto-create: no user available",
            source_account_id=source_account_id,
            organization_id=organization_id,
        )
        return None

    display_name = connection["name"] or f"{connector_type} connection"
    created_or_existing_id = await conn.fetchval(
        """
        INSERT INTO source_account (
            id, organization_id, added_by_user_id,
            type, provider, external_id,
            display_name, status, visibility,
            created_at, updated_at
        ) VALUES (
            $1, $2, $3,
            $4, $4, $5,
            $6, 'connected', 'org_shared',
            $7, $7
        )
        ON CONFLICT (organization_id, type, external_id)
        DO UPDATE SET
            updated_at = EXCLUDED.updated_at
        RETURNING id
        """,
        source_account_id,
        connection["organization_id"] or organization_id,
        str(added_by_user_id),
        connector_type,
        external_id,
        display_name,
        now,
    )

    resolved_id = str(created_or_existing_id) if created_or_existing_id else source_account_id

    logger.info(
        "Materialized source_account from connection for raw persistence",
        source_account_id=resolved_id,
        connector_type=connector_type,
    )
    return resolved_id
