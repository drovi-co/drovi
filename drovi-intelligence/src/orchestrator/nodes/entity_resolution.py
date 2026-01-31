"""
Entity Resolution Node

Resolves and merges entities (primarily contacts) across different sources.
This ensures that "John Doe" from email, @johndoe from Slack, and
john.doe@company.com are recognized as the same person.

Uses fuzzy matching, phonetic matching, and graph traversal to identify
duplicate entities and merge them intelligently.
"""

import time
from typing import Literal

import structlog

from src.graph.client import get_graph_client
from ..state import (
    IntelligenceState,
    ExtractedContact,
    ExtractedIntelligence,
    NodeTiming,
)

logger = structlog.get_logger()


async def entity_resolution_node(state: IntelligenceState) -> dict:
    """
    Resolve and merge entities across sources.

    This node:
    1. Collects all contacts mentioned in the extracted intelligence
    2. Searches for existing contacts with matching identifiers
    3. Merges duplicates or creates new contacts
    4. Links extracted intelligence to resolved contacts

    Returns:
        State update with resolved contacts
    """
    start_time = time.time()

    logger.info(
        "Resolving entities",
        analysis_id=state.analysis_id,
        contact_count=len(state.extracted.contacts),
    )

    # Update trace
    state.trace.current_node = "entity_resolution"
    state.trace.nodes.append("entity_resolution")

    try:
        graph = await get_graph_client()
        organization_id = state.input.organization_id

        # Collect all contacts from extracted intelligence
        contacts_to_resolve = _collect_contacts_from_state(state)

        resolved_contacts = []
        merge_actions = []

        for contact in contacts_to_resolve:
            # Search for existing contact
            existing = await _find_existing_contact(
                graph,
                organization_id,
                contact,
            )

            if existing:
                # Merge with existing
                merged = await _merge_contact(
                    graph,
                    organization_id,
                    existing["id"],
                    contact,
                )
                if merged:
                    merge_actions.append({
                        "action": "merged",
                        "new_contact": contact.name,
                        "existing_id": existing["id"],
                    })
                    contact.id = existing["id"]
            else:
                # Create new contact
                contact_id = await _create_contact(
                    graph,
                    organization_id,
                    contact,
                )
                contact.id = contact_id

            resolved_contacts.append(contact)

        logger.info(
            "Entity resolution complete",
            analysis_id=state.analysis_id,
            total_contacts=len(contacts_to_resolve),
            merged_count=len(merge_actions),
            new_count=len(contacts_to_resolve) - len(merge_actions),
        )

        # Update extracted intelligence with resolved contacts
        extracted = ExtractedIntelligence(
            claims=state.extracted.claims,
            commitments=state.extracted.commitments,
            decisions=state.extracted.decisions,
            tasks=state.extracted.tasks,
            topics=state.extracted.topics,
            risks=state.extracted.risks,
            contacts=resolved_contacts,
        )

        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )

        return {
            "extracted": extracted,
            "trace": {
                **state.trace.model_dump(),
                "current_node": "entity_resolution",
                "node_timings": {
                    **state.trace.node_timings,
                    "entity_resolution": node_timing,
                },
            },
        }

    except Exception as e:
        logger.error(
            "Entity resolution failed",
            analysis_id=state.analysis_id,
            error=str(e),
        )

        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )

        return {
            "trace": {
                **state.trace.model_dump(),
                "current_node": "entity_resolution",
                "node_timings": {
                    **state.trace.node_timings,
                    "entity_resolution": node_timing,
                },
                "errors": state.trace.errors + [f"entity_resolution: {str(e)}"],
            },
        }


