"""
UIO Manager

Manages the lifecycle of Universal Intelligence Objects (UIOs) across
PostgreSQL, FalkorDB, and Graphiti stores.

UIOs are the core abstraction for all extracted intelligence:
- Commitments
- Decisions
- Tasks
- Claims
- Risks

Each UIO follows a complete lifecycle:
draft → active → in_progress → completed/cancelled → archived
"""

from datetime import datetime
from typing import Literal
from uuid import uuid4

import structlog

from src.graph.client import get_graph_client
from src.memory.graphiti_memory import get_graphiti_memory
from src.orchestrator.state import UIOStatus

logger = structlog.get_logger()

UIOType = Literal["commitment", "decision", "task", "claim", "risk"]


class UIOManager:
    """
    Manages UIO lifecycle across all stores.

    Responsibilities:
    - Create UIOs with proper initial state
    - Update UIO status with validation
    - Handle user corrections
    - Merge duplicate UIOs
    - Sync across PostgreSQL, FalkorDB, and Graphiti
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
    # Create UIOs
    # =========================================================================

    async def create_uio(
        self,
        uio_type: UIOType,
        data: dict,
        source_type: str,
        source_id: str | None = None,
        episode_id: str | None = None,
        confidence: float = 0.0,
    ) -> str:
        """
        Create a new UIO with proper lifecycle initialization.

        The UIO is created in DRAFT status and requires review
        before becoming active.

        Args:
            uio_type: Type of UIO (commitment, decision, task, claim, risk)
            data: UIO-specific data (title, description, etc.)
            source_type: Source of extraction (email, slack, etc.)
            source_id: Optional source identifier
            episode_id: Optional Graphiti episode ID
            confidence: Extraction confidence score

        Returns:
            The created UIO ID
        """
        graph = await self._get_graph()

        uio_id = str(uuid4())
        now = datetime.utcnow()

        logger.info(
            "Creating UIO",
            organization_id=self.organization_id,
            uio_type=uio_type,
            uio_id=uio_id,
        )

        # Build node properties
        node_props = {
            "id": uio_id,
            "organizationId": self.organization_id,
            "status": UIOStatus.DRAFT.value,
            "createdAt": now.isoformat(),
            "updatedAt": now.isoformat(),
            "sourceType": source_type,
            "sourceId": source_id,
            "episodeId": episode_id,
            "confidence": confidence,
            "needsReview": True,
            "userCorrected": False,
            **self._sanitize_properties(data),
        }

        # Determine label based on type
        label_map = {
            "commitment": "Commitment",
            "decision": "Decision",
            "task": "Task",
            "claim": "Claim",
            "risk": "Risk",
        }
        label = label_map.get(uio_type, "UIO")

        # Create node in FalkorDB
        try:
            # FalkorDB doesn't support $props directly - use explicit properties
            props_clause, props_params = graph.build_create_properties(node_props)
            await graph.query(
                f"""
                CREATE (u:UIO:{label} {{{props_clause}}})
                """,
                props_params,
            )

            # Link to episode if provided
            if episode_id:
                await graph.query(
                    """
                    MATCH (u:UIO {id: $uioId})
                    MATCH (e:Episode {id: $episodeId})
                    CREATE (u)-[:EXTRACTED_FROM]->(e)
                    """,
                    {"uioId": uio_id, "episodeId": episode_id},
                )

            logger.info(
                "UIO created in FalkorDB",
                uio_id=uio_id,
                uio_type=uio_type,
            )

        except Exception as e:
            logger.error(
                "Failed to create UIO in FalkorDB",
                uio_id=uio_id,
                error=str(e),
            )
            raise

        return uio_id

    # =========================================================================
    # Update UIO Status
    # =========================================================================

    async def update_status(
        self,
        uio_id: str,
        new_status: UIOStatus,
        user_id: str | None = None,
    ) -> bool:
        """
        Update UIO status with validation.

        Valid transitions:
        - draft → active, cancelled
        - active → in_progress, completed, cancelled
        - in_progress → completed, cancelled, active
        - completed → archived
        - cancelled → archived

        Args:
            uio_id: UIO ID
            new_status: New status
            user_id: User making the change (for audit)

        Returns:
            True if status was updated
        """
        graph = await self._get_graph()

        # Get current status
        result = await graph.query(
            """
            MATCH (u:UIO {id: $id, organizationId: $orgId})
            RETURN u.status as status
            """,
            {"id": uio_id, "orgId": self.organization_id},
        )

        if not result:
            logger.warning(
                "UIO not found for status update",
                uio_id=uio_id,
            )
            return False

        current_status = UIOStatus(result[0].get("status", "draft"))

        # Validate transition
        if not self._is_valid_transition(current_status, new_status):
            logger.warning(
                "Invalid status transition",
                uio_id=uio_id,
                from_status=current_status.value,
                to_status=new_status.value,
            )
            return False

        now = datetime.utcnow()

        # Build update properties
        update_props = {
            "status": new_status.value,
            "updatedAt": now.isoformat(),
            "statusChangedAt": now.isoformat(),
        }

        # Set completed_at if completing
        if new_status in (UIOStatus.COMPLETED, UIOStatus.CANCELLED):
            update_props["completedAt"] = now.isoformat()

        # Set reviewed info if activating from draft
        if current_status == UIOStatus.DRAFT and new_status == UIOStatus.ACTIVE:
            update_props["needsReview"] = False
            if user_id:
                update_props["reviewedBy"] = user_id
                update_props["reviewedAt"] = now.isoformat()

        # Update in FalkorDB
        try:
            # FalkorDB doesn't support SET += $props - use explicit properties
            set_clause, set_params = graph.build_set_clause("u", update_props)
            await graph.query(
                f"""
                MATCH (u:UIO {{id: $id, organizationId: $orgId}})
                SET {set_clause}
                """,
                {"id": uio_id, "orgId": self.organization_id, **set_params},
            )

            logger.info(
                "UIO status updated",
                uio_id=uio_id,
                from_status=current_status.value,
                to_status=new_status.value,
            )

            # Create status change episode in memory
            try:
                memory = await self._get_memory()
                await memory.add_episode(
                    name=f"UIO Status Change: {new_status.value}",
                    content=f"UIO {uio_id} status changed from {current_status.value} to {new_status.value}",
                    source_type="system",
                    reference_time=now,
                )
            except Exception as e:
                logger.warning(
                    "Failed to create status change episode",
                    error=str(e),
                )

            return True

        except Exception as e:
            logger.error(
                "Failed to update UIO status",
                uio_id=uio_id,
                error=str(e),
            )
            return False

    def _is_valid_transition(
        self,
        from_status: UIOStatus,
        to_status: UIOStatus,
    ) -> bool:
        """Check if status transition is valid."""
        valid_transitions = {
            UIOStatus.DRAFT: [UIOStatus.ACTIVE, UIOStatus.CANCELLED],
            UIOStatus.ACTIVE: [UIOStatus.IN_PROGRESS, UIOStatus.COMPLETED, UIOStatus.CANCELLED],
            UIOStatus.IN_PROGRESS: [UIOStatus.COMPLETED, UIOStatus.CANCELLED, UIOStatus.ACTIVE],
            UIOStatus.COMPLETED: [UIOStatus.ARCHIVED],
            UIOStatus.CANCELLED: [UIOStatus.ARCHIVED],
            UIOStatus.ARCHIVED: [],  # No transitions from archived
        }

        return to_status in valid_transitions.get(from_status, [])

    # =========================================================================
    # User Corrections
    # =========================================================================

    async def apply_correction(
        self,
        uio_id: str,
        corrections: dict,
        user_id: str,
    ) -> bool:
        """
        Apply user corrections to a UIO.

        Stores the original extraction for training data and marks
        the UIO as user-corrected.

        Args:
            uio_id: UIO ID
            corrections: Dict of field corrections
            user_id: User making the correction

        Returns:
            True if correction was applied
        """
        graph = await self._get_graph()

        # Get current UIO data
        result = await graph.query(
            """
            MATCH (u:UIO {id: $id, organizationId: $orgId})
            RETURN properties(u) as props
            """,
            {"id": uio_id, "orgId": self.organization_id},
        )

        if not result:
            logger.warning(
                "UIO not found for correction",
                uio_id=uio_id,
            )
            return False

        current_props = result[0].get("props", {})
        now = datetime.utcnow()

        # Store original if not already corrected
        original_extraction = None
        if not current_props.get("userCorrected"):
            # Store original values for the corrected fields
            original_extraction = {
                k: current_props.get(k)
                for k in corrections.keys()
                if k in current_props
            }

        # Build update
        update_props = {
            **self._sanitize_properties(corrections),
            "updatedAt": now.isoformat(),
            "userCorrected": True,
            "reviewedBy": user_id,
            "reviewedAt": now.isoformat(),
            "needsReview": False,
        }

        if original_extraction:
            # Store as JSON string for FalkorDB compatibility
            import json
            update_props["originalExtraction"] = json.dumps(original_extraction)

        try:
            # FalkorDB doesn't support SET += $props - use explicit properties
            set_clause, set_params = graph.build_set_clause("u", update_props)
            await graph.query(
                f"""
                MATCH (u:UIO {{id: $id, organizationId: $orgId}})
                SET {set_clause}
                """,
                {"id": uio_id, "orgId": self.organization_id, **set_params},
            )

            logger.info(
                "UIO correction applied",
                uio_id=uio_id,
                corrected_fields=list(corrections.keys()),
            )

            return True

        except Exception as e:
            logger.error(
                "Failed to apply UIO correction",
                uio_id=uio_id,
                error=str(e),
            )
            return False

    # =========================================================================
    # Merge UIOs
    # =========================================================================

    async def merge_uios(
        self,
        source_uio_id: str,
        target_uio_id: str,
        merge_strategy: Literal["newest_wins", "highest_confidence", "manual"] = "newest_wins",
        manual_resolution: dict | None = None,
    ) -> bool:
        """
        Merge duplicate UIOs.

        The source UIO is archived and linked to the target via
        MERGED_INTO relationship. All relationships from source
        are transferred to target.

        Args:
            source_uio_id: UIO to be merged (will be archived)
            target_uio_id: UIO to merge into (will be updated)
            merge_strategy: How to resolve conflicts
            manual_resolution: Field values for manual strategy

        Returns:
            True if merge was successful
        """
        graph = await self._get_graph()

        logger.info(
            "Merging UIOs",
            source_uio_id=source_uio_id,
            target_uio_id=target_uio_id,
            strategy=merge_strategy,
        )

        # Get both UIOs
        result = await graph.query(
            """
            MATCH (source:UIO {id: $sourceId, organizationId: $orgId})
            MATCH (target:UIO {id: $targetId, organizationId: $orgId})
            RETURN properties(source) as sourceProps, properties(target) as targetProps
            """,
            {
                "sourceId": source_uio_id,
                "targetId": target_uio_id,
                "orgId": self.organization_id,
            },
        )

        if not result:
            logger.warning(
                "UIOs not found for merge",
                source_uio_id=source_uio_id,
                target_uio_id=target_uio_id,
            )
            return False

        source_props = result[0].get("sourceProps", {})
        target_props = result[0].get("targetProps", {})

        # Determine merged values based on strategy
        if merge_strategy == "manual" and manual_resolution:
            merged_data = manual_resolution
        elif merge_strategy == "highest_confidence":
            if source_props.get("confidence", 0) > target_props.get("confidence", 0):
                merged_data = {**target_props, **source_props}
            else:
                merged_data = {**source_props, **target_props}
        else:  # newest_wins
            source_updated = source_props.get("updatedAt", "")
            target_updated = target_props.get("updatedAt", "")
            if source_updated > target_updated:
                merged_data = {**target_props, **source_props}
            else:
                merged_data = {**source_props, **target_props}

        # Don't override critical fields
        merged_data["id"] = target_uio_id
        merged_data["organizationId"] = self.organization_id
        merged_data["updatedAt"] = datetime.utcnow().isoformat()

        try:
            # Update target with merged data
            # FalkorDB doesn't support SET += $props - use explicit properties
            set_clause, set_params = graph.build_set_clause("target", merged_data)
            await graph.query(
                f"""
                MATCH (target:UIO {{id: $targetId, organizationId: $orgId}})
                SET {set_clause}
                """,
                {"targetId": target_uio_id, "orgId": self.organization_id, **set_params},
            )

            # Transfer relationships from source to target
            await graph.query(
                """
                MATCH (source:UIO {id: $sourceId, organizationId: $orgId})-[r]->(related)
                MATCH (target:UIO {id: $targetId, organizationId: $orgId})
                WHERE NOT (target)-[:MERGED_INTO]->(related)
                CREATE (target)-[newRel:TRANSFERRED_FROM_MERGE]->(related)
                """,
                {
                    "sourceId": source_uio_id,
                    "targetId": target_uio_id,
                    "orgId": self.organization_id,
                },
            )

            # Archive source and create MERGED_INTO relationship
            from datetime import datetime
            now = datetime.utcnow().isoformat()
            await graph.query(
                """
                MATCH (source:UIO {id: $sourceId, organizationId: $orgId})
                MATCH (target:UIO {id: $targetId, organizationId: $orgId})
                SET source.status = 'archived',
                    source.archivedAt = $archivedAt,
                    source.mergedInto = $targetId
                CREATE (source)-[:MERGED_INTO]->(target)
                """,
                {
                    "sourceId": source_uio_id,
                    "targetId": target_uio_id,
                    "orgId": self.organization_id,
                    "archivedAt": now,
                },
            )

            logger.info(
                "UIOs merged successfully",
                source_uio_id=source_uio_id,
                target_uio_id=target_uio_id,
            )

            return True

        except Exception as e:
            logger.error(
                "Failed to merge UIOs",
                source_uio_id=source_uio_id,
                target_uio_id=target_uio_id,
                error=str(e),
            )
            return False

    # =========================================================================
    # Query UIOs
    # =========================================================================

    async def get_uio(self, uio_id: str) -> dict | None:
        """Get a single UIO by ID."""
        graph = await self._get_graph()

        result = await graph.query(
            """
            MATCH (u:UIO {id: $id, organizationId: $orgId})
            RETURN properties(u) as props, labels(u) as labels
            """,
            {"id": uio_id, "orgId": self.organization_id},
        )

        if result:
            props = result[0].get("props", {})
            labels = result[0].get("labels", [])
            props["type"] = self._get_uio_type_from_labels(labels)
            return props
        return None

    async def list_uios(
        self,
        uio_type: UIOType | None = None,
        status: UIOStatus | None = None,
        needs_review: bool | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """
        List UIOs with filtering.

        Args:
            uio_type: Filter by type
            status: Filter by status
            needs_review: Filter by review status
            limit: Maximum results
            offset: Pagination offset

        Returns:
            List of UIO dicts
        """
        graph = await self._get_graph()

        # Build label filter
        label = "UIO"
        if uio_type:
            label_map = {
                "commitment": "Commitment",
                "decision": "Decision",
                "task": "Task",
                "claim": "Claim",
                "risk": "Risk",
            }
            label = f"UIO:{label_map.get(uio_type, 'UIO')}"

        # Build WHERE conditions
        conditions = ["u.organizationId = $orgId"]
        params = {"orgId": self.organization_id, "limit": limit, "offset": offset}

        if status:
            conditions.append("u.status = $status")
            params["status"] = status.value

        if needs_review is not None:
            conditions.append("u.needsReview = $needsReview")
            params["needsReview"] = needs_review

        where_clause = " AND ".join(conditions)

        result = await graph.query(
            f"""
            MATCH (u:{label})
            WHERE {where_clause}
            RETURN properties(u) as props, labels(u) as labels
            ORDER BY u.createdAt DESC
            SKIP $offset
            LIMIT $limit
            """,
            params,
        )

        uios = []
        for r in result:
            props = r.get("props", {})
            labels = r.get("labels", [])
            props["type"] = self._get_uio_type_from_labels(labels)
            uios.append(props)

        return uios

    async def get_pending_review(self, limit: int = 50) -> list[dict]:
        """Get UIOs pending review."""
        return await self.list_uios(needs_review=True, limit=limit)

    async def get_uio_history(self, uio_id: str) -> list[dict]:
        """Get status change history for a UIO."""
        graph = await self._get_graph()

        # This would require a separate history table/nodes
        # For now, return the current state
        uio = await self.get_uio(uio_id)
        if uio:
            return [
                {
                    "status": uio.get("status"),
                    "changedAt": uio.get("statusChangedAt") or uio.get("createdAt"),
                    "changedBy": uio.get("reviewedBy"),
                }
            ]
        return []

    async def get_related_uios(self, uio_id: str, depth: int = 1) -> list[dict]:
        """Get UIOs related to this one in the graph."""
        graph = await self._get_graph()

        result = await graph.query(
            f"""
            MATCH (u:UIO {{id: $id, organizationId: $orgId}})
            MATCH (u)-[*1..{depth}]-(related:UIO)
            WHERE related.organizationId = $orgId
            RETURN DISTINCT properties(related) as props, labels(related) as labels
            LIMIT 20
            """,
            {"id": uio_id, "orgId": self.organization_id},
        )

        uios = []
        for r in result:
            props = r.get("props", {})
            labels = r.get("labels", [])
            props["type"] = self._get_uio_type_from_labels(labels)
            uios.append(props)

        return uios

    # =========================================================================
    # Helpers
    # =========================================================================

    def _sanitize_properties(self, data: dict) -> dict:
        """Sanitize properties for FalkorDB storage."""
        sanitized = {}
        for key, value in data.items():
            if value is None:
                continue
            if isinstance(value, datetime):
                sanitized[key] = value.isoformat()
            elif isinstance(value, (list, dict)):
                import json
                sanitized[key] = json.dumps(value)
            else:
                sanitized[key] = value
        return sanitized

    def _get_uio_type_from_labels(self, labels: list[str]) -> str:
        """Extract UIO type from node labels."""
        type_labels = {"Commitment", "Decision", "Task", "Claim", "Risk"}
        for label in labels:
            if label in type_labels:
                return label.lower()
        return "uio"


# =============================================================================
# Singleton
# =============================================================================

_uio_managers: dict[str, UIOManager] = {}


async def get_uio_manager(organization_id: str) -> UIOManager:
    """Get a UIOManager for an organization."""
    global _uio_managers

    if organization_id not in _uio_managers:
        _uio_managers[organization_id] = UIOManager(organization_id)

    return _uio_managers[organization_id]
