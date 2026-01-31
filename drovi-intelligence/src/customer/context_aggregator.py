"""
Customer Context Aggregator

Aggregates all intelligence about a customer using FalkorDB graph traversal.
From the "Trillion Dollar Hole" research:
- "Someone needs to build a company around Customer Context Graph"
- Collect all threads about customers: emails, meetings, Slack, contracts, deliverables

The power of FalkorDB is that customer context is already implicitly stored
through relationships. This service provides aggregation queries.
"""

from datetime import datetime, timezone
from typing import Any

import structlog
from pydantic import BaseModel, Field

logger = structlog.get_logger()


class TimelineEvent(BaseModel):
    """A single event in a contact's timeline."""

    id: str
    event_type: str  # "episode", "commitment", "decision", "message"
    title: str
    summary: str | None = None
    source_type: str | None = None
    reference_time: datetime
    participants: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class CommitmentSummary(BaseModel):
    """Summary of a commitment involving a contact."""

    id: str
    title: str
    status: str
    priority: str | None = None
    direction: str  # "owed_by_me" or "owed_to_me"
    due_date: datetime | None = None
    confidence: float = 0.0


class DecisionSummary(BaseModel):
    """Summary of a decision involving a contact."""

    id: str
    title: str
    statement: str | None = None
    status: str
    decided_at: datetime | None = None


class ContactSummary(BaseModel):
    """Summary of a related contact."""

    id: str
    email: str | None = None
    name: str | None = None
    company: str | None = None
    title: str | None = None
    interaction_count: int = 0
    last_interaction: datetime | None = None


class CustomerContext(BaseModel):
    """Complete context about a customer/contact."""

    # Contact info
    contact_id: str
    email: str | None = None
    name: str | None = None
    company: str | None = None
    title: str | None = None

    # Metrics
    interaction_count: int = 0
    last_interaction: datetime | None = None
    relationship_health: float = 1.0  # 0-1

    # Source presence
    source_types: list[str] = Field(default_factory=list)

    # Related intelligence
    open_commitments: list[CommitmentSummary] = Field(default_factory=list)
    related_decisions: list[DecisionSummary] = Field(default_factory=list)

    # Network
    top_contacts: list[ContactSummary] = Field(default_factory=list)
    top_topics: list[str] = Field(default_factory=list)

    # Timeline (chronological events)
    timeline: list[TimelineEvent] = Field(default_factory=list)

    # AI-generated summary
    relationship_summary: str | None = None


# Core Cypher query for customer context
CUSTOMER_CONTEXT_QUERY = """
MATCH (c:Contact {id: $contact_id, organizationId: $org_id})

// Get all episodes involving this contact
OPTIONAL MATCH (c)-[:MENTIONED_IN|PARTICIPATED_IN]->(ep:Episode)
WHERE ep.organizationId = $org_id

// Get commitments
OPTIONAL MATCH (c)-[:INVOLVED_IN]->(commit:Commitment)
WHERE commit.organizationId = $org_id
AND commit.status IN ['pending', 'in_progress', 'waiting']
AND commit.validTo IS NULL

// Get decisions
OPTIONAL MATCH (c)-[:INVOLVED_IN|STAKEHOLDER_OF]->(decision:Decision)
WHERE decision.organizationId = $org_id
AND decision.validTo IS NULL

// Get related contacts (colleagues, collaborators)
OPTIONAL MATCH (c)-[:COMMUNICATES_WITH]->(related:Contact)
WHERE related.organizationId = $org_id

// Get topics they discuss
OPTIONAL MATCH (c)-[:INTERESTED_IN|DISCUSSES]->(topic:Topic)
WHERE topic.organizationId = $org_id

// Get source presence
WITH c, ep, commit, decision, related, topic,
     collect(DISTINCT ep.sourceType) as sources

RETURN c,
       count(DISTINCT ep) as interaction_count,
       max(ep.referenceTime) as last_interaction,
       collect(DISTINCT commit)[0..10] as open_commitments,
       collect(DISTINCT decision)[0..10] as related_decisions,
       collect(DISTINCT related)[0..10] as top_contacts,
       collect(DISTINCT topic.name)[0..5] as top_topics,
       sources
"""


