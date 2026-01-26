"""
Load Contact Data Node

Loads all interactions and related data for a contact from all sources.
This is the first node in the contact intelligence pipeline.
"""

import time
from datetime import datetime, timedelta
from typing import Any

import structlog

from src.db import get_db_pool
from ..state import (
    ContactIntelligenceState,
    LoadedContactData,
    InteractionRecord,
    CommitmentRecord,
    DecisionRecord,
    NodeTiming,
)

logger = structlog.get_logger()


async def load_contact_data_node(state: ContactIntelligenceState) -> dict[str, Any]:
    """
    Load all data for the contact from all sources.

    Loads:
    - Contact profile from PostgreSQL
    - All interactions (emails, Slack messages, calendar events)
    - Related commitments and decisions
    - Network connections for graph analytics

    Returns:
        State update with loaded_data populated
    """
    start_time = time.time()

    logger.info(
        "Loading contact data",
        analysis_id=state.analysis_id,
        contact_id=state.input.contact_id,
    )

    # Update trace
    state.trace.current_node = "load_contact_data"
    state.trace.nodes.append("load_contact_data")

    try:
        pool = await get_db_pool()

        # Get contact profile
        contact_record = await _get_contact(
            pool,
            state.input.contact_id,
            state.input.organization_id,
        )

        if not contact_record:
            logger.warning(
                "Contact not found",
                contact_id=state.input.contact_id,
            )
            return {
                "skip_remaining": True,
                "skip_reason": "Contact not found",
                "trace": {
                    **state.trace.model_dump(),
                    "errors": state.trace.errors + ["Contact not found"],
                },
            }

        # Determine time range for analysis
        since_date = state.input.since_date
        if not since_date:
            # Default: last 90 days
            since_date = datetime.utcnow() - timedelta(days=90)

        until_date = state.input.until_date or datetime.utcnow()

        # Load interactions from all sources
        interactions = await _load_interactions(
            pool,
            contact_record["primary_email"],
            state.input.organization_id,
            since_date,
            until_date,
        )

        # Load commitments involving this contact
        commitments = await _load_commitments(
            pool,
            state.input.contact_id,
            state.input.organization_id,
        )

        # Load decisions involving this contact
        decisions = await _load_decisions(
            pool,
            state.input.contact_id,
            state.input.organization_id,
        )

        # Load network data for graph analytics
        mutual_contacts, shared_thread_contacts = await _load_network_data(
            pool,
            state.input.contact_id,
            state.input.organization_id,
        )

        # Build loaded data
        loaded_data = LoadedContactData(
            contact_id=state.input.contact_id,
            contact_email=contact_record["primary_email"],
            contact_name=contact_record.get("display_name"),
            contact_company=contact_record.get("company"),
            contact_title=contact_record.get("title"),
            interactions=interactions,
            commitments=commitments,
            decisions=decisions,
            mutual_contact_ids=mutual_contacts,
            shared_thread_contact_ids=shared_thread_contacts,
            first_interaction_at=contact_record.get("first_interaction_at"),
            last_interaction_at=contact_record.get("last_interaction_at"),
            total_interactions=len(interactions),
        )

        logger.info(
            "Contact data loaded",
            analysis_id=state.analysis_id,
            contact_id=state.input.contact_id,
            interaction_count=len(interactions),
            commitment_count=len(commitments),
            decision_count=len(decisions),
        )

        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
            duration_ms=int((time.time() - start_time) * 1000),
        )

        return {
            "loaded_data": loaded_data.model_dump(),
            "trace": {
                **state.trace.model_dump(),
                "current_node": "load_contact_data",
                "node_timings": {
                    **state.trace.node_timings,
                    "load_contact_data": node_timing,
                },
            },
        }

    except Exception as e:
        logger.error(
            "Failed to load contact data",
            analysis_id=state.analysis_id,
            contact_id=state.input.contact_id,
            error=str(e),
        )

        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
            duration_ms=int((time.time() - start_time) * 1000),
        )

        return {
            "skip_remaining": True,
            "skip_reason": f"Failed to load data: {str(e)}",
            "trace": {
                **state.trace.model_dump(),
                "current_node": "load_contact_data",
                "node_timings": {
                    **state.trace.node_timings,
                    "load_contact_data": node_timing,
                },
                "errors": state.trace.errors + [f"load_contact_data: {str(e)}"],
            },
        }


