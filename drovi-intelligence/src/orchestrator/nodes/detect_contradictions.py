"""
Contradiction Detection Node

Detects contradictions between newly extracted intelligence and existing graph data.
Creates CONTRADICTS relationships and Risk objects for significant contradictions.

From the pitch: "Detects contradictions", "Risks - contradictions"
"""

import time
from datetime import datetime
from typing import Any

import structlog

from src.search.embeddings import generate_embedding, EmbeddingError
from ..state import (
    IntelligenceState,
    DetectedRisk,
    NodeTiming,
)

logger = structlog.get_logger()

# Similarity thresholds
TOPIC_SIMILARITY_THRESHOLD = 0.7  # Same topic but different content
CONTRADICTION_SIMILARITY_THRESHOLD = 0.6  # Similar enough to compare


async def detect_contradictions_node(state: IntelligenceState) -> dict:
    """
    Detect contradictions between new extractions and existing intelligence.

    This node:
    1. Finds existing decisions/commitments on similar topics
    2. Uses LLM to detect semantic contradictions
    3. Creates Risk objects for detected contradictions
    4. Records CONTRADICTS relationships for the persist node

    Returns:
        State update with detected contradictions as risks
    """
    start_time = time.time()

    logger.info(
        "Detecting contradictions",
        analysis_id=state.analysis_id,
        decision_count=len(state.extracted.decisions),
        commitment_count=len(state.extracted.commitments),
    )

    # Update trace
    state.trace.current_node = "detect_contradictions"
    state.trace.nodes.append("detect_contradictions")

    new_risks: list[DetectedRisk] = []
    contradiction_pairs: list[dict[str, Any]] = []

    try:
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        # Check decisions for contradictions
        for decision in state.extracted.decisions:
            try:
                contradictions = await _check_decision_contradictions(
                    graph,
                    decision,
                    state.input.organization_id,
                )
                for contradiction in contradictions:
                    risk = _create_contradiction_risk(
                        new_item_type="Decision",
                        new_item_id=decision.id,
                        new_item_title=decision.title,
                        existing_item=contradiction,
                        quoted_text=decision.quoted_text,
                    )
                    new_risks.append(risk)
                    contradiction_pairs.append({
                        "new_id": decision.id,
                        "new_type": "Decision",
                        "existing_id": contradiction["id"],
                        "existing_type": "Decision",
                        "contradiction_type": contradiction.get("contradiction_type", "content_conflict"),
                        "evidence": contradiction.get("evidence"),
                        "severity": contradiction.get("severity", "medium"),
                    })
            except Exception as e:
                logger.warning(
                    "Failed to check decision contradictions",
                    decision_id=decision.id,
                    error=str(e),
                )

        # Check commitments for contradictions
        for commitment in state.extracted.commitments:
            try:
                contradictions = await _check_commitment_contradictions(
                    graph,
                    commitment,
                    state.input.organization_id,
                )
                for contradiction in contradictions:
                    risk = _create_contradiction_risk(
                        new_item_type="Commitment",
                        new_item_id=commitment.id,
                        new_item_title=commitment.title,
                        existing_item=contradiction,
                        quoted_text=commitment.quoted_text,
                    )
                    new_risks.append(risk)
                    contradiction_pairs.append({
                        "new_id": commitment.id,
                        "new_type": "Commitment",
                        "existing_id": contradiction["id"],
                        "existing_type": "Commitment",
                        "contradiction_type": contradiction.get("contradiction_type", "content_conflict"),
                        "evidence": contradiction.get("evidence"),
                        "severity": contradiction.get("severity", "medium"),
                    })
            except Exception as e:
                logger.warning(
                    "Failed to check commitment contradictions",
                    commitment_id=commitment.id,
                    error=str(e),
                )

        logger.info(
            "Contradiction detection complete",
            analysis_id=state.analysis_id,
            contradictions_found=len(new_risks),
        )

    except Exception as e:
        logger.warning(
            "Contradiction detection failed, continuing",
            analysis_id=state.analysis_id,
            error=str(e),
        )

    # Add new risks to existing risks
    all_risks = list(state.extracted.risks) + new_risks

    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "extracted": {
            **state.extracted.model_dump(),
            "risks": [r.model_dump() for r in all_risks],
        },
        "trace": {
            **state.trace.model_dump(),
            "current_node": "detect_contradictions",
            "node_timings": {
                **state.trace.node_timings,
                "detect_contradictions": node_timing,
            },
        },
        # Store contradiction pairs for the persist node to create relationships
        "_contradiction_pairs": contradiction_pairs,
    }


