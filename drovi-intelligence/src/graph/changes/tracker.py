"""
Change Tracker

High-level API for tracking and querying entity changes.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import structlog

from src.graph.changes.diff import DiffResult, compute_diff
from src.graph.changes.version import EntityVersion, VersionManager

logger = structlog.get_logger()

# Singleton instance
_tracker: "ChangeTracker | None" = None


@dataclass
class ChangeRecord:
    """A record of a change to an entity."""

    entity_id: str
    entity_type: str
    change_type: str  # created, updated, deleted
    version: int
    diff: DiffResult | None
    timestamp: datetime
    changed_by: str | None = None
    change_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "entity_id": self.entity_id,
            "entity_type": self.entity_type,
            "change_type": self.change_type,
            "version": self.version,
            "diff": self.diff.to_dict() if self.diff else None,
            "timestamp": self.timestamp.isoformat(),
            "changed_by": self.changed_by,
            "change_reason": self.change_reason,
        }


class ChangeTracker:
    """
    Tracks changes to entities over time.

    Provides:
    - Automatic version creation on entity updates
    - Diff computation between versions
    - Query for changes since a specific time
    - Change history for entities
    """

    def __init__(self):
        """Initialize change tracker."""
        self._version_manager = VersionManager()

    async def track_change(
        self,
        entity_id: str,
        entity_type: str,
        new_data: dict[str, Any],
        changed_by: str | None = None,
        change_reason: str | None = None,
    ) -> ChangeRecord:
        """
        Track a change to an entity.

        Args:
            entity_id: Entity ID
            entity_type: Type of entity
            new_data: New entity data
            changed_by: Who made the change
            change_reason: Why the change was made

        Returns:
            ChangeRecord with diff information
        """
        # Get previous version
        prev_version = await self._version_manager.get_latest_version(
            entity_id, entity_type
        )

        # Compute diff
        old_data = prev_version.data if prev_version else None
        old_version_num = prev_version.version if prev_version else None
        new_version_num = (old_version_num or 0) + 1

        diff = compute_diff(
            old_data=old_data,
            new_data=new_data,
            entity_id=entity_id,
            entity_type=entity_type,
            old_version=old_version_num,
            new_version=new_version_num,
        )

        # Save new version
        version = await self._version_manager.save_version(
            entity_id=entity_id,
            entity_type=entity_type,
            data=new_data,
            created_by=changed_by,
            change_reason=change_reason,
        )

        # Determine change type
        if diff.is_new:
            change_type = "created"
        elif diff.is_deleted:
            change_type = "deleted"
        else:
            change_type = "updated"

        record = ChangeRecord(
            entity_id=entity_id,
            entity_type=entity_type,
            change_type=change_type,
            version=version.version,
            diff=diff,
            timestamp=version.created_at,
            changed_by=changed_by,
            change_reason=change_reason,
        )

        logger.debug(
            "Tracked entity change",
            entity_id=entity_id,
            entity_type=entity_type,
            change_type=change_type,
            version=version.version,
        )

        return record

    async def get_changes_since(
        self,
        organization_id: str,
        since: datetime,
        entity_types: list[str] | None = None,
        limit: int = 100,
    ) -> list[ChangeRecord]:
        """
        Get all changes since a specific time.

        Args:
            organization_id: Organization ID
            since: Start time for changes
            entity_types: Optional filter by entity types
            limit: Maximum number of changes to return

        Returns:
            List of ChangeRecords
        """
        from src.db import get_raw_query_pool

        pool = await get_raw_query_pool()

        # Build query
        query = """
            SELECT
                ev1.entity_id,
                ev1.entity_type,
                ev1.version,
                ev1.data as new_data,
                ev1.created_at,
                ev1.created_by,
                ev1.change_reason,
                ev2.data as old_data,
                ev2.version as old_version
            FROM entity_versions ev1
            LEFT JOIN entity_versions ev2
                ON ev1.entity_id = ev2.entity_id
                AND ev1.entity_type = ev2.entity_type
                AND ev2.version = ev1.version - 1
            WHERE ev1.created_at > $1
        """

        params = [since]
        param_count = 1

        if entity_types:
            param_count += 1
            query += f" AND ev1.entity_type = ANY(${param_count})"
            params.append(entity_types)

        query += f"""
            ORDER BY ev1.created_at DESC
            LIMIT ${param_count + 1}
        """
        params.append(limit)

        async with pool.acquire() as conn:
            rows = await conn.fetch(query, *params)

        records = []
        for row in rows:
            new_data = row["new_data"]
            old_data = row["old_data"]

            if isinstance(new_data, str):
                import json
                new_data = json.loads(new_data)
            if isinstance(old_data, str):
                import json
                old_data = json.loads(old_data)

            diff = compute_diff(
                old_data=old_data,
                new_data=new_data,
                entity_id=row["entity_id"],
                entity_type=row["entity_type"],
                old_version=row["old_version"],
                new_version=row["version"],
            )

            if diff.is_new:
                change_type = "created"
            elif diff.is_deleted:
                change_type = "deleted"
            else:
                change_type = "updated"

            records.append(ChangeRecord(
                entity_id=row["entity_id"],
                entity_type=row["entity_type"],
                change_type=change_type,
                version=row["version"],
                diff=diff,
                timestamp=row["created_at"],
                changed_by=row["created_by"],
                change_reason=row["change_reason"],
            ))

        return records

    async def get_entity_history(
        self,
        entity_id: str,
        entity_type: str,
        limit: int = 10,
    ) -> list[ChangeRecord]:
        """
        Get change history for an entity.

        Args:
            entity_id: Entity ID
            entity_type: Type of entity
            limit: Maximum number of changes

        Returns:
            List of ChangeRecords, newest first
        """
        versions = await self._version_manager.get_version_history(
            entity_id, entity_type, limit + 1  # Get one extra for diffing
        )

        records = []
        for i, version in enumerate(versions[:-1] if len(versions) > 1 else versions):
            old_version = versions[i + 1] if i + 1 < len(versions) else None

            diff = compute_diff(
                old_data=old_version.data if old_version else None,
                new_data=version.data,
                entity_id=entity_id,
                entity_type=entity_type,
                old_version=old_version.version if old_version else None,
                new_version=version.version,
            )

            if diff.is_new:
                change_type = "created"
            elif diff.is_deleted:
                change_type = "deleted"
            else:
                change_type = "updated"

            records.append(ChangeRecord(
                entity_id=entity_id,
                entity_type=entity_type,
                change_type=change_type,
                version=version.version,
                diff=diff,
                timestamp=version.created_at,
                changed_by=version.created_by,
                change_reason=version.change_reason,
            ))

        return records[:limit]

    async def compare_versions(
        self,
        entity_id: str,
        entity_type: str,
        version1: int,
        version2: int,
    ) -> DiffResult | None:
        """
        Compare two specific versions of an entity.

        Args:
            entity_id: Entity ID
            entity_type: Type of entity
            version1: First version (older)
            version2: Second version (newer)

        Returns:
            DiffResult or None if versions not found
        """
        v1 = await self._version_manager.get_version(entity_id, entity_type, version1)
        v2 = await self._version_manager.get_version(entity_id, entity_type, version2)

        if not v1 or not v2:
            return None

        return compute_diff(
            old_data=v1.data,
            new_data=v2.data,
            entity_id=entity_id,
            entity_type=entity_type,
            old_version=version1,
            new_version=version2,
        )

    async def get_entity_at_time(
        self,
        entity_id: str,
        entity_type: str,
        at_time: datetime,
    ) -> dict[str, Any] | None:
        """
        Get entity state as of a specific time.

        Args:
            entity_id: Entity ID
            entity_type: Type of entity
            at_time: Point in time

        Returns:
            Entity data at that time, or None
        """
        version = await self._version_manager.get_version_at_time(
            entity_id, entity_type, at_time
        )
        return version.data if version else None

    async def get_changed_entities(
        self,
        organization_id: str,
        since: datetime,
        entity_types: list[str] | None = None,
    ) -> dict[str, list[str]]:
        """
        Get IDs of entities that changed since a time.

        Args:
            organization_id: Organization ID
            since: Start time
            entity_types: Optional filter

        Returns:
            Dict mapping entity_type -> list of entity_ids
        """
        from src.db import get_raw_query_pool

        pool = await get_raw_query_pool()

        query = """
            SELECT DISTINCT entity_id, entity_type
            FROM entity_versions
            WHERE created_at > $1
        """
        params = [since]

        if entity_types:
            query += " AND entity_type = ANY($2)"
            params.append(entity_types)

        async with pool.acquire() as conn:
            rows = await conn.fetch(query, *params)

        result: dict[str, list[str]] = {}
        for row in rows:
            entity_type = row["entity_type"]
            if entity_type not in result:
                result[entity_type] = []
            result[entity_type].append(row["entity_id"])

        return result


async def get_change_tracker() -> ChangeTracker:
    """Get or create the singleton change tracker."""
    global _tracker
    if _tracker is None:
        _tracker = ChangeTracker()
    return _tracker