class CustomerContextAggregator:
    """
    Aggregates all intelligence about a customer using FalkorDB graph traversal.
    """

    def __init__(self, graph_client=None):
        """
        Initialize the aggregator.

        Args:
            graph_client: FalkorDB graph client
        """
        self._graph = graph_client

    async def _ensure_graph(self):
        """Lazy-load graph client."""
        if self._graph is None:
            from ..graph.client import get_graph_client

            self._graph = await get_graph_client()

    async def get_customer_context(
        self,
        contact_id: str,
        organization_id: str,
        include_history: bool = True,
        max_timeline_items: int = 50,
    ) -> CustomerContext:
        """
        Get complete customer context via single graph traversal.

        Args:
            contact_id: Contact to get context for
            organization_id: Organization context
            include_history: Whether to include timeline
            max_timeline_items: Max timeline events to return

        Returns:
            CustomerContext with all aggregated intelligence
        """
        await self._ensure_graph()

        logger.info(
            "Getting customer context",
            contact_id=contact_id,
            organization_id=organization_id,
        )

        try:
            result = await self._graph.query(
                CUSTOMER_CONTEXT_QUERY,
                {
                    "contact_id": contact_id,
                    "org_id": organization_id,
                },
            )

            if not result or len(result) == 0:
                # Contact not found
                return CustomerContext(contact_id=contact_id)

            row = result[0]
            contact = row.get("c", {})

            # Parse commitments
            open_commitments = [
                CommitmentSummary(
                    id=c.get("id", ""),
                    title=c.get("title", ""),
                    status=c.get("status", "unknown"),
                    priority=c.get("priority"),
                    direction=c.get("direction", "owed_by_me"),
                    due_date=c.get("dueDate"),
                    confidence=c.get("confidence", 0.0),
                )
                for c in (row.get("open_commitments") or [])
                if c
            ]

            # Parse decisions
            related_decisions = [
                DecisionSummary(
                    id=d.get("id", ""),
                    title=d.get("title", ""),
                    statement=d.get("statement"),
                    status=d.get("status", "made"),
                    decided_at=d.get("decidedAt"),
                )
                for d in (row.get("related_decisions") or [])
                if d
            ]

            # Parse related contacts
            top_contacts = [
                ContactSummary(
                    id=r.get("id", ""),
                    email=r.get("email"),
                    name=r.get("name"),
                    company=r.get("company"),
                    title=r.get("title"),
                    interaction_count=r.get("interactionCount", 0),
                    last_interaction=r.get("lastInteraction"),
                )
                for r in (row.get("top_contacts") or [])
                if r
            ]

            context = CustomerContext(
                contact_id=contact_id,
                email=contact.get("email"),
                name=contact.get("name"),
                company=contact.get("company"),
                title=contact.get("title"),
                interaction_count=row.get("interaction_count", 0),
                last_interaction=row.get("last_interaction"),
                source_types=row.get("sources", []),
                open_commitments=open_commitments,
                related_decisions=related_decisions,
                top_contacts=top_contacts,
                top_topics=row.get("top_topics", []),
                relationship_summary=contact.get("relationshipSummary"),
            )

            # Get timeline if requested
            if include_history:
                context.timeline = await self.get_contact_timeline(
                    contact_id=contact_id,
                    organization_id=organization_id,
                    limit=max_timeline_items,
                )

            # Compute relationship health
            context.relationship_health = await self.compute_relationship_health(
                contact_id=contact_id,
                organization_id=organization_id,
            )

            logger.info(
                "Customer context retrieved",
                contact_id=contact_id,
                interactions=context.interaction_count,
                commitments=len(context.open_commitments),
                decisions=len(context.related_decisions),
            )

            return context

        except Exception as e:
            logger.error(
                "Failed to get customer context",
                error=str(e),
                contact_id=contact_id,
            )
            return CustomerContext(contact_id=contact_id)

    async def get_contact_timeline(
        self,
        contact_id: str,
        organization_id: str,
        limit: int = 50,
    ) -> list[TimelineEvent]:
        """
        Get chronological timeline of all interactions with contact.

        Args:
            contact_id: Contact to get timeline for
            organization_id: Organization context
            limit: Max events to return

        Returns:
            List of TimelineEvent in reverse chronological order
        """
        await self._ensure_graph()

        try:
            result = await self._graph.query(
                """
                MATCH (c:Contact {id: $contact_id, organizationId: $org_id})
                      -[:MENTIONED_IN|PARTICIPATED_IN]->(ep:Episode)
                WHERE ep.organizationId = $org_id
                RETURN ep.id as id,
                       'episode' as event_type,
                       ep.name as title,
                       ep.summary as summary,
                       ep.sourceType as source_type,
                       ep.referenceTime as reference_time,
                       ep.participants as participants
                ORDER BY ep.referenceTime DESC
                LIMIT $limit
                """,
                {
                    "contact_id": contact_id,
                    "org_id": organization_id,
                    "limit": limit,
                },
            )

            return [
                TimelineEvent(
                    id=row["id"],
                    event_type=row["event_type"],
                    title=row["title"] or "Untitled",
                    summary=row.get("summary"),
                    source_type=row.get("source_type"),
                    reference_time=row["reference_time"],
                    participants=row.get("participants", []),
                )
                for row in (result or [])
            ]

        except Exception as e:
            logger.warning(
                "Failed to get contact timeline",
                error=str(e),
                contact_id=contact_id,
            )
            return []

    async def compute_relationship_health(
        self,
        contact_id: str,
        organization_id: str,
    ) -> float:
        """
        Compute relationship health score based on graph patterns.

        Health factors:
        - Commitment fulfillment rate
        - Interaction trend (increasing vs decreasing)
        - Response patterns
        - Total interaction volume

        Args:
            contact_id: Contact to analyze
            organization_id: Organization context

        Returns:
            Health score (0-1)
        """
        from datetime import timedelta

        await self._ensure_graph()

        # Calculate cutoff dates in Python for FalkorDB compatibility
        now = datetime.now(timezone.utc)
        cutoff_30d = (now - timedelta(days=30)).isoformat()
        cutoff_60d = (now - timedelta(days=60)).isoformat()

        try:
            result = await self._graph.query(
                """
                MATCH (c:Contact {id: $contact_id, organizationId: $org_id})

                // Get commitment fulfillment
                OPTIONAL MATCH (c)-[:INVOLVED_IN]->(commit:Commitment)
                WHERE commit.organizationId = $org_id
                WITH c,
                     sum(CASE WHEN commit.status = 'completed' THEN 1 ELSE 0 END) as fulfilled,
                     count(commit) as total_commits

                // Get interaction trend
                OPTIONAL MATCH (c)-[:MENTIONED_IN]->(ep:Episode)
                WHERE ep.organizationId = $org_id
                WITH c, fulfilled, total_commits,
                     collect(ep) as episodes

                WITH c, fulfilled, total_commits, episodes,
                     size([ep IN episodes WHERE ep.referenceTime > $cutoff_30d]) as recent,
                     size([ep IN episodes WHERE ep.referenceTime > $cutoff_60d
                           AND ep.referenceTime <= $cutoff_30d]) as previous

                RETURN {
                    fulfillment_rate: CASE WHEN total_commits > 0
                                      THEN toFloat(fulfilled)/total_commits
                                      ELSE 1.0 END,
                    interaction_trend: CASE WHEN previous > 0
                                       THEN toFloat(recent)/previous
                                       ELSE 1.0 END,
                    total_interactions: size(episodes)
                } as metrics
                """,
                {
                    "contact_id": contact_id,
                    "org_id": organization_id,
                    "cutoff_30d": cutoff_30d,
                    "cutoff_60d": cutoff_60d,
                },
            )

            if not result or not result[0].get("metrics"):
                return 1.0  # Default healthy

            metrics = result[0]["metrics"]

            # Weighted health score
            fulfillment = metrics.get("fulfillment_rate", 1.0)
            trend = min(metrics.get("interaction_trend", 1.0), 1.5) / 1.5
            volume = min(metrics.get("total_interactions", 0) / 50, 1.0)

            health = (
                fulfillment * 0.4 +
                trend * 0.3 +
                volume * 0.3
            )

            return round(health, 2)

        except Exception as e:
            logger.warning(
                "Failed to compute relationship health",
                error=str(e),
                contact_id=contact_id,
            )
            return 1.0

    async def generate_relationship_summary(
        self,
        contact_id: str,
        organization_id: str,
    ) -> str:
        """
        Generate LLM narrative summary of relationship.

        Args:
            contact_id: Contact to summarize
            organization_id: Organization context

        Returns:
            Human-readable relationship summary
        """
        await self._ensure_graph()

        context = await self.get_customer_context(
            contact_id=contact_id,
            organization_id=organization_id,
            include_history=False,
        )

        if not context.name:
            return "No relationship data available."

        # Build summary from available data
        parts = []

        # Basic info
        if context.name:
            if context.company:
                parts.append(f"{context.name} at {context.company}")
            else:
                parts.append(context.name)

        # Interaction stats
        if context.interaction_count > 0:
            parts.append(f"{context.interaction_count} interactions recorded")
            if context.last_interaction:
                days_ago = (datetime.now(timezone.utc) - context.last_interaction).days
                if days_ago == 0:
                    parts.append("last contact today")
                elif days_ago == 1:
                    parts.append("last contact yesterday")
                else:
                    parts.append(f"last contact {days_ago} days ago")

        # Commitments
        if context.open_commitments:
            owed_by_me = len([c for c in context.open_commitments if c.direction == "owed_by_me"])
            owed_to_me = len([c for c in context.open_commitments if c.direction == "owed_to_me"])
            if owed_by_me > 0:
                parts.append(f"{owed_by_me} open commitment{'s' if owed_by_me > 1 else ''} to them")
            if owed_to_me > 0:
                parts.append(f"{owed_to_me} pending from them")

        # Topics
        if context.top_topics:
            parts.append(f"discusses: {', '.join(context.top_topics[:3])}")

        # Health indicator
        if context.relationship_health < 0.5:
            parts.append("⚠️ relationship may need attention")
        elif context.relationship_health > 0.8:
            parts.append("✓ healthy relationship")

        summary = ". ".join(parts) + "."

        # Cache in graph
        try:
            now = datetime.now(timezone.utc).isoformat()
            await self._graph.query(
                """
                MATCH (c:Contact {id: $contact_id, organizationId: $org_id})
                SET c.relationshipSummary = $summary,
                    c.relationshipSummaryUpdatedAt = $now
                """,
                {
                    "contact_id": contact_id,
                    "org_id": organization_id,
                    "summary": summary,
                    "now": now,
                },
            )
        except Exception:
            pass  # Cache write failure is non-critical

        return summary

    async def search_customers(
        self,
        query: str,
        organization_id: str,
        limit: int = 20,
    ) -> list[ContactSummary]:
        """
        Search for customers by name, email, or company.

        Args:
            query: Search query
            organization_id: Organization context
            limit: Max results

        Returns:
            List of matching ContactSummary
        """
        await self._ensure_graph()

        try:
            # Use full-text search if available, fall back to CONTAINS
            result = await self._graph.query(
                """
                MATCH (c:Contact {organizationId: $org_id})
                WHERE toLower(c.name) CONTAINS toLower($query)
                   OR toLower(c.email) CONTAINS toLower($query)
                   OR toLower(c.company) CONTAINS toLower($query)
                RETURN c.id as id,
                       c.email as email,
                       c.name as name,
                       c.company as company,
                       c.title as title,
                       c.interactionCount as interaction_count,
                       c.lastInteraction as last_interaction
                ORDER BY c.importanceScore DESC, c.interactionCount DESC
                LIMIT $limit
                """,
                {
                    "query": query,
                    "org_id": organization_id,
                    "limit": limit,
                },
            )

            return [
                ContactSummary(
                    id=row["id"],
                    email=row.get("email"),
                    name=row.get("name"),
                    company=row.get("company"),
                    title=row.get("title"),
                    interaction_count=row.get("interaction_count", 0),
                    last_interaction=row.get("last_interaction"),
                )
                for row in (result or [])
            ]

        except Exception as e:
            logger.warning("Customer search failed", error=str(e))
            return []


# Singleton instance
_aggregator: CustomerContextAggregator | None = None


async def get_customer_context_aggregator() -> CustomerContextAggregator:
    """Get or create the customer context aggregator."""
    global _aggregator
    if _aggregator is None:
        _aggregator = CustomerContextAggregator()
    return _aggregator
