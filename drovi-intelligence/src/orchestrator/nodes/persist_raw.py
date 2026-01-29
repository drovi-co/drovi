"""
Persist Raw Content Node

Persists raw message content to FalkorDB for:
- Full-text search across all communications
- Evidence linking for extracted intelligence
- Thread reconstruction
- Temporal analysis

This is part of Phase 1 (Deeper Graph) of the FalkorDB enhancement plan.
"""

import json
import time
from datetime import datetime, timezone
from uuid import uuid4

import structlog

from ..state import IntelligenceState, NodeTiming
from src.graph.types import RawMessageNode, ThreadContextNode, SourceType

logger = structlog.get_logger()


def utc_now():
    """Get current UTC time as a naive datetime."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def serialize_for_graph(value):
    """Serialize values for FalkorDB graph storage."""
    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        return json.dumps(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


async def persist_raw_content_node(state: IntelligenceState) -> dict:
    """
    Persist raw content to FalkorDB for deeper graph memory.

    This node:
    1. Creates RawMessage nodes for each parsed message
    2. Creates or updates ThreadContext for the conversation
    3. Links messages to contacts via SENT_BY and RECEIVED_BY relationships
    4. Links messages to threads via IN_THREAD relationships

    Returns:
        State update with raw_message_ids and thread_context_id
    """
    start_time = time.time()

    logger.info(
        "Persisting raw content",
        analysis_id=state.analysis_id,
        source_type=state.input.source_type,
        message_count=len(state.messages),
    )

    # Update trace
    state.trace.current_node = "persist_raw"
    state.trace.nodes.append("persist_raw")

    raw_message_ids: list[str] = []
    thread_context_id: str | None = None

    try:
        from src.graph.client import get_graph_client
        graph = await get_graph_client()

        now = utc_now()

        # Map source_type string to SourceType enum
        source_type_map = {
            "email": "email",
            "slack": "slack",
            "notion": "notion",
            "google_docs": "google_docs",
            "whatsapp": "whatsapp",
            "calendar": "calendar",
            "api": "api",
            "manual": "manual",
        }
        source_type = source_type_map.get(state.input.source_type, "api")

        # Create or get ThreadContext if we have a conversation_id
        if state.input.conversation_id:
            thread_context_id = await _get_or_create_thread_context(
                graph=graph,
                organization_id=state.input.organization_id,
                conversation_id=state.input.conversation_id,
                source_type=source_type,
                subject=state.input.metadata.get("subject") if state.input.metadata else None,
                messages=state.messages,
                now=now,
            )

        # Create RawMessage nodes for each parsed message
        for i, message in enumerate(state.messages):
            raw_message_id = str(uuid4())
            raw_message_ids.append(raw_message_id)

            # Build properties for graph node
            props = {
                "id": raw_message_id,
                "organizationId": state.input.organization_id,
                "content": serialize_for_graph(message.content),
                "sourceType": source_type,
                "sourceId": state.input.source_id or f"{state.input.conversation_id}_{i}",
                "sourceAccountId": serialize_for_graph(state.input.source_account_id),
                "senderEmail": serialize_for_graph(message.sender_email),
                "senderName": serialize_for_graph(message.sender_name),
                "threadId": serialize_for_graph(thread_context_id),
                "sentAt": message.sent_at.isoformat() if message.sent_at else now.isoformat(),
                "receivedAt": now.isoformat(),
                "isFromUser": message.is_from_user,
                "isProcessed": True,
                "processedAt": now.isoformat(),
                "createdAt": now.isoformat(),
                "updatedAt": now.isoformat(),
            }

            # Add metadata fields if available
            if state.input.metadata:
                metadata = state.input.metadata
                if "subject" in metadata:
                    props["subject"] = serialize_for_graph(metadata["subject"])
                if "channel_id" in metadata:
                    props["channelId"] = serialize_for_graph(metadata["channel_id"])
                if "channel_name" in metadata:
                    props["channelName"] = serialize_for_graph(metadata["channel_name"])
                if "page_id" in metadata:
                    props["pageId"] = serialize_for_graph(metadata["page_id"])
                if "doc_id" in metadata:
                    props["docId"] = serialize_for_graph(metadata["doc_id"])
                if "event_id" in metadata:
                    props["eventId"] = serialize_for_graph(metadata["event_id"])

            # Create RawMessage node
            await graph.query(
                """
                CREATE (m:RawMessage {
                    id: $id,
                    organizationId: $organizationId,
                    content: $content,
                    sourceType: $sourceType,
                    sourceId: $sourceId,
                    sourceAccountId: $sourceAccountId,
                    senderEmail: $senderEmail,
                    senderName: $senderName,
                    threadId: $threadId,
                    sentAt: $sentAt,
                    receivedAt: $receivedAt,
                    isFromUser: $isFromUser,
                    isProcessed: $isProcessed,
                    processedAt: $processedAt,
                    createdAt: $createdAt,
                    updatedAt: $updatedAt
                })
                RETURN m
                """,
                props,
            )

            # Link to ThreadContext if exists
            if thread_context_id:
                await graph.query(
                    """
                    MATCH (m:RawMessage {id: $messageId})
                    MATCH (t:ThreadContext {id: $threadId})
                    MERGE (m)-[:IN_THREAD]->(t)
                    """,
                    {"messageId": raw_message_id, "threadId": thread_context_id},
                )

            # Link to sender Contact if we have email
            if message.sender_email:
                await graph.query(
                    """
                    MATCH (m:RawMessage {id: $messageId})
                    MATCH (c:Contact {email: $email, organizationId: $orgId})
                    MERGE (m)-[:SENT_BY]->(c)
                    """,
                    {
                        "messageId": raw_message_id,
                        "email": message.sender_email.lower(),
                        "orgId": state.input.organization_id,
                    },
                )

            logger.debug(
                "Created RawMessage",
                raw_message_id=raw_message_id,
                sender_email=message.sender_email,
                has_thread=bool(thread_context_id),
            )

        logger.info(
            "Raw content persisted",
            analysis_id=state.analysis_id,
            raw_message_count=len(raw_message_ids),
            thread_context_id=thread_context_id,
        )

    except Exception as e:
        logger.error(
            "Failed to persist raw content",
            analysis_id=state.analysis_id,
            error=str(e),
        )
        # Don't fail the pipeline - raw persistence is supplementary
        raw_message_ids = []
        thread_context_id = None

    # Record timing
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "raw_message_ids": raw_message_ids,
        "thread_context_id": thread_context_id,
        "trace": {
            **state.trace.model_dump(),
            "node_timings": {
                **state.trace.node_timings,
                "persist_raw": node_timing,
            },
        },
    }


async def _get_or_create_thread_context(
    graph,
    organization_id: str,
    conversation_id: str,
    source_type: str,
    subject: str | None,
    messages: list,
    now: datetime,
) -> str:
    """Get existing ThreadContext or create new one."""

    # Check if thread already exists
    result = await graph.query(
        """
        MATCH (t:ThreadContext {threadId: $threadId, organizationId: $orgId})
        RETURN t.id as id
        """,
        {"threadId": conversation_id, "orgId": organization_id},
    )

    if result.result_set and len(result.result_set) > 0:
        existing_id = result.result_set[0][0]

        # Update thread with new message count
        await graph.query(
            """
            MATCH (t:ThreadContext {id: $id})
            SET t.messageCount = t.messageCount + $newMessages,
                t.lastMessageAt = $now,
                t.lastActivityAt = $now,
                t.updatedAt = $now
            """,
            {
                "id": existing_id,
                "newMessages": len(messages),
                "now": now.isoformat(),
            },
        )

        logger.debug(
            "Updated existing ThreadContext",
            thread_context_id=existing_id,
            new_messages=len(messages),
        )
        return existing_id

    # Create new ThreadContext
    thread_context_id = str(uuid4())

    # Extract participant info from messages
    participant_emails = list(set(
        m.sender_email.lower()
        for m in messages
        if m.sender_email
    ))

    # Find first and last message times
    message_times = [m.sent_at for m in messages if m.sent_at]
    first_message_at = min(message_times) if message_times else now
    last_message_at = max(message_times) if message_times else now

    await graph.query(
        """
        CREATE (t:ThreadContext {
            id: $id,
            organizationId: $orgId,
            threadId: $threadId,
            sourceType: $sourceType,
            subject: $subject,
            participantEmails: $participants,
            participantCount: $participantCount,
            messageCount: $messageCount,
            firstMessageAt: $firstMessageAt,
            lastMessageAt: $lastMessageAt,
            lastActivityAt: $lastActivityAt,
            status: 'active',
            createdAt: $now,
            updatedAt: $now
        })
        RETURN t
        """,
        {
            "id": thread_context_id,
            "orgId": organization_id,
            "threadId": conversation_id,
            "sourceType": source_type,
            "subject": subject or "",
            "participants": json.dumps(participant_emails),
            "participantCount": len(participant_emails),
            "messageCount": len(messages),
            "firstMessageAt": first_message_at.isoformat() if isinstance(first_message_at, datetime) else first_message_at,
            "lastMessageAt": last_message_at.isoformat() if isinstance(last_message_at, datetime) else last_message_at,
            "lastActivityAt": now.isoformat(),
            "now": now.isoformat(),
        },
    )

    # Link ThreadContext to participant Contacts
    for email in participant_emails:
        await graph.query(
            """
            MATCH (t:ThreadContext {id: $threadId})
            MATCH (c:Contact {email: $email, organizationId: $orgId})
            MERGE (t)-[:THREAD_PARTICIPANT]->(c)
            """,
            {
                "threadId": thread_context_id,
                "email": email,
                "orgId": organization_id,
            },
        )

    logger.debug(
        "Created new ThreadContext",
        thread_context_id=thread_context_id,
        conversation_id=conversation_id,
        participant_count=len(participant_emails),
    )

    return thread_context_id
