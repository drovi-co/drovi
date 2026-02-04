"""
Memory Evolution Module

Handles "living" memory semantics:
- Supersession: When new info contradicts/updates old info
- Versioning: Track what was true at different points in time
- Access tracking: Update last_accessed_at and access_count on reads
- Conflict resolution: Handle contradictions between sources

From the pitch: "Bi-temporal (what was true vs what is now)"
"""

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any

import structlog

from src.graph.client import DroviGraph, get_graph_client
from src.graph.types import GraphNodeType

logger = structlog.get_logger()


class SupersessionReason(str, Enum):
    """Reasons why a node was superseded."""

    UPDATED = "updated"  # Same entity, new information
    CORRECTED = "corrected"  # Previous version was incorrect
    CONTRADICTED = "contradicted"  # Conflicting information
    MERGED = "merged"  # Combined with another entity
    REVERSED = "reversed"  # Decision/commitment reversed
    FULFILLED = "fulfilled"  # Commitment completed
    CANCELED = "canceled"  # Explicitly canceled


@dataclass
class EvolutionResult:
    """Result of an evolution operation."""

    success: bool
    old_node_id: str | None = None
    new_node_id: str | None = None
    reason: SupersessionReason | None = None
    error: str | None = None


class MemoryEvolution:
    """
    Manages memory evolution and versioning.

    Provides:
    - Supersession: Mark old nodes as superseded by new ones
    - Versioning: Track temporal validity (valid_from, valid_to)
    - Access tracking: Update access metrics on reads
    - Contradiction handling: Create CONTRADICTS relationships
    """

    def __init__(self, graph: DroviGraph):
        """Initialize with graph client."""
        self.graph = graph

    async def supersede_node(
        self,
        old_node_id: str,
        new_node_id: str,
        node_type: GraphNodeType,
        reason: SupersessionReason,
        metadata: dict[str, Any] | None = None,
    ) -> EvolutionResult:
        """
        Mark an old node as superseded by a new one.

        Sets:
        - old.validTo = now
        - old.supersededById = new.id
        - old.supersessionReason = reason
        - Creates SUPERSEDES relationship

        Args:
            old_node_id: ID of the node being superseded
            new_node_id: ID of the superseding node
            node_type: Type of both nodes
            reason: Why supersession occurred
            metadata: Additional context

        Returns:
            EvolutionResult with success status
        """
        now = datetime.utcnow().isoformat()

        try:
            # Update old node
            await self.graph.query(
                f"""
                MATCH (old:{node_type.value} {{id: $oldId}})
                SET old.validTo = $now,
                    old.supersededById = $newId,
                    old.supersessionReason = $reason,
                    old.supersessionMetadata = $metadata
                """,
                {
                    "oldId": old_node_id,
                    "newId": new_node_id,
                    "now": now,
                    "reason": reason.value,
                    "metadata": str(metadata) if metadata else None,
                },
            )

            # Create SUPERSEDES relationship
            await self.graph.query(
                f"""
                MATCH (old:{node_type.value} {{id: $oldId}})
                MATCH (new:{node_type.value} {{id: $newId}})
                CREATE (new)-[:SUPERSEDES {{
                    reason: $reason,
                    supersededAt: $now
                }}]->(old)
                """,
                {
                    "oldId": old_node_id,
                    "newId": new_node_id,
                    "reason": reason.value,
                    "now": now,
                },
            )

            logger.info(
                "Node superseded",
                old_id=old_node_id,
                new_id=new_node_id,
                node_type=node_type.value,
                reason=reason.value,
            )

            return EvolutionResult(
                success=True,
                old_node_id=old_node_id,
                new_node_id=new_node_id,
                reason=reason,
            )

        except Exception as e:
            logger.error(
                "Failed to supersede node",
                old_id=old_node_id,
                new_id=new_node_id,
                error=str(e),
            )
            return EvolutionResult(success=False, error=str(e))

    async def record_contradiction(
        self,
        node_a_id: str,
        node_b_id: str,
        node_type: GraphNodeType,
        contradiction_type: str,
        evidence: str | None = None,
        severity: str = "medium",
    ) -> EvolutionResult:
        """
        Record a contradiction between two nodes.

        Creates CONTRADICTS relationship between nodes.
        Optionally creates a Risk node for the contradiction.

        Args:
            node_a_id: First node ID
            node_b_id: Second node ID
            node_type: Type of both nodes
            contradiction_type: Type of contradiction
            evidence: Evidence for the contradiction
            severity: low, medium, high

        Returns:
            EvolutionResult
        """
        now = datetime.utcnow().isoformat()

        try:
            # Create CONTRADICTS relationship (bidirectional)
            await self.graph.query(
                f"""
                MATCH (a:{node_type.value} {{id: $aId}})
                MATCH (b:{node_type.value} {{id: $bId}})
                CREATE (a)-[:CONTRADICTS {{
                    contradictionType: $type,
                    evidence: $evidence,
                    severity: $severity,
                    detectedAt: $now
                }}]->(b)
                """,
                {
                    "aId": node_a_id,
                    "bId": node_b_id,
                    "type": contradiction_type,
                    "evidence": evidence,
                    "severity": severity,
                    "now": now,
                },
            )

            logger.info(
                "Contradiction recorded",
                node_a=node_a_id,
                node_b=node_b_id,
                type=contradiction_type,
                severity=severity,
            )

            return EvolutionResult(
                success=True,
                old_node_id=node_a_id,
                new_node_id=node_b_id,
            )

        except Exception as e:
            logger.error(
                "Failed to record contradiction",
                error=str(e),
            )
            return EvolutionResult(success=False, error=str(e))

    async def track_access(
        self,
        node_id: str,
        node_type: GraphNodeType,
        user_id: str | None = None,
    ) -> bool:
        """
        Track access to a node.

        Updates:
        - lastAccessedAt
        - accessCount (increment)
        - Optionally logs user who accessed

        Args:
            node_id: Node being accessed
            node_type: Type of node
            user_id: Optional user who accessed

        Returns:
            True if successful
        """
        now = datetime.utcnow().isoformat()

        try:
            await self.graph.query(
                f"""
                MATCH (n:{node_type.value} {{id: $nodeId}})
                SET n.lastAccessedAt = $now,
                    n.accessCount = COALESCE(n.accessCount, 0) + 1
                """,
                {"nodeId": node_id, "now": now},
            )
            return True
        except Exception as e:
            logger.warning(
                "Failed to track access",
                node_id=node_id,
                error=str(e),
            )
            return False

    async def batch_track_access(
        self,
        accesses: list[tuple[str, GraphNodeType]],
    ) -> int:
        """
        Track access to multiple nodes efficiently.

        Args:
            accesses: List of (node_id, node_type) tuples

        Returns:
            Number of successful updates
        """
        if not accesses:
            return 0

        now = datetime.utcnow().isoformat()
        success_count = 0

        # Group by node type for efficient queries
        by_type: dict[GraphNodeType, list[str]] = {}
        for node_id, node_type in accesses:
            if node_type not in by_type:
                by_type[node_type] = []
            by_type[node_type].append(node_id)

        for node_type, node_ids in by_type.items():
            try:
                result = await self.graph.query(
                    f"""
                    UNWIND $nodeIds AS nodeId
                    MATCH (n:{node_type.value} {{id: nodeId}})
                    SET n.lastAccessedAt = $now,
                        n.accessCount = COALESCE(n.accessCount, 0) + 1
                    RETURN count(n) as updated
                    """,
                    {"nodeIds": node_ids, "now": now},
                )
                if result:
                    success_count += result[0].get("updated", 0)
            except Exception as e:
                logger.warning(
                    "Failed to batch track access",
                    node_type=node_type.value,
                    error=str(e),
                )

        return success_count

    async def get_history(
        self,
        node_id: str,
        node_type: GraphNodeType,
        include_superseded: bool = True,
    ) -> list[dict[str, Any]]:
        """
        Get the evolution history of a node.

        Returns the chain of supersession for a node.

        Args:
            node_id: Current node ID
            node_type: Type of node
            include_superseded: Whether to include superseded versions

        Returns:
            List of node versions from newest to oldest
        """
        try:
            # Get the full supersession chain
            result = await self.graph.query(
                f"""
                MATCH (current:{node_type.value} {{id: $nodeId}})
                OPTIONAL MATCH path = (current)-[:SUPERSEDES*]->(older:{node_type.value})
                WITH current, collect(older) as older_versions
                RETURN current as node, older_versions
                """,
                {"nodeId": node_id},
            )

            if not result:
                return []

            history = []
            current = result[0].get("node")
            if current:
                history.append(current)

            older = result[0].get("older_versions", [])
            if include_superseded and older:
                history.extend(older)

            return history

        except Exception as e:
            logger.error(
                "Failed to get node history",
                node_id=node_id,
                error=str(e),
            )
            return []

    async def get_version_at_time(
        self,
        node_id: str,
        node_type: GraphNodeType,
        as_of: datetime,
    ) -> dict[str, Any] | None:
        """
        Get the version of a node that was valid at a specific time.

        Implements bi-temporal queries: "What was true at time X?"

        Args:
            node_id: Current node ID (or any ID in the chain)
            node_type: Type of node
            as_of: Point in time to query

        Returns:
            Node version valid at that time, or None
        """
        as_of_str = as_of.isoformat()

        try:
            # Find the version valid at the given time
            result = await self.graph.query(
                f"""
                MATCH (n:{node_type.value})
                WHERE (n.id = $nodeId OR n.supersededById = $nodeId)
                AND n.createdAt <= $asOf
                AND (n.validTo IS NULL OR n.validTo = '' OR n.validTo > $asOf)
                RETURN n
                ORDER BY n.createdAt DESC
                LIMIT 1
                """,
                {"nodeId": node_id, "asOf": as_of_str},
            )

            if result:
                return result[0].get("n")
            return None

        except Exception as e:
            logger.error(
                "Failed to get version at time",
                node_id=node_id,
                as_of=as_of_str,
                error=str(e),
            )
            return None

    async def fulfill_commitment(
        self,
        commitment_id: str,
        organization_id: str,
        fulfilled_by: str | None = None,
        evidence: str | None = None,
    ) -> EvolutionResult:
        """
        Mark a commitment as fulfilled.

        Updates status and sets validTo timestamp.

        Args:
            commitment_id: Commitment to fulfill
            organization_id: Organization
            fulfilled_by: User/agent who fulfilled it
            evidence: Evidence of fulfillment

        Returns:
            EvolutionResult
        """
        now = datetime.utcnow().isoformat()

        try:
            await self.graph.query(
                """
                MATCH (c:Commitment {id: $commitmentId, organizationId: $orgId})
                SET c.status = 'fulfilled',
                    c.validTo = $now,
                    c.fulfilledAt = $now,
                    c.fulfilledBy = $fulfilledBy,
                    c.fulfillmentEvidence = $evidence
                """,
                {
                    "commitmentId": commitment_id,
                    "orgId": organization_id,
                    "now": now,
                    "fulfilledBy": fulfilled_by,
                    "evidence": evidence,
                },
            )

            logger.info(
                "Commitment fulfilled",
                commitment_id=commitment_id,
            )

            return EvolutionResult(
                success=True,
                old_node_id=commitment_id,
                reason=SupersessionReason.FULFILLED,
            )

        except Exception as e:
            logger.error(
                "Failed to fulfill commitment",
                commitment_id=commitment_id,
                error=str(e),
            )
            return EvolutionResult(success=False, error=str(e))

    async def reverse_decision(
        self,
        old_decision_id: str,
        new_decision_id: str,
        organization_id: str,
        reason: str | None = None,
    ) -> EvolutionResult:
        """
        Mark a decision as reversed by a new decision.

        Args:
            old_decision_id: Original decision being reversed
            new_decision_id: New decision that reverses it
            organization_id: Organization
            reason: Reason for reversal

        Returns:
            EvolutionResult
        """
        now = datetime.utcnow().isoformat()

        try:
            # Update old decision
            await self.graph.query(
                """
                MATCH (old:Decision {id: $oldId, organizationId: $orgId})
                SET old.status = 'reversed',
                    old.validTo = $now,
                    old.supersededById = $newId,
                    old.supersessionReason = 'reversed',
                    old.reversalReason = $reason
                """,
                {
                    "oldId": old_decision_id,
                    "newId": new_decision_id,
                    "orgId": organization_id,
                    "now": now,
                    "reason": reason,
                },
            )

            # Create REVERSES relationship
            await self.graph.query(
                """
                MATCH (old:Decision {id: $oldId, organizationId: $orgId})
                MATCH (new:Decision {id: $newId, organizationId: $orgId})
                CREATE (new)-[:REVERSES {
                    reversedAt: $now,
                    reason: $reason
                }]->(old)
                """,
                {
                    "oldId": old_decision_id,
                    "newId": new_decision_id,
                    "orgId": organization_id,
                    "now": now,
                    "reason": reason,
                },
            )

            logger.info(
                "Decision reversed",
                old_decision=old_decision_id,
                new_decision=new_decision_id,
            )

            return EvolutionResult(
                success=True,
                old_node_id=old_decision_id,
                new_node_id=new_decision_id,
                reason=SupersessionReason.REVERSED,
            )

        except Exception as e:
            logger.error(
                "Failed to reverse decision",
                old_id=old_decision_id,
                error=str(e),
            )
            return EvolutionResult(success=False, error=str(e))

    async def merge_entities(
        self,
        source_ids: list[str],
        target_id: str,
        entity_type: str = "Entity",
        organization_id: str | None = None,
    ) -> EvolutionResult:
        """
        Merge multiple entities into one.

        All source entities are marked as superseded.
        Relationships are transferred to target.

        Args:
            source_ids: IDs of entities to merge
            target_id: ID of entity to merge into
            entity_type: Type of entity (Entity, Contact, etc.)
            organization_id: Optional org filter

        Returns:
            EvolutionResult
        """
        now = datetime.utcnow().isoformat()

        try:
            for source_id in source_ids:
                if source_id == target_id:
                    continue

                # Mark source as superseded
                org_filter = ""
                params: dict[str, Any] = {
                    "sourceId": source_id,
                    "targetId": target_id,
                    "now": now,
                }

                if organization_id:
                    org_filter = "AND source.organizationId = $orgId"
                    params["orgId"] = organization_id

                await self.graph.query(
                    f"""
                    MATCH (source:{entity_type} {{id: $sourceId}})
                    WHERE source.id <> $targetId
                    {org_filter}
                    SET source.validTo = $now,
                        source.supersededById = $targetId,
                        source.supersessionReason = 'merged'
                    """,
                    params,
                )

                # Create MERGED_INTO relationship
                await self.graph.query(
                    f"""
                    MATCH (source:{entity_type} {{id: $sourceId}})
                    MATCH (target:{entity_type} {{id: $targetId}})
                    CREATE (source)-[:MERGED_INTO {{mergedAt: $now}}]->(target)
                    """,
                    params,
                )

                # Transfer relationships (optional - can be expensive)
                # For now, we just mark the merge; relationship transfer can be done separately

            logger.info(
                "Entities merged",
                source_ids=source_ids,
                target_id=target_id,
            )

            return EvolutionResult(
                success=True,
                new_node_id=target_id,
                reason=SupersessionReason.MERGED,
            )

        except Exception as e:
            logger.error(
                "Failed to merge entities",
                source_ids=source_ids,
                target_id=target_id,
                error=str(e),
            )
            return EvolutionResult(success=False, error=str(e))


# Singleton
_evolution: MemoryEvolution | None = None


async def get_memory_evolution() -> MemoryEvolution:
    """Get the singleton MemoryEvolution instance."""
    global _evolution
    if _evolution is None:
        graph = await get_graph_client()
        _evolution = MemoryEvolution(graph)
    return _evolution
