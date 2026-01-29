"""
Extract Communication Node

Extracts communication patterns from parsed messages and records them
in the communication graph for relationship intelligence.

This is part of Phase 2 (Wider Graph) of the FalkorDB enhancement plan.
"""

import time
from datetime import datetime, timezone

import structlog

from ..state import IntelligenceState, NodeTiming

logger = structlog.get_logger()


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def extract_communication_node(state: IntelligenceState) -> dict:
    """
    Extract communication patterns from parsed messages.

    This node:
    1. Records communication events for each message
    2. Updates COMMUNICATED_WITH relationships between contacts
    3. Tracks communication metadata (channel, sentiment, response times)

    The communication graph enables:
    - Relationship strength analysis
    - Communication pattern detection
    - Response time tracking
    - Sentiment trajectory tracking

    Returns:
        State update with communication_events_recorded count
    """
    start_time = time.time()

    logger.info(
        "Extracting communication patterns",
        analysis_id=state.analysis_id,
        message_count=len(state.messages),
        resolved_contacts=len(state.contact_context.resolved_contacts),
    )

    # Update trace
    state.trace.current_node = "extract_communication"
    state.trace.nodes.append("extract_communication")

    events_recorded = 0
    skipped_no_sender = 0
    skipped_no_contact = 0

    try:
        from src.graph.communication import get_communication_tracker

        tracker = await get_communication_tracker(state.input.organization_id)

        # Map email addresses to resolved contact IDs
        email_to_contact_id = {}
        for contact in state.contact_context.resolved_contacts:
            if contact.email:
                email_to_contact_id[contact.email.lower()] = contact.id

        # Map source type to event type
        source_to_event_type = {
            "email": "email_sent",
            "slack": "slack_message",
            "whatsapp": "slack_message",  # Similar pattern
            "calendar": "meeting_scheduled",
            "notion": "document_shared",
            "google_docs": "document_shared",
        }

        previous_message_time = None
        previous_sender_id = None

        for i, message in enumerate(state.messages):
            # Skip messages without sender info
            if not message.sender_email:
                skipped_no_sender += 1
                continue

            # Get sender contact ID
            sender_email = message.sender_email.lower()
            sender_contact_id = email_to_contact_id.get(sender_email)

            if not sender_contact_id:
                skipped_no_contact += 1
                logger.debug(
                    "Skipping message - sender not resolved",
                    sender_email=sender_email,
                )
                continue

            # Determine recipients (all other resolved contacts in the conversation)
            recipient_ids = []
            for contact in state.contact_context.resolved_contacts:
                if contact.id != sender_contact_id and contact.email:
                    recipient_ids.append(contact.id)

            # If no recipients found, check if user is implicit recipient
            if not recipient_ids and state.input.user_email:
                user_email_lower = state.input.user_email.lower()
                user_contact_id = email_to_contact_id.get(user_email_lower)
                if user_contact_id and user_contact_id != sender_contact_id:
                    recipient_ids.append(user_contact_id)

            # Skip if no recipients (can't form a communication link)
            if not recipient_ids:
                continue

            # Determine event type
            event_type = source_to_event_type.get(
                state.input.source_type, "email_sent"
            )

            # Calculate response time if this looks like a response
            is_response = False
            response_time_seconds = None
            if (
                previous_message_time
                and previous_sender_id
                and previous_sender_id != sender_contact_id
                and message.sent_at
            ):
                is_response = True
                time_diff = message.sent_at - previous_message_time
                response_time_seconds = int(time_diff.total_seconds())
                # Cap at 7 days (604800 seconds) to filter outliers
                if response_time_seconds > 604800 or response_time_seconds < 0:
                    response_time_seconds = None

            # Extract channel info from metadata
            channel = None
            if state.input.metadata:
                channel = (
                    state.input.metadata.get("channel_id")
                    or state.input.metadata.get("channel_name")
                    or state.input.metadata.get("page_id")
                )

            # Record the communication event
            await tracker.record_communication(
                from_contact_id=sender_contact_id,
                to_contact_ids=recipient_ids,
                event_type=event_type,
                source_type=state.input.source_type or "email",
                occurred_at=message.sent_at or utc_now(),
                channel=channel,
                source_id=state.raw_message_ids[i] if i < len(state.raw_message_ids) else None,
                message_length=len(message.content) if message.content else None,
                is_response=is_response,
                response_time_seconds=response_time_seconds,
            )

            events_recorded += 1

            # Track for response detection
            if message.sent_at:
                previous_message_time = message.sent_at
            previous_sender_id = sender_contact_id

        logger.info(
            "Communication patterns extracted",
            analysis_id=state.analysis_id,
            events_recorded=events_recorded,
            skipped_no_sender=skipped_no_sender,
            skipped_no_contact=skipped_no_contact,
        )

    except Exception as e:
        logger.error(
            "Failed to extract communication patterns",
            analysis_id=state.analysis_id,
            error=str(e),
        )
        # Don't fail the pipeline - communication extraction is supplementary
        events_recorded = 0

    # Record timing
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "communication_events_recorded": events_recorded,
        "trace": {
            **state.trace.model_dump(),
            "node_timings": {
                **state.trace.node_timings,
                "extract_communication": node_timing,
            },
        },
    }
