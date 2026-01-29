"""
Access Tracking

Tracks access to graph nodes for relevance decay and analytics.
Updates last_accessed_at and access_count on read operations.
"""

from datetime import datetime
from typing import Any
import asyncio

import structlog

logger = structlog.get_logger()


class AccessTracker:
    """
    Tracks access to graph nodes.

    Updates:
    - last_accessed_at: Timestamp of most recent access
    - access_count: Total number of times accessed

    These values are used for:
    - Memory decay calculation
    - Relevance scoring
    - Usage analytics
    """

    def __init__(self):
        """Initialize access tracker."""
        self._pending_updates: dict[str, dict[str, Any]] = {}
        self._batch_size = 100
        self._flush_interval = 30  # seconds
        self._flush_task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        """Start background flush task."""
        if self._running:
            return

        self._running = True
        self._flush_task = asyncio.create_task(self._flush_loop())
        logger.info("Access tracker started")

    async def stop(self) -> None:
        """Stop background flush task and flush remaining updates."""
        self._running = False
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass

        # Flush any remaining updates
        await self._flush_updates()
        logger.info("Access tracker stopped")

    async def _flush_loop(self) -> None:
        """Background loop for flushing access updates."""
        while self._running:
            try:
                await asyncio.sleep(self._flush_interval)
                await self._flush_updates()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in access tracker flush loop", error=str(e))

    async def _flush_updates(self) -> None:
        """Flush pending access updates to the database."""
        if not self._pending_updates:
            return

        # Swap out pending updates
        updates = self._pending_updates
        self._pending_updates = {}

        try:
            from src.graph.client import get_graph_client

            client = await get_graph_client()

            # Batch update nodes
            for node_key, update_info in updates.items():
                node_type = update_info.get("node_type", "node")
                node_id = update_info["node_id"]
                access_count = update_info["access_count"]
                last_accessed = update_info["last_accessed_at"]

                # Update the node in FalkorDB
                query = f"""
                    MATCH (n:{node_type} {{id: $node_id}})
                    SET n.last_accessed_at = $last_accessed,
                        n.access_count = COALESCE(n.access_count, 0) + $access_count
                    RETURN n.id
                """

                try:
                    await client.query(
                        query,
                        {
                            "node_id": node_id,
                            "last_accessed": last_accessed.isoformat(),
                            "access_count": access_count,
                        },
                    )
                except Exception as e:
                    logger.debug(
                        "Failed to update access for node",
                        node_id=node_id,
                        error=str(e),
                    )

            logger.debug(
                "Flushed access updates",
                count=len(updates),
            )

        except Exception as e:
            # Put updates back if flush failed
            self._pending_updates.update(updates)
            logger.error("Failed to flush access updates", error=str(e))

    def record_access(
        self,
        node_id: str,
        node_type: str = "node",
        access_count: int = 1,
    ) -> None:
        """
        Record an access to a node.

        Args:
            node_id: ID of the accessed node
            node_type: Type of node (UIO, Entity, etc.)
            access_count: Number of accesses to record
        """
        key = f"{node_type}:{node_id}"

        if key in self._pending_updates:
            self._pending_updates[key]["access_count"] += access_count
            self._pending_updates[key]["last_accessed_at"] = datetime.utcnow()
        else:
            self._pending_updates[key] = {
                "node_id": node_id,
                "node_type": node_type,
                "access_count": access_count,
                "last_accessed_at": datetime.utcnow(),
            }

        # Trigger immediate flush if batch size reached
        if len(self._pending_updates) >= self._batch_size:
            asyncio.create_task(self._flush_updates())

    async def record_access_async(
        self,
        node_id: str,
        node_type: str = "node",
    ) -> None:
        """Async version of record_access."""
        self.record_access(node_id, node_type)

    def record_batch_access(
        self,
        node_ids: list[str],
        node_type: str = "node",
    ) -> None:
        """
        Record access to multiple nodes.

        Args:
            node_ids: List of node IDs
            node_type: Type of nodes
        """
        for node_id in node_ids:
            self.record_access(node_id, node_type)

    async def get_access_stats(
        self,
        node_id: str,
        node_type: str = "node",
    ) -> dict[str, Any] | None:
        """
        Get access statistics for a node.

        Args:
            node_id: Node ID
            node_type: Node type

        Returns:
            Dict with access_count and last_accessed_at, or None
        """
        try:
            from src.graph.client import get_graph_client

            client = await get_graph_client()

            query = f"""
                MATCH (n:{node_type} {{id: $node_id}})
                RETURN n.access_count as access_count,
                       n.last_accessed_at as last_accessed_at
            """

            result = await client.query(query, {"node_id": node_id})

            if result and len(result) > 0:
                row = result[0]
                return {
                    "access_count": row.get("access_count", 0) or 0,
                    "last_accessed_at": row.get("last_accessed_at"),
                }

        except Exception as e:
            logger.debug("Failed to get access stats", node_id=node_id, error=str(e))

        return None

    async def get_most_accessed(
        self,
        organization_id: str,
        node_type: str | None = None,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """
        Get most accessed nodes.

        Args:
            organization_id: Organization ID
            node_type: Optional node type filter
            limit: Maximum results

        Returns:
            List of nodes with access stats
        """
        try:
            from src.graph.client import get_graph_client

            client = await get_graph_client()

            type_filter = f":{node_type}" if node_type else ""
            query = f"""
                MATCH (n{type_filter} {{organization_id: $org_id}})
                WHERE n.access_count > 0
                RETURN n.id as id,
                       labels(n)[0] as type,
                       n.access_count as access_count,
                       n.last_accessed_at as last_accessed_at
                ORDER BY n.access_count DESC
                LIMIT $limit
            """

            result = await client.query(
                query,
                {"org_id": organization_id, "limit": limit},
            )

            return [
                {
                    "id": row["id"],
                    "type": row["type"],
                    "access_count": row["access_count"],
                    "last_accessed_at": row["last_accessed_at"],
                }
                for row in result
            ]

        except Exception as e:
            logger.error("Failed to get most accessed", error=str(e))
            return []

    async def get_recently_accessed(
        self,
        organization_id: str,
        node_type: str | None = None,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """
        Get recently accessed nodes.

        Args:
            organization_id: Organization ID
            node_type: Optional node type filter
            limit: Maximum results

        Returns:
            List of nodes with access stats
        """
        try:
            from src.graph.client import get_graph_client

            client = await get_graph_client()

            type_filter = f":{node_type}" if node_type else ""
            query = f"""
                MATCH (n{type_filter} {{organization_id: $org_id}})
                WHERE n.last_accessed_at IS NOT NULL
                RETURN n.id as id,
                       labels(n)[0] as type,
                       n.access_count as access_count,
                       n.last_accessed_at as last_accessed_at
                ORDER BY n.last_accessed_at DESC
                LIMIT $limit
            """

            result = await client.query(
                query,
                {"org_id": organization_id, "limit": limit},
            )

            return [
                {
                    "id": row["id"],
                    "type": row["type"],
                    "access_count": row["access_count"],
                    "last_accessed_at": row["last_accessed_at"],
                }
                for row in result
            ]

        except Exception as e:
            logger.error("Failed to get recently accessed", error=str(e))
            return []

    async def get_never_accessed(
        self,
        organization_id: str,
        node_type: str | None = None,
        days_old: int = 30,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """
        Get nodes that have never been accessed (candidates for archival).

        Args:
            organization_id: Organization ID
            node_type: Optional node type filter
            days_old: Minimum age in days
            limit: Maximum results

        Returns:
            List of nodes that have never been accessed
        """
        try:
            from src.graph.client import get_graph_client

            client = await get_graph_client()

            cutoff = datetime.utcnow().isoformat()

            type_filter = f":{node_type}" if node_type else ""
            query = f"""
                MATCH (n{type_filter} {{organization_id: $org_id}})
                WHERE (n.access_count IS NULL OR n.access_count = 0)
                  AND n.created_at < $cutoff
                RETURN n.id as id,
                       labels(n)[0] as type,
                       n.created_at as created_at
                ORDER BY n.created_at ASC
                LIMIT $limit
            """

            result = await client.query(
                query,
                {"org_id": organization_id, "cutoff": cutoff, "limit": limit},
            )

            return [
                {
                    "id": row["id"],
                    "type": row["type"],
                    "created_at": row["created_at"],
                }
                for row in result
            ]

        except Exception as e:
            logger.error("Failed to get never accessed", error=str(e))
            return []


# Singleton instance
_access_tracker: AccessTracker | None = None


async def get_access_tracker() -> AccessTracker:
    """Get or create the singleton access tracker."""
    global _access_tracker
    if _access_tracker is None:
        _access_tracker = AccessTracker()
        await _access_tracker.start()
    return _access_tracker


# Decorator for tracking access on read operations
def track_access(node_type: str = "node"):
    """
    Decorator to track access to nodes returned by a function.

    The decorated function should return a dict with 'id' key
    or a list of dicts with 'id' keys.
    """
    def decorator(func):
        async def wrapper(*args, **kwargs):
            result = await func(*args, **kwargs)

            try:
                tracker = await get_access_tracker()

                if isinstance(result, dict) and "id" in result:
                    tracker.record_access(result["id"], node_type)
                elif isinstance(result, list):
                    node_ids = [
                        item["id"] for item in result
                        if isinstance(item, dict) and "id" in item
                    ]
                    if node_ids:
                        tracker.record_batch_access(node_ids, node_type)

            except Exception as e:
                logger.debug("Failed to track access", error=str(e))

            return result

        return wrapper
    return decorator
