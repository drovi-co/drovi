"""
Connector State Repository

Persists per-stream sync cursors to PostgreSQL (sync_states table).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import structlog
from sqlalchemy import text

from src.connectors.base.state import ConnectorState, SyncCheckpoint
from src.db.client import get_db_session

logger = structlog.get_logger()


class ConnectorStateRepository:
    """Database-backed sync state storage."""

    async def get_state(self, connection_id: str, connector_type: str) -> ConnectorState:
        """Load state for a connection from the database."""
        async with get_db_session() as session:
            rows = await session.execute(
                text(
                    """
                    SELECT stream_name, cursor_state, records_synced, bytes_synced,
                           status, error_message, last_sync_started_at, last_sync_completed_at
                    FROM sync_states
                    WHERE connection_id = :connection_id
                    """
                ),
                {"connection_id": connection_id},
            )
            results = rows.mappings().all()

        state = ConnectorState(connection_id=connection_id, connector_type=connector_type)
        for row in results:
            state.stream_states[row["stream_name"]] = SyncCheckpoint(
                stream_name=row["stream_name"],
                connection_id=connection_id,
                cursor=row.get("cursor_state") or {},
                records_synced=row.get("records_synced") or 0,
                bytes_synced=row.get("bytes_synced") or 0,
                status=row.get("status") or "idle",
                error_message=row.get("error_message"),
                last_sync_started_at=row.get("last_sync_started_at"),
                last_sync_completed_at=row.get("last_sync_completed_at"),
            )
        return state

    async def upsert_stream_state(
        self,
        connection_id: str,
        stream_name: str,
        cursor_state: dict[str, Any] | None = None,
        status: str | None = None,
        records_synced: int | None = None,
        bytes_synced: int | None = None,
        error_message: str | None = None,
        last_sync_started_at: datetime | None = None,
        last_sync_completed_at: datetime | None = None,
    ) -> None:
        """Insert or update a single stream state."""
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO sync_states (
                        id, connection_id, stream_name, cursor_state,
                        records_synced, bytes_synced, status,
                        error_message, last_sync_started_at, last_sync_completed_at,
                        created_at, updated_at
                    ) VALUES (
                        gen_random_uuid(), :connection_id, :stream_name, :cursor_state,
                        :records_synced, :bytes_synced, :status,
                        :error_message, :last_sync_started_at, :last_sync_completed_at,
                        NOW(), NOW()
                    )
                    ON CONFLICT (connection_id, stream_name)
                    DO UPDATE SET
                        cursor_state = COALESCE(EXCLUDED.cursor_state, sync_states.cursor_state),
                        records_synced = COALESCE(EXCLUDED.records_synced, sync_states.records_synced),
                        bytes_synced = COALESCE(EXCLUDED.bytes_synced, sync_states.bytes_synced),
                        status = COALESCE(EXCLUDED.status, sync_states.status),
                        error_message = EXCLUDED.error_message,
                        last_sync_started_at = COALESCE(EXCLUDED.last_sync_started_at, sync_states.last_sync_started_at),
                        last_sync_completed_at = COALESCE(EXCLUDED.last_sync_completed_at, sync_states.last_sync_completed_at),
                        updated_at = NOW()
                    """
                ),
                {
                    "connection_id": connection_id,
                    "stream_name": stream_name,
                    "cursor_state": cursor_state,
                    "records_synced": records_synced,
                    "bytes_synced": bytes_synced,
                    "status": status,
                    "error_message": error_message,
                    "last_sync_started_at": last_sync_started_at,
                    "last_sync_completed_at": last_sync_completed_at,
                },
            )
            await session.commit()


_state_repo: ConnectorStateRepository | None = None


def get_state_repo() -> ConnectorStateRepository:
    global _state_repo
    if _state_repo is None:
        _state_repo = ConnectorStateRepository()
    return _state_repo