async def _check_decision_contradictions(
    graph: Any,
    decision: Any,
    organization_id: str,
) -> list[dict]:
    """Check for contradictions with existing decisions."""
    contradictions = []

    # Generate embedding for the new decision
    embed_text = f"{decision.title} {decision.statement or ''}"
    try:
        embedding = await generate_embedding(embed_text)
    except EmbeddingError:
        return []

    # Find similar existing decisions (same topic area)
    similar = await graph.vector_search(
        label="Decision",
        embedding=embedding,
        organization_id=organization_id,
        k=5,
    )

    for match in similar:
        score = match.get("score", 0)
        if score < CONTRADICTION_SIMILARITY_THRESHOLD:
            continue

        existing = match.get("node", match)
        existing_id = existing.get("id")
        if not existing_id:
            continue

        # Skip if very high similarity (likely duplicate, not contradiction)
        if score > 0.92:
            continue

        # Check for semantic contradiction
        contradiction_result = await _analyze_decision_contradiction(
            new_decision=decision,
            existing_decision=existing,
        )

        if contradiction_result.get("is_contradiction"):
            contradictions.append({
                "id": existing_id,
                "title": existing.get("title"),
                "statement": existing.get("statement"),
                "contradiction_type": contradiction_result.get("type", "content_conflict"),
                "evidence": contradiction_result.get("evidence"),
                "severity": contradiction_result.get("severity", "medium"),
                "similarity": score,
            })

    return contradictions


async def _check_commitment_contradictions(
    graph: Any,
    commitment: Any,
    organization_id: str,
) -> list[dict]:
    """Check for contradictions with existing commitments."""
    contradictions = []

    # Generate embedding for the new commitment
    embed_text = f"{commitment.title} {commitment.description or ''}"
    try:
        embedding = await generate_embedding(embed_text)
    except EmbeddingError:
        return []

    # Find similar existing commitments
    similar = await graph.vector_search(
        label="Commitment",
        embedding=embedding,
        organization_id=organization_id,
        k=5,
    )

    for match in similar:
        score = match.get("score", 0)
        if score < CONTRADICTION_SIMILARITY_THRESHOLD:
            continue

        existing = match.get("node", match)
        existing_id = existing.get("id")
        if not existing_id:
            continue

        # Skip if very high similarity (likely duplicate)
        if score > 0.92:
            continue

        # Check for commitment conflicts
        contradiction_result = await _analyze_commitment_contradiction(
            new_commitment=commitment,
            existing_commitment=existing,
        )

        if contradiction_result.get("is_contradiction"):
            contradictions.append({
                "id": existing_id,
                "title": existing.get("title"),
                "description": existing.get("description"),
                "contradiction_type": contradiction_result.get("type", "content_conflict"),
                "evidence": contradiction_result.get("evidence"),
                "severity": contradiction_result.get("severity", "medium"),
                "similarity": score,
            })

    return contradictions


async def _analyze_decision_contradiction(
    new_decision: Any,
    existing_decision: dict,
) -> dict:
    """
    Analyze whether two decisions contradict each other.

    Uses heuristics and optionally LLM for semantic analysis.
    """
    from src.llm.client import get_llm_client

    # Quick heuristics first
    new_statement = (new_decision.statement or "").lower()
    existing_statement = (existing_decision.get("statement") or "").lower()

    # Check for explicit negation patterns
    negation_patterns = [
        ("will", "will not"),
        ("won't", "will"),
        ("should", "should not"),
        ("shouldn't", "should"),
        ("can", "cannot"),
        ("can't", "can"),
        ("approve", "reject"),
        ("accept", "decline"),
        ("yes", "no"),
        ("proceed", "stop"),
        ("continue", "discontinue"),
    ]

    for pos, neg in negation_patterns:
        if (pos in new_statement and neg in existing_statement) or \
           (neg in new_statement and pos in existing_statement):
            return {
                "is_contradiction": True,
                "type": "explicit_negation",
                "evidence": f"New: '{new_decision.title}' vs Existing: '{existing_decision.get('title')}'",
                "severity": "high",
            }

    # Check if decisions are on similar topic but with different outcomes
    # Use LLM for semantic analysis
    try:
        llm = await get_llm_client()

        prompt = f"""Analyze whether these two decisions contradict each other.

DECISION 1 (New):
Title: {new_decision.title}
Statement: {new_decision.statement}

DECISION 2 (Existing):
Title: {existing_decision.get('title')}
Statement: {existing_decision.get('statement')}

Answer with a JSON object:
{{
    "is_contradiction": true/false,
    "type": "explicit_negation" | "implicit_conflict" | "scope_overlap" | "timing_conflict" | "none",
    "evidence": "Brief explanation of the contradiction if any",
    "severity": "low" | "medium" | "high"
}}

Only return the JSON, nothing else."""

        response = await llm.chat(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
        )

        import json
        result = json.loads(response.content)
        return result

    except Exception as e:
        logger.warning("LLM contradiction analysis failed", error=str(e))
        return {"is_contradiction": False}


