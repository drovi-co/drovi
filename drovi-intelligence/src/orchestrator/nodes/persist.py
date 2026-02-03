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
    ExtractedTask,
)
from src.graph.types import ConfidenceTier, get_confidence_tier, GraphNodeType, GraphRelationshipType
from src.search.embeddings import generate_embedding, EmbeddingError
from src.evidence.audit import record_evidence_audit
from src.ingestion.unified_event import build_segment_hash

logger = structlog.get_logger()

# Tiered confidence system - replaces binary filtering
# All items are persisted, but indexed/prioritized differently by tier
CONFIDENCE_TIER_THRESHOLDS = {
    "high": 0.80,      # Full indexing, primary results
    "medium": 0.50,    # Indexed, secondary results
    "low": 0.20,       # Stored but de-prioritized
    "speculative": 0,  # Stored, flagged for review
}

# Legacy thresholds for logging comparison (no longer used for filtering)
LEGACY_MIN_CONFIDENCE_COMMITMENT = 0.70
LEGACY_MIN_CONFIDENCE_DECISION = 0.70
LEGACY_MIN_CONFIDENCE_CLAIM = 0.50


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


def _has_evidence(quoted_text: str | None) -> bool:
    """Return True when quoted evidence is present."""
    return bool(quoted_text and quoted_text.strip())


def _resolve_message_id(state: IntelligenceState, quoted_text: str | None) -> str | None:
    """Best-effort resolve the source message ID for evidence linkage."""
    if not state.messages:
        return None

    if quoted_text:
        needle = quoted_text.strip().lower()
        for message in state.messages:
            content = (message.content or "").lower()
            if needle and needle in content:
                return message.id

    if len(state.messages) == 1:
        return state.messages[0].id

    return state.messages[0].id if state.messages else None


def _temporal_fields(now: datetime) -> dict[str, datetime | None]:
    """Return temporal fields for UIO persistence."""
    return {
        "valid_from": now,
        "valid_to": None,
        "system_from": now,
        "system_to": None,
    }


def _temporal_graph_props(now: datetime) -> dict[str, str]:
    """Return temporal fields for graph nodes/relationships."""
    iso_now = now.isoformat()
    return {
        "validFrom": iso_now,
        "validTo": "",
        "systemFrom": iso_now,
        "systemTo": "",
    }


def _temporal_relationship_props(now: datetime) -> dict[str, str]:
    """Return temporal fields for graph relationships."""
    iso_now = now.isoformat()
    return {
        "validFrom": iso_now,
        "validTo": "",
        "systemFrom": iso_now,
        "systemTo": "",
        "createdAt": iso_now,
        "updatedAt": iso_now,
    }


def _normalize_compare_value(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, str):
        return value.strip().lower()
    if isinstance(value, list):
        return sorted([str(item).strip().lower() for item in value])
    return value


def _values_differ(a, b) -> bool:
    return _normalize_compare_value(a) != _normalize_compare_value(b)


async def _audit_uio_source(
    organization_id: str,
    evidence_id: str,
    uio_id: str,
    uio_type: str,
    action: str,
    conversation_id: str | None = None,
    message_id: str | None = None,
) -> None:
    """Record evidence audit entry for UIO creation/updates."""
    await record_evidence_audit(
        artifact_id=evidence_id,
        organization_id=organization_id,
        action=action,
        actor_type="system",
        metadata={
            "uio_id": uio_id,
            "uio_type": uio_type,
            "conversation_id": conversation_id,
            "message_id": message_id,
        },
    )


def _resolve_session_node_type(source_type: str | None) -> GraphNodeType | None:
    if source_type == "meeting":
        return GraphNodeType.MEETING_SESSION
    if source_type == "call":
        return GraphNodeType.CALL_SESSION
    if source_type == "recording":
        return GraphNodeType.RECORDING
    return None


async def _link_uio_to_session(
    graph,
    state: IntelligenceState,
    uio_label: str,
    uio_id: str,
) -> None:
    session_id = state.input.source_id or state.input.conversation_id
    session_node = _resolve_session_node_type(state.input.source_type)
    if not session_id or not session_node:
        return

    await graph.query(
        f"""
        MATCH (u:{uio_label} {{id: $uio_id, organizationId: $org_id}})
        MATCH (s:{session_node.value} {{id: $session_id}})
        MERGE (u)-[r:{GraphRelationshipType.EXTRACTED_FROM.value}]->(s)
        ON CREATE SET r.validFrom = $valid_from,
                      r.validTo = $valid_to,
                      r.systemFrom = $system_from,
                      r.systemTo = $system_to,
                      r.createdAt = $created_at,
                      r.updatedAt = $updated_at
        """,
        {
            "uio_id": uio_id,
            "org_id": state.input.organization_id,
            "session_id": session_id,
            **_temporal_relationship_props(utc_now()),
        },
    )


async def _set_graph_embedding(
    graph,
    state: IntelligenceState,
    node_label: str,
    node_id: str,
    text: str,
) -> None:
    if not text or not text.strip():
        return
    try:
        embedding = await generate_embedding(text)
    except EmbeddingError:
        return
    await graph.query(
        f"""
        MATCH (n:{node_label} {{id: $id, organizationId: $org_id}})
        SET n.embedding = vecf32($embedding)
        """,
        {
            "id": node_id,
            "org_id": state.input.organization_id,
            "embedding": embedding,
        },
    )


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


async def resolve_contact_id_by_email(session, org_id: str, email: str | None) -> str | None:
    """Look up a contact ID by email within an organization.

    Args:
        session: SQLAlchemy async session
        org_id: Organization ID to search within
        email: Email address to look up

    Returns:
        Contact ID if found, None otherwise
    """
    if not email:
        return None

    result = await session.execute(
        text("""
            SELECT id FROM contact
            WHERE organization_id = :org_id AND primary_email = :email
            LIMIT 1
        """),
        {"org_id": org_id, "email": email.lower()},
    )
    row = result.fetchone()
    return row[0] if row else None


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
    evidence_id: str | None = None,
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

    if evidence_id:
        merged_new_value = dict(new_value or {})
        merged_new_value["evidence_id"] = evidence_id
        new_value = merged_new_value

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


async def _should_supersede_commitment(session, existing_uio_id: str, commitment) -> bool:
    result = await session.execute(
        text("""
            SELECT u.canonical_description, u.due_date,
                   cd.direction, cd.priority
            FROM unified_intelligence_object u
            LEFT JOIN uio_commitment_details cd ON u.id = cd.uio_id
            WHERE u.id = :uio_id
        """),
        {"uio_id": existing_uio_id},
    )
    row = result.fetchone()
    if not row:
        return False
    return any([
        _values_differ(row.canonical_description, commitment.description or ""),
        _values_differ(row.due_date, to_naive_utc(commitment.due_date)),
        _values_differ(row.direction, commitment.direction),
        _values_differ(row.priority, commitment.priority),
    ])


async def _should_supersede_decision(session, existing_uio_id: str, decision) -> bool:
    result = await session.execute(
        text("""
            SELECT u.canonical_description,
                   dd.statement, dd.rationale, dd.status
            FROM unified_intelligence_object u
            LEFT JOIN uio_decision_details dd ON u.id = dd.uio_id
            WHERE u.id = :uio_id
        """),
        {"uio_id": existing_uio_id},
    )
    row = result.fetchone()
    if not row:
        return False
    return any([
        _values_differ(row.statement, decision.statement),
        _values_differ(row.rationale, decision.rationale or ""),
        _values_differ(row.status, decision.status),
    ])


async def _should_supersede_task(session, existing_uio_id: str, task) -> bool:
    result = await session.execute(
        text("""
            SELECT u.canonical_description, u.due_date,
                   td.status, td.priority, td.project, td.tags
            FROM unified_intelligence_object u
            LEFT JOIN uio_task_details td ON u.id = td.uio_id
            WHERE u.id = :uio_id
        """),
        {"uio_id": existing_uio_id},
    )
    row = result.fetchone()
    if not row:
        return False
    return any([
        _values_differ(row.canonical_description, task.description or ""),
        _values_differ(row.due_date, to_naive_utc(task.due_date)),
        _values_differ(row.status, task.status),
        _values_differ(row.priority, task.priority),
        _values_differ(row.project, getattr(task, "project", None)),
        _values_differ(row.tags, getattr(task, "tags", None) or []),
    ])


async def _should_supersede_risk(session, existing_uio_id: str, risk) -> bool:
    result = await session.execute(
        text("""
            SELECT u.canonical_description,
                   rd.severity, rd.risk_type, rd.suggested_action
            FROM unified_intelligence_object u
            LEFT JOIN uio_risk_details rd ON u.id = rd.uio_id
            WHERE u.id = :uio_id
        """),
        {"uio_id": existing_uio_id},
    )
    row = result.fetchone()
    if not row:
        return False
    return any([
        _values_differ(row.canonical_description, risk.description or ""),
        _values_differ(row.severity, risk.severity),
        _values_differ(row.risk_type, risk.type),
        _values_differ(row.suggested_action, risk.suggested_action),
    ])


