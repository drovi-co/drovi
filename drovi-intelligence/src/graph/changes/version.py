"""
Version Management

Manages entity versions for change tracking.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
import json

import structlog

logger = structlog.get_logger()


@dataclass
class EntityVersion:
    """A versioned snapshot of an entity."""

    entity_id: str
    entity_type: str
    version: int
    data: dict[str, Any]
    created_at: datetime
    created_by: str | None = None  # User/system that made the change
    change_reason: str | None = None  # Optional reason for the change

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "entity_id": self.entity_id,
            "entity_type": self.entity_type,
            "version": self.version,
            "data": self.data,
            "created_at": self.created_at.isoformat(),
            "created_by": self.created_by,
            "change_reason": self.change_reason,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "EntityVersion":
        """Create from dictionary."""
        return cls(
            entity_id=data["entity_id"],
            entity_type=data["entity_type"],
            version=data["version"],
            data=data["data"],
            created_at=datetime.fromisoformat(data["created_at"]),
            created_by=data.get("created_by"),
            change_reason=data.get("change_reason"),
        )


class VersionManager:
    """
    Manages entity version history.

    Stores version snapshots in PostgreSQL for audit trail
    and change detection capabilities.
    """

    def __init__(self):
        """Initialize version manager."""
        self._pool = None

    async def _get_pool(self):
        """Get database connection pool."""
        if self._pool is None:
            from src.db import get_raw_query_pool
            self._pool = await get_raw_query_pool()
        return self._pool

    async def save_version(
        self,
        entity_id: str,
        entity_type: str,
        data: dict[str, Any],
        created_by: str | None = None,
        change_reason: str | None = None,
    ) -> EntityVersion:
        """
        Save a new version of an entity.

        Args:
            entity_id: Entity ID
            entity_type: Type of entity (uio, entity, etc.)
            data: Entity data to snapshot
            created_by: Optional creator identifier
            change_reason: Optional reason for change

        Returns:
            Created EntityVersion
        """
        pool = await self._get_pool()

        async with pool.acquire() as conn:
            # Get current version number
            row = await conn.fetchrow(
                """
                SELECT COALESCE(MAX(version), 0) as max_version
                FROM entity_versions
                WHERE entity_id = $1 AND entity_type = $2
                """,
                entity_id,
                entity_type,
            )
            next_version = (row["max_version"] or 0) + 1

            # Insert new version
            now = datetime.utcnow()
            await conn.execute(
                """
                INSERT INTO entity_versions (
                    entity_id, entity_type, version, data,
                    created_at, created_by, change_reason
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                entity_id,
                entity_type,
                next_version,
                json.dumps(data),
                now,
                created_by,
                change_reason,
            )

        version = EntityVersion(
            entity_id=entity_id,
            entity_type=entity_type,
            version=next_version,
            data=data,
            created_at=now,
            created_by=created_by,
            change_reason=change_reason,
        )

        logger.debug(
            "Saved entity version",
            entity_id=entity_id,
            entity_type=entity_type,
            version=next_version,
        )

        return version

    async def get_version(
        self,
        entity_id: str,
        entity_type: str,
        version: int,
    ) -> EntityVersion | None:
        """
        Get a specific version of an entity.

        Args:
            entity_id: Entity ID
            entity_type: Type of entity
            version: Version number

        Returns:
            EntityVersion if found
        """
        pool = await self._get_pool()

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT entity_id, entity_type, version, data,
                       created_at, created_by, change_reason
                FROM entity_versions
                WHERE entity_id = $1 AND entity_type = $2 AND version = $3
                """,
                entity_id,
                entity_type,
                version,
            )

        if not row:
            return None

        return EntityVersion(
            entity_id=row["entity_id"],
            entity_type=row["entity_type"],
            version=row["version"],
            data=json.loads(row["data"]) if isinstance(row["data"], str) else row["data"],
            created_at=row["created_at"],
            created_by=row["created_by"],
            change_reason=row["change_reason"],
        )

    async def get_latest_version(
        self,
        entity_id: str,
        entity_type: str,
    ) -> EntityVersion | None:
        """
        Get the latest version of an entity.

        Args:
            entity_id: Entity ID
            entity_type: Type of entity

        Returns:
            Latest EntityVersion if found
        """
        pool = await self._get_pool()

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT entity_id, entity_type, version, data,
                       created_at, created_by, change_reason
                FROM entity_versions
                WHERE entity_id = $1 AND entity_type = $2
                ORDER BY version DESC
                LIMIT 1
                """,
                entity_id,
                entity_type,
            )

        if not row:
            return None

        return EntityVersion(
            entity_id=row["entity_id"],
            entity_type=row["entity_type"],
            version=row["version"],
            data=json.loads(row["data"]) if isinstance(row["data"], str) else row["data"],
            created_at=row["created_at"],
            created_by=row["created_by"],
            change_reason=row["change_reason"],
        )

    async def get_version_history(
        self,
        entity_id: str,
        entity_type: str,
        limit: int = 10,
    ) -> list[EntityVersion]:
        """
        Get version history for an entity.

        Args:
            entity_id: Entity ID
            entity_type: Type of entity
            limit: Maximum number of versions to return

        Returns:
            List of EntityVersions, newest first
        """
        pool = await self._get_pool()

        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT entity_id, entity_type, version, data,
                       created_at, created_by, change_reason
                FROM entity_versions
                WHERE entity_id = $1 AND entity_type = $2
                ORDER BY version DESC
                LIMIT $3
                """,
                entity_id,
                entity_type,
                limit,
            )

        return [
            EntityVersion(
                entity_id=row["entity_id"],
                entity_type=row["entity_type"],
                version=row["version"],
                data=json.loads(row["data"]) if isinstance(row["data"], str) else row["data"],
                created_at=row["created_at"],
                created_by=row["created_by"],
                change_reason=row["change_reason"],
            )
            for row in rows
        ]

    async def get_version_at_time(
        self,
        entity_id: str,
        entity_type: str,
        at_time: datetime,
    ) -> EntityVersion | None:
        """
        Get the version of an entity as of a specific time.

        Args:
            entity_id: Entity ID
            entity_type: Type of entity
            at_time: Point in time to query

        Returns:
            EntityVersion that was active at that time
        """
        pool = await self._get_pool()

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT entity_id, entity_type, version, data,
                       created_at, created_by, change_reason
                FROM entity_versions
                WHERE entity_id = $1 AND entity_type = $2
                  AND created_at <= $3
                ORDER BY version DESC
                LIMIT 1
                """,
                entity_id,
                entity_type,
                at_time,
            )

        if not row:
            return None

        return EntityVersion(
            entity_id=row["entity_id"],
            entity_type=row["entity_type"],
            version=row["version"],
            data=json.loads(row["data"]) if isinstance(row["data"], str) else row["data"],
            created_at=row["created_at"],
            created_by=row["created_by"],
            change_reason=row["change_reason"],
        )

    async def delete_old_versions(
        self,
        entity_id: str,
        entity_type: str,
        keep_versions: int = 10,
    ) -> int:
        """
        Delete old versions, keeping only the most recent N.

        Args:
            entity_id: Entity ID
            entity_type: Type of entity
            keep_versions: Number of versions to keep

        Returns:
            Number of versions deleted
        """
        pool = await self._get_pool()

        async with pool.acquire() as conn:
            result = await conn.execute(
                """
                DELETE FROM entity_versions
                WHERE entity_id = $1 AND entity_type = $2
                  AND version NOT IN (
                    SELECT version FROM entity_versions
                    WHERE entity_id = $1 AND entity_type = $2
                    ORDER BY version DESC
                    LIMIT $3
                  )
                """,
                entity_id,
                entity_type,
                keep_versions,
            )

        deleted = int(result.split()[-1]) if result else 0
        return deleted


# SQL schema for entity_versions table
ENTITY_VERSIONS_SCHEMA = """
CREATE TABLE IF NOT EXISTS entity_versions (
    id BIGSERIAL PRIMARY KEY,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    version INTEGER NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    change_reason TEXT,
    UNIQUE(entity_id, entity_type, version)
);

CREATE INDEX IF NOT EXISTS idx_entity_versions_entity
ON entity_versions(entity_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_entity_versions_created
ON entity_versions(created_at);
"""
