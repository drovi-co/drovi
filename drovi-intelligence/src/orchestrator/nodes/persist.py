"""
Persist Node

Persists extracted intelligence to PostgreSQL and FalkorDB.
"""

import json
import time
from datetime import datetime, timezone
from uuid import uuid4

import structlog
from sqlalchemy import text

from ..state import (
    IntelligenceState,
    Output,
    NodeTiming,
)

logger = structlog.get_logger()

# Minimum confidence thresholds for persisting intelligence
MIN_CONFIDENCE_COMMITMENT = 0.70
MIN_CONFIDENCE_DECISION = 0.70
MIN_CONFIDENCE_CLAIM = 0.50


def serialize_for_graph(value):
    """Serialize values for FalkorDB graph storage.

    FalkorDB doesn't support list or dict types as node properties,
    so we serialize them as JSON strings.
    """
    if value is None:
        return ""
    if isinstance(value, (list, dict)):
        return json.dumps(value)
    return value


def utc_now():
    """Get current UTC time as a naive datetime for PostgreSQL.

    PostgreSQL TIMESTAMP WITHOUT TIME ZONE columns expect naive datetimes.
    This function returns the current UTC time without timezone info.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_naive_utc(dt):
    """Convert a datetime to naive UTC for PostgreSQL.

    If the datetime is timezone-aware, convert to UTC and strip tzinfo.
    If already naive, return as-is (assuming it's already in UTC).
    """
    if dt is None:
        return None
    if dt.tzinfo is not None:
        # Convert to UTC and strip timezone info
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


async def create_timeline_event(
    session,
    uio_id: str,
    event_type: str,
    event_description: str,
    source_type: str | None = None,
    source_id: str | None = None,
    source_name: str | None = None,
    quoted_text: str | None = None,
    previous_value: dict | None = None,
    new_value: dict | None = None,
    confidence: float | None = None,
    triggered_by: str = "system",
) -> None:
    """
    Create a timeline event for a UIO.

    This provides the activity history log to ensure we never lose data
    during deduplication or updates.
    """
    event_id = str(uuid4())
    now = utc_now()

    await session.execute(
        text("""
            INSERT INTO unified_object_timeline (
                id, unified_object_id,
                event_type, event_description,
                previous_value, new_value,
                source_type, source_id, source_name,
                quoted_text, triggered_by, confidence,
                event_at, created_at
            ) VALUES (
                :id, :uio_id,
                :event_type, :event_description,
                :previous_value, :new_value,
                :source_type, :source_id, :source_name,
                :quoted_text, :triggered_by, :confidence,
                :event_at, :created_at
            )
        """),
        {
            "id": event_id,
            "uio_id": uio_id,
            "event_type": event_type,
            "event_description": event_description,
            "previous_value": json.dumps(previous_value) if previous_value else None,
            "new_value": json.dumps(new_value) if new_value else None,
            "source_type": source_type,
            "source_id": source_id,
            "source_name": source_name,
            "quoted_text": quoted_text[:1000] if quoted_text else None,  # Limit length
            "triggered_by": triggered_by,
            "confidence": confidence,
            "event_at": now,
            "created_at": now,
        },
    )


async def find_existing_uio(session, org_id: str, uio_type: str, title: str) -> str | None:
    """
    Check if a UIO with the same title already exists in PostgreSQL.

    Returns the existing UIO ID if found, None otherwise.
    Uses case-insensitive title matching.
    """
    if not title:
        return None

    result = await session.execute(
        text("""
            SELECT id FROM unified_intelligence_object
            WHERE organization_id = :org_id
            AND type = :uio_type
            AND LOWER(TRIM(canonical_title)) = LOWER(TRIM(:title))
            AND status = 'active'
            LIMIT 1
        """),
        {
            "org_id": org_id,
            "uio_type": uio_type,
            "title": title,
        },
    )
    row = result.fetchone()
    return row[0] if row else None


async def persist_node(state: IntelligenceState) -> dict:
    """
    Persist extracted intelligence to databases.

    This node:
    1. Creates or updates UIOs in PostgreSQL
    2. Creates graph nodes and relationships in FalkorDB
    3. Generates embeddings for vector search
    4. Handles merges based on deduplication results
    5. Records all created/updated entities

    Returns:
        State update with persist results
    """
    start_time = time.time()

    logger.info(
        "Persisting intelligence",
        analysis_id=state.analysis_id,
        commitment_count=len(state.extracted.commitments),
        decision_count=len(state.extracted.decisions),
        risk_count=len(state.extracted.risks),
    )

    # Update trace
    state.trace.current_node = "persist"
    state.trace.nodes.append("persist")

    uios_created: list[dict] = []
    uios_merged: list[dict] = []
    tasks_created: list[dict] = []
    claims_created: list[dict] = []
    contacts_created: list[dict] = []
    low_confidence_skipped: list[dict] = []

    # Filter out low-confidence items
    commitments_to_persist = []
    for commitment in state.extracted.commitments:
        if commitment.confidence >= MIN_CONFIDENCE_COMMITMENT:
            commitments_to_persist.append(commitment)
        else:
            low_confidence_skipped.append({
                "type": "commitment",
                "title": commitment.title,
                "confidence": commitment.confidence,
            })
            logger.debug(
                "Skipping low-confidence commitment",
                title=commitment.title,
                confidence=commitment.confidence,
                threshold=MIN_CONFIDENCE_COMMITMENT,
            )

    decisions_to_persist = []
    for decision in state.extracted.decisions:
        if decision.confidence >= MIN_CONFIDENCE_DECISION:
            decisions_to_persist.append(decision)
        else:
            low_confidence_skipped.append({
                "type": "decision",
                "title": decision.title,
                "confidence": decision.confidence,
            })
            logger.debug(
                "Skipping low-confidence decision",
                title=decision.title,
                confidence=decision.confidence,
                threshold=MIN_CONFIDENCE_DECISION,
            )

    claims_to_persist = []
    for claim in state.extracted.claims:
        if claim.confidence >= MIN_CONFIDENCE_CLAIM:
            claims_to_persist.append(claim)
        else:
            low_confidence_skipped.append({
                "type": "claim",
                "text": claim.content[:50] if claim.content else "",
                "confidence": claim.confidence,
            })

    logger.info(
        "Confidence filtering",
        commitments_original=len(state.extracted.commitments),
        commitments_kept=len(commitments_to_persist),
        decisions_original=len(state.extracted.decisions),
        decisions_kept=len(decisions_to_persist),
        claims_original=len(state.extracted.claims),
        claims_kept=len(claims_to_persist),
        total_skipped=len(low_confidence_skipped),
    )

    # =========================================================================
    # INTRA-BATCH DEDUPLICATION
    # Deduplicate items within the same extraction batch (same title = same item)
    # =========================================================================

    def dedupe_by_title(items: list, item_type: str) -> list:
        """Deduplicate items by title, keeping highest confidence version."""
        seen_titles: dict[str, int] = {}  # title -> index in result list
        result = []
        duplicates_merged = 0

        for item in items:
            title = (item.title or "").lower().strip()
            if not title:
                result.append(item)
                continue

            if title in seen_titles:
                # Found duplicate - keep the one with higher confidence
                existing_idx = seen_titles[title]
                existing_item = result[existing_idx]
                if item.confidence > existing_item.confidence:
                    result[existing_idx] = item  # Replace with higher confidence
                duplicates_merged += 1
            else:
                seen_titles[title] = len(result)
                result.append(item)

        if duplicates_merged > 0:
            logger.info(
                f"Intra-batch deduplication: merged {duplicates_merged} duplicate {item_type}s",
                original_count=len(items),
                deduplicated_count=len(result),
            )
        return result

    # Deduplicate commitments within batch
    commitments_before_dedup = len(commitments_to_persist)
    commitments_to_persist = dedupe_by_title(commitments_to_persist, "commitment")

    # Deduplicate decisions within batch
    decisions_before_dedup = len(decisions_to_persist)
    decisions_to_persist = dedupe_by_title(decisions_to_persist, "decision")

    logger.info(
        "Intra-batch deduplication complete",
        commitments_before=commitments_before_dedup,
        commitments_after=len(commitments_to_persist),
        decisions_before=decisions_before_dedup,
        decisions_after=len(decisions_to_persist),
    )

    # Build merge lookup
    merge_lookup = {
        mc.new_item_id: mc
        for mc in state.deduplication.merge_candidates
        if mc.should_merge
    }

    try:
        # Import clients and initialize database
        from src.graph.client import get_graph_client
        from src.db.client import get_db_session, init_db

        # Initialize database connection pool if not already done
        await init_db()

        graph = await get_graph_client()

        # Persist commitments (filtered by confidence)
        async with get_db_session() as session:
            for commitment in commitments_to_persist:
                # Check if should merge (from vector search deduplication)
                merge_candidate = merge_lookup.get(commitment.id)

                if merge_candidate:
                    # Update existing UIO
                    uios_merged.append({
                        "sourceId": commitment.id,
                        "targetId": merge_candidate.existing_uio_id,
                    })

                    logger.debug(
                        "Merging commitment (vector match)",
                        new_id=commitment.id,
                        existing_id=merge_candidate.existing_uio_id,
                    )
                    continue

                # PostgreSQL fallback: check for existing UIO with same title
                existing_uio_id = await find_existing_uio(
                    session,
                    state.input.organization_id,
                    "commitment",
                    commitment.title,
                )

                if existing_uio_id:
                    # Found existing UIO - add as additional source, don't create duplicate
                    uios_merged.append({
                        "sourceId": commitment.id,
                        "targetId": existing_uio_id,
                    })
                    logger.info(
                        "Skipping duplicate commitment (PostgreSQL match)",
                        title=commitment.title,
                        existing_uio_id=existing_uio_id,
                    )

                    # Add this conversation as an additional source for the existing UIO
                    now = utc_now()
                    source_id = str(uuid4())
                    await session.execute(
                        text("""
                            INSERT INTO unified_object_source (
                                id, unified_object_id, source_type,
                                source_account_id, role,
                                conversation_id, quoted_text, extracted_title,
                                confidence, added_at, source_timestamp,
                                detection_method, created_at
                            ) VALUES (
                                :id, :uio_id, :source_type,
                                :source_account_id, 'confirmation',
                                :conversation_id, :quoted_text, :title,
                                :confidence, :now, :source_timestamp,
                                'llm_extraction', :now
                            )
                        """),
                        {
                            "id": source_id,
                            "uio_id": existing_uio_id,
                            "source_type": state.input.source_type or "email",
                            "source_account_id": state.input.source_account_id,
                            "conversation_id": state.input.conversation_id,
                            "quoted_text": getattr(commitment, "quoted_text", None),
                            "title": commitment.title,
                            "confidence": commitment.confidence,
                            "now": now,
                            "source_timestamp": now,
                        },
                    )

                    # Create timeline event for source confirmation
                    await create_timeline_event(
                        session=session,
                        uio_id=existing_uio_id,
                        event_type="source_added",
                        event_description=f"Commitment confirmed from {state.input.source_type or 'email'}: {commitment.title}",
                        source_type=state.input.source_type or "email",
                        source_id=state.input.conversation_id,
                        quoted_text=getattr(commitment, "quoted_text", None),
                        new_value={
                            "title": commitment.title,
                            "confidence": commitment.confidence,
                            "source": state.input.source_type or "email",
                        },
                        confidence=commitment.confidence,
                        triggered_by="system",
                    )

                    await session.commit()
                    continue

                # Create new UIO
                uio_id = str(uuid4())
                now = utc_now()

                uios_created.append({
                    "id": uio_id,
                    "type": "commitment",
                })

                # Create UIO in PostgreSQL (unified_intelligence_object table)
                await session.execute(
                    text("""
                        INSERT INTO unified_intelligence_object (
                            id, organization_id, type, status,
                            canonical_title, canonical_description,
                            due_date, due_date_confidence,
                            overall_confidence, first_seen_at, last_updated_at,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, 'commitment', 'active',
                            :title, :description,
                            :due_date, :due_date_confidence,
                            :confidence, :now, :now,
                            :now, :now
                        )
                    """),
                    {
                        "id": uio_id,
                        "org_id": state.input.organization_id,
                        "title": commitment.title,
                        "description": commitment.description or "",
                        "due_date": to_naive_utc(commitment.due_date),
                        "due_date_confidence": commitment.confidence if commitment.due_date else None,
                        "confidence": commitment.confidence,
                        "now": now,
                    },
                )

                # Also create in commitment table (for frontend compatibility)
                commitment_id = str(uuid4())
                await session.execute(
                    text("""
                        INSERT INTO commitment (
                            id, organization_id, unified_object_id,
                            direction, title, description,
                            due_date, due_date_confidence, due_date_original_text,
                            status, priority, confidence,
                            source_account_id, source_conversation_id,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, :uio_id,
                            :direction, :title, :description,
                            :due_date, :due_date_confidence, :due_date_text,
                            'pending', :priority, :confidence,
                            :source_account_id, :conversation_id,
                            :now, :now
                        )
                    """),
                    {
                        "id": commitment_id,
                        "org_id": state.input.organization_id,
                        "uio_id": uio_id,
                        "direction": commitment.direction,
                        "title": commitment.title,
                        "description": commitment.description or "",
                        "due_date": to_naive_utc(commitment.due_date),
                        "due_date_confidence": commitment.confidence if commitment.due_date else None,
                        "due_date_text": commitment.due_date_text,
                        "priority": commitment.priority,
                        "confidence": commitment.confidence,
                        "source_account_id": state.input.source_account_id,
                        "conversation_id": state.input.conversation_id,
                        "now": now,
                    },
                )

                # Create UIO extension record (uio_commitment_details)
                commitment_details_id = str(uuid4())
                extraction_context = {
                    "reasoning": getattr(commitment, "reasoning", None),
                    "quotedText": getattr(commitment, "quoted_text", None),
                    "commitmentType": getattr(commitment, "commitment_type", None),
                    "modelUsed": "sonnet",
                }
                await session.execute(
                    text("""
                        INSERT INTO uio_commitment_details (
                            id, uio_id, direction,
                            due_date_source, due_date_original_text,
                            priority, status,
                            is_conditional, condition,
                            extraction_context,
                            created_at, updated_at
                        ) VALUES (
                            :id, :uio_id, :direction,
                            :due_date_source, :due_date_text,
                            :priority, 'pending',
                            :is_conditional, :condition,
                            :extraction_context,
                            :now, :now
                        )
                    """),
                    {
                        "id": commitment_details_id,
                        "uio_id": uio_id,
                        "direction": commitment.direction or "owed_to_me",
                        "due_date_source": "explicit" if commitment.due_date else "inferred",
                        "due_date_text": commitment.due_date_text,
                        "priority": commitment.priority or "medium",
                        "is_conditional": getattr(commitment, "is_conditional", False),
                        "condition": getattr(commitment, "condition", None),
                        "extraction_context": json.dumps(extraction_context),
                        "now": now,
                    },
                )

                # Link UIO to source conversation
                source_id = str(uuid4())
                await session.execute(
                    text("""
                        INSERT INTO unified_object_source (
                            id, unified_object_id, source_type,
                            source_account_id, role,
                            conversation_id, message_id,
                            quoted_text, extracted_title,
                            extracted_due_date,
                            confidence, added_at, source_timestamp,
                            detection_method,
                            created_at
                        ) VALUES (
                            :id, :uio_id, :source_type,
                            :source_account_id, 'origin',
                            :conversation_id, :message_id,
                            :quoted_text, :title,
                            :due_date,
                            :confidence, :now, :source_timestamp,
                            'llm_extraction',
                            :now
                        )
                    """),
                    {
                        "id": source_id,
                        "uio_id": uio_id,
                        "source_type": state.input.source_type or "email",
                        "source_account_id": state.input.source_account_id,
                        "conversation_id": state.input.conversation_id,
                        "message_id": None,  # Could be extracted from message data
                        "quoted_text": getattr(commitment, "quoted_text", None),
                        "title": commitment.title,
                        "due_date": to_naive_utc(commitment.due_date),
                        "confidence": commitment.confidence,
                        "now": now,
                        "source_timestamp": now,
                    },
                )

                # Create timeline event for UIO creation
                await create_timeline_event(
                    session=session,
                    uio_id=uio_id,
                    event_type="created",
                    event_description=f"Commitment extracted from {state.input.source_type or 'email'}: {commitment.title}",
                    source_type=state.input.source_type or "email",
                    source_id=state.input.conversation_id,
                    quoted_text=getattr(commitment, "quoted_text", None),
                    new_value={
                        "title": commitment.title,
                        "description": commitment.description,
                        "direction": commitment.direction,
                        "priority": commitment.priority,
                        "dueDate": commitment.due_date.isoformat() if commitment.due_date else None,
                        "confidence": commitment.confidence,
                    },
                    confidence=commitment.confidence,
                    triggered_by="system",
                )

                await session.commit()

                # Create graph node
                await graph.query(
                    """
                    CREATE (c:Commitment {
                        id: $id,
                        organizationId: $orgId,
                        title: $title,
                        description: $description,
                        direction: $direction,
                        priority: $priority,
                        status: 'active',
                        createdAt: $createdAt
                    })
                    RETURN c
                    """,
                    {
                        "id": uio_id,
                        "orgId": state.input.organization_id,
                        "title": serialize_for_graph(commitment.title),
                        "description": serialize_for_graph(commitment.description),
                        "direction": serialize_for_graph(commitment.direction),
                        "priority": serialize_for_graph(commitment.priority),
                        "createdAt": now.isoformat(),
                    },
                )

                # Create task if commitment has a due date
                if commitment.due_date:
                    task_id = str(uuid4())
                    tasks_created.append({
                        "id": task_id,
                        "uioId": uio_id,
                    })

                logger.debug(
                    "Created commitment",
                        uio_id=uio_id,
                        title=commitment.title,
                    )

        # Persist decisions (filtered by confidence)
        async with get_db_session() as session:
            for decision in decisions_to_persist:
                merge_candidate = merge_lookup.get(decision.id)

                if merge_candidate:
                    uios_merged.append({
                        "sourceId": decision.id,
                        "targetId": merge_candidate.existing_uio_id,
                    })
                    logger.debug(
                        "Merging decision (vector match)",
                        new_id=decision.id,
                        existing_id=merge_candidate.existing_uio_id,
                    )
                    continue

                # PostgreSQL fallback: check for existing UIO with same title
                existing_uio_id = await find_existing_uio(
                    session,
                    state.input.organization_id,
                    "decision",
                    decision.title,
                )

                if existing_uio_id:
                    # Found existing UIO - add as additional source
                    uios_merged.append({
                        "sourceId": decision.id,
                        "targetId": existing_uio_id,
                    })
                    logger.info(
                        "Skipping duplicate decision (PostgreSQL match)",
                        title=decision.title,
                        existing_uio_id=existing_uio_id,
                    )

                    # Add this conversation as an additional source
                    now = utc_now()
                    source_id = str(uuid4())
                    await session.execute(
                        text("""
                            INSERT INTO unified_object_source (
                                id, unified_object_id, source_type,
                                source_account_id, role,
                                conversation_id, quoted_text, extracted_title,
                                confidence, added_at, source_timestamp,
                                detection_method, created_at
                            ) VALUES (
                                :id, :uio_id, :source_type,
                                :source_account_id, 'confirmation',
                                :conversation_id, :quoted_text, :title,
                                :confidence, :now, :source_timestamp,
                                'llm_extraction', :now
                            )
                        """),
                        {
                            "id": source_id,
                            "uio_id": existing_uio_id,
                            "source_type": state.input.source_type or "email",
                            "source_account_id": state.input.source_account_id,
                            "conversation_id": state.input.conversation_id,
                            "quoted_text": getattr(decision, "quoted_text", None),
                            "title": decision.title,
                            "confidence": decision.confidence,
                            "now": now,
                            "source_timestamp": now,
                        },
                    )

                    # Create timeline event for source confirmation
                    await create_timeline_event(
                        session=session,
                        uio_id=existing_uio_id,
                        event_type="source_added",
                        event_description=f"Decision confirmed from {state.input.source_type or 'email'}: {decision.title}",
                        source_type=state.input.source_type or "email",
                        source_id=state.input.conversation_id,
                        quoted_text=getattr(decision, "quoted_text", None),
                        new_value={
                            "title": decision.title,
                            "confidence": decision.confidence,
                            "source": state.input.source_type or "email",
                        },
                        confidence=decision.confidence,
                        triggered_by="system",
                    )

                    await session.commit()
                    continue

                uio_id = str(uuid4())
                now = utc_now()

                uios_created.append({
                    "id": uio_id,
                    "type": "decision",
                })

                # Create UIO in PostgreSQL
                await session.execute(
                    text("""
                        INSERT INTO unified_intelligence_object (
                            id, organization_id, type, status,
                            canonical_title, canonical_description,
                            overall_confidence, first_seen_at, last_updated_at,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, 'decision', 'active',
                            :title, :description,
                            :confidence, :now, :now,
                            :now, :now
                        )
                    """),
                    {
                        "id": uio_id,
                        "org_id": state.input.organization_id,
                        "title": decision.title,
                        "description": f"{decision.statement}\n\nRationale: {decision.rationale or 'N/A'}",
                        "confidence": decision.confidence,
                        "now": now,
                    },
                )

                # Also create in decision table (for frontend compatibility)
                decision_id = str(uuid4())
                await session.execute(
                    text("""
                        INSERT INTO decision (
                            id, organization_id, unified_object_id,
                            title, statement, rationale,
                            decided_at, confidence,
                            source_account_id, source_conversation_id,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, :uio_id,
                            :title, :statement, :rationale,
                            :now, :confidence,
                            :source_account_id, :conversation_id,
                            :now, :now
                        )
                    """),
                    {
                        "id": decision_id,
                        "org_id": state.input.organization_id,
                        "uio_id": uio_id,
                        "title": decision.title,
                        "statement": decision.statement,
                        "rationale": decision.rationale or "",
                        "confidence": decision.confidence,
                        "source_account_id": state.input.source_account_id,
                        "conversation_id": state.input.conversation_id,
                        "now": now,
                    },
                )

                # Create UIO extension record (uio_decision_details)
                decision_details_id = str(uuid4())
                extraction_context = {
                    "reasoning": getattr(decision, "reasoning", None),
                    "quotedText": getattr(decision, "quoted_text", None),
                    "modelUsed": "sonnet",
                }
                await session.execute(
                    text("""
                        INSERT INTO uio_decision_details (
                            id, uio_id, statement, rationale,
                            alternatives, stakeholder_contact_ids, impact_areas,
                            status, decided_at,
                            extraction_context,
                            created_at, updated_at
                        ) VALUES (
                            :id, :uio_id, :statement, :rationale,
                            :alternatives, :stakeholders, :impact_areas,
                            'made', :decided_at,
                            :extraction_context,
                            :now, :now
                        )
                    """),
                    {
                        "id": decision_details_id,
                        "uio_id": uio_id,
                        "statement": decision.statement,
                        "rationale": decision.rationale or "",
                        "alternatives": json.dumps(getattr(decision, "alternatives", []) or []),
                        "stakeholders": getattr(decision, "stakeholders", []) or [],
                        "impact_areas": getattr(decision, "implications", []) or [],
                        "decided_at": now,
                        "extraction_context": json.dumps(extraction_context),
                        "now": now,
                    },
                )

                # Link UIO to source conversation
                source_id = str(uuid4())
                await session.execute(
                    text("""
                        INSERT INTO unified_object_source (
                            id, unified_object_id, source_type,
                            source_account_id, role,
                            conversation_id, message_id,
                            quoted_text, extracted_title,
                            confidence, added_at, source_timestamp,
                            detection_method,
                            created_at
                        ) VALUES (
                            :id, :uio_id, :source_type,
                            :source_account_id, 'origin',
                            :conversation_id, :message_id,
                            :quoted_text, :title,
                            :confidence, :now, :source_timestamp,
                            'llm_extraction',
                            :now
                        )
                    """),
                    {
                        "id": source_id,
                        "uio_id": uio_id,
                        "source_type": state.input.source_type or "email",
                        "source_account_id": state.input.source_account_id,
                        "conversation_id": state.input.conversation_id,
                        "message_id": None,
                        "quoted_text": getattr(decision, "quoted_text", None),
                        "title": decision.title,
                        "confidence": decision.confidence,
                        "now": now,
                        "source_timestamp": now,
                    },
                )

                # Create timeline event for UIO creation
                await create_timeline_event(
                    session=session,
                    uio_id=uio_id,
                    event_type="created",
                    event_description=f"Decision extracted from {state.input.source_type or 'email'}: {decision.title}",
                    source_type=state.input.source_type or "email",
                    source_id=state.input.conversation_id,
                    quoted_text=getattr(decision, "quoted_text", None),
                    new_value={
                        "title": decision.title,
                        "statement": decision.statement,
                        "rationale": decision.rationale,
                        "confidence": decision.confidence,
                    },
                    confidence=decision.confidence,
                    triggered_by="system",
                )

                await session.commit()

                # Create graph node
                await graph.query(
                    """
                    CREATE (d:Decision {
                        id: $id,
                        organizationId: $orgId,
                        title: $title,
                        statement: $statement,
                        rationale: $rationale,
                        status: $status,
                        stakeholders: $stakeholders,
                        dependencies: $dependencies,
                        implications: $implications,
                        createdAt: $createdAt
                    })
                    RETURN d
                    """,
                    {
                        "id": uio_id,
                        "orgId": state.input.organization_id,
                        "title": serialize_for_graph(decision.title),
                        "statement": serialize_for_graph(decision.statement),
                        "rationale": serialize_for_graph(decision.rationale),
                        "status": serialize_for_graph(decision.status),
                        "stakeholders": serialize_for_graph(decision.stakeholders),
                        "dependencies": serialize_for_graph(decision.dependencies),
                        "implications": serialize_for_graph(decision.implications),
                        "createdAt": now.isoformat(),
                    },
                )

                logger.debug(
                    "Created decision",
                    uio_id=uio_id,
                    title=decision.title,
                )

        # Persist risks to PostgreSQL and graph
        # Apply intra-batch deduplication for risks
        risks_to_persist = dedupe_by_title(state.extracted.risks, "risk")

        async with get_db_session() as session:
            for risk in risks_to_persist:
                # Check for existing risk UIO with same title (PostgreSQL fallback)
                existing_uio_id = await find_existing_uio(
                    session,
                    state.input.organization_id,
                    "risk",
                    risk.title,
                )

                if existing_uio_id:
                    # Found existing risk - add as confirmation source
                    now = utc_now()
                    source_id = str(uuid4())
                    await session.execute(
                        text("""
                            INSERT INTO unified_object_source (
                                id, unified_object_id, source_type,
                                source_account_id, role,
                                conversation_id, quoted_text, extracted_title,
                                confidence, added_at, source_timestamp,
                                detection_method, created_at
                            ) VALUES (
                                :id, :uio_id, :source_type,
                                :source_account_id, 'confirmation',
                                :conversation_id, :quoted_text, :title,
                                :confidence, :now, :source_timestamp,
                                'llm_extraction', :now
                            )
                        """),
                        {
                            "id": source_id,
                            "uio_id": existing_uio_id,
                            "source_type": state.input.source_type or "email",
                            "source_account_id": state.input.source_account_id,
                            "conversation_id": state.input.conversation_id,
                            "quoted_text": getattr(risk, "quoted_text", None),
                            "title": risk.title,
                            "confidence": risk.confidence,
                            "now": now,
                            "source_timestamp": now,
                        },
                    )

                    # Create timeline event for confirmation
                    await create_timeline_event(
                        session=session,
                        uio_id=existing_uio_id,
                        event_type="source_added",
                        event_description=f"Risk confirmed from {state.input.source_type or 'email'}: {risk.title}",
                        source_type=state.input.source_type or "email",
                        source_id=state.input.conversation_id,
                        quoted_text=getattr(risk, "quoted_text", None),
                        new_value={
                            "title": risk.title,
                            "severity": risk.severity,
                            "source": state.input.source_type or "email",
                        },
                        confidence=risk.confidence,
                        triggered_by="system",
                    )

                    await session.commit()
                    logger.info(
                        "Skipping duplicate risk (PostgreSQL match)",
                        title=risk.title,
                        existing_uio_id=existing_uio_id,
                    )
                    continue

                risk_id = str(uuid4())
                uio_id = str(uuid4())
                now = utc_now()

                try:
                    # Create UIO for risk
                    await session.execute(
                        text("""
                            INSERT INTO unified_intelligence_object (
                                id, organization_id, type, status,
                                canonical_title, canonical_description,
                                overall_confidence, first_seen_at, last_updated_at,
                                created_at, updated_at
                            ) VALUES (
                                :id, :org_id, 'risk', 'active',
                                :title, :description,
                                :confidence, :now, :now,
                                :now, :now
                            )
                        """),
                        {
                            "id": uio_id,
                            "org_id": state.input.organization_id,
                            "title": risk.title,
                            "description": risk.description or "",
                            "confidence": risk.confidence,
                            "now": now,
                        },
                    )

                    # Create UIO extension record (uio_risk_details)
                    risk_details_id = str(uuid4())
                    # Map risk type to enum value
                    risk_type_map = {
                        "deadline": "deadline_risk",
                        "deadline_risk": "deadline_risk",
                        "commitment_conflict": "commitment_conflict",
                        "unclear_ownership": "unclear_ownership",
                        "missing_info": "missing_information",
                        "missing_information": "missing_information",
                        "escalation": "escalation_needed",
                        "escalation_needed": "escalation_needed",
                        "policy": "policy_violation",
                        "policy_violation": "policy_violation",
                        "financial": "financial_risk",
                        "financial_risk": "financial_risk",
                        "relationship": "relationship_risk",
                        "relationship_risk": "relationship_risk",
                        "sensitive": "sensitive_data",
                        "sensitive_data": "sensitive_data",
                        "contradiction": "contradiction",
                        "fraud": "fraud_signal",
                        "fraud_signal": "fraud_signal",
                        "other": "other",
                    }
                    risk_type_value = risk_type_map.get(risk.type, "other")

                    # Map severity to valid enum values
                    severity_map = {
                        "low": "low",
                        "medium": "medium",
                        "high": "high",
                        "critical": "critical",
                    }
                    risk_severity = severity_map.get(
                        risk.severity.lower() if risk.severity else "medium",
                        "medium"
                    )

                    findings = {
                        "description": risk.description,
                        "evidence": [risk.quoted_text] if risk.quoted_text else [],
                        "potentialImpact": risk.reasoning,
                    }
                    extraction_context = {
                        "reasoning": risk.reasoning,
                        "quotedText": risk.quoted_text,
                        "modelUsed": "sonnet",
                    }
                    await session.execute(
                        text("""
                            INSERT INTO uio_risk_details (
                                id, uio_id, risk_type, severity,
                                suggested_action, findings, extraction_context,
                                created_at, updated_at
                            ) VALUES (
                                :id, :uio_id, :risk_type, :severity,
                                :suggested_action, :findings, :extraction_context,
                                :now, :now
                            )
                        """),
                        {
                            "id": risk_details_id,
                            "uio_id": uio_id,
                            "risk_type": risk_type_value,
                            "severity": risk_severity,
                            "suggested_action": risk.suggested_action,
                            "findings": json.dumps(findings),
                            "extraction_context": json.dumps(extraction_context),
                            "now": now,
                        },
                    )

                    # Link risk UIO to source conversation
                    risk_source_id = str(uuid4())
                    await session.execute(
                        text("""
                            INSERT INTO unified_object_source (
                                id, unified_object_id, source_type,
                                source_account_id, role,
                                conversation_id, quoted_text, extracted_title,
                                confidence, added_at, source_timestamp,
                                detection_method, created_at
                            ) VALUES (
                                :id, :uio_id, :source_type,
                                :source_account_id, 'origin',
                                :conversation_id, :quoted_text, :title,
                                :confidence, :now, :source_timestamp,
                                'llm_extraction', :now
                            )
                        """),
                        {
                            "id": risk_source_id,
                            "uio_id": uio_id,
                            "source_type": state.input.source_type or "email",
                            "source_account_id": state.input.source_account_id,
                            "conversation_id": state.input.conversation_id,
                            "quoted_text": risk.quoted_text,
                            "title": risk.title,
                            "confidence": risk.confidence,
                            "now": now,
                            "source_timestamp": now,
                        },
                    )

                    # Create timeline event for risk creation
                    await create_timeline_event(
                        session=session,
                        uio_id=uio_id,
                        event_type="created",
                        event_description=f"Risk detected from {state.input.source_type or 'email'}: {risk.title}",
                        source_type=state.input.source_type or "email",
                        source_id=state.input.conversation_id,
                        quoted_text=risk.quoted_text,
                        new_value={
                            "title": risk.title,
                            "type": risk.type,
                            "severity": risk.severity,
                            "confidence": risk.confidence,
                        },
                        confidence=risk.confidence,
                        triggered_by="system",
                    )

                    await session.commit()

                    # Also create graph node
                    await graph.query(
                        """
                        CREATE (r:Risk {
                            id: $id,
                            organizationId: $orgId,
                            type: $type,
                            title: $title,
                            description: $description,
                            severity: $severity,
                            suggestedAction: $action,
                            relatedTo: $relatedTo,
                            quotedText: $quotedText,
                            confidence: $confidence,
                            reasoning: $reasoning,
                            createdAt: $createdAt
                        })
                        RETURN r
                        """,
                        {
                            "id": uio_id,
                            "orgId": state.input.organization_id,
                            "type": serialize_for_graph(risk.type),
                            "title": serialize_for_graph(risk.title),
                            "description": serialize_for_graph(risk.description),
                            "severity": serialize_for_graph(risk.severity),
                            "action": serialize_for_graph(risk.suggested_action),
                            "relatedTo": serialize_for_graph(risk.related_to),
                            "quotedText": serialize_for_graph(risk.quoted_text),
                            "confidence": risk.confidence,
                            "reasoning": serialize_for_graph(risk.reasoning),
                            "createdAt": now.isoformat(),
                        },
                    )

                    uios_created.append({
                        "id": uio_id,
                        "type": "risk",
                    })

                    logger.debug(
                        "Created risk",
                        uio_id=uio_id,
                        title=risk.title,
                        severity=risk.severity,
                    )
                except Exception as e:
                    logger.error(
                        "Failed to persist risk",
                        risk_title=risk.title,
                        error=str(e),
                    )
                    state.trace.errors.append(f"persist_risk: {str(e)}")

        # Persist tasks to PostgreSQL (with deduplication against commitments, decisions, and existing tasks)
        # Apply intra-batch deduplication for tasks
        tasks_to_persist = dedupe_by_title(state.extracted.tasks, "task")

        # Build set of commitment and decision titles for deduplication
        commitment_titles = {c.title.lower().strip() for c in state.extracted.commitments if c.title}
        decision_titles = {d.title.lower().strip() for d in state.extracted.decisions if d.title}
        decision_statements = {d.statement.lower().strip() for d in state.extracted.decisions if d.statement}

        def is_duplicate_task(task_title: str) -> bool:
            """Check if a task duplicates a commitment or decision."""
            if not task_title:
                return False
            title_lower = task_title.lower().strip()

            # Check exact match with commitments
            if title_lower in commitment_titles:
                return True

            # Check exact match with decisions
            if title_lower in decision_titles or title_lower in decision_statements:
                return True

            # Check fuzzy match - if task title is contained in commitment/decision or vice versa
            for ct in commitment_titles:
                if title_lower in ct or ct in title_lower:
                    # Only consider it a duplicate if overlap is significant (>70%)
                    overlap = len(set(title_lower.split()) & set(ct.split()))
                    max_words = max(len(title_lower.split()), len(ct.split()))
                    if max_words > 0 and overlap / max_words > 0.7:
                        return True

            for dt in decision_titles | decision_statements:
                if title_lower in dt or dt in title_lower:
                    overlap = len(set(title_lower.split()) & set(dt.split()))
                    max_words = max(len(title_lower.split()), len(dt.split()))
                    if max_words > 0 and overlap / max_words > 0.7:
                        return True

            return False

        async with get_db_session() as session:
            for task in tasks_to_persist:
                # Skip tasks that duplicate commitments or decisions
                if is_duplicate_task(task.title):
                    logger.debug(
                        "Skipping duplicate task",
                        task_title=task.title,
                        reason="duplicates commitment or decision",
                    )
                    continue

                # Check for existing task UIO with same title (PostgreSQL fallback)
                existing_uio_id = await find_existing_uio(
                    session,
                    state.input.organization_id,
                    "task",
                    task.title,
                )

                if existing_uio_id:
                    # Found existing task - add as confirmation source
                    now = utc_now()
                    source_id = str(uuid4())
                    await session.execute(
                        text("""
                            INSERT INTO unified_object_source (
                                id, unified_object_id, source_type,
                                source_account_id, role,
                                conversation_id, quoted_text, extracted_title,
                                confidence, added_at, source_timestamp,
                                detection_method, created_at
                            ) VALUES (
                                :id, :uio_id, :source_type,
                                :source_account_id, 'confirmation',
                                :conversation_id, :quoted_text, :title,
                                :confidence, :now, :source_timestamp,
                                'llm_extraction', :now
                            )
                        """),
                        {
                            "id": source_id,
                            "uio_id": existing_uio_id,
                            "source_type": state.input.source_type or "email",
                            "source_account_id": state.input.source_account_id,
                            "conversation_id": state.input.conversation_id,
                            "quoted_text": getattr(task, "quoted_text", None),
                            "title": task.title,
                            "confidence": getattr(task, "confidence", 0.9),
                            "now": now,
                            "source_timestamp": now,
                        },
                    )

                    # Create timeline event for confirmation
                    await create_timeline_event(
                        session=session,
                        uio_id=existing_uio_id,
                        event_type="source_added",
                        event_description=f"Task confirmed from {state.input.source_type or 'email'}: {task.title}",
                        source_type=state.input.source_type or "email",
                        source_id=state.input.conversation_id,
                        quoted_text=getattr(task, "quoted_text", None),
                        new_value={
                            "title": task.title,
                            "status": task.status,
                            "source": state.input.source_type or "email",
                        },
                        confidence=getattr(task, "confidence", 0.9),
                        triggered_by="system",
                    )

                    await session.commit()
                    logger.info(
                        "Skipping duplicate task (PostgreSQL match)",
                        title=task.title,
                        existing_uio_id=existing_uio_id,
                    )
                    continue

                task_id = str(uuid4())
                uio_id = str(uuid4())
                now = utc_now()

                # Create UIO for task
                await session.execute(
                    text("""
                        INSERT INTO unified_intelligence_object (
                            id, organization_id, type, status,
                            canonical_title, canonical_description,
                            due_date, overall_confidence,
                            first_seen_at, last_updated_at,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, 'task', 'active',
                            :title, :description,
                            :due_date, 0.9,
                            :now, :now,
                            :now, :now
                        )
                    """),
                    {
                        "id": uio_id,
                        "org_id": state.input.organization_id,
                        "title": task.title,
                        "description": task.description or "",
                        "due_date": to_naive_utc(task.due_date),
                        "now": now,
                    },
                )

                # Map status to valid enum values
                status_map = {
                    "todo": "todo",
                    "backlog": "backlog",
                    "in_progress": "in_progress",
                    "in_review": "in_review",
                    "done": "done",
                    "cancelled": "cancelled",
                    "completed": "done",
                    "pending": "backlog",
                }
                task_status = status_map.get(task.status, "backlog") if task.status else "backlog"

                # Map priority to valid enum values
                priority_map = {
                    "no_priority": "no_priority",
                    "low": "low",
                    "medium": "medium",
                    "high": "high",
                    "urgent": "urgent",
                }
                task_priority = priority_map.get(task.priority, "no_priority") if task.priority else "no_priority"

                # Map input source_type to task_source_type enum
                # Valid values: conversation, commitment, decision, manual
                task_source_type = "conversation"  # Default for external sources (email, slack, etc.)

                # Create task table record (for frontend compatibility)
                await session.execute(
                    text("""
                        INSERT INTO task (
                            id, organization_id, title, description,
                            status, priority,
                            due_date, source_type, source_uio_id,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, :title, :description,
                            :status, :priority,
                            :due_date, :source_type, :source_uio_id,
                            :now, :now
                        )
                    """),
                    {
                        "id": task_id,
                        "org_id": state.input.organization_id,
                        "title": task.title,
                        "description": task.description or "",
                        "status": task_status,
                        "priority": task_priority,
                        "due_date": to_naive_utc(task.due_date),
                        "source_type": task_source_type,
                        "source_uio_id": uio_id,
                        "now": now,
                    },
                )

                # Create UIO extension record (uio_task_details)
                task_details_id = str(uuid4())
                completed_at = None
                if task_status == "done" and hasattr(task, "completed_at"):
                    completed_at = to_naive_utc(task.completed_at)

                await session.execute(
                    text("""
                        INSERT INTO uio_task_details (
                            id, uio_id, status, priority,
                            estimated_effort, completed_at,
                            project, tags,
                            created_at, updated_at
                        ) VALUES (
                            :id, :uio_id, :status, :priority,
                            :estimated_effort, :completed_at,
                            :project, :tags,
                            :now, :now
                        )
                    """),
                    {
                        "id": task_details_id,
                        "uio_id": uio_id,
                        "status": task_status,
                        "priority": task_priority,
                        "estimated_effort": getattr(task, "estimated_effort", None),
                        "completed_at": completed_at,
                        "project": getattr(task, "project", None),
                        "tags": getattr(task, "tags", []) or [],
                        "now": now,
                    },
                )

                # Link task UIO to source conversation
                task_source_id = str(uuid4())
                await session.execute(
                    text("""
                        INSERT INTO unified_object_source (
                            id, unified_object_id, source_type,
                            source_account_id, role,
                            conversation_id, extracted_title,
                            confidence, added_at, source_timestamp,
                            detection_method, created_at
                        ) VALUES (
                            :id, :uio_id, :source_type,
                            :source_account_id, 'origin',
                            :conversation_id, :title,
                            :confidence, :now, :source_timestamp,
                            'llm_extraction', :now
                        )
                    """),
                    {
                        "id": task_source_id,
                        "uio_id": uio_id,
                        "source_type": state.input.source_type or "email",
                        "source_account_id": state.input.source_account_id,
                        "conversation_id": state.input.conversation_id,
                        "title": task.title,
                        "confidence": task.confidence,
                        "now": now,
                        "source_timestamp": now,
                    },
                )

                # Create timeline event for task creation
                await create_timeline_event(
                    session=session,
                    uio_id=uio_id,
                    event_type="created",
                    event_description=f"Task extracted from {state.input.source_type or 'email'}: {task.title}",
                    source_type=state.input.source_type or "email",
                    source_id=state.input.conversation_id,
                    quoted_text=getattr(task, "quoted_text", None),
                    new_value={
                        "title": task.title,
                        "status": task_status,
                        "priority": task_priority,
                        "dueDate": task.due_date.isoformat() if task.due_date else None,
                    },
                    confidence=task.confidence,
                    triggered_by="system",
                )

                tasks_created.append({"id": task_id, "title": task.title, "uio_id": uio_id})

            await session.commit()

        # Persist claims to PostgreSQL (filtered by confidence)
        # Apply intra-batch deduplication for claims
        def dedupe_claims_by_content(claims: list) -> list:
            """Deduplicate claims by content, keeping highest confidence version."""
            seen_content: dict[str, int] = {}
            result = []
            duplicates_merged = 0

            for claim in claims:
                content = (claim.content or "").lower().strip()[:100]  # First 100 chars for matching
                if not content:
                    result.append(claim)
                    continue

                if content in seen_content:
                    existing_idx = seen_content[content]
                    existing_item = result[existing_idx]
                    if claim.confidence > existing_item.confidence:
                        result[existing_idx] = claim
                    duplicates_merged += 1
                else:
                    seen_content[content] = len(result)
                    result.append(claim)

            if duplicates_merged > 0:
                logger.info(
                    f"Intra-batch deduplication: merged {duplicates_merged} duplicate claims",
                    original_count=len(claims),
                    deduplicated_count=len(result),
                )
            return result

        claims_to_persist = dedupe_claims_by_content(claims_to_persist)

        claims_created = []
        async with get_db_session() as session:
            for claim in claims_to_persist:
                # Check for existing claim with same content (PostgreSQL fallback)
                existing_uio_id = await find_existing_uio(
                    session,
                    state.input.organization_id,
                    "claim",
                    claim.content[:200] if claim.content else "",
                )

                if existing_uio_id:
                    # Found existing claim - add as confirmation source
                    now = utc_now()
                    source_id = str(uuid4())
                    await session.execute(
                        text("""
                            INSERT INTO unified_object_source (
                                id, unified_object_id, source_type,
                                source_account_id, role,
                                conversation_id, quoted_text, extracted_title,
                                confidence, added_at, source_timestamp,
                                detection_method, created_at
                            ) VALUES (
                                :id, :uio_id, :source_type,
                                :source_account_id, 'confirmation',
                                :conversation_id, :quoted_text, :title,
                                :confidence, :now, :source_timestamp,
                                'llm_extraction', :now
                            )
                        """),
                        {
                            "id": source_id,
                            "uio_id": existing_uio_id,
                            "source_type": state.input.source_type or "email",
                            "source_account_id": state.input.source_account_id,
                            "conversation_id": state.input.conversation_id,
                            "quoted_text": getattr(claim, "quoted_text", claim.content[:500] if claim.content else None),
                            "title": claim.content[:200] if claim.content else None,
                            "confidence": claim.confidence,
                            "now": now,
                            "source_timestamp": now,
                        },
                    )

                    # Create timeline event for confirmation
                    await create_timeline_event(
                        session=session,
                        uio_id=existing_uio_id,
                        event_type="source_added",
                        event_description=f"Claim confirmed from {state.input.source_type or 'email'}: {claim.content[:50]}...",
                        source_type=state.input.source_type or "email",
                        source_id=state.input.conversation_id,
                        quoted_text=getattr(claim, "quoted_text", None),
                        new_value={
                            "content": claim.content[:100] if claim.content else None,
                            "confidence": claim.confidence,
                            "source": state.input.source_type or "email",
                        },
                        confidence=claim.confidence,
                        triggered_by="system",
                    )

                    await session.commit()
                    logger.info(
                        "Skipping duplicate claim (PostgreSQL match)",
                        content=claim.content[:50] if claim.content else None,
                        existing_uio_id=existing_uio_id,
                    )
                    continue

                claim_id = str(uuid4())
                uio_id = str(uuid4())
                now = utc_now()

                # Create UIO for claim
                await session.execute(
                    text("""
                        INSERT INTO unified_intelligence_object (
                            id, organization_id, type, status,
                            canonical_title, canonical_description,
                            overall_confidence, first_seen_at, last_updated_at,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, 'claim', 'active',
                            :title, :description,
                            :confidence, :now, :now,
                            :now, :now
                        )
                    """),
                    {
                        "id": uio_id,
                        "org_id": state.input.organization_id,
                        "title": claim.content[:200] if claim.content else "Unnamed claim",
                        "description": claim.content or "",
                        "confidence": claim.confidence,
                        "now": now,
                    },
                )

                # Create claim table record (for frontend compatibility)
                await session.execute(
                    text("""
                        INSERT INTO claim (
                            id, organization_id, type, text,
                            confidence, conversation_id,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, :type, :text,
                            :confidence, :conversation_id,
                            :now, :now
                        )
                    """),
                    {
                        "id": claim_id,
                        "org_id": state.input.organization_id,
                        "type": claim.type,
                        "text": claim.content,
                        "confidence": claim.confidence,
                        "conversation_id": state.input.conversation_id,
                        "now": now,
                    },
                )

                # Create UIO extension record (uio_claim_details)
                claim_details_id = str(uuid4())
                extraction_context = {
                    "entities": getattr(claim, "entities", []),
                    "temporalReferences": getattr(claim, "temporal_references", []),
                    "modelUsed": "sonnet",
                }
                await session.execute(
                    text("""
                        INSERT INTO uio_claim_details (
                            id, uio_id, claim_type,
                            quoted_text, normalized_text,
                            importance, extraction_context,
                            created_at, updated_at
                        ) VALUES (
                            :id, :uio_id, :claim_type,
                            :quoted_text, :normalized_text,
                            :importance, :extraction_context,
                            :now, :now
                        )
                    """),
                    {
                        "id": claim_details_id,
                        "uio_id": uio_id,
                        "claim_type": claim.type or "fact",
                        "quoted_text": getattr(claim, "quoted_text", claim.content),
                        "normalized_text": claim.content,
                        "importance": getattr(claim, "importance", "medium"),
                        "extraction_context": json.dumps(extraction_context),
                        "now": now,
                    },
                )

                # Link UIO to source conversation
                source_id = str(uuid4())
                await session.execute(
                    text("""
                        INSERT INTO unified_object_source (
                            id, unified_object_id, source_type,
                            source_account_id, role,
                            conversation_id, quoted_text, extracted_title,
                            confidence, added_at, source_timestamp,
                            detection_method, created_at
                        ) VALUES (
                            :id, :uio_id, :source_type,
                            :source_account_id, 'origin',
                            :conversation_id, :quoted_text, :title,
                            :confidence, :now, :source_timestamp,
                            'llm_extraction', :now
                        )
                    """),
                    {
                        "id": source_id,
                        "uio_id": uio_id,
                        "source_type": state.input.source_type or "email",
                        "source_account_id": state.input.source_account_id,
                        "conversation_id": state.input.conversation_id,
                        "quoted_text": getattr(claim, "quoted_text", claim.content[:500] if claim.content else None),
                        "title": claim.content[:200] if claim.content else None,
                        "confidence": claim.confidence,
                        "now": now,
                        "source_timestamp": now,
                    },
                )

                # Create timeline event for claim creation
                await create_timeline_event(
                    session=session,
                    uio_id=uio_id,
                    event_type="created",
                    event_description=f"Claim extracted from {state.input.source_type or 'email'}: {claim.content[:50] if claim.content else 'N/A'}...",
                    source_type=state.input.source_type or "email",
                    source_id=state.input.conversation_id,
                    quoted_text=getattr(claim, "quoted_text", None),
                    new_value={
                        "type": claim.type,
                        "content": claim.content[:100] if claim.content else None,
                        "confidence": claim.confidence,
                    },
                    confidence=claim.confidence,
                    triggered_by="system",
                )

                claims_created.append({"id": claim_id, "type": claim.type, "uio_id": uio_id})

            await session.commit()

        # Persist contacts to PostgreSQL (sync with graph)
        contacts_created = []
        async with get_db_session() as session:
            for contact in state.extracted.contacts:
                if not contact.id or not contact.email:
                    continue  # Skip contacts without ID or email

                now = utc_now()

                # Upsert contact
                await session.execute(
                    text("""
                        INSERT INTO contact (
                            id, organization_id, primary_email, display_name,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, :email, :name,
                            :now, :now
                        )
                        ON CONFLICT (organization_id, primary_email)
                        DO UPDATE SET
                            display_name = COALESCE(EXCLUDED.display_name, contact.display_name),
                            updated_at = :now
                    """),
                    {
                        "id": contact.id,
                        "org_id": state.input.organization_id,
                        "email": contact.email,
                        "name": contact.name,
                        "now": now,
                    },
                )
                contacts_created.append({"id": contact.id, "email": contact.email})

            await session.commit()

        # Create brief UIO and extension record
        if state.brief.brief_summary:
            async with get_db_session() as session:
                try:
                    brief_uio_id = str(uuid4())
                    brief_details_id = str(uuid4())
                    now = utc_now()

                    # Create UIO for brief
                    await session.execute(
                        text("""
                            INSERT INTO unified_intelligence_object (
                                id, organization_id, type, status,
                                canonical_title, canonical_description,
                                overall_confidence, first_seen_at, last_updated_at,
                                created_at, updated_at
                            ) VALUES (
                                :id, :org_id, 'brief', 'active',
                                :title, :description,
                                :confidence, :now, :now,
                                :now, :now
                            )
                        """),
                        {
                            "id": brief_uio_id,
                            "org_id": state.input.organization_id,
                            "title": f"Brief: {state.brief.brief_summary[:100]}..." if len(state.brief.brief_summary) > 100 else f"Brief: {state.brief.brief_summary}",
                            "description": state.brief.brief_summary,
                            "confidence": 0.9,
                            "now": now,
                        },
                    )

                    # Build open loops array
                    open_loops = []
                    if state.brief.open_loops:
                        for loop in state.brief.open_loops:
                            if isinstance(loop, str):
                                open_loops.append({"description": loop})
                            elif hasattr(loop, "description"):
                                open_loops.append({
                                    "description": loop.description,
                                    "owner": getattr(loop, "owner", None),
                                    "isBlocking": getattr(loop, "is_blocking", False),
                                })

                    # Map suggested_action to valid enum values
                    action_map = {
                        "respond": "respond",
                        "review": "review",
                        "delegate": "delegate",
                        "schedule": "schedule",
                        "wait": "wait",
                        "waiting": "wait",
                        "escalate": "escalate",
                        "archive": "archive",
                        "follow_up": "follow_up",
                        "followup": "follow_up",
                        "none": "none",
                    }
                    brief_action = action_map.get(
                        state.brief.suggested_action.lower() if state.brief.suggested_action else "none",
                        "none"
                    )

                    # Map priority_tier to valid enum values
                    priority_map = {
                        "urgent": "urgent",
                        "high": "high",
                        "medium": "medium",
                        "low": "low",
                    }
                    brief_priority = priority_map.get(
                        state.brief.priority_tier.lower() if state.brief.priority_tier else "medium",
                        "medium"
                    )

                    # Create UIO extension record (uio_brief_details)
                    await session.execute(
                        text("""
                            INSERT INTO uio_brief_details (
                                id, uio_id, summary,
                                suggested_action, action_reasoning,
                                open_loops, priority_tier,
                                urgency_score, importance_score, sentiment_score,
                                intent_classification, conversation_id,
                                created_at, updated_at
                            ) VALUES (
                                :id, :uio_id, :summary,
                                :suggested_action, :action_reasoning,
                                :open_loops, :priority_tier,
                                :urgency_score, :importance_score, :sentiment_score,
                                :intent_classification, :conversation_id,
                                :now, :now
                            )
                        """),
                        {
                            "id": brief_details_id,
                            "uio_id": brief_uio_id,
                            "summary": state.brief.brief_summary,
                            "suggested_action": brief_action,
                            "action_reasoning": state.brief.suggested_action_reason,
                            "open_loops": json.dumps(open_loops),
                            "priority_tier": brief_priority,
                            "urgency_score": state.classification.urgency,
                            "importance_score": state.classification.importance,
                            "sentiment_score": state.classification.sentiment,
                            "intent_classification": state.classification.intent,
                            "conversation_id": state.input.conversation_id,
                            "now": now,
                        },
                    )

                    # Link brief UIO to source conversation
                    brief_source_id = str(uuid4())
                    await session.execute(
                        text("""
                            INSERT INTO unified_object_source (
                                id, unified_object_id, source_type,
                                source_account_id, role,
                                conversation_id, extracted_title,
                                confidence, added_at, source_timestamp,
                                detection_method, created_at
                            ) VALUES (
                                :id, :uio_id, :source_type,
                                :source_account_id, 'origin',
                                :conversation_id, :title,
                                :confidence, :now, :source_timestamp,
                                'llm_extraction', :now
                            )
                        """),
                        {
                            "id": brief_source_id,
                            "uio_id": brief_uio_id,
                            "source_type": state.input.source_type or "email",
                            "source_account_id": state.input.source_account_id,
                            "conversation_id": state.input.conversation_id,
                            "title": state.brief.brief_summary[:200] if state.brief.brief_summary else None,
                            "confidence": 0.9,  # Briefs are generally high confidence
                            "now": now,
                            "source_timestamp": now,
                        },
                    )

                    await session.commit()

                    uios_created.append({
                        "id": brief_uio_id,
                        "type": "brief",
                    })

                    logger.debug(
                        "Created brief UIO",
                        uio_id=brief_uio_id,
                        priority_tier=state.brief.priority_tier,
                    )
                except Exception as e:
                    logger.error(
                        "Failed to create brief UIO",
                        error=str(e),
                    )
                    state.trace.errors.append(f"persist_brief_uio: {str(e)}")

        # Update conversation with brief data
        if state.input.conversation_id and state.brief.brief_summary:
            async with get_db_session() as session:
                try:
                    # Count persisted items (not filtered ones)
                    commitment_count = len([u for u in uios_created if u.get("type") == "commitment"])
                    decision_count = len([u for u in uios_created if u.get("type") == "decision"])
                    claim_count = len(claims_created)

                    await session.execute(
                        text("""
                            UPDATE conversation SET
                                brief_summary = :brief_summary,
                                suggested_action = :suggested_action,
                                suggested_action_reason = :suggested_action_reason,
                                has_open_loops = :has_open_loops,
                                open_loop_count = :open_loop_count,
                                priority_tier = :priority_tier,
                                intent_classification = :intent,
                                urgency_score = :urgency,
                                importance_score = :importance,
                                sentiment_score = :sentiment,
                                commitment_count = :commitment_count,
                                decision_count = :decision_count,
                                claim_count = :claim_count,
                                has_risk_warning = :has_risk_warning,
                                risk_level = :risk_level,
                                last_analyzed_at = :now,
                                updated_at = :now
                            WHERE id = :conversation_id
                        """),
                        {
                            "conversation_id": state.input.conversation_id,
                            "brief_summary": state.brief.brief_summary,
                            "suggested_action": state.brief.suggested_action,
                            "suggested_action_reason": state.brief.suggested_action_reason,
                            "has_open_loops": state.brief.has_open_loops,
                            "open_loop_count": state.brief.open_loop_count,
                            "priority_tier": state.brief.priority_tier,
                            "intent": state.classification.intent,
                            "urgency": state.classification.urgency,
                            "importance": state.classification.importance,
                            "sentiment": state.classification.sentiment,
                            "commitment_count": commitment_count,
                            "decision_count": decision_count,
                            "claim_count": claim_count,
                            "has_risk_warning": len(state.extracted.risks) > 0,
                            "risk_level": state.extracted.risks[0].severity if state.extracted.risks else None,
                            "now": utc_now(),
                        },
                    )
                    await session.commit()

                    logger.info(
                        "Updated conversation with brief",
                        conversation_id=state.input.conversation_id,
                        priority_tier=state.brief.priority_tier,
                        has_open_loops=state.brief.has_open_loops,
                    )
                except Exception as e:
                    logger.error(
                        "Failed to update conversation with brief",
                        conversation_id=state.input.conversation_id,
                        error=str(e),
                    )
                    state.trace.errors.append(f"persist_brief: {str(e)}")

        # Create COMMUNICATES_WITH relationships in graph
        if len(state.extracted.contacts) >= 2:
            # Get sender email from input
            sender_email = state.input.user_email
            now = utc_now()

            if sender_email:
                # Create relationships between sender and all other contacts
                for contact in state.extracted.contacts:
                    if contact.email and contact.email != sender_email:
                        await graph.query(
                            """
                            MATCH (sender:Contact {email: $senderEmail, organizationId: $orgId})
                            MATCH (receiver:Contact {email: $receiverEmail, organizationId: $orgId})
                            MERGE (sender)-[r:COMMUNICATES_WITH]->(receiver)
                            ON CREATE SET r.firstContact = $now, r.messageCount = 1
                            ON MATCH SET r.lastContact = $now, r.messageCount = r.messageCount + 1
                            """,
                            {
                                "senderEmail": sender_email,
                                "receiverEmail": contact.email,
                                "orgId": state.input.organization_id,
                                "now": now.isoformat(),
                            },
                        )

        # Create episode in graph for temporal tracking
        episode_id = str(uuid4())
        episode_now = utc_now()
        await graph.query(
            """
            CREATE (e:Episode {
                id: $id,
                organizationId: $orgId,
                sourceType: $sourceType,
                sourceId: $sourceId,
                analysisId: $analysisId,
                createdAt: $createdAt
            })
            RETURN e
            """,
            {
                "id": episode_id,
                "orgId": serialize_for_graph(state.input.organization_id),
                "sourceType": serialize_for_graph(state.input.source_type),
                "sourceId": serialize_for_graph(state.input.source_id),
                "analysisId": serialize_for_graph(state.analysis_id),
                "createdAt": episode_now.isoformat(),
            },
        )

        # Link episode to created UIOs
        for uio in uios_created:
            await graph.query(
                """
                MATCH (e:Episode {id: $episodeId})
                MATCH (u {id: $uioId})
                CREATE (e)-[:EXTRACTED]->(u)
                """,
                {
                    "episodeId": episode_id,
                    "uioId": uio["id"],
                },
            )

        logger.info(
            "Intelligence persisted",
            analysis_id=state.analysis_id,
            uios_created=len(uios_created),
            uios_merged=len(uios_merged),
            tasks_created=len(tasks_created),
            claims_created=len(claims_created),
            contacts_created=len(contacts_created),
        )

    except Exception as e:
        logger.error(
            "Persistence failed",
            analysis_id=state.analysis_id,
            error=str(e),
        )

        # Continue with partial results
        state.trace.errors.append(f"persist: {str(e)}")

    output = Output(
        uios_created=uios_created,
        uios_merged=uios_merged,
        tasks_created=tasks_created,
        claims_created=claims_created,
        contacts_created=contacts_created,
    )

    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "output": output,
        "trace": {
            **state.trace.model_dump(),
            "current_node": "persist",
            "node_timings": {
                **state.trace.node_timings,
                "persist": node_timing,
            },
        },
    }