async def _apply_supersession(
    session,
    graph,
    *,
    now: datetime,
    organization_id: str,
    existing_uio_id: str,
    new_uio_id: str,
    uio_type: str,
    evidence_id: str | None,
    source_type: str | None,
    conversation_id: str | None,
    message_id: str | None,
) -> None:
    detail_table = {
        "commitment": "uio_commitment_details",
        "decision": "uio_decision_details",
        "task": "uio_task_details",
        "risk": "uio_risk_details",
    }.get(uio_type)

    await session.execute(
        text("""
            UPDATE unified_intelligence_object
            SET valid_to = :now,
                system_to = :now,
                last_updated_at = :now,
                updated_at = :now
            WHERE id = :existing_id
        """),
        {
            "now": now,
            "existing_id": existing_uio_id,
        },
    )

    if detail_table:
        await session.execute(
            text(f"""
                UPDATE {detail_table}
                SET superseded_by_uio_id = :new_id
                WHERE uio_id = :existing_id
            """),
            {
                "new_id": new_uio_id,
                "existing_id": existing_uio_id,
            },
        )
        await session.execute(
            text(f"""
                UPDATE {detail_table}
                SET supersedes_uio_id = :existing_id
                WHERE uio_id = :new_id
            """),
            {
                "existing_id": existing_uio_id,
                "new_id": new_uio_id,
            },
        )

    await create_timeline_event(
        session=session,
        uio_id=existing_uio_id,
        event_type="superseded",
        event_description=f"Superseded by {uio_type} {new_uio_id}",
        source_type=source_type,
        source_id=conversation_id,
        quoted_text=None,
        evidence_id=evidence_id,
        new_value={"superseded_by": new_uio_id},
        confidence=None,
        triggered_by="system",
    )
    await create_timeline_event(
        session=session,
        uio_id=new_uio_id,
        event_type="supersedes",
        event_description=f"Supersedes {uio_type} {existing_uio_id}",
        source_type=source_type,
        source_id=conversation_id,
        quoted_text=None,
        evidence_id=evidence_id,
        new_value={"supersedes": existing_uio_id},
        confidence=None,
        triggered_by="system",
    )

    try:
        relationship_props = _temporal_relationship_props(now)
        await graph.query(
            f"""
            MATCH (old {{id: $existing_id, organizationId: $org_id}})
            SET old.validTo = $valid_to,
                old.systemTo = $system_to,
                old.updatedAt = $updated_at
            """,
            {
                "existing_id": existing_uio_id,
                "org_id": organization_id,
                "valid_to": relationship_props["validFrom"],
                "system_to": relationship_props["systemFrom"],
                "updated_at": relationship_props["updatedAt"],
            },
        )
        await graph.query(
            f"""
            MATCH (new {{id: $new_id, organizationId: $org_id}})
            MATCH (old {{id: $existing_id, organizationId: $org_id}})
            MERGE (new)-[r:{GraphRelationshipType.SUPERSEDES.value}]->(old)
            ON CREATE SET r.validFrom = $valid_from,
                          r.validTo = $valid_to,
                          r.systemFrom = $system_from,
                          r.systemTo = $system_to,
                          r.createdAt = $created_at,
                          r.updatedAt = $updated_at
            """,
            {
                "new_id": new_uio_id,
                "existing_id": existing_uio_id,
                "org_id": organization_id,
                "valid_from": relationship_props["validFrom"],
                "valid_to": relationship_props["validTo"],
                "system_from": relationship_props["systemFrom"],
                "system_to": relationship_props["systemTo"],
                "created_at": relationship_props["createdAt"],
                "updated_at": relationship_props["updatedAt"],
            },
        )
    except Exception as exc:
        logger.warning("Failed to update graph supersession", error=str(exc))


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
    created_uio_by_extracted_id: dict[str, dict] = {}

    if not state.candidates_persisted and (
        state.extracted.commitments
        or state.extracted.decisions
        or state.extracted.tasks
        or state.extracted.claims
        or state.extracted.risks
    ):
        logger.error(
            "Candidates not persisted; skipping final UIO persistence",
            analysis_id=state.analysis_id,
        )
        state.trace.errors.append("persist: candidates_not_persisted")
        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )
        return {
            "trace": {
                **state.trace.model_dump(),
                "current_node": "persist",
                "node_timings": {
                    **state.trace.node_timings,
                    "persist": node_timing,
                },
            }
        }

    # Tiered confidence tracking - NO filtering, ALL items are persisted
    tier_stats = {
        "commitments": {"high": 0, "medium": 0, "low": 0, "speculative": 0},
        "decisions": {"high": 0, "medium": 0, "low": 0, "speculative": 0},
        "claims": {"high": 0, "medium": 0, "low": 0, "speculative": 0},
    }

    # Assign confidence tiers to all items (no filtering!)
    commitments_to_persist = []
    for commitment in state.extracted.commitments:
        tier = get_confidence_tier(commitment.confidence)
        tier_stats["commitments"][tier.value] += 1
        # Attach tier to commitment for persistence
        commitment._confidence_tier = tier.value
        commitments_to_persist.append(commitment)
        logger.debug(
            "Commitment tiered",
            title=commitment.title,
            confidence=commitment.confidence,
            tier=tier.value,
        )

    decisions_to_persist = []
    for decision in state.extracted.decisions:
        tier = get_confidence_tier(decision.confidence)
        tier_stats["decisions"][tier.value] += 1
        decision._confidence_tier = tier.value
        decisions_to_persist.append(decision)
        logger.debug(
            "Decision tiered",
            title=decision.title,
            confidence=decision.confidence,
            tier=tier.value,
        )

    claims_to_persist = []
    for claim in state.extracted.claims:
        tier = get_confidence_tier(claim.confidence)
        tier_stats["claims"][tier.value] += 1
        claim._confidence_tier = tier.value
        claims_to_persist.append(claim)

    # Calculate legacy comparison (what would have been filtered before)
    legacy_would_filter = {
        "commitments": sum(1 for c in state.extracted.commitments if c.confidence < LEGACY_MIN_CONFIDENCE_COMMITMENT),
        "decisions": sum(1 for d in state.extracted.decisions if d.confidence < LEGACY_MIN_CONFIDENCE_DECISION),
        "claims": sum(1 for c in state.extracted.claims if c.confidence < LEGACY_MIN_CONFIDENCE_CLAIM),
    }

    logger.info(
        "Tiered confidence system - ALL items persisted",
        commitments_total=len(commitments_to_persist),
        commitments_tiers=tier_stats["commitments"],
        decisions_total=len(decisions_to_persist),
        decisions_tiers=tier_stats["decisions"],
        claims_total=len(claims_to_persist),
        claims_tiers=tier_stats["claims"],
        legacy_would_have_filtered=legacy_would_filter,
        data_saved_by_tiering=sum(legacy_would_filter.values()),
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
                if not _has_evidence(getattr(commitment, "quoted_text", None)):
                    logger.info(
                        "Skipping commitment without evidence",
                        title=commitment.title,
                        analysis_id=state.analysis_id,
                    )
                    continue

                message_id = getattr(commitment, "source_message_id", None) or _resolve_message_id(
                    state, getattr(commitment, "quoted_text", None)
                )
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

                supersedes_uio_id = None
                if existing_uio_id:
                    should_supersede = await _should_supersede_commitment(
                        session,
                        existing_uio_id,
                        commitment,
                    )
                    if not should_supersede:
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
                                    conversation_id, message_id, quoted_text, quoted_text_start, quoted_text_end,
                                    segment_hash, extracted_title,
                                    confidence, added_at, source_timestamp,
                                    detection_method, created_at
                                ) VALUES (
                                    :id, :uio_id, :source_type,
                                    :source_account_id, 'confirmation',
                                    :conversation_id, :message_id, :quoted_text, :quoted_text_start, :quoted_text_end,
                                    :segment_hash, :title,
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
                                "message_id": message_id,
                                "quoted_text": getattr(commitment, "quoted_text", None),
                                "quoted_text_start": getattr(commitment, "quoted_text_start", None),
                                "quoted_text_end": getattr(commitment, "quoted_text_end", None),
                                "segment_hash": build_segment_hash(getattr(commitment, "quoted_text", "") or "")
                                if _has_evidence(getattr(commitment, "quoted_text", None))
                                else None,
                                "title": commitment.title,
                                "confidence": commitment.confidence,
                                "now": now,
                                "source_timestamp": now,
                            },
                        )

                        for span in getattr(commitment, "supporting_evidence", []) or []:
                            support_id = str(uuid4())
                            await session.execute(
                                text("""
                                    INSERT INTO unified_object_source (
                                        id, unified_object_id, source_type,
                                        source_account_id, role,
                                        conversation_id, message_id, quoted_text, quoted_text_start, quoted_text_end,
                                        segment_hash, extracted_title,
                                        confidence, added_at, source_timestamp,
                                        detection_method, created_at
                                    ) VALUES (
                                        :id, :uio_id, :source_type,
                                        :source_account_id, 'supporting',
                                        :conversation_id, :message_id, :quoted_text, :quoted_text_start, :quoted_text_end,
                                        :segment_hash, :title,
                                        :confidence, :now, :source_timestamp,
                                        'llm_extraction', :now
                                    )
                                """),
                                {
                                    "id": support_id,
                                    "uio_id": existing_uio_id,
                                    "source_type": state.input.source_type or "email",
                                    "source_account_id": state.input.source_account_id,
                                    "conversation_id": state.input.conversation_id,
                                    "message_id": getattr(span, "source_message_id", None),
                                    "quoted_text": getattr(span, "quoted_text", None),
                                    "quoted_text_start": getattr(span, "quoted_text_start", None),
                                    "quoted_text_end": getattr(span, "quoted_text_end", None),
                                    "segment_hash": build_segment_hash(getattr(span, "quoted_text", "") or "")
                                    if _has_evidence(getattr(span, "quoted_text", None))
                                    else None,
                                    "title": commitment.title,
                                    "confidence": commitment.confidence,
                                    "now": now,
                                    "source_timestamp": now,
                                },
                            )

                        await _audit_uio_source(
                            organization_id=state.input.organization_id,
                            evidence_id=source_id,
                            uio_id=existing_uio_id,
                            uio_type="risk",
                            action="uio_source_added",
                            conversation_id=state.input.conversation_id,
                            message_id=message_id,
                        )

                        await _audit_uio_source(
                            organization_id=state.input.organization_id,
                            evidence_id=source_id,
                            uio_id=existing_uio_id,
                            uio_type="decision",
                            action="uio_source_added",
                            conversation_id=state.input.conversation_id,
                            message_id=message_id,
                        )

                        await _audit_uio_source(
                            organization_id=state.input.organization_id,
                            evidence_id=source_id,
                            uio_id=existing_uio_id,
                            uio_type="commitment",
                            action="uio_source_added",
                            conversation_id=state.input.conversation_id,
                            message_id=message_id,
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
                            evidence_id=source_id,
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
                    supersedes_uio_id = existing_uio_id

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
                            valid_from, valid_to, system_from, system_to,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, 'commitment', 'active',
                            :title, :description,
                            :due_date, :due_date_confidence,
                            :confidence, :now, :now,
                            :valid_from, :valid_to, :system_from, :system_to,
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
                        **_temporal_fields(now),
                    },
                )

                # Create UIO extension record (uio_commitment_details)
                commitment_details_id = str(uuid4())
                confidence_tier = getattr(commitment, "_confidence_tier", "medium")
                extraction_context = {
                    "reasoning": getattr(commitment, "reasoning", None),
                    "quotedText": getattr(commitment, "quoted_text", None),
                    "commitmentType": getattr(commitment, "commitment_type", None),
                    "modelUsed": getattr(commitment, "model_used", None),
                    "modelTier": getattr(commitment, "model_tier", None),
                    "evidenceCount": 1 + len(getattr(commitment, "supporting_evidence", []) or []),
                    "confidenceReasoning": getattr(commitment, "confidence_reasoning", None),
                    "confidenceTier": confidence_tier,  # Tiered confidence system
                }

                # Resolve debtor and creditor contact IDs from emails
                debtor_contact_id = await resolve_contact_id_by_email(
                    session, state.input.organization_id, getattr(commitment, "debtor_email", None)
                )
                creditor_contact_id = await resolve_contact_id_by_email(
                    session, state.input.organization_id, getattr(commitment, "creditor_email", None)
                )

                await session.execute(
                    text("""
                        INSERT INTO uio_commitment_details (
                            id, uio_id, direction,
                            debtor_contact_id, creditor_contact_id,
                            due_date_source, due_date_original_text,
                            priority, status,
                            is_conditional, condition,
                            supersedes_uio_id, superseded_by_uio_id,
                            extraction_context,
                            created_at, updated_at
                        ) VALUES (
                            :id, :uio_id, :direction,
                            :debtor_contact_id, :creditor_contact_id,
                            :due_date_source, :due_date_text,
                            :priority, 'pending',
                            :is_conditional, :condition,
                            :supersedes_uio_id, :superseded_by_uio_id,
                            :extraction_context,
                            :now, :now
                        )
                    """),
                    {
                        "id": commitment_details_id,
                        "uio_id": uio_id,
                        "direction": commitment.direction or "owed_to_me",
                        "debtor_contact_id": debtor_contact_id,
                        "creditor_contact_id": creditor_contact_id,
                        "due_date_source": "explicit" if commitment.due_date else "inferred",
                        "due_date_text": commitment.due_date_text,
                        "priority": commitment.priority or "medium",
                        "is_conditional": getattr(commitment, "is_conditional", False),
                        "condition": getattr(commitment, "condition", None),
                        "supersedes_uio_id": supersedes_uio_id,
                        "superseded_by_uio_id": None,
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
                            quoted_text, quoted_text_start, quoted_text_end,
                            segment_hash, extracted_title,
                            extracted_due_date,
                            confidence, added_at, source_timestamp,
                            detection_method,
                            created_at
                        ) VALUES (
                            :id, :uio_id, :source_type,
                            :source_account_id, 'origin',
                            :conversation_id, :message_id,
                            :quoted_text, :quoted_text_start, :quoted_text_end,
                            :segment_hash, :title,
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
                        "message_id": message_id,
                        "quoted_text": getattr(commitment, "quoted_text", None),
                        "quoted_text_start": getattr(commitment, "quoted_text_start", None),
                        "quoted_text_end": getattr(commitment, "quoted_text_end", None),
                        "segment_hash": build_segment_hash(getattr(commitment, "quoted_text", "") or "")
                        if _has_evidence(getattr(commitment, "quoted_text", None))
                        else None,
                        "title": commitment.title,
                        "due_date": to_naive_utc(commitment.due_date),
                        "confidence": commitment.confidence,
                        "now": now,
                        "source_timestamp": now,
                    },
                )

                for span in getattr(commitment, "supporting_evidence", []) or []:
                    support_id = str(uuid4())
                    await session.execute(
                        text("""
                            INSERT INTO unified_object_source (
                                id, unified_object_id, source_type,
                                source_account_id, role,
                                conversation_id, message_id,
                                quoted_text, quoted_text_start, quoted_text_end,
                                segment_hash, extracted_title,
                                extracted_due_date,
                                confidence, added_at, source_timestamp,
                                detection_method,
                                created_at
                            ) VALUES (
                                :id, :uio_id, :source_type,
                                :source_account_id, 'supporting',
                                :conversation_id, :message_id,
                                :quoted_text, :quoted_text_start, :quoted_text_end,
                                :segment_hash, :title,
                                :due_date,
                                :confidence, :now, :source_timestamp,
                                'llm_extraction',
                                :now
                            )
                        """),
                        {
                            "id": support_id,
                            "uio_id": uio_id,
                            "source_type": state.input.source_type or "email",
                            "source_account_id": state.input.source_account_id,
                            "conversation_id": state.input.conversation_id,
                            "message_id": getattr(span, "source_message_id", None),
                            "quoted_text": getattr(span, "quoted_text", None),
                            "quoted_text_start": getattr(span, "quoted_text_start", None),
                            "quoted_text_end": getattr(span, "quoted_text_end", None),
                            "segment_hash": build_segment_hash(getattr(span, "quoted_text", "") or "")
                            if _has_evidence(getattr(span, "quoted_text", None))
                            else None,
                            "title": commitment.title,
                            "due_date": to_naive_utc(commitment.due_date),
                            "confidence": commitment.confidence,
                            "now": now,
                            "source_timestamp": now,
                        },
                    )

                await _audit_uio_source(
                    organization_id=state.input.organization_id,
                    evidence_id=source_id,
                    uio_id=uio_id,
                    uio_type="commitment",
                    action="uio_created",
                    conversation_id=state.input.conversation_id,
                    message_id=message_id,
                )

                created_uio_by_extracted_id[commitment.id] = {
                    "uio_id": uio_id,
                    "type": "commitment",
                    "evidence_id": source_id,
                }

                # Create timeline event for UIO creation
                await create_timeline_event(
                    session=session,
                    uio_id=uio_id,
                    event_type="created",
                    event_description=f"Commitment extracted from {state.input.source_type or 'email'}: {commitment.title}",
                    source_type=state.input.source_type or "email",
                    source_id=state.input.conversation_id,
                    quoted_text=getattr(commitment, "quoted_text", None),
                    evidence_id=source_id,
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

                if supersedes_uio_id:
                    await _apply_supersession(
                        session,
                        graph,
                        now=now,
                        organization_id=state.input.organization_id,
                        existing_uio_id=supersedes_uio_id,
                        new_uio_id=uio_id,
                        uio_type="commitment",
                        evidence_id=source_id,
                        source_type=state.input.source_type or "email",
                        conversation_id=state.input.conversation_id,
                        message_id=message_id,
                    )

                await session.commit()

                # Create graph node
                graph_confidence_tier = getattr(commitment, "_confidence_tier", "medium")
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
                        confidence: $confidence,
                        confidenceTier: $confidenceTier,
                        createdAt: $createdAt,
                        updatedAt: $createdAt,
                        validFrom: $validFrom,
                        validTo: $validTo,
                        systemFrom: $systemFrom,
                        systemTo: $systemTo
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
                        "confidence": commitment.confidence,
                        "confidenceTier": graph_confidence_tier,
                        "createdAt": now.isoformat(),
                        **_temporal_graph_props(now),
                    },
                )
                await _link_uio_to_session(graph, state, "Commitment", uio_id)
                await _set_graph_embedding(
                    graph,
                    state,
                    "Commitment",
                    uio_id,
                    f"{commitment.title or ''} {commitment.description or ''}".strip(),
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
                    confidence_tier=graph_confidence_tier,
                )

        # Persist decisions (filtered by confidence)
        async with get_db_session() as session:
            for decision in decisions_to_persist:
                if not _has_evidence(getattr(decision, "quoted_text", None)):
                    logger.info(
                        "Skipping decision without evidence",
                        title=decision.title,
                        analysis_id=state.analysis_id,
                    )
                    continue

                message_id = getattr(decision, "source_message_id", None) or _resolve_message_id(
                    state, getattr(decision, "quoted_text", None)
                )
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

                supersedes_uio_id = None
                if existing_uio_id:
                    should_supersede = await _should_supersede_decision(
                        session,
                        existing_uio_id,
                        decision,
                    )
                    if not should_supersede:
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
                                    conversation_id, message_id, quoted_text, quoted_text_start, quoted_text_end,
                                    segment_hash, extracted_title,
                                    confidence, added_at, source_timestamp,
                                    detection_method, created_at
                                ) VALUES (
                                    :id, :uio_id, :source_type,
                                    :source_account_id, 'confirmation',
                                    :conversation_id, :message_id, :quoted_text, :quoted_text_start, :quoted_text_end,
                                    :segment_hash, :title,
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
                                "message_id": message_id,
                                "quoted_text": getattr(decision, "quoted_text", None),
                                "quoted_text_start": getattr(decision, "quoted_text_start", None),
                                "quoted_text_end": getattr(decision, "quoted_text_end", None),
                                "segment_hash": build_segment_hash(getattr(decision, "quoted_text", "") or "")
                                if _has_evidence(getattr(decision, "quoted_text", None))
                                else None,
                                "title": decision.title,
                                "confidence": decision.confidence,
                                "now": now,
                                "source_timestamp": now,
                            },
                        )

                        for span in getattr(decision, "supporting_evidence", []) or []:
                            support_id = str(uuid4())
                            await session.execute(
                                text("""
                                    INSERT INTO unified_object_source (
                                        id, unified_object_id, source_type,
                                        source_account_id, role,
                                        conversation_id, message_id, quoted_text, quoted_text_start, quoted_text_end,
                                        segment_hash, extracted_title,
                                        confidence, added_at, source_timestamp,
                                        detection_method, created_at
                                    ) VALUES (
                                        :id, :uio_id, :source_type,
                                        :source_account_id, 'supporting',
                                        :conversation_id, :message_id, :quoted_text, :quoted_text_start, :quoted_text_end,
                                        :segment_hash, :title,
                                        :confidence, :now, :source_timestamp,
                                        'llm_extraction', :now
                                    )
                                """),
                                {
                                    "id": support_id,
                                    "uio_id": existing_uio_id,
                                    "source_type": state.input.source_type or "email",
                                    "source_account_id": state.input.source_account_id,
                                    "conversation_id": state.input.conversation_id,
                                    "message_id": getattr(span, "source_message_id", None),
                                    "quoted_text": getattr(span, "quoted_text", None),
                                    "quoted_text_start": getattr(span, "quoted_text_start", None),
                                    "quoted_text_end": getattr(span, "quoted_text_end", None),
                                    "segment_hash": build_segment_hash(getattr(span, "quoted_text", "") or "")
                                    if _has_evidence(getattr(span, "quoted_text", None))
                                    else None,
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
                            evidence_id=source_id,
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
                    supersedes_uio_id = existing_uio_id

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
                            valid_from, valid_to, system_from, system_to,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, 'decision', 'active',
                            :title, :description,
                            :confidence, :now, :now,
                            :valid_from, :valid_to, :system_from, :system_to,
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
                        **_temporal_fields(now),
                    },
                )

                # Create UIO extension record (uio_decision_details)
                decision_details_id = str(uuid4())
                confidence_tier = getattr(decision, "_confidence_tier", "medium")
                extraction_context = {
                    "reasoning": getattr(decision, "reasoning", None),
                    "quotedText": getattr(decision, "quoted_text", None),
                    "modelUsed": getattr(decision, "model_used", None),
                    "modelTier": getattr(decision, "model_tier", None),
                    "evidenceCount": 1 + len(getattr(decision, "supporting_evidence", []) or []),
                    "confidenceReasoning": getattr(decision, "confidence_reasoning", None),
                    "confidenceTier": confidence_tier,  # Tiered confidence system
                }

                # Resolve decision maker contact ID from email
                decision_maker_contact_id = await resolve_contact_id_by_email(
                    session, state.input.organization_id, getattr(decision, "decision_maker_email", None)
                )

                await session.execute(
                    text("""
                        INSERT INTO uio_decision_details (
                            id, uio_id, statement, rationale,
                            decision_maker_contact_id,
                            alternatives, stakeholder_contact_ids, impact_areas,
                            status, decided_at,
                            supersedes_uio_id, superseded_by_uio_id,
                            extraction_context,
                            created_at, updated_at
                        ) VALUES (
                            :id, :uio_id, :statement, :rationale,
                            :decision_maker_contact_id,
                            :alternatives, :stakeholders, :impact_areas,
                            'made', :decided_at,
                            :supersedes_uio_id, :superseded_by_uio_id,
                            :extraction_context,
                            :now, :now
                        )
                    """),
                    {
                        "id": decision_details_id,
                        "uio_id": uio_id,
                        "statement": decision.statement,
                        "rationale": decision.rationale or "",
                        "decision_maker_contact_id": decision_maker_contact_id,
                        "alternatives": json.dumps(getattr(decision, "alternatives", []) or []),
                        "stakeholders": getattr(decision, "stakeholders", []) or [],
                        "impact_areas": getattr(decision, "implications", []) or [],
                        "decided_at": now,
                        "supersedes_uio_id": supersedes_uio_id,
                        "superseded_by_uio_id": None,
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
                            quoted_text, quoted_text_start, quoted_text_end,
                            segment_hash, extracted_title,
                            confidence, added_at, source_timestamp,
                            detection_method,
                            created_at
                        ) VALUES (
                            :id, :uio_id, :source_type,
                            :source_account_id, 'origin',
                            :conversation_id, :message_id,
                            :quoted_text, :quoted_text_start, :quoted_text_end,
                            :segment_hash, :title,
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
                        "message_id": message_id,
                        "quoted_text": getattr(decision, "quoted_text", None),
                        "quoted_text_start": getattr(decision, "quoted_text_start", None),
                        "quoted_text_end": getattr(decision, "quoted_text_end", None),
                        "segment_hash": build_segment_hash(getattr(decision, "quoted_text", "") or "")
                        if _has_evidence(getattr(decision, "quoted_text", None))
                        else None,
                        "title": decision.title,
                        "confidence": decision.confidence,
                        "now": now,
                        "source_timestamp": now,
                    },
                )

                for span in getattr(decision, "supporting_evidence", []) or []:
                    support_id = str(uuid4())
                    await session.execute(
                        text("""
                            INSERT INTO unified_object_source (
                                id, unified_object_id, source_type,
                                source_account_id, role,
                                conversation_id, message_id,
                                quoted_text, quoted_text_start, quoted_text_end,
                                segment_hash, extracted_title,
                                confidence, added_at, source_timestamp,
                                detection_method,
                                created_at
                            ) VALUES (
                                :id, :uio_id, :source_type,
                                :source_account_id, 'supporting',
                                :conversation_id, :message_id,
                                :quoted_text, :quoted_text_start, :quoted_text_end,
                                :segment_hash, :title,
                                :confidence, :now, :source_timestamp,
                                'llm_extraction',
                                :now
                            )
                        """),
                        {
                            "id": support_id,
                            "uio_id": uio_id,
                            "source_type": state.input.source_type or "email",
                            "source_account_id": state.input.source_account_id,
                            "conversation_id": state.input.conversation_id,
                            "message_id": getattr(span, "source_message_id", None),
                            "quoted_text": getattr(span, "quoted_text", None),
                            "quoted_text_start": getattr(span, "quoted_text_start", None),
                            "quoted_text_end": getattr(span, "quoted_text_end", None),
                            "segment_hash": build_segment_hash(getattr(span, "quoted_text", "") or "")
                            if _has_evidence(getattr(span, "quoted_text", None))
                            else None,
                            "title": decision.title,
                            "confidence": decision.confidence,
                            "now": now,
                            "source_timestamp": now,
                        },
                    )

                await _audit_uio_source(
                    organization_id=state.input.organization_id,
                    evidence_id=source_id,
                    uio_id=uio_id,
                    uio_type="decision",
                    action="uio_created",
                    conversation_id=state.input.conversation_id,
                    message_id=message_id,
                )

                created_uio_by_extracted_id[decision.id] = {
                    "uio_id": uio_id,
                    "type": "decision",
                    "evidence_id": source_id,
                }

                # Create timeline event for UIO creation
                await create_timeline_event(
                    session=session,
                    uio_id=uio_id,
                    event_type="created",
                    event_description=f"Decision extracted from {state.input.source_type or 'email'}: {decision.title}",
                    source_type=state.input.source_type or "email",
                    source_id=state.input.conversation_id,
                    quoted_text=getattr(decision, "quoted_text", None),
                    evidence_id=source_id,
                    new_value={
                        "title": decision.title,
                        "statement": decision.statement,
                        "rationale": decision.rationale,
                        "confidence": decision.confidence,
                    },
                    confidence=decision.confidence,
                    triggered_by="system",
                )

                if supersedes_uio_id:
                    await _apply_supersession(
                        session,
                        graph,
                        now=now,
                        organization_id=state.input.organization_id,
                        existing_uio_id=supersedes_uio_id,
                        new_uio_id=uio_id,
                        uio_type="decision",
                        evidence_id=source_id,
                        source_type=state.input.source_type or "email",
                        conversation_id=state.input.conversation_id,
                        message_id=message_id,
                    )

                await session.commit()

                # Create graph node
                graph_confidence_tier = getattr(decision, "_confidence_tier", "medium")
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
                        confidence: $confidence,
                        confidenceTier: $confidenceTier,
                        createdAt: $createdAt,
                        updatedAt: $createdAt,
                        validFrom: $validFrom,
                        validTo: $validTo,
                        systemFrom: $systemFrom,
                        systemTo: $systemTo
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
                        "confidence": decision.confidence,
                        "confidenceTier": graph_confidence_tier,
                        "createdAt": now.isoformat(),
                        **_temporal_graph_props(now),
                    },
                )
                await _link_uio_to_session(graph, state, "Decision", uio_id)
                await _set_graph_embedding(
                    graph,
                    state,
                    "Decision",
                    uio_id,
                    f"{decision.title or ''} {decision.statement or ''}".strip(),
                )

                logger.debug(
                    "Created decision",
                    uio_id=uio_id,
                    title=decision.title,
                    confidence_tier=graph_confidence_tier,
                )

        # Persist risks to PostgreSQL and graph
        # Apply intra-batch deduplication for risks
        risks_to_persist = dedupe_by_title(state.extracted.risks, "risk")

        async with get_db_session() as session:
            for risk in risks_to_persist:
                if not _has_evidence(getattr(risk, "quoted_text", None)):
                    logger.info(
                        "Skipping risk without evidence",
                        title=risk.title,
                        analysis_id=state.analysis_id,
                    )
                    continue

                message_id = getattr(risk, "source_message_id", None) or _resolve_message_id(
                    state, getattr(risk, "quoted_text", None)
                )
                # Check for existing risk UIO with same title (PostgreSQL fallback)
                existing_uio_id = await find_existing_uio(
                    session,
                    state.input.organization_id,
                    "risk",
                    risk.title,
                )

                supersedes_uio_id = None
                if existing_uio_id:
                    should_supersede = await _should_supersede_risk(
                        session,
                        existing_uio_id,
                        risk,
                    )
                    if not should_supersede:
                        # Found existing risk - add as confirmation source
                        now = utc_now()
                        source_id = str(uuid4())
                        await session.execute(
                            text("""
                                INSERT INTO unified_object_source (
                                    id, unified_object_id, source_type,
                                    source_account_id, role,
                                    conversation_id, message_id, quoted_text, quoted_text_start, quoted_text_end,
                                    segment_hash, extracted_title,
                                    confidence, added_at, source_timestamp,
                                    detection_method, created_at
                                ) VALUES (
                                    :id, :uio_id, :source_type,
                                    :source_account_id, 'confirmation',
                                    :conversation_id, :message_id, :quoted_text, :quoted_text_start, :quoted_text_end,
                                    :segment_hash, :title,
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
                                "message_id": message_id,
                                "quoted_text": getattr(risk, "quoted_text", None),
                                "quoted_text_start": getattr(risk, "quoted_text_start", None),
                                "quoted_text_end": getattr(risk, "quoted_text_end", None),
                                "segment_hash": build_segment_hash(getattr(risk, "quoted_text", "") or "")
                                if _has_evidence(getattr(risk, "quoted_text", None))
                                else None,
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
                            evidence_id=source_id,
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
                    supersedes_uio_id = existing_uio_id

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
                                valid_from, valid_to, system_from, system_to,
                                created_at, updated_at
                            ) VALUES (
                                :id, :org_id, 'risk', 'active',
                                :title, :description,
                                :confidence, :now, :now,
                                :valid_from, :valid_to, :system_from, :system_to,
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
                            **_temporal_fields(now),
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
                        "modelUsed": getattr(risk, "model_used", None),
                        "modelTier": getattr(risk, "model_tier", None),
                        "evidenceCount": 1 if risk.quoted_text else 0,
                        "confidenceReasoning": getattr(risk, "confidence_reasoning", None),
                    }
                    await session.execute(
                        text("""
                        INSERT INTO uio_risk_details (
                            id, uio_id, risk_type, severity,
                            suggested_action, findings, extraction_context,
                            supersedes_uio_id, superseded_by_uio_id,
                            created_at, updated_at
                        ) VALUES (
                            :id, :uio_id, :risk_type, :severity,
                            :suggested_action, :findings, :extraction_context,
                            :supersedes_uio_id, :superseded_by_uio_id,
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
                        "supersedes_uio_id": supersedes_uio_id,
                        "superseded_by_uio_id": None,
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
                                conversation_id, message_id, quoted_text, quoted_text_start, quoted_text_end,
                                segment_hash, extracted_title,
                                confidence, added_at, source_timestamp,
                                detection_method, created_at
                            ) VALUES (
                                :id, :uio_id, :source_type,
                                :source_account_id, 'origin',
                                :conversation_id, :message_id, :quoted_text, :quoted_text_start, :quoted_text_end,
                                :segment_hash, :title,
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
                            "message_id": message_id,
                            "quoted_text": risk.quoted_text,
                            "quoted_text_start": getattr(risk, "quoted_text_start", None),
                            "quoted_text_end": getattr(risk, "quoted_text_end", None),
                            "segment_hash": build_segment_hash(risk.quoted_text or "")
                            if _has_evidence(risk.quoted_text)
                            else None,
                            "title": risk.title,
                            "confidence": risk.confidence,
                            "now": now,
                            "source_timestamp": now,
                        },
                    )

                    await _audit_uio_source(
                        organization_id=state.input.organization_id,
                        evidence_id=risk_source_id,
                        uio_id=uio_id,
                        uio_type="risk",
                        action="uio_created",
                        conversation_id=state.input.conversation_id,
                        message_id=message_id,
                    )

                    created_uio_by_extracted_id[risk.id] = {
                        "uio_id": uio_id,
                        "type": "risk",
                        "evidence_id": risk_source_id,
                    }

                    # Create timeline event for risk creation
                    await create_timeline_event(
                        session=session,
                        uio_id=uio_id,
                        event_type="created",
                        event_description=f"Risk detected from {state.input.source_type or 'email'}: {risk.title}",
                        source_type=state.input.source_type or "email",
                        source_id=state.input.conversation_id,
                        quoted_text=risk.quoted_text,
                        evidence_id=risk_source_id,
                        new_value={
                            "title": risk.title,
                            "type": risk.type,
                            "severity": risk.severity,
                            "confidence": risk.confidence,
                        },
                        confidence=risk.confidence,
                        triggered_by="system",
                    )

                    if supersedes_uio_id:
                        await _apply_supersession(
                            session,
                            graph,
                            now=now,
                            organization_id=state.input.organization_id,
                            existing_uio_id=supersedes_uio_id,
                            new_uio_id=uio_id,
                            uio_type="risk",
                            evidence_id=risk_source_id,
                            source_type=state.input.source_type or "email",
                            conversation_id=state.input.conversation_id,
                            message_id=message_id,
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
                            createdAt: $createdAt,
                            updatedAt: $createdAt,
                            validFrom: $validFrom,
                            validTo: $validTo,
                            systemFrom: $systemFrom,
                            systemTo: $systemTo
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
                            **_temporal_graph_props(now),
                        },
                    )
                    await _link_uio_to_session(graph, state, "Risk", uio_id)
                    await _set_graph_embedding(
                        graph,
                        state,
                        "Risk",
                        uio_id,
                        f"{risk.title or ''} {risk.description or ''}".strip(),
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

        def _has_explicit_task_marker(task: ExtractedTask) -> bool:
            quoted = (task.quoted_text or "").strip().lower()
            return quoted.startswith(("task:", "todo:", "action:", "action item:", "follow up:"))

        def is_duplicate_task(task_title: str, task: ExtractedTask) -> bool:
            """Check if a task duplicates a commitment or decision."""
            if not task_title:
                return False
            if _has_explicit_task_marker(task):
                # Explicit tasks should be persisted even if similar to commitments/decisions.
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
            task_graph_entries: list[dict] = []
            for task in tasks_to_persist:
                # Skip tasks that duplicate commitments or decisions
                if is_duplicate_task(task.title, task):
                    logger.debug(
                        "Skipping duplicate task",
                        task_title=task.title,
                        reason="duplicates commitment or decision",
                    )
                    continue

                if not _has_evidence(getattr(task, "quoted_text", None)):
                    logger.info(
                        "Skipping task without evidence",
                        title=task.title,
                        analysis_id=state.analysis_id,
                    )
                    continue

                message_id = getattr(task, "source_message_id", None) or _resolve_message_id(
                    state, getattr(task, "quoted_text", None)
                )

                # Check for existing task UIO with same title (PostgreSQL fallback)
                existing_uio_id = await find_existing_uio(
                    session,
                    state.input.organization_id,
                    "task",
                    task.title,
                )

                supersedes_uio_id = None
                if existing_uio_id:
                    should_supersede = await _should_supersede_task(
                        session,
                        existing_uio_id,
                        task,
                    )
                    if not should_supersede:
                        # Found existing task - add as confirmation source
                        now = utc_now()
                        source_id = str(uuid4())
                        await session.execute(
                            text("""
                                INSERT INTO unified_object_source (
                                    id, unified_object_id, source_type,
                                    source_account_id, role,
                                    conversation_id, message_id, quoted_text, quoted_text_start, quoted_text_end,
                                    segment_hash, extracted_title,
                                    confidence, added_at, source_timestamp,
                                    detection_method, created_at
                                ) VALUES (
                                    :id, :uio_id, :source_type,
                                    :source_account_id, 'confirmation',
                                    :conversation_id, :message_id, :quoted_text, :quoted_text_start, :quoted_text_end,
                                    :segment_hash, :title,
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
                                "message_id": message_id,
                                "quoted_text": getattr(task, "quoted_text", None),
                                "quoted_text_start": getattr(task, "quoted_text_start", None),
                                "quoted_text_end": getattr(task, "quoted_text_end", None),
                                "segment_hash": build_segment_hash(getattr(task, "quoted_text", "") or "")
                                if _has_evidence(getattr(task, "quoted_text", None))
                                else None,
                                "title": task.title,
                                "confidence": getattr(task, "confidence", 0.9),
                                "now": now,
                                "source_timestamp": now,
                            },
                        )

                        await _audit_uio_source(
                            organization_id=state.input.organization_id,
                            evidence_id=source_id,
                            uio_id=existing_uio_id,
                            uio_type="task",
                            action="uio_source_added",
                            conversation_id=state.input.conversation_id,
                            message_id=message_id,
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
                            evidence_id=source_id,
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
                    supersedes_uio_id = existing_uio_id

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
                            valid_from, valid_to, system_from, system_to,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, 'task', 'active',
                            :title, :description,
                            :due_date, 0.9,
                            :now, :now,
                            :valid_from, :valid_to, :system_from, :system_to,
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
                        **_temporal_fields(now),
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

                # Create UIO extension record (uio_task_details)
                task_details_id = str(uuid4())
                completed_at = None
                if task_status == "done" and hasattr(task, "completed_at"):
                    completed_at = to_naive_utc(task.completed_at)

                extraction_context = {
                    "reasoning": getattr(task, "reasoning", None),
                    "quotedText": getattr(task, "quoted_text", None),
                    "modelUsed": getattr(task, "model_used", None),
                    "modelTier": getattr(task, "model_tier", None),
                    "evidenceCount": 1 if getattr(task, "quoted_text", None) else 0,
                    "confidenceReasoning": getattr(task, "confidence_reasoning", None),
                }

                # Resolve assignee and created_by contact IDs from emails
                assignee_contact_id = await resolve_contact_id_by_email(
                    session, state.input.organization_id, getattr(task, "assignee_email", None)
                )
                created_by_contact_id = await resolve_contact_id_by_email(
                    session, state.input.organization_id, getattr(task, "created_by_email", None)
                )

                await session.execute(
                    text("""
                        INSERT INTO uio_task_details (
                            id, uio_id, status, priority,
                            assignee_contact_id, created_by_contact_id,
                            estimated_effort, completed_at,
                            project, tags,
                            extraction_context,
                            supersedes_uio_id, superseded_by_uio_id,
                            created_at, updated_at
                        ) VALUES (
                            :id, :uio_id, :status, :priority,
                            :assignee_contact_id, :created_by_contact_id,
                            :estimated_effort, :completed_at,
                            :project, :tags,
                            :extraction_context,
                            :supersedes_uio_id, :superseded_by_uio_id,
                            :now, :now
                        )
                    """),
                    {
                        "id": task_details_id,
                        "uio_id": uio_id,
                        "status": task_status,
                        "priority": task_priority,
                        "assignee_contact_id": assignee_contact_id,
                        "created_by_contact_id": created_by_contact_id,
                        "estimated_effort": getattr(task, "estimated_effort", None),
                        "completed_at": completed_at,
                        "project": getattr(task, "project", None),
                        "tags": getattr(task, "tags", []) or [],
                        "extraction_context": json.dumps(extraction_context),
                        "supersedes_uio_id": supersedes_uio_id,
                        "superseded_by_uio_id": None,
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
                            conversation_id, message_id, quoted_text, quoted_text_start, quoted_text_end,
                            segment_hash, extracted_title,
                            confidence, added_at, source_timestamp,
                            detection_method, created_at
                        ) VALUES (
                            :id, :uio_id, :source_type,
                            :source_account_id, 'origin',
                            :conversation_id, :message_id, :quoted_text, :quoted_text_start, :quoted_text_end,
                            :segment_hash, :title,
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
                        "message_id": message_id,
                        "quoted_text": getattr(task, "quoted_text", None),
                        "quoted_text_start": getattr(task, "quoted_text_start", None),
                        "quoted_text_end": getattr(task, "quoted_text_end", None),
                        "segment_hash": build_segment_hash(getattr(task, "quoted_text", "") or "")
                        if _has_evidence(getattr(task, "quoted_text", None))
                        else None,
                        "title": task.title,
                        "confidence": task.confidence,
                        "now": now,
                        "source_timestamp": now,
                    },
                )

                await _audit_uio_source(
                    organization_id=state.input.organization_id,
                    evidence_id=task_source_id,
                    uio_id=uio_id,
                    uio_type="task",
                    action="uio_created",
                    conversation_id=state.input.conversation_id,
                    message_id=message_id,
                )

                created_uio_by_extracted_id[task.id] = {
                    "uio_id": uio_id,
                    "type": "task",
                    "evidence_id": task_source_id,
                }

                # Create timeline event for task creation
                await create_timeline_event(
                    session=session,
                    uio_id=uio_id,
                    event_type="created",
                    event_description=f"Task extracted from {state.input.source_type or 'email'}: {task.title}",
                    source_type=state.input.source_type or "email",
                    source_id=state.input.conversation_id,
                    quoted_text=getattr(task, "quoted_text", None),
                    evidence_id=task_source_id,
                    new_value={
                        "title": task.title,
                        "status": task_status,
                        "priority": task_priority,
                        "dueDate": task.due_date.isoformat() if task.due_date else None,
                    },
                    confidence=task.confidence,
                    triggered_by="system",
                )

                if supersedes_uio_id:
                    await _apply_supersession(
                        session,
                        graph,
                        now=now,
                        organization_id=state.input.organization_id,
                        existing_uio_id=supersedes_uio_id,
                        new_uio_id=uio_id,
                        uio_type="task",
                        evidence_id=task_source_id,
                        source_type=state.input.source_type or "email",
                        conversation_id=state.input.conversation_id,
                        message_id=message_id,
                    )

                tasks_created.append({"id": uio_id, "title": task.title})
                task_graph_entries.append(
                    {
                        "id": uio_id,
                        "title": task.title,
                        "description": task.description,
                        "status": task_status,
                        "priority": task_priority,
                        "due_date": task.due_date,
                        "assignee_contact_id": assignee_contact_id,
                        "created_by_contact_id": created_by_contact_id,
                        "confidence": task.confidence,
                    }
                )

            await session.commit()

        for task_entry in task_graph_entries:
            await graph.query(
                """
                CREATE (t:Task {
                    id: $id,
                    organizationId: $orgId,
                    title: $title,
                    description: $description,
                    status: $status,
                    priority: $priority,
                    dueDate: $dueDate,
                    assigneeContactId: $assigneeContactId,
                    createdByContactId: $createdByContactId,
                    confidence: $confidence,
                    createdAt: $createdAt,
                    updatedAt: $createdAt,
                    validFrom: $validFrom,
                    validTo: $validTo,
                    systemFrom: $systemFrom,
                    systemTo: $systemTo
                })
                RETURN t
                """,
                {
                    "id": task_entry["id"],
                    "orgId": state.input.organization_id,
                    "title": serialize_for_graph(task_entry["title"]),
                    "description": serialize_for_graph(task_entry["description"]),
                    "status": serialize_for_graph(task_entry["status"]),
                    "priority": serialize_for_graph(task_entry["priority"]),
                    "dueDate": to_naive_utc(task_entry["due_date"]).isoformat()
                    if task_entry["due_date"]
                    else "",
                    "assigneeContactId": serialize_for_graph(
                        task_entry["assignee_contact_id"]
                    ),
                    "createdByContactId": serialize_for_graph(
                        task_entry["created_by_contact_id"]
                    ),
                    "confidence": task_entry["confidence"],
                    "createdAt": utc_now().isoformat(),
                    **_temporal_graph_props(utc_now()),
                },
            )
            await _link_uio_to_session(graph, state, "Task", task_entry["id"])
            await _set_graph_embedding(
                graph,
                state,
                "Task",
                task_entry["id"],
                f"{task_entry['title'] or ''} {task_entry['description'] or ''}".strip(),
            )

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
            claim_graph_entries: list[dict] = []
            for claim in claims_to_persist:
                if not _has_evidence(getattr(claim, "quoted_text", None)):
                    logger.info(
                        "Skipping claim without evidence",
                        content=claim.content[:50] if claim.content else None,
                        analysis_id=state.analysis_id,
                    )
                    continue

                message_id = getattr(claim, "source_message_id", None) or _resolve_message_id(
                    state, getattr(claim, "quoted_text", None)
                )
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
                                conversation_id, message_id, quoted_text, quoted_text_start, quoted_text_end,
                                segment_hash, extracted_title,
                                confidence, added_at, source_timestamp,
                                detection_method, created_at
                            ) VALUES (
                                :id, :uio_id, :source_type,
                                :source_account_id, 'confirmation',
                                :conversation_id, :message_id, :quoted_text, :quoted_text_start, :quoted_text_end,
                                :segment_hash, :title,
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
                            "message_id": message_id,
                            "quoted_text": getattr(claim, "quoted_text", claim.content[:500] if claim.content else None),
                            "quoted_text_start": getattr(claim, "quoted_text_start", None),
                            "quoted_text_end": getattr(claim, "quoted_text_end", None),
                            "segment_hash": build_segment_hash(getattr(claim, "quoted_text", "") or "")
                            if _has_evidence(getattr(claim, "quoted_text", None))
                            else None,
                            "title": claim.content[:200] if claim.content else None,
                            "confidence": claim.confidence,
                            "now": now,
                            "source_timestamp": now,
                        },
                    )

                    await _audit_uio_source(
                        organization_id=state.input.organization_id,
                        evidence_id=source_id,
                        uio_id=existing_uio_id,
                        uio_type="claim",
                        action="uio_source_added",
                        conversation_id=state.input.conversation_id,
                        message_id=message_id,
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
                        evidence_id=source_id,
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

                uio_id = str(uuid4())
                now = utc_now()

                # Create UIO for claim
                await session.execute(
                    text("""
                        INSERT INTO unified_intelligence_object (
                            id, organization_id, type, status,
                            canonical_title, canonical_description,
                            overall_confidence, first_seen_at, last_updated_at,
                            valid_from, valid_to, system_from, system_to,
                            created_at, updated_at
                        ) VALUES (
                            :id, :org_id, 'claim', 'active',
                            :title, :description,
                            :confidence, :now, :now,
                            :valid_from, :valid_to, :system_from, :system_to,
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
                        **_temporal_fields(now),
                    },
                )

                # Create UIO extension record (uio_claim_details)
                claim_details_id = str(uuid4())
                confidence_tier = getattr(claim, "_confidence_tier", "medium")
                extraction_context = {
                    "entities": getattr(claim, "entities", []),
                    "temporalReferences": getattr(claim, "temporal_references", []),
                    "modelUsed": getattr(claim, "model_used", None),
                    "modelTier": getattr(claim, "model_tier", None),
                    "evidenceCount": 1 if getattr(claim, "quoted_text", None) else 0,
                    "confidenceReasoning": getattr(claim, "confidence_reasoning", None),
                    "confidenceTier": confidence_tier,  # Tiered confidence system
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
                            conversation_id, message_id, quoted_text, quoted_text_start, quoted_text_end,
                            segment_hash, extracted_title,
                            confidence, added_at, source_timestamp,
                            detection_method, created_at
                        ) VALUES (
                            :id, :uio_id, :source_type,
                            :source_account_id, 'origin',
                            :conversation_id, :message_id, :quoted_text, :quoted_text_start, :quoted_text_end,
                            :segment_hash, :title,
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
                        "message_id": message_id,
                        "quoted_text": getattr(claim, "quoted_text", claim.content[:500] if claim.content else None),
                        "quoted_text_start": getattr(claim, "quoted_text_start", None),
                        "quoted_text_end": getattr(claim, "quoted_text_end", None),
                        "segment_hash": build_segment_hash(getattr(claim, "quoted_text", "") or "")
                        if _has_evidence(getattr(claim, "quoted_text", None))
                        else None,
                        "title": claim.content[:200] if claim.content else None,
                        "confidence": claim.confidence,
                        "now": now,
                        "source_timestamp": now,
                    },
                )

                await _audit_uio_source(
                    organization_id=state.input.organization_id,
                    evidence_id=source_id,
                    uio_id=uio_id,
                    uio_type="claim",
                    action="uio_created",
                    conversation_id=state.input.conversation_id,
                    message_id=message_id,
                )

                created_uio_by_extracted_id[claim.id] = {
                    "uio_id": uio_id,
                    "type": "claim",
                    "evidence_id": source_id,
                }

                # Create timeline event for claim creation
                await create_timeline_event(
                    session=session,
                    uio_id=uio_id,
                    event_type="created",
                    event_description=f"Claim extracted from {state.input.source_type or 'email'}: {claim.content[:50] if claim.content else 'N/A'}...",
                    source_type=state.input.source_type or "email",
                    source_id=state.input.conversation_id,
                    quoted_text=getattr(claim, "quoted_text", None),
                    evidence_id=source_id,
                    new_value={
                        "type": claim.type,
                        "content": claim.content[:100] if claim.content else None,
                        "confidence": claim.confidence,
                    },
                    confidence=claim.confidence,
                    triggered_by="system",
                )

                claims_created.append({"id": uio_id, "type": claim.type})
                claim_graph_entries.append(
                    {
                        "id": uio_id,
                        "type": claim.type,
                        "content": claim.content,
                        "quoted_text": getattr(claim, "quoted_text", None),
                        "confidence": claim.confidence,
                        "importance": getattr(claim, "importance", "medium"),
                    }
                )

            await session.commit()

        for claim_entry in claim_graph_entries:
            await graph.query(
                """
                CREATE (cl:Claim {
                    id: $id,
                    organizationId: $orgId,
                    type: $type,
                    content: $content,
                    quotedText: $quotedText,
                    confidence: $confidence,
                    importance: $importance,
                    createdAt: $createdAt,
                    updatedAt: $createdAt,
                    validFrom: $validFrom,
                    validTo: $validTo,
                    systemFrom: $systemFrom,
                    systemTo: $systemTo
                })
                RETURN cl
                """,
                {
                    "id": claim_entry["id"],
                    "orgId": state.input.organization_id,
                    "type": serialize_for_graph(claim_entry["type"]),
                    "content": serialize_for_graph(claim_entry["content"]),
                    "quotedText": serialize_for_graph(claim_entry["quoted_text"]),
                    "confidence": claim_entry["confidence"],
                    "importance": serialize_for_graph(claim_entry["importance"]),
                    "createdAt": utc_now().isoformat(),
                    **_temporal_graph_props(utc_now()),
                },
            )
            await _link_uio_to_session(graph, state, "Claim", claim_entry["id"])
            await _set_graph_embedding(
                graph,
                state,
                "Claim",
                claim_entry["id"],
                claim_entry["content"] or "",
            )

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
                                valid_from, valid_to, system_from, system_to,
                                created_at, updated_at
                            ) VALUES (
                                :id, :org_id, 'brief', 'active',
                                :title, :description,
                                :confidence, :now, :now,
                                :valid_from, :valid_to, :system_from, :system_to,
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
                            **_temporal_fields(now),
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
                                why_this_matters, what_changed,
                                suggested_action, action_reasoning,
                                open_loops, priority_tier,
                                urgency_score, importance_score, sentiment_score,
                                intent_classification, conversation_id,
                                created_at, updated_at
                            ) VALUES (
                                :id, :uio_id, :summary,
                                :why_this_matters, :what_changed,
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
                            "why_this_matters": getattr(state.brief, "why_this_matters", None),
                            "what_changed": getattr(state.brief, "what_changed", None),
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
                                conversation_id, message_id, quoted_text, segment_hash, extracted_title,
                                confidence, added_at, source_timestamp,
                                detection_method, created_at
                            ) VALUES (
                                :id, :uio_id, :source_type,
                                :source_account_id, 'origin',
                                :conversation_id, :message_id, :quoted_text, :segment_hash, :title,
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
                            "message_id": _resolve_message_id(state, None),
                            "quoted_text": (state.input.content[:500] if state.input.content else None),
                            "segment_hash": build_segment_hash(state.input.content[:500])
                            if state.input.content
                            else None,
                            "title": state.brief.brief_summary[:200] if state.brief.brief_summary else None,
                            "confidence": 0.9,  # Briefs are generally high confidence
                            "now": now,
                            "source_timestamp": now,
                        },
                    )

                    await _audit_uio_source(
                        organization_id=state.input.organization_id,
                        evidence_id=brief_source_id,
                        uio_id=brief_uio_id,
                        uio_type="brief",
                        action="uio_created",
                        conversation_id=state.input.conversation_id,
                        message_id=_resolve_message_id(state, None),
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
                            ON CREATE SET r.firstContact = $now,
                                          r.lastContact = $now,
                                          r.messageCount = 1,
                                          r.validFrom = $valid_from,
                                          r.validTo = $valid_to,
                                          r.systemFrom = $system_from,
                                          r.systemTo = $system_to,
                                          r.createdAt = $created_at,
                                          r.updatedAt = $updated_at
                            ON MATCH SET r.lastContact = $now,
                                         r.messageCount = r.messageCount + 1,
                                         r.updatedAt = $updated_at
                            """,
                            {
                                "senderEmail": sender_email,
                                "receiverEmail": contact.email,
                                "orgId": state.input.organization_id,
                                "now": now.isoformat(),
                                **_temporal_relationship_props(now),
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
                createdAt: $createdAt,
                validFrom: $validFrom,
                validTo: $validTo,
                systemFrom: $systemFrom,
                systemTo: $systemTo
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
                **_temporal_graph_props(episode_now),
            },
        )

        # Link episode to created UIOs
        for uio in uios_created:
            await graph.query(
                """
                MATCH (e:Episode {id: $episodeId})
                MATCH (u {id: $uioId})
                CREATE (e)-[r:EXTRACTED]->(u)
                SET r.validFrom = $valid_from,
                    r.validTo = $valid_to,
                    r.systemFrom = $system_from,
                    r.systemTo = $system_to,
                    r.createdAt = $created_at,
                    r.updatedAt = $updated_at
                """,
                {
                    "episodeId": episode_id,
                    "uioId": uio["id"],
                    **_temporal_relationship_props(utc_now()),
                },
            )

        # Persist contradiction relationships and flags
        if state.contradiction_pairs:
            supersession_types = {
                "explicit_negation",
                "policy_change",
                "reversal",
                "supersedes",
            }
            async with get_db_session() as session:
                now = utc_now()
                for pair in state.contradiction_pairs:
                    mapping = created_uio_by_extracted_id.get(pair.get("new_id"))
                    if not mapping:
                        continue
                    new_uio_id = mapping["uio_id"]
                    existing_uio_id = pair.get("existing_id")
                    if not existing_uio_id:
                        continue

                    contradiction_type = pair.get("contradiction_type", "content_conflict")
                    severity = pair.get("severity", "medium")
                    evidence_id = mapping.get("evidence_id")

                    await session.execute(
                        text("""
                            UPDATE unified_intelligence_object
                            SET contradicts_existing = true,
                                last_updated_at = :now,
                                updated_at = :now
                            WHERE id = :new_id
                        """),
                        {
                            "now": now,
                            "new_id": new_uio_id,
                        },
                    )

                    await create_timeline_event(
                        session=session,
                        uio_id=new_uio_id,
                        event_type="contradiction_detected",
                        event_description=f"Contradicts {existing_uio_id} ({contradiction_type})",
                        source_type=state.input.source_type or "email",
                        source_id=state.input.conversation_id,
                        quoted_text=None,
                        evidence_id=evidence_id,
                        new_value={
                            "existing_id": existing_uio_id,
                            "type": contradiction_type,
                            "severity": severity,
                        },
                        confidence=None,
                        triggered_by="system",
                    )
                    await create_timeline_event(
                        session=session,
                        uio_id=existing_uio_id,
                        event_type="contradicted_by",
                        event_description=f"Contradicted by {new_uio_id} ({contradiction_type})",
                        source_type=state.input.source_type or "email",
                        source_id=state.input.conversation_id,
                        quoted_text=None,
                        evidence_id=evidence_id,
                        new_value={
                            "new_id": new_uio_id,
                            "type": contradiction_type,
                            "severity": severity,
                        },
                        confidence=None,
                        triggered_by="system",
                    )

                    try:
                        rel_props = _temporal_relationship_props(now)
                        await graph.query(
                            f"""
                            MATCH (n {{id: $new_id, organizationId: $org_id}})
                            MATCH (e {{id: $existing_id, organizationId: $org_id}})
                            MERGE (n)-[r:{GraphRelationshipType.CONTRADICTS.value}]->(e)
                            ON CREATE SET r.contradictionType = $contradiction_type,
                                          r.severity = $severity,
                                          r.evidenceId = $evidence_id,
                                          r.validFrom = $valid_from,
                                          r.validTo = $valid_to,
                                          r.systemFrom = $system_from,
                                          r.systemTo = $system_to,
                                          r.createdAt = $created_at,
                                          r.updatedAt = $updated_at
                            """,
                            {
                                "new_id": new_uio_id,
                                "existing_id": existing_uio_id,
                                "org_id": state.input.organization_id,
                                "contradiction_type": contradiction_type,
                                "severity": severity,
                                "evidence_id": evidence_id,
                                "valid_from": rel_props["validFrom"],
                                "valid_to": rel_props["validTo"],
                                "system_from": rel_props["systemFrom"],
                                "system_to": rel_props["systemTo"],
                                "created_at": rel_props["createdAt"],
                                "updated_at": rel_props["updatedAt"],
                            },
                        )
                    except Exception as exc:
                        logger.warning("Failed to create contradiction relationship", error=str(exc))

                    if contradiction_type in supersession_types:
                        await _apply_supersession(
                            session,
                            graph,
                            now=now,
                            organization_id=state.input.organization_id,
                            existing_uio_id=existing_uio_id,
                            new_uio_id=new_uio_id,
                            uio_type=mapping.get("type", "decision"),
                            evidence_id=evidence_id,
                            source_type=state.input.source_type or "email",
                            conversation_id=state.input.conversation_id,
                            message_id=None,
                        )

                await session.commit()

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