async def _get_contact(pool, contact_id: str, organization_id: str) -> dict | None:
    """Get contact record from database."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                id, primary_email, display_name, company, title,
                first_interaction_at, last_interaction_at,
                total_threads, total_messages,
                health_score, importance_score, engagement_score
            FROM contact
            WHERE id = $1 AND organization_id = $2
            """,
            contact_id,
            organization_id,
        )
        return dict(row) if row else None


async def _load_interactions(
    pool,
    contact_email: str,
    organization_id: str,
    since_date: datetime,
    until_date: datetime,
) -> list[InteractionRecord]:
    """Load all interactions with the contact."""
    interactions: list[InteractionRecord] = []

    async with pool.acquire() as conn:
        # Load email interactions
        email_rows = await conn.fetch(
            """
            SELECT
                m.id,
                m.sent_at as timestamp,
                m.sender_email,
                m.subject,
                m.body_text,
                m.is_from_user,
                c.id as thread_id,
                CASE
                    WHEN m.sender_email ILIKE $1 THEN 'inbound'
                    ELSE 'outbound'
                END as direction
            FROM message m
            JOIN conversation c ON m.conversation_id = c.id
            JOIN source_account sa ON c.source_account_id = sa.id
            WHERE sa.organization_id = $2
              AND sa.type = 'email'
              AND m.sent_at >= $3
              AND m.sent_at <= $4
              AND (
                  m.sender_email ILIKE $1
                  OR EXISTS (
                      SELECT 1 FROM jsonb_array_elements(m.recipients) r
                      WHERE r->>'email' ILIKE $1
                  )
              )
            ORDER BY m.sent_at DESC
            LIMIT 1000
            """,
            contact_email,
            organization_id,
            since_date,
            until_date,
        )

        for row in email_rows:
            word_count = len((row["body_text"] or "").split()) if row["body_text"] else 0
            interactions.append(
                InteractionRecord(
                    id=row["id"],
                    source_type="email",
                    timestamp=row["timestamp"],
                    direction=row["direction"],
                    subject=row["subject"],
                    snippet=(row["body_text"] or "")[:200],
                    word_count=word_count,
                    thread_id=row["thread_id"],
                    is_thread_starter=False,  # Would need more logic
                )
            )

        # Load Slack interactions
        slack_rows = await conn.fetch(
            """
            SELECT
                m.id,
                m.sent_at as timestamp,
                m.sender_email,
                m.body_text,
                c.id as thread_id,
                CASE
                    WHEN m.sender_email ILIKE $1 THEN 'inbound'
                    ELSE 'outbound'
                END as direction
            FROM message m
            JOIN conversation c ON m.conversation_id = c.id
            JOIN source_account sa ON c.source_account_id = sa.id
            WHERE sa.organization_id = $2
              AND sa.type = 'slack'
              AND m.sent_at >= $3
              AND m.sent_at <= $4
              AND (
                  m.sender_email ILIKE $1
                  OR m.body_text ILIKE '%' || $1 || '%'
              )
            ORDER BY m.sent_at DESC
            LIMIT 500
            """,
            contact_email,
            organization_id,
            since_date,
            until_date,
        )

        for row in slack_rows:
            word_count = len((row["body_text"] or "").split()) if row["body_text"] else 0
            interactions.append(
                InteractionRecord(
                    id=row["id"],
                    source_type="slack",
                    timestamp=row["timestamp"],
                    direction=row["direction"],
                    snippet=(row["body_text"] or "")[:200],
                    word_count=word_count,
                    thread_id=row["thread_id"],
                )
            )

        # Load calendar interactions
        calendar_rows = await conn.fetch(
            """
            SELECT
                c.id,
                c.last_message_at as timestamp,
                c.title as subject,
                c.snippet
            FROM conversation c
            JOIN source_account sa ON c.source_account_id = sa.id
            WHERE sa.organization_id = $1
              AND sa.type = 'calendar'
              AND c.last_message_at >= $2
              AND c.last_message_at <= $3
              AND (
                  c.title ILIKE '%' || $4 || '%'
                  OR c.snippet ILIKE '%' || $4 || '%'
              )
            ORDER BY c.last_message_at DESC
            LIMIT 100
            """,
            organization_id,
            since_date,
            until_date,
            contact_email.split("@")[0],  # Match by name part
        )

        for row in calendar_rows:
            interactions.append(
                InteractionRecord(
                    id=row["id"],
                    source_type="calendar",
                    timestamp=row["timestamp"],
                    direction="outbound",  # Calendar events are typically initiated
                    subject=row["subject"],
                    snippet=row["snippet"],
                )
            )

    # Sort by timestamp
    interactions.sort(key=lambda x: x.timestamp, reverse=True)

    return interactions