def _collect_contacts_from_state(state: IntelligenceState) -> list[ExtractedContact]:
    """
    Collect all contacts mentioned in extracted intelligence.

    Extracts contacts from:
    - Existing extracted contacts
    - Commitment parties (debtor, creditor)
    - Decision makers and stakeholders
    - Task assignees and creators
    """
    contacts = list(state.extracted.contacts)
    seen_emails = {c.email for c in contacts if c.email}
    seen_names = {c.name.lower() for c in contacts}

    # From commitments
    for commitment in state.extracted.commitments:
        # Debtor
        if commitment.debtor_email and commitment.debtor_email not in seen_emails:
            contacts.append(ExtractedContact(
                name=commitment.debtor_name or commitment.debtor_email,
                email=commitment.debtor_email,
                relationship="unknown",
                source_type=state.input.source_type,
                confidence=commitment.confidence,
            ))
            seen_emails.add(commitment.debtor_email)

        # Creditor
        if commitment.creditor_email and commitment.creditor_email not in seen_emails:
            contacts.append(ExtractedContact(
                name=commitment.creditor_name or commitment.creditor_email,
                email=commitment.creditor_email,
                relationship="unknown",
                source_type=state.input.source_type,
                confidence=commitment.confidence,
            ))
            seen_emails.add(commitment.creditor_email)

    # From decisions
    for decision in state.extracted.decisions:
        if decision.decision_maker_email and decision.decision_maker_email not in seen_emails:
            contacts.append(ExtractedContact(
                name=decision.decision_maker_name or decision.decision_maker_email,
                email=decision.decision_maker_email,
                relationship="unknown",
                source_type=state.input.source_type,
                confidence=decision.confidence,
            ))
            seen_emails.add(decision.decision_maker_email)

    # From tasks
    for task in state.extracted.tasks:
        if task.assignee_email and task.assignee_email not in seen_emails:
            contacts.append(ExtractedContact(
                name=task.assignee_name or task.assignee_email,
                email=task.assignee_email,
                relationship="unknown",
                source_type=state.input.source_type,
                confidence=task.confidence,
            ))
            seen_emails.add(task.assignee_email)

        if task.created_by_email and task.created_by_email not in seen_emails:
            contacts.append(ExtractedContact(
                name=task.created_by_name or task.created_by_email,
                email=task.created_by_email,
                relationship="unknown",
                source_type=state.input.source_type,
                confidence=task.confidence,
            ))
            seen_emails.add(task.created_by_email)

    return contacts


async def _find_existing_contact(
    graph,
    organization_id: str,
    contact: ExtractedContact,
) -> dict | None:
    """
    Find an existing contact that matches the new contact.

    Uses multiple matching strategies:
    1. Exact email match
    2. Fuzzy name match (using FalkorDB full-text with phonetic)
    3. Alias match
    """
    # Try exact email match first
    if contact.email:
        result = await graph.query(
            """
            MATCH (c:Contact {email: $email, organizationId: $orgId})
            RETURN c.id as id, c.name as name, c.email as email, c.aliases as aliases
            LIMIT 1
            """,
            {"email": contact.email, "orgId": organization_id},
        )
        if result:
            return result[0]

    # Try fuzzy name match using full-text search
    if contact.name:
        try:
            # FalkorDB fulltext uses 2 args: index_name and query
            # Index name format: label_property_idx
            index_name = "contact_name_idx"
            result = await graph.query(
                f"""
                CALL db.idx.fulltext.queryNodes('{index_name}', $nameQuery)
                YIELD node, score
                WHERE node.organizationId = $orgId AND score > 0.7
                RETURN node.id as id, node.name as name, node.email as email,
                       node.aliases as aliases, score
                ORDER BY score DESC
                LIMIT 1
                """,
                {"nameQuery": contact.name, "orgId": organization_id},
            )
            if result and result[0].get("score", 0) > 0.8:
                return result[0]
        except Exception:
            # Full-text index might not exist yet
            pass

        # Fallback: Simple case-insensitive match
        result = await graph.query(
            """
            MATCH (c:Contact {organizationId: $orgId})
            WHERE toLower(c.name) = toLower($name)
               OR $name IN c.aliases
            RETURN c.id as id, c.name as name, c.email as email, c.aliases as aliases
            LIMIT 1
            """,
            {"name": contact.name, "orgId": organization_id},
        )
        if result:
            return result[0]

    # Try Slack handle match
    if contact.slack_handle:
        result = await graph.query(
            """
            MATCH (c:Contact {organizationId: $orgId})
            WHERE c.slackHandle = $handle OR c.slackId = $handle
            RETURN c.id as id, c.name as name, c.email as email
            LIMIT 1
            """,
            {"handle": contact.slack_handle, "orgId": organization_id},
        )
        if result:
            return result[0]

    return None


