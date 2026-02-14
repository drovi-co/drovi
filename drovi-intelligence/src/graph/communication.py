"""
Communication Graph Tracking

Tracks communication patterns between contacts for relationship intelligence:
- Who communicates with whom
- Communication frequency and recency
- Channel preferences
- Sentiment tracking over time
- Response time patterns

This is part of Phase 2 (Wider Graph) of the FalkorDB enhancement plan.
"""

import json
from datetime import datetime
from uuid import uuid4

import structlog

from .client import get_graph_client
from .types import CommunicationEventNode, SourceType
from src.kernel.time import utc_now_naive

logger = structlog.get_logger()


class CommunicationTracker:
    """
    Tracks and analyzes communication patterns in FalkorDB.

    Manages:
    - CommunicationEvent nodes for individual events
    - COMMUNICATED_WITH relationships between Contacts with aggregated stats
    - Communication metrics and analytics
    """

    def __init__(self, organization_id: str):
        self.organization_id = organization_id
        self._graph = None

    async def _get_graph(self):
        """Lazy load graph client."""
        if self._graph is None:
            self._graph = await get_graph_client()
        return self._graph

    async def record_communication(
        self,
        from_contact_id: str,
        to_contact_ids: list[str],
        event_type: str,
        source_type: str,
        occurred_at: datetime | None = None,
        channel: str | None = None,
        source_id: str | None = None,
        sentiment_score: float | None = None,
        message_length: int | None = None,
        is_response: bool = False,
        response_to_event_id: str | None = None,
        response_time_seconds: int | None = None,
    ) -> str:
        """
        Record a communication event and update relationship stats.

        Args:
            from_contact_id: ID of the sender
            to_contact_ids: List of recipient contact IDs
            event_type: Type of communication (email_sent, slack_message, etc.)
            source_type: Source type (email, slack, etc.)
            occurred_at: When the communication occurred
            channel: Channel ID or name
            source_id: Link to RawMessage or other source
            sentiment_score: Sentiment of the communication (-1 to 1)
            message_length: Length of the message
            is_response: Whether this is a response to another message
            response_to_event_id: ID of the event being responded to
            response_time_seconds: Time to respond

        Returns:
            ID of the created CommunicationEvent
        """
        graph = await self._get_graph()
        event_id = str(uuid4())
        now = utc_now_naive()
        occurred_at = occurred_at or now

        # Create CommunicationEvent node
        await graph.query(
            """
            CREATE (e:CommunicationEvent {
                id: $id,
                organizationId: $orgId,
                eventType: $eventType,
                fromContactId: $fromContactId,
                toContactIds: $toContactIds,
                sourceType: $sourceType,
                sourceId: $sourceId,
                occurredAt: $occurredAt,
                channel: $channel,
                isResponse: $isResponse,
                responseToEventId: $responseToEventId,
                responseTimeSeconds: $responseTimeSeconds,
                sentimentScore: $sentimentScore,
                messageLength: $messageLength,
                createdAt: $createdAt
            })
            RETURN e
            """,
            {
                "id": event_id,
                "orgId": self.organization_id,
                "eventType": event_type,
                "fromContactId": from_contact_id,
                "toContactIds": json.dumps(to_contact_ids),
                "sourceType": source_type,
                "sourceId": source_id or "",
                "occurredAt": occurred_at.isoformat(),
                "channel": channel or "",
                "isResponse": is_response,
                "responseToEventId": response_to_event_id or "",
                "responseTimeSeconds": response_time_seconds,
                "sentimentScore": sentiment_score,
                "messageLength": message_length,
                "createdAt": now.isoformat(),
            },
        )

        # Link event to sender contact
        await graph.query(
            """
            MATCH (e:CommunicationEvent {id: $eventId})
            MATCH (c:Contact {id: $contactId})
            MERGE (e)-[:COMMUNICATED]->(c)
            """,
            {"eventId": event_id, "contactId": from_contact_id},
        )

        # Update COMMUNICATED_WITH relationships for each recipient
        for to_contact_id in to_contact_ids:
            await self._update_communication_relationship(
                from_contact_id=from_contact_id,
                to_contact_id=to_contact_id,
                channel=channel or source_type,
                sentiment_score=sentiment_score,
                occurred_at=occurred_at,
            )

            # Also link event to recipient contact
            await graph.query(
                """
                MATCH (e:CommunicationEvent {id: $eventId})
                MATCH (c:Contact {id: $contactId})
                MERGE (e)-[:COMMUNICATED]->(c)
                """,
                {"eventId": event_id, "contactId": to_contact_id},
            )

        logger.debug(
            "Recorded communication event",
            event_id=event_id,
            from_contact=from_contact_id,
            to_contacts=len(to_contact_ids),
            event_type=event_type,
        )

        return event_id

    async def _update_communication_relationship(
        self,
        from_contact_id: str,
        to_contact_id: str,
        channel: str,
        sentiment_score: float | None,
        occurred_at: datetime,
    ) -> None:
        """Update or create COMMUNICATED_WITH relationship with aggregated stats."""
        graph = await self._get_graph()

        # Check if relationship exists
        result = await graph.query(
            """
            MATCH (a:Contact {id: $fromId})-[r:COMMUNICATED_WITH]->(b:Contact {id: $toId})
            RETURN r.count as count, r.channels as channels, r.sentimentSum as sentimentSum
            """,
            {"fromId": from_contact_id, "toId": to_contact_id},
        )

        if result.result_set and len(result.result_set) > 0:
            # Update existing relationship
            row = result.result_set[0]
            existing_count = row[0] or 0
            existing_channels = json.loads(row[1]) if row[1] else []
            existing_sentiment_sum = row[2] or 0.0

            # Update channels list
            if channel and channel not in existing_channels:
                existing_channels.append(channel)

            # Update sentiment sum for averaging
            new_sentiment_sum = existing_sentiment_sum
            if sentiment_score is not None:
                new_sentiment_sum = existing_sentiment_sum + sentiment_score

            await graph.query(
                """
                MATCH (a:Contact {id: $fromId})-[r:COMMUNICATED_WITH]->(b:Contact {id: $toId})
                SET r.count = $newCount,
                    r.channels = $channels,
                    r.lastAt = $lastAt,
                    r.sentimentSum = $sentimentSum,
                    r.sentimentAvg = $sentimentAvg
                """,
                {
                    "fromId": from_contact_id,
                    "toId": to_contact_id,
                    "newCount": existing_count + 1,
                    "channels": json.dumps(existing_channels),
                    "lastAt": occurred_at.isoformat(),
                    "sentimentSum": new_sentiment_sum,
                    "sentimentAvg": new_sentiment_sum / (existing_count + 1) if sentiment_score is not None else None,
                },
            )
        else:
            # Create new relationship
            await graph.query(
                """
                MATCH (a:Contact {id: $fromId})
                MATCH (b:Contact {id: $toId})
                CREATE (a)-[r:COMMUNICATED_WITH {
                    count: 1,
                    channels: $channels,
                    firstAt: $firstAt,
                    lastAt: $lastAt,
                    sentimentSum: $sentimentSum,
                    sentimentAvg: $sentimentAvg
                }]->(b)
                """,
                {
                    "fromId": from_contact_id,
                    "toId": to_contact_id,
                    "channels": json.dumps([channel] if channel else []),
                    "firstAt": occurred_at.isoformat(),
                    "lastAt": occurred_at.isoformat(),
                    "sentimentSum": sentiment_score or 0.0,
                    "sentimentAvg": sentiment_score,
                },
            )

    async def get_communication_stats(
        self,
        contact_id: str,
        since: datetime | None = None,
    ) -> dict:
        """
        Get communication statistics for a contact.

        Args:
            contact_id: The contact to get stats for
            since: Only include events since this time

        Returns:
            Dict with communication statistics
        """
        graph = await self._get_graph()

        # Get outgoing communication stats
        outgoing_query = """
            MATCH (c:Contact {id: $contactId})-[r:COMMUNICATED_WITH]->(other:Contact)
            RETURN count(r) as relationshipCount,
                   sum(r.count) as totalMessages,
                   collect(other.id) as contacts
        """

        # Get incoming communication stats
        incoming_query = """
            MATCH (other:Contact)-[r:COMMUNICATED_WITH]->(c:Contact {id: $contactId})
            RETURN count(r) as relationshipCount,
                   sum(r.count) as totalMessages,
                   collect(other.id) as contacts
        """

        outgoing_result = await graph.query(outgoing_query, {"contactId": contact_id})
        incoming_result = await graph.query(incoming_query, {"contactId": contact_id})

        outgoing = outgoing_result.result_set[0] if outgoing_result.result_set else [0, 0, []]
        incoming = incoming_result.result_set[0] if incoming_result.result_set else [0, 0, []]

        return {
            "contact_id": contact_id,
            "outgoing": {
                "relationship_count": outgoing[0] or 0,
                "total_messages": outgoing[1] or 0,
                "contacts": outgoing[2] or [],
            },
            "incoming": {
                "relationship_count": incoming[0] or 0,
                "total_messages": incoming[1] or 0,
                "contacts": incoming[2] or [],
            },
            "total_communications": (outgoing[1] or 0) + (incoming[1] or 0),
            "unique_contacts": len(set((outgoing[2] or []) + (incoming[2] or []))),
        }

    async def get_top_communicators(
        self,
        limit: int = 10,
    ) -> list[dict]:
        """
        Get contacts with most communication activity.

        Returns:
            List of contacts sorted by communication volume
        """
        graph = await self._get_graph()

        result = await graph.query(
            """
            MATCH (c:Contact {organizationId: $orgId})
            OPTIONAL MATCH (c)-[out:COMMUNICATED_WITH]->()
            OPTIONAL MATCH ()-[in:COMMUNICATED_WITH]->(c)
            WITH c,
                 coalesce(sum(out.count), 0) as outgoing,
                 coalesce(sum(in.count), 0) as incoming
            RETURN c.id as id,
                   c.email as email,
                   c.name as name,
                   outgoing,
                   incoming,
                   outgoing + incoming as total
            ORDER BY total DESC
            LIMIT $limit
            """,
            {"orgId": self.organization_id, "limit": limit},
        )

        return [
            {
                "contact_id": row[0],
                "email": row[1],
                "name": row[2],
                "outgoing_count": row[3],
                "incoming_count": row[4],
                "total_count": row[5],
            }
            for row in (result.result_set or [])
        ]

    async def get_relationship_strength(
        self,
        contact_a_id: str,
        contact_b_id: str,
    ) -> dict:
        """
        Calculate relationship strength between two contacts.

        Considers:
        - Total communication count (both directions)
        - Recency of last communication
        - Diversity of channels used
        - Sentiment trends

        Returns:
            Dict with relationship metrics
        """
        graph = await self._get_graph()

        result = await graph.query(
            """
            MATCH (a:Contact {id: $aId})
            MATCH (b:Contact {id: $bId})
            OPTIONAL MATCH (a)-[ab:COMMUNICATED_WITH]->(b)
            OPTIONAL MATCH (b)-[ba:COMMUNICATED_WITH]->(a)
            RETURN ab.count as aToB,
                   ba.count as bToA,
                   ab.lastAt as aToBlast,
                   ba.lastAt as bToAlast,
                   ab.channels as aToChannels,
                   ba.channels as bToChannels,
                   ab.sentimentAvg as aToSentiment,
                   ba.sentimentAvg as bToSentiment
            """,
            {"aId": contact_a_id, "bId": contact_b_id},
        )

        if not result.result_set or len(result.result_set) == 0:
            return {
                "contact_a_id": contact_a_id,
                "contact_b_id": contact_b_id,
                "total_communications": 0,
                "strength": 0.0,
                "channels": [],
                "sentiment": None,
            }

        row = result.result_set[0]
        a_to_b = row[0] or 0
        b_to_a = row[1] or 0
        total = a_to_b + b_to_a

        # Parse channels
        channels_a = json.loads(row[4]) if row[4] else []
        channels_b = json.loads(row[5]) if row[5] else []
        all_channels = list(set(channels_a + channels_b))

        # Calculate sentiment
        sentiment_a = row[6]
        sentiment_b = row[7]
        avg_sentiment = None
        if sentiment_a is not None and sentiment_b is not None:
            avg_sentiment = (sentiment_a + sentiment_b) / 2
        elif sentiment_a is not None:
            avg_sentiment = sentiment_a
        elif sentiment_b is not None:
            avg_sentiment = sentiment_b

        # Calculate strength (simple heuristic, can be enhanced)
        # Factors: total communications, channel diversity, balance of communication
        communication_score = min(total / 100, 1.0)  # Cap at 100 messages
        channel_score = min(len(all_channels) / 3, 1.0)  # Cap at 3 channels
        balance_score = 1.0 - abs(a_to_b - b_to_a) / max(total, 1)  # More balanced = stronger

        strength = (communication_score * 0.5 + channel_score * 0.2 + balance_score * 0.3)

        return {
            "contact_a_id": contact_a_id,
            "contact_b_id": contact_b_id,
            "a_to_b_count": a_to_b,
            "b_to_a_count": b_to_a,
            "total_communications": total,
            "channels": all_channels,
            "sentiment": avg_sentiment,
            "strength": round(strength, 3),
        }

    async def detect_communication_clusters(self) -> list[dict]:
        """
        Detect communication clusters using graph algorithms.

        Uses CDLP (Community Detection using Label Propagation) when available,
        falls back to simple connected component detection.

        Returns:
            List of clusters with member contacts
        """
        graph = await self._get_graph()

        try:
            # Try CDLP community detection
            result = await graph.query(
                """
                CALL algo.labelPropagation({
                    nodeLabels: ['Contact'],
                    relationshipTypes: ['COMMUNICATED_WITH'],
                    maxIterations: 10
                }) YIELD node, communityId
                WITH communityId, collect(node.id) as members
                RETURN communityId, members, size(members) as size
                ORDER BY size DESC
                """,
            )

            if result.result_set:
                return [
                    {
                        "community_id": row[0],
                        "member_ids": row[1],
                        "size": row[2],
                    }
                    for row in result.result_set
                ]
        except Exception as e:
            logger.warning(
                "CDLP community detection not available, using fallback",
                error=str(e),
            )

        # Fallback: simple connected component detection
        result = await graph.query(
            """
            MATCH (c:Contact {organizationId: $orgId})-[:COMMUNICATED_WITH*1..3]-(connected:Contact)
            WITH c, collect(DISTINCT connected.id) + [c.id] as cluster
            RETURN cluster, size(cluster) as size
            ORDER BY size DESC
            LIMIT 20
            """,
            {"orgId": self.organization_id},
        )

        clusters = []
        seen = set()
        for row in (result.result_set or []):
            members = sorted(row[0])
            key = tuple(members)
            if key not in seen:
                seen.add(key)
                clusters.append({
                    "community_id": f"cluster_{len(clusters)}",
                    "member_ids": members,
                    "size": row[1],
                })

        return clusters


async def get_communication_tracker(organization_id: str) -> CommunicationTracker:
    """Get a CommunicationTracker for an organization."""
    return CommunicationTracker(organization_id)
