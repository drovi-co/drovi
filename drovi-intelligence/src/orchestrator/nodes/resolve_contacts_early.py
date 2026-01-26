"""
Resolve Contacts Early Node

Pre-resolution of contact identities BEFORE intelligence extraction.
This node runs immediately after parsing to provide rich relationship
context that enhances commitment/decision extraction.

Benefits:
- Extraction prompts include "This is from your VIP contact John (CEO of Acme)"
- Commitments get richer party information (not just email, full context)
- Decisions include relationship history with decision-maker
- Tasks can be assigned with full contact context

Pipeline Position: Node 2 (immediately after 'parse', before 'classify')
"""

import time
from typing import Any

import structlog

from src.identity import (
    get_identity_graph,
    IdentityType,
    IdentitySource,
)
from ..state import (
    IntelligenceState,
    ContactContextData,
    NodeTiming,
)

logger = structlog.get_logger()


async def resolve_contacts_early_node(state: IntelligenceState) -> dict[str, Any]:
    """
    Resolve all message participants to unified contacts BEFORE extraction.

    This provides relationship context that enriches intelligence extraction:
    - VIP/at-risk status influences how commitments are prioritized
    - Role type (decision_maker, gatekeeper) helps identify authority
    - Health scores provide relationship context
    - Communication history informs urgency assessment

    Returns:
        State update with contact_context populated
    """
    start_time = time.time()

    logger.info(
        "Pre-resolving contacts",
        analysis_id=state.analysis_id,
        message_count=len(state.messages),
    )

    # Update trace
    state.trace.current_node = "resolve_contacts_early"
    state.trace.nodes.append("resolve_contacts_early")

    try:
        identity_graph = await get_identity_graph()
        organization_id = state.input.organization_id

        # Collect all participant identifiers from parsed messages
        identifiers = _collect_participant_identifiers(state)

        logger.debug(
            "Collected participant identifiers",
            analysis_id=state.analysis_id,
            identifier_count=len(identifiers),
        )

        # Build contact context
        contact_context = await _build_contact_context(
            identity_graph,
            organization_id,
            identifiers,
        )

        logger.info(
            "Contact pre-resolution complete",
            analysis_id=state.analysis_id,
            resolved_count=len(contact_context.resolved_contacts),
            vip_count=len(contact_context.vip_contacts),
            at_risk_count=len(contact_context.at_risk_contacts),
        )

        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )

        return {
            "contact_context": contact_context.model_dump(),
            "trace": {
                **state.trace.model_dump(),
                "current_node": "resolve_contacts_early",
                "node_timings": {
                    **state.trace.node_timings,
                    "resolve_contacts_early": node_timing,
                },
            },
        }

    except Exception as e:
        logger.error(
            "Contact pre-resolution failed",
            analysis_id=state.analysis_id,
            error=str(e),
        )

        # Return empty context on failure - extraction can proceed without it
        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )

        return {
            "contact_context": ContactContextData(resolved=False).model_dump(),
            "trace": {
                **state.trace.model_dump(),
                "current_node": "resolve_contacts_early",
                "node_timings": {
                    **state.trace.node_timings,
                    "resolve_contacts_early": node_timing,
                },
                "errors": state.trace.errors + [f"resolve_contacts_early: {str(e)}"],
            },
        }