async def _analyze_commitment_contradiction(
    new_commitment: Any,
    existing_commitment: dict,
) -> dict:
    """
    Analyze whether two commitments contradict each other.

    Checks for:
    - Conflicting deliverables
    - Conflicting timelines
    - Conflicting parties
    """
    # Check for timeline conflicts (same deliverable, different due dates)
    new_due = new_commitment.due_date
    existing_due = existing_commitment.get("dueDate")

    if new_due and existing_due:
        # If same title but different due dates, that's a potential conflict
        new_title_lower = new_commitment.title.lower()
        existing_title_lower = (existing_commitment.get("title") or "").lower()

        # Simple keyword overlap check
        new_words = set(new_title_lower.split())
        existing_words = set(existing_title_lower.split())
        overlap = len(new_words & existing_words) / max(len(new_words | existing_words), 1)

        if overlap > 0.5:
            # Same topic, check if due dates conflict
            try:
                new_due_dt = new_due if isinstance(new_due, datetime) else datetime.fromisoformat(str(new_due))
                existing_due_dt = datetime.fromisoformat(str(existing_due).replace("Z", "+00:00"))

                if abs((new_due_dt - existing_due_dt.replace(tzinfo=None)).days) > 7:
                    return {
                        "is_contradiction": True,
                        "type": "timing_conflict",
                        "evidence": f"Same commitment with different due dates: {new_due_dt.date()} vs {existing_due_dt.date()}",
                        "severity": "medium",
                    }
            except Exception:
                pass

    # Check for direction conflicts (same item but opposite direction)
    new_direction = new_commitment.direction
    existing_direction = existing_commitment.get("direction")

    if new_direction and existing_direction and new_direction != existing_direction:
        new_title_lower = new_commitment.title.lower()
        existing_title_lower = (existing_commitment.get("title") or "").lower()

        new_words = set(new_title_lower.split())
        existing_words = set(existing_title_lower.split())
        overlap = len(new_words & existing_words) / max(len(new_words | existing_words), 1)

        if overlap > 0.6:
            return {
                "is_contradiction": True,
                "type": "direction_conflict",
                "evidence": f"Same commitment but opposite direction: {new_direction} vs {existing_direction}",
                "severity": "high",
            }

    return {"is_contradiction": False}


def _create_contradiction_risk(
    new_item_type: str,
    new_item_id: str,
    new_item_title: str,
    existing_item: dict,
    quoted_text: str | None = None,
) -> DetectedRisk:
    """Create a Risk object for a detected contradiction."""
    return DetectedRisk(
        type="contradiction",
        title=f"Contradiction detected: {new_item_title[:50]}",
        description=(
            f"New {new_item_type.lower()} '{new_item_title}' contradicts existing "
            f"{new_item_type.lower()} '{existing_item.get('title', 'unknown')}'. "
            f"Type: {existing_item.get('contradiction_type', 'unknown')}. "
            f"{existing_item.get('evidence', '')}"
        ),
        severity=existing_item.get("severity", "medium"),
        related_to=[
            {"type": new_item_type, "reference": new_item_id},
            {"type": new_item_type, "reference": existing_item.get("id")},
        ],
        suggested_action=f"Review both {new_item_type.lower()}s and resolve the conflict",
        quoted_text=quoted_text,
        confidence=0.7 + (existing_item.get("similarity", 0) * 0.2),
        reasoning=f"Contradiction type: {existing_item.get('contradiction_type')}",
    )