async def _merge_contact(
    graph,
    organization_id: str,
    existing_id: str,
    new_contact: ExtractedContact,
) -> bool:
    """
    Merge new contact information into existing contact.

    Updates:
    - Adds new aliases
    - Updates missing fields
    - Tracks sources
    - Updates last_seen_at
    """
    try:
        from datetime import datetime
        import json

        now = datetime.utcnow().isoformat()

        # Build update properties
        updates = {
            "lastSeenAt": now,
        }

        # Add new alias if name is different
        if new_contact.name:
            try:
                await graph.query(
                    """
                    MATCH (c:Contact {id: $id, organizationId: $orgId})
                    WHERE NOT toLower(c.name) = toLower($name)
                    SET c.aliases = CASE
                        WHEN c.aliases IS NULL THEN [$name]
                        ELSE CASE
                            WHEN $name IN c.aliases THEN c.aliases
                            ELSE c.aliases + [$name]
                        END
                    END
                    """,
                    {"id": existing_id, "orgId": organization_id, "name": new_contact.name},
                )
            except Exception as alias_err:
                # If type mismatch (legacy string format), reset to proper list
                if "Type mismatch" in str(alias_err):
                    logger.debug(
                        "Fixing legacy string aliases",
                        contact_id=existing_id,
                    )
                    await graph.query(
                        """
                        MATCH (c:Contact {id: $id, organizationId: $orgId})
                        SET c.aliases = [$name]
                        """,
                        {"id": existing_id, "orgId": organization_id, "name": new_contact.name},
                    )
                else:
                    raise

        # Update missing email
        if new_contact.email:
            await graph.query(
                """
                MATCH (c:Contact {id: $id, organizationId: $orgId})
                WHERE c.email IS NULL
                SET c.email = $email
                """,
                {"id": existing_id, "orgId": organization_id, "email": new_contact.email},
            )

        # Update missing phone
        if new_contact.phone:
            await graph.query(
                """
                MATCH (c:Contact {id: $id, organizationId: $orgId})
                WHERE c.phone IS NULL
                SET c.phone = $phone
                """,
                {"id": existing_id, "orgId": organization_id, "phone": new_contact.phone},
            )

        # Update Slack info
        if new_contact.slack_handle or new_contact.slack_id:
            await graph.query(
                """
                MATCH (c:Contact {id: $id, organizationId: $orgId})
                SET c.slackHandle = COALESCE(c.slackHandle, $handle),
                    c.slackId = COALESCE(c.slackId, $slackId)
                """,
                {
                    "id": existing_id,
                    "orgId": organization_id,
                    "handle": new_contact.slack_handle,
                    "slackId": new_contact.slack_id,
                },
            )

        # Track source - use try/except to handle legacy string-formatted sources
        if new_contact.source_type:
            try:
                # Try normal list update first
                await graph.query(
                    """
                    MATCH (c:Contact {id: $id, organizationId: $orgId})
                    SET c.sources = CASE
                        WHEN c.sources IS NULL THEN [$source]
                        ELSE CASE
                            WHEN $source IN c.sources THEN c.sources
                            ELSE c.sources + [$source]
                        END
                    END,
                    c.lastSeenAt = $now
                    """,
                    {
                        "id": existing_id,
                        "orgId": organization_id,
                        "source": new_contact.source_type,
                        "now": now,
                    },
                )
            except Exception as source_err:
                # If type mismatch (legacy string format), reset to proper list
                if "Type mismatch" in str(source_err):
                    logger.debug(
                        "Fixing legacy string sources",
                        contact_id=existing_id,
                    )
                    await graph.query(
                        """
                        MATCH (c:Contact {id: $id, organizationId: $orgId})
                        SET c.sources = [$source], c.lastSeenAt = $now
                        """,
                        {
                            "id": existing_id,
                            "orgId": organization_id,
                            "source": new_contact.source_type,
                            "now": now,
                        },
                    )
                else:
                    raise

        logger.debug(
            "Contact merged",
            existing_id=existing_id,
            new_name=new_contact.name,
        )

        return True

    except Exception as e:
        logger.error(
            "Failed to merge contact",
            existing_id=existing_id,
            error=str(e),
        )
        return False


async def _create_contact(
    graph,
    organization_id: str,
    contact: ExtractedContact,
) -> str:
    """Create a new contact in the graph."""
    from datetime import datetime
    from uuid import uuid4

    contact_id = str(uuid4())
    now = datetime.utcnow().isoformat()

    # FalkorDB doesn't support $props directly in CREATE
    # We need to expand properties explicitly
    # Note: Pass actual arrays, not JSON strings
    await graph.query(
        """
        CREATE (c:Contact {
            id: $id,
            organizationId: $orgId,
            name: $name,
            email: $email,
            phone: $phone,
            slackHandle: $slackHandle,
            slackId: $slackId,
            role: $role,
            company: $company,
            relationship: $relationship,
            aliases: $aliases,
            sources: $sources,
            firstSeenAt: $firstSeenAt,
            lastSeenAt: $lastSeenAt,
            createdAt: $createdAt,
            confidence: $confidence
        })
        """,
        {
            "id": contact_id,
            "orgId": organization_id,
            "name": contact.name or "",
            "email": contact.email or "",
            "phone": contact.phone or "",
            "slackHandle": contact.slack_handle or "",
            "slackId": contact.slack_id or "",
            "role": contact.role or "",
            "company": contact.company or "",
            "relationship": contact.relationship or "unknown",
            "aliases": contact.aliases or [],
            "sources": [contact.source_type] if contact.source_type else [],
            "firstSeenAt": now,
            "lastSeenAt": now,
            "createdAt": now,
            "confidence": contact.confidence,
        },
    )

    logger.debug(
        "Contact created",
        contact_id=contact_id,
        name=contact.name,
        email=contact.email,
    )

    return contact_id
