"""
Link Intelligence Node

Cross-links intelligence objects (commitments, decisions, risks, tasks)
to create a connected knowledge graph with relationships like:
- IMPACTS: Decision impacts Commitment
- THREATENS: Risk threatens Decision/Commitment
- FULFILLS: Task fulfills Commitment
- RELATED_TO: General related items
- DEPENDS_ON: Dependencies between items

This is part of Phase 2 (Wider Graph) of the FalkorDB enhancement plan.
"""

import time
from uuid import uuid4

import structlog

from ..state import IntelligenceState, NodeTiming

logger = structlog.get_logger()


async def link_intelligence_node(state: IntelligenceState) -> dict:
    """
    Cross-link intelligence objects to create a connected knowledge graph.

    This node:
    1. Links Decisions to Commitments they impact
    2. Links Risks to Decisions/Commitments they threaten
    3. Links Tasks to Commitments they fulfill
    4. Identifies and links related items via semantic similarity

    These connections enable:
    - Impact analysis: "What commitments are affected by this decision?"
    - Risk tracking: "What risks threaten this commitment?"
    - Task tracking: "What tasks fulfill this commitment?"
    - Related intelligence discovery

    Returns:
        State update with links_created count
    """
    start_time = time.time()

    logger.info(
        "Linking intelligence objects",
        analysis_id=state.analysis_id,
        commitments=len(state.extracted.commitments),
        decisions=len(state.extracted.decisions),
        risks=len(state.extracted.risks),
        tasks=len(state.extracted.tasks),
    )

    # Update trace
    state.trace.current_node = "link_intelligence"
    state.trace.nodes.append("link_intelligence")

    links_created = 0

    try:
        from src.graph.client import get_graph_client
        graph = await get_graph_client()

        # 1. Link Decisions to Commitments they impact
        # A decision impacts a commitment if they share participants or mention similar topics
        for decision in state.extracted.decisions:
            for commitment in state.extracted.commitments:
                impact_reason = _check_decision_impacts_commitment(decision, commitment)
                if impact_reason:
                    await _create_relationship(
                        graph=graph,
                        from_type="Decision",
                        from_id=decision.id,
                        to_type="Commitment",
                        to_id=commitment.id,
                        rel_type="IMPACTS",
                        properties={
                            "reason": impact_reason,
                            "confidence": 0.7,
                        },
                    )
                    links_created += 1
                    logger.debug(
                        "Linked decision to commitment",
                        decision=decision.title[:50],
                        commitment=commitment.title[:50],
                        reason=impact_reason,
                    )

        # 2. Link Risks to Decisions/Commitments they threaten
        for risk in state.extracted.risks:
            # Link to related UIOs mentioned in the risk
            related_uio_ids = getattr(risk, "related_uio_ids", []) or []
            for uio_id in related_uio_ids:
                # Try to find the UIO type
                for commitment in state.extracted.commitments:
                    if commitment.id == uio_id:
                        await _create_relationship(
                            graph=graph,
                            from_type="Risk",
                            from_id=risk.id,
                            to_type="Commitment",
                            to_id=commitment.id,
                            rel_type="THREATENS",
                            properties={
                                "severity": risk.severity,
                                "confidence": 0.8,
                            },
                        )
                        links_created += 1
                        break

                for decision in state.extracted.decisions:
                    if decision.id == uio_id:
                        await _create_relationship(
                            graph=graph,
                            from_type="Risk",
                            from_id=risk.id,
                            to_type="Decision",
                            to_id=decision.id,
                            rel_type="THREATENS",
                            properties={
                                "severity": risk.severity,
                                "confidence": 0.8,
                            },
                        )
                        links_created += 1
                        break

            # Also check text similarity for implicit threats
            for commitment in state.extracted.commitments:
                if _text_overlap(risk.title or "", commitment.title):
                    await _create_relationship(
                        graph=graph,
                        from_type="Risk",
                        from_id=risk.id,
                        to_type="Commitment",
                        to_id=commitment.id,
                        rel_type="THREATENS",
                        properties={
                            "severity": risk.severity,
                            "confidence": 0.6,
                            "reason": "text_similarity",
                        },
                    )
                    links_created += 1

        # 3. Link Tasks to Commitments they fulfill
        for task in state.extracted.tasks:
            # If task has a source commitment ID
            source_commitment_id = getattr(task, "source_commitment_id", None)
            if source_commitment_id:
                await _create_relationship(
                    graph=graph,
                    from_type="Task",
                    from_id=task.id,
                    to_type="Commitment",
                    to_id=source_commitment_id,
                    rel_type="FULFILLS",
                    properties={
                        "confidence": 0.9,
                    },
                )
                links_created += 1

            # Also check for title similarity
            for commitment in state.extracted.commitments:
                if _text_overlap(task.title, commitment.title):
                    await _create_relationship(
                        graph=graph,
                        from_type="Task",
                        from_id=task.id,
                        to_type="Commitment",
                        to_id=commitment.id,
                        rel_type="FULFILLS",
                        properties={
                            "confidence": 0.6,
                            "reason": "text_similarity",
                        },
                    )
                    links_created += 1

        # 4. Link related commitments
        for i, c1 in enumerate(state.extracted.commitments):
            for c2 in state.extracted.commitments[i + 1:]:
                # Check for shared participants
                shared_participants = _has_shared_participants(c1, c2)
                if shared_participants:
                    await _create_relationship(
                        graph=graph,
                        from_type="Commitment",
                        from_id=c1.id,
                        to_type="Commitment",
                        to_id=c2.id,
                        rel_type="RELATED_TO",
                        properties={
                            "reason": "shared_participants",
                            "confidence": 0.7,
                        },
                    )
                    links_created += 1

                # Check for text overlap
                elif _text_overlap(c1.title, c2.title):
                    await _create_relationship(
                        graph=graph,
                        from_type="Commitment",
                        from_id=c1.id,
                        to_type="Commitment",
                        to_id=c2.id,
                        rel_type="RELATED_TO",
                        properties={
                            "reason": "text_similarity",
                            "confidence": 0.5,
                        },
                    )
                    links_created += 1

        # 5. Link related decisions
        for i, d1 in enumerate(state.extracted.decisions):
            for d2 in state.extracted.decisions[i + 1:]:
                if _text_overlap(d1.title, d2.title):
                    await _create_relationship(
                        graph=graph,
                        from_type="Decision",
                        from_id=d1.id,
                        to_type="Decision",
                        to_id=d2.id,
                        rel_type="RELATED_TO",
                        properties={
                            "reason": "text_similarity",
                            "confidence": 0.5,
                        },
                    )
                    links_created += 1

        logger.info(
            "Intelligence objects linked",
            analysis_id=state.analysis_id,
            links_created=links_created,
        )

    except Exception as e:
        logger.error(
            "Failed to link intelligence objects",
            analysis_id=state.analysis_id,
            error=str(e),
        )
        # Don't fail the pipeline
        links_created = 0

    # Record timing
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "intelligence_links_created": links_created,
        "trace": {
            **state.trace.model_dump(),
            "node_timings": {
                **state.trace.node_timings,
                "link_intelligence": node_timing,
            },
        },
    }


