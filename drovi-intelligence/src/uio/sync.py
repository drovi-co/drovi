"""
UIO Sync

Synchronizes UIOs across the three data stores:
1. PostgreSQL - Source of truth for status and user data
2. FalkorDB - Graph relationships and search
3. Graphiti - Temporal memory and entity extraction

This ensures consistency across all stores while maintaining
each store's unique strengths.
"""

from datetime import datetime
from typing import Literal

import structlog

from src.graph.client import get_graph_client
from src.memory.graphiti_memory import get_graphiti_memory
from src.orchestrator.state import UIOStatus

logger = structlog.get_logger()

SyncDirection = Literal["pg_to_graph", "graph_to_pg", "bidirectional"]


class UIOSync:
    """
    Synchronizes UIO data across PostgreSQL, FalkorDB, and Graphiti.

    Handles:
    - Initial sync when UIOs are created
    - Status updates across stores
    - Batch sync for data migrations
    - Conflict resolution
    """

    def __init__(self, organization_id: str):
        self.organization_id = organization_id
        self._graph = None
        self._memory = None

    async def _get_graph(self):
        """Lazy load graph client."""
        if self._graph is None:
            self._graph = await get_graph_client()
        return self._graph

    async def _get_memory(self):
        """Lazy load Graphiti memory."""
        if self._memory is None:
            self._memory = await get_graphiti_memory(self.organization_id)
        return self._memory

    # =========================================================================
    # Sync Operations
    # =========================================================================

    async def sync_uio_to_graph(
        self,
        uio_id: str,
        uio_type: str,
        data: dict,
    ) -> bool:
        """
        Sync a UIO from PostgreSQL to FalkorDB.

        Args:
            uio_id: UIO ID
            uio_type: Type of UIO (commitment, decision, task, etc.)
            data: UIO data from PostgreSQL

        Returns:
            True if sync was successful
        """
        graph = await self._get_graph()

        logger.info(
            "Syncing UIO to FalkorDB",
            uio_id=uio_id,
            uio_type=uio_type,
        )

        # Build node properties
        props = self._prepare_graph_properties(data)

        # Determine label
        label_map = {
            "commitment": "Commitment",
            "decision": "Decision",
            "task": "Task",
            "claim": "Claim",
            "risk": "Risk",
        }
        label = label_map.get(uio_type, "UIO")

        try:
            # Upsert node in FalkorDB
            # FalkorDB doesn't support SET += $props - use explicit properties
            set_clause, set_params = graph.build_set_clause("u", props)
            await graph.query(
                f"""
                MERGE (u:UIO:{label} {{id: $id, organizationId: $orgId}})
                ON CREATE SET {set_clause}
                ON MATCH SET {set_clause}
                """,
                {"id": uio_id, "orgId": self.organization_id, **set_params},
            )

            logger.debug(
                "UIO synced to FalkorDB",
                uio_id=uio_id,
            )

            return True

        except Exception as e:
            logger.error(
                "Failed to sync UIO to FalkorDB",
                uio_id=uio_id,
                error=str(e),
            )
            return False

    async def sync_uio_to_memory(
        self,
        uio_id: str,
        uio_type: str,
        data: dict,
    ) -> str | None:
        """
        Sync a UIO to Graphiti memory as an episode.

        This creates a temporal record of the UIO for memory search.

        Args:
            uio_id: UIO ID
            uio_type: Type of UIO
            data: UIO data

        Returns:
            Episode ID if successful, None otherwise
        """
        memory = await self._get_memory()

        logger.info(
            "Syncing UIO to Graphiti memory",
            uio_id=uio_id,
            uio_type=uio_type,
        )

        try:
            # Build episode content
            title = data.get("title", "")
            description = data.get("description", "")
            content = f"{uio_type.capitalize()}: {title}\n{description}"

            # Add relevant parties
            if uio_type == "commitment":
                debtor = data.get("debtorName", "")
                creditor = data.get("creditorName", "")
                if debtor or creditor:
                    content += f"\nParties: {debtor} -> {creditor}"

            if uio_type == "task":
                assignee = data.get("assigneeName", "")
                if assignee:
                    content += f"\nAssignee: {assignee}"

            # Determine reference time
            ref_time = data.get("createdAt")
            if isinstance(ref_time, str):
                ref_time = datetime.fromisoformat(ref_time.replace("Z", "+00:00"))
            elif ref_time is None:
                ref_time = datetime.utcnow()

            episode_id = await memory.add_episode(
                name=f"{uio_type.capitalize()}: {title}",
                content=content,
                source_type="uio_sync",
                reference_time=ref_time,
                source_id=uio_id,
            )

            logger.debug(
                "UIO synced to Graphiti memory",
                uio_id=uio_id,
                episode_id=episode_id,
            )

            return episode_id

        except Exception as e:
            logger.error(
                "Failed to sync UIO to Graphiti memory",
                uio_id=uio_id,
                error=str(e),
            )
            return None

    async def sync_status_change(
        self,
        uio_id: str,
        old_status: UIOStatus,
        new_status: UIOStatus,
        changed_by: str | None = None,
    ) -> bool:
        """
        Sync a status change across all stores.

        Args:
            uio_id: UIO ID
            old_status: Previous status
            new_status: New status
            changed_by: User who made the change

        Returns:
            True if sync was successful
        """
        graph = await self._get_graph()
        memory = await self._get_memory()

        now = datetime.utcnow()

        logger.info(
            "Syncing status change",
            uio_id=uio_id,
            old_status=old_status.value,
            new_status=new_status.value,
        )

        try:
            # Update in FalkorDB
            update_props = {
                "status": new_status.value,
                "updatedAt": now.isoformat(),
                "statusChangedAt": now.isoformat(),
            }

            if new_status in (UIOStatus.COMPLETED, UIOStatus.CANCELLED):
                update_props["completedAt"] = now.isoformat()

            # FalkorDB doesn't support SET += $props - use explicit properties
            set_clause, set_params = graph.build_set_clause("u", update_props)
            await graph.query(
                f"""
                MATCH (u:UIO {{id: $id, organizationId: $orgId}})
                SET {set_clause}
                """,
                {"id": uio_id, "orgId": self.organization_id, **set_params},
            )

            # Create status change episode in memory
            await memory.add_episode(
                name=f"Status Change: {old_status.value} → {new_status.value}",
                content=f"UIO {uio_id} status changed from {old_status.value} to {new_status.value}"
                + (f" by {changed_by}" if changed_by else ""),
                source_type="status_change",
                reference_time=now,
                source_id=uio_id,
            )

            return True

        except Exception as e:
            logger.error(
                "Failed to sync status change",
                uio_id=uio_id,
                error=str(e),
            )
            return False

    # =========================================================================
    # Batch Sync
    # =========================================================================

    async def batch_sync_to_graph(
        self,
        uios: list[dict],
    ) -> dict:
        """
        Batch sync multiple UIOs to FalkorDB.

        Args:
            uios: List of UIO dicts with 'id', 'type', and 'data' keys

        Returns:
            Dict with 'succeeded' and 'failed' counts
        """
        logger.info(
            "Batch syncing UIOs to FalkorDB",
            count=len(uios),
        )

        succeeded = 0
        failed = 0

        for uio in uios:
            success = await self.sync_uio_to_graph(
                uio_id=uio["id"],
                uio_type=uio["type"],
                data=uio["data"],
            )
            if success:
                succeeded += 1
            else:
                failed += 1

        logger.info(
            "Batch sync complete",
            succeeded=succeeded,
            failed=failed,
        )

        return {"succeeded": succeeded, "failed": failed}

    async def full_sync(self, uio_id: str, uio_type: str, data: dict) -> dict:
        """
        Perform a full sync of a UIO to all stores.

        Args:
            uio_id: UIO ID
            uio_type: Type of UIO
            data: UIO data

        Returns:
            Dict with sync results for each store
        """
        results = {
            "graph": False,
            "memory": None,
        }

        # Sync to FalkorDB
        results["graph"] = await self.sync_uio_to_graph(uio_id, uio_type, data)

        # Sync to Graphiti memory
        episode_id = await self.sync_uio_to_memory(uio_id, uio_type, data)
        results["memory"] = episode_id

        return results

    # =========================================================================
    # Relationship Sync
    # =========================================================================

    async def sync_uio_relationship(
        self,
        source_uio_id: str,
        target_uio_id: str,
        relationship_type: str,
        properties: dict | None = None,
    ) -> bool:
        """
        Sync a relationship between two UIOs to FalkorDB.

        Args:
            source_uio_id: Source UIO ID
            target_uio_id: Target UIO ID
            relationship_type: Type of relationship (e.g., DEPENDS_ON, BLOCKS)
            properties: Optional relationship properties

        Returns:
            True if sync was successful
        """
        graph = await self._get_graph()

        logger.info(
            "Syncing UIO relationship",
            source=source_uio_id,
            target=target_uio_id,
            type=relationship_type,
        )

        try:
            props = properties or {}
            props["createdAt"] = datetime.utcnow().isoformat()

            # FalkorDB doesn't support SET += $props - use explicit properties
            set_clause, set_params = graph.build_set_clause("r", props)
            await graph.query(
                f"""
                MATCH (source:UIO {{id: $sourceId, organizationId: $orgId}})
                MATCH (target:UIO {{id: $targetId, organizationId: $orgId}})
                MERGE (source)-[r:{relationship_type}]->(target)
                SET {set_clause}
                """,
                {
                    "sourceId": source_uio_id,
                    "targetId": target_uio_id,
                    "orgId": self.organization_id,
                    **set_params,
                },
            )

            return True

        except Exception as e:
            logger.error(
                "Failed to sync UIO relationship",
                source=source_uio_id,
                target=target_uio_id,
                error=str(e),
            )
            return False

    async def sync_contact_relationship(
        self,
        uio_id: str,
        contact_email: str,
        relationship_type: str,
    ) -> bool:
        """
        Sync a relationship between a UIO and a Contact.

        Args:
            uio_id: UIO ID
            contact_email: Contact email
            relationship_type: Type of relationship (e.g., ASSIGNED_TO, CREATED_BY)

        Returns:
            True if sync was successful
        """
        graph = await self._get_graph()

        try:
            from datetime import datetime
            now = datetime.utcnow().isoformat()
            await graph.query(
                f"""
                MATCH (u:UIO {{id: $uioId, organizationId: $orgId}})
                MERGE (c:Contact {{email: $email, organizationId: $orgId}})
                MERGE (u)-[r:{relationship_type}]->(c)
                SET r.createdAt = $createdAt
                """,
                {
                    "uioId": uio_id,
                    "email": contact_email,
                    "orgId": self.organization_id,
                    "createdAt": now,
                },
            )

            return True

        except Exception as e:
            logger.error(
                "Failed to sync contact relationship",
                uio_id=uio_id,
                contact=contact_email,
                error=str(e),
            )
            return False

    # =========================================================================
    # Helpers
    # =========================================================================

    def _prepare_graph_properties(self, data: dict) -> dict:
        """Prepare properties for FalkorDB storage."""
        import json

        props = {}
        for key, value in data.items():
            if value is None:
                continue
            if isinstance(value, datetime):
                props[key] = value.isoformat()
            elif isinstance(value, (list, dict)):
                props[key] = json.dumps(value)
            else:
                props[key] = value

        props["organizationId"] = self.organization_id
        props["updatedAt"] = datetime.utcnow().isoformat()

        return props


# =============================================================================
# Singleton
# =============================================================================

_uio_syncs: dict[str, UIOSync] = {}


async def get_uio_sync(organization_id: str) -> UIOSync:
    """Get a UIOSync for an organization."""
    global _uio_syncs

    if organization_id not in _uio_syncs:
        _uio_syncs[organization_id] = UIOSync(organization_id)

    return _uio_syncs[organization_id]
