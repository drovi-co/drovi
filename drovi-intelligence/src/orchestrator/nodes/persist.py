"""
Persist Node

Persists extracted intelligence to PostgreSQL and FalkorDB.
"""

import json
import time
from datetime import datetime
from uuid import uuid4

import structlog
from sqlalchemy import text

from ..state import (
    IntelligenceState,
    Output,
    NodeTiming,
)

logger = structlog.get_logger()


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

    # Build merge lookup
    merge_lookup = {
        mc.new_item_id: mc
        for mc in state.deduplication.merge_candidates
        if mc.should_merge
    }

    try:
        # Import clients
        from src.graph.client import get_graph_client
        from src.db.client import get_db_session

        graph = await get_graph_client()

        # Persist commitments
        async with get_db_session() as session:
            for commitment in state.extracted.commitments:
                # Check if should merge
                merge_candidate = merge_lookup.get(commitment.id)

                if merge_candidate:
                    # Update existing UIO
                    uios_merged.append({
                        "sourceId": commitment.id,
                        "targetId": merge_candidate.existing_uio_id,
                    })

                    logger.debug(
                        "Merging commitment",
                        new_id=commitment.id,
                        existing_id=merge_candidate.existing_uio_id,
                    )

                    # Would update existing record in PostgreSQL
                    # Would update graph node properties

                else:
                    # Create new UIO
                    uio_id = str(uuid4())
                    now = datetime.utcnow()

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
                            "due_date": commitment.due_date,
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
                            "due_date": commitment.due_date,
                            "due_date_confidence": commitment.confidence if commitment.due_date else None,
                            "due_date_text": commitment.due_date_text,
                            "priority": commitment.priority,
                            "confidence": commitment.confidence,
                            "source_account_id": state.input.source_account_id,
                            "conversation_id": state.input.conversation_id,
                            "now": now,
                        },
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

        # Persist decisions
        async with get_db_session() as session:
            for decision in state.extracted.decisions:
                merge_candidate = merge_lookup.get(decision.id)

                if merge_candidate:
                    uios_merged.append({
                        "sourceId": decision.id,
                        "targetId": merge_candidate.existing_uio_id,
                    })
                else:
                    uio_id = str(uuid4())
                    now = datetime.utcnow()

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

        # Persist risks (stored in graph only for now)
        for risk in state.extracted.risks:
            risk_id = str(uuid4())
            now = datetime.utcnow()

            try:
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
                        "id": risk_id,
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
                    "id": risk_id,
                    "type": "risk",
                })

                logger.debug(
                    "Created risk",
                    risk_id=risk_id,
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

        # Persist tasks to PostgreSQL
        async with get_db_session() as session:
            for task in state.extracted.tasks:
                task_id = str(uuid4())
                now = datetime.utcnow()

                await session.execute(
                    text("""
                        INSERT INTO task (
                            id, organization_id, title, description,
                            status, priority, assignee_email,
                            due_date, source_type, created_at, updated_at
                        ) VALUES (
                            :id, :org_id, :title, :description,
                            :status, :priority, :assignee_email,
                            :due_date, :source_type, :now, :now
                        )
                    """),
                    {
                        "id": task_id,
                        "org_id": state.input.organization_id,
                        "title": task.title,
                        "description": task.description or "",
                        "status": task.status or "todo",
                        "priority": task.priority or "medium",
                        "assignee_email": task.assignee_email,
                        "due_date": task.due_date,
                        "source_type": state.input.source_type,
                        "now": now,
                    },
                )
                tasks_created.append({"id": task_id, "title": task.title})

            await session.commit()

        # Persist claims to PostgreSQL
        claims_created = []
        async with get_db_session() as session:
            for claim in state.extracted.claims:
                claim_id = str(uuid4())
                now = datetime.utcnow()

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
                        "text": claim.text,
                        "confidence": claim.confidence,
                        "conversation_id": state.input.conversation_id,
                        "now": now,
                    },
                )
                claims_created.append({"id": claim_id, "type": claim.type})

            await session.commit()

        # Persist contacts to PostgreSQL (sync with graph)
        contacts_created = []
        async with get_db_session() as session:
            for contact in state.extracted.contacts:
                if not contact.id or not contact.email:
                    continue  # Skip contacts without ID or email

                now = datetime.utcnow()

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

        # Update conversation with brief data
        if state.input.conversation_id and state.brief.brief_summary:
            async with get_db_session() as session:
                try:
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
                            "now": datetime.utcnow(),
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
            now = datetime.utcnow()

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
        episode_now = datetime.utcnow()
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