def _check_decision_impacts_commitment(decision, commitment) -> str | None:
    """
    Check if a decision impacts a commitment.

    Returns the reason if it does, None otherwise.
    """
    # Check for shared participants
    decision_stakeholders = getattr(decision, "stakeholders", []) or []
    commitment_debtor = getattr(commitment, "debtor_email", None)
    commitment_creditor = getattr(commitment, "creditor_email", None)

    if commitment_debtor and commitment_debtor.lower() in [s.lower() for s in decision_stakeholders]:
        return "shared_debtor"
    if commitment_creditor and commitment_creditor.lower() in [s.lower() for s in decision_stakeholders]:
        return "shared_creditor"

    # Check for text overlap in titles
    if _text_overlap(decision.title or "", commitment.title or ""):
        return "text_similarity"

    # Check if decision affects commitment's topic
    decision_implications = getattr(decision, "implications", []) or []
    for impl in decision_implications:
        if isinstance(impl, str) and commitment.title.lower() in impl.lower():
            return "implication_match"

    return None


def _has_shared_participants(c1, c2) -> bool:
    """Check if two commitments share participants."""
    c1_participants = set()
    if c1.debtor_email:
        c1_participants.add(c1.debtor_email.lower())
    if c1.creditor_email:
        c1_participants.add(c1.creditor_email.lower())

    c2_participants = set()
    if c2.debtor_email:
        c2_participants.add(c2.debtor_email.lower())
    if c2.creditor_email:
        c2_participants.add(c2.creditor_email.lower())

    return bool(c1_participants & c2_participants)


def _text_overlap(text1: str, text2: str, threshold: float = 0.3) -> bool:
    """
    Check if two texts have significant word overlap.

    Args:
        text1: First text
        text2: Second text
        threshold: Minimum Jaccard similarity threshold

    Returns:
        True if texts have significant overlap
    """
    if not text1 or not text2:
        return False

    # Tokenize and normalize
    words1 = set(text1.lower().split())
    words2 = set(text2.lower().split())

    # Remove common stop words
    stop_words = {
        "the", "a", "an", "to", "and", "or", "is", "are", "was", "were",
        "be", "been", "being", "have", "has", "had", "do", "does", "did",
        "will", "would", "could", "should", "may", "might", "must",
        "i", "you", "he", "she", "it", "we", "they", "my", "your",
        "his", "her", "its", "our", "their", "this", "that", "these",
        "those", "in", "on", "at", "by", "for", "with", "about",
    }
    words1 = words1 - stop_words
    words2 = words2 - stop_words

    if not words1 or not words2:
        return False

    # Calculate Jaccard similarity
    intersection = len(words1 & words2)
    union = len(words1 | words2)

    similarity = intersection / union if union > 0 else 0

    return similarity >= threshold


async def _create_relationship(
    graph,
    from_type: str,
    from_id: str,
    to_type: str,
    to_id: str,
    rel_type: str,
    properties: dict | None = None,
) -> bool:
    """
    Create a relationship between two nodes if it doesn't exist.

    Returns True if created, False if already exists.
    """
    properties = properties or {}

    try:
        # Use MERGE to avoid duplicates
        props_str = ", ".join(f"r.{k} = ${k}" for k in properties.keys())
        set_clause = f"SET {props_str}" if props_str else ""

        query = f"""
            MATCH (a:{from_type} {{id: $fromId}})
            MATCH (b:{to_type} {{id: $toId}})
            MERGE (a)-[r:{rel_type}]->(b)
            {set_clause}
            RETURN r
        """

        params = {
            "fromId": from_id,
            "toId": to_id,
            **properties,
        }

        await graph.query(query, params)
        return True

    except Exception as e:
        logger.warning(
            "Failed to create relationship",
            from_type=from_type,
            to_type=to_type,
            rel_type=rel_type,
            error=str(e),
        )
        return False