def _collect_participant_identifiers(
    state: IntelligenceState,
) -> list[tuple[IdentityType, str]]:
    """
    Collect all participant identifiers from parsed messages.

    Extracts:
    - Sender emails from messages
    - User email from input
    - Any Slack IDs from metadata
    - Calendar attendee emails

    Returns:
        List of (identity_type, identity_value) tuples
    """
    identifiers: list[tuple[IdentityType, str]] = []
    seen: set[str] = set()

    # From parsed messages
    for msg in state.messages:
        if msg.sender_email and msg.sender_email.lower() not in seen:
            identifiers.append((IdentityType.EMAIL, msg.sender_email.lower()))
            seen.add(msg.sender_email.lower())

    # From input user
    if state.input.user_email and state.input.user_email.lower() not in seen:
        identifiers.append((IdentityType.EMAIL, state.input.user_email.lower()))
        seen.add(state.input.user_email.lower())

    # From metadata (calendar attendees, etc.)
    if state.input.metadata:
        # Calendar attendees
        attendees = state.input.metadata.get("attendees", [])
        for attendee in attendees:
            email = attendee.get("email") if isinstance(attendee, dict) else str(attendee)
            if email and email.lower() not in seen:
                identifiers.append((IdentityType.EMAIL, email.lower()))
                seen.add(email.lower())

        # Slack users
        slack_users = state.input.metadata.get("slack_users", [])
        for slack_user in slack_users:
            if isinstance(slack_user, dict):
                if slack_user.get("id"):
                    slack_id = slack_user["id"]
                    if f"slack:{slack_id}" not in seen:
                        identifiers.append((IdentityType.SLACK_ID, slack_id))
                        seen.add(f"slack:{slack_id}")
                if slack_user.get("email") and slack_user["email"].lower() not in seen:
                    identifiers.append((IdentityType.EMAIL, slack_user["email"].lower()))
                    seen.add(slack_user["email"].lower())

        # WhatsApp participants
        wa_participants = state.input.metadata.get("whatsapp_participants", [])
        for wa_id in wa_participants:
            if wa_id and f"wa:{wa_id}" not in seen:
                identifiers.append((IdentityType.WHATSAPP_ID, wa_id))
                seen.add(f"wa:{wa_id}")

    return identifiers


async def _build_contact_context(
    identity_graph,
    organization_id: str,
    identifiers: list[tuple[IdentityType, str]],
) -> ContactContextData:
    """
    Build full contact context from resolved identities.

    Args:
        identity_graph: UnifiedIdentityGraph instance
        organization_id: Organization scope
        identifiers: List of (type, value) identifier tuples

    Returns:
        ContactContextData with all resolved contacts
    """
    context = ContactContextData(resolved=True)

    for id_type, id_value in identifiers:
        try:
            resolution = await identity_graph.resolve_identifier(
                identifier_type=id_type,
                identifier_value=id_value,
                organization_id=organization_id,
                create_if_missing=True,
                source=_get_source_for_type(id_type),
            )

            if resolution and resolution.contact:
                contact = resolution.contact

                # Index by identifier
                key = (
                    id_value.lower()
                    if id_type == IdentityType.EMAIL
                    else f"{id_type.value}:{id_value}"
                )

                context.resolved_contacts[key] = {
                    "id": contact.id,
                    "display_name": contact.display_name,
                    "primary_email": contact.primary_email,
                    "company": contact.company,
                    "title": contact.title,
                    "importance_score": contact.importance_score,
                    "health_score": contact.health_score,
                    "engagement_score": contact.engagement_score,
                    "sentiment_score": contact.sentiment_score,
                    "is_vip": contact.is_vip,
                    "is_at_risk": contact.is_at_risk,
                    "lifecycle_stage": contact.lifecycle_stage,
                    "role_type": contact.role_type,
                    "pagerank_score": contact.pagerank_score,
                    "bridging_score": contact.bridging_score,
                    "total_threads": contact.total_threads,
                    "total_messages": contact.total_messages,
                }

                # Track VIP and at-risk
                if contact.is_vip and contact.id not in context.vip_contacts:
                    context.vip_contacts.append(contact.id)
                if contact.is_at_risk and contact.id not in context.at_risk_contacts:
                    context.at_risk_contacts.append(contact.id)

                # Store relationship strength
                context.relationship_strengths[contact.id] = contact.health_score

        except Exception as e:
            logger.warning(
                "Failed to resolve identifier",
                id_type=id_type.value,
                id_value=id_value[:20] + "..." if len(id_value) > 20 else id_value,
                error=str(e),
            )
            continue

    return context


def _get_source_for_type(id_type: IdentityType) -> IdentitySource:
    """Map identity type to likely source."""
    mapping = {
        IdentityType.EMAIL: IdentitySource.EMAIL_HEADER,
        IdentityType.EMAIL_ALIAS: IdentitySource.EMAIL_HEADER,
        IdentityType.SLACK_ID: IdentitySource.SLACK_PROFILE,
        IdentityType.SLACK_HANDLE: IdentitySource.SLACK_PROFILE,
        IdentityType.WHATSAPP_ID: IdentitySource.EMAIL_HEADER,
        IdentityType.PHONE: IdentitySource.EMAIL_HEADER,
        IdentityType.CALENDAR_ATTENDEE_ID: IdentitySource.CALENDAR_INVITE,
    }
    return mapping.get(id_type, IdentitySource.EMAIL_HEADER)