async def _load_commitments(
    pool,
    contact_id: str,
    organization_id: str,
) -> list[CommitmentRecord]:
    """Load commitments involving this contact."""
    commitments: list[CommitmentRecord] = []

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                id, title, direction, status, due_date, created_at,
                debtor_contact_id, creditor_contact_id
            FROM commitment
            WHERE organization_id = $1
              AND (debtor_contact_id = $2 OR creditor_contact_id = $2)
            ORDER BY created_at DESC
            LIMIT 100
            """,
            organization_id,
            contact_id,
        )

        for row in rows:
            direction = (
                "owed_by_contact"
                if row["debtor_contact_id"] == contact_id
                else "owed_to_contact"
            )
            commitments.append(
                CommitmentRecord(
                    id=row["id"],
                    title=row["title"],
                    direction=direction,
                    status=row["status"],
                    due_date=row["due_date"],
                    created_at=row["created_at"],
                )
            )

    return commitments


async def _load_decisions(
    pool,
    contact_id: str,
    organization_id: str,
) -> list[DecisionRecord]:
    """Load decisions involving this contact."""
    decisions: list[DecisionRecord] = []

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT
                id, title, decided_at, owner_contact_ids
            FROM decision
            WHERE organization_id = $1
              AND $2 = ANY(owner_contact_ids)
            ORDER BY decided_at DESC
            LIMIT 50
            """,
            organization_id,
            contact_id,
        )

        for row in rows:
            owner_ids = row["owner_contact_ids"] or []
            is_decision_maker = contact_id in owner_ids
            decisions.append(
                DecisionRecord(
                    id=row["id"],
                    title=row["title"],
                    is_decision_maker=is_decision_maker,
                    decided_at=row["decided_at"],
                )
            )

    return decisions


async def _load_network_data(
    pool,
    contact_id: str,
    organization_id: str,
) -> tuple[list[str], list[str]]:
    """Load network connection data for graph analytics."""
    mutual_contacts: list[str] = []
    shared_thread_contacts: list[str] = []

    async with pool.acquire() as conn:
        # Get contacts with direct relationship
        relationship_rows = await conn.fetch(
            """
            SELECT
                CASE
                    WHEN contact_a_id = $1 THEN contact_b_id
                    ELSE contact_a_id
                END as other_contact_id
            FROM contact_relationship
            WHERE organization_id = $2
              AND (contact_a_id = $1 OR contact_b_id = $1)
            ORDER BY strength DESC
            LIMIT 50
            """,
            contact_id,
            organization_id,
        )

        mutual_contacts = [row["other_contact_id"] for row in relationship_rows]

        # Get contacts who appear in same threads
        # This is a simplified query - in production would be more sophisticated
        shared_rows = await conn.fetch(
            """
            WITH contact_threads AS (
                SELECT DISTINCT c.id as thread_id
                FROM conversation c
                JOIN message m ON m.conversation_id = c.id
                JOIN source_account sa ON c.source_account_id = sa.id
                JOIN contact ct ON ct.id = $1
                WHERE sa.organization_id = $2
                  AND (
                      m.sender_email ILIKE ct.primary_email
                      OR EXISTS (
                          SELECT 1 FROM jsonb_array_elements(m.recipients) r
                          WHERE r->>'email' ILIKE ct.primary_email
                      )
                  )
                LIMIT 100
            )
            SELECT DISTINCT ct2.id
            FROM contact_threads t
            JOIN message m ON m.conversation_id = t.thread_id
            JOIN contact ct2 ON ct2.primary_email ILIKE m.sender_email
            WHERE ct2.id != $1
              AND ct2.organization_id = $2
            LIMIT 50
            """,
            contact_id,
            organization_id,
        )

        shared_thread_contacts = [row["id"] for row in shared_rows]

    return mutual_contacts, shared_thread_contacts
