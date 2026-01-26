"""
Pattern Match Node

Implements Klein's Recognition-Primed Decisions (RPD) model:
- Experts don't analyze, they RECOGNIZE patterns
- Match incoming intelligence against learned patterns
- Boost confidence when patterns match
- Enable rapid, intuitive responses to familiar situations

From the "Trillion Dollar Hole" research:
- Capture domain-specific patterns that indicate significant situations
- Two-stage matching: semantic (vector similarity) + structural (Cypher patterns)
"""

import time
from typing import Any

import structlog
from pydantic import BaseModel, Field

from ..state import (
    IntelligenceState,
    NodeTiming,
)

logger = structlog.get_logger()


class MatchedPattern(BaseModel):
    """A pattern that was matched against the current content."""

    pattern_id: str
    pattern_name: str
    description: str | None = None

    # Match quality
    semantic_score: float  # 0-1, vector similarity
    structural_match: bool  # Whether Cypher pattern matched

    # Klein's RPD components
    salient_features: list[str] = Field(default_factory=list)
    typical_expectations: list[str] = Field(default_factory=list)
    suggested_action: str | None = None
    plausible_goals: list[str] = Field(default_factory=list)

    # Impact
    confidence_boost: float = 0.0  # How much to boost intelligence confidence
    domain: str | None = None


class PatternMatchResult(BaseModel):
    """Result of pattern matching."""

    matched_patterns: list[MatchedPattern] = Field(default_factory=list)
    total_patterns_checked: int = 0
    confidence_boost: float = 0.0  # Maximum boost from all matches
    dominant_pattern_id: str | None = None


async def pattern_match_node(state: IntelligenceState) -> dict:
    """
    Match incoming intelligence against learned patterns.

    From Klein's Recognition-Primed Decisions (RPD):
    - Pattern recognition is how experts make fast, accurate decisions
    - Patterns capture "what makes this situation distinctive"
    - When matched, patterns provide expectations and typical actions

    Pipeline position: After classify, before extraction

    Args:
        state: Current intelligence state with classified content

    Returns:
        Dict with matched_patterns and confidence_boost
    """
    start_time = time.time()

    logger.info(
        "Starting pattern matching",
        analysis_id=state.analysis_id,
        organization_id=state.input.organization_id,
    )

    result = PatternMatchResult()

    try:
        from ...graph.client import get_graph_client
        from ...embedding.service import get_embedding

        graph = await get_graph_client()
        organization_id = state.input.organization_id

        # Get content embedding for semantic matching
        content = state.input.content
        content_embedding = await get_embedding(content[:8000])  # Limit for embedding

        # Get active patterns for this organization
        patterns = await _get_active_patterns(graph, organization_id)
        result.total_patterns_checked = len(patterns)

        if not patterns:
            logger.debug("No active patterns for organization", org_id=organization_id)
        else:
            # Two-stage matching
            for pattern in patterns:
                matched_pattern = await _match_pattern(
                    pattern=pattern,
                    content_embedding=content_embedding,
                    content=content,
                    graph=graph,
                    state=state,
                )

                if matched_pattern:
                    result.matched_patterns.append(matched_pattern)

                    # Track maximum confidence boost
                    if matched_pattern.confidence_boost > result.confidence_boost:
                        result.confidence_boost = matched_pattern.confidence_boost
                        result.dominant_pattern_id = matched_pattern.pattern_id

            # Update pattern match counts in graph
            for pattern in result.matched_patterns:
                await _record_pattern_match(graph, pattern.pattern_id)

        if result.matched_patterns:
            logger.info(
                "Patterns matched",
                analysis_id=state.analysis_id,
                matched_count=len(result.matched_patterns),
                confidence_boost=result.confidence_boost,
                dominant_pattern=result.dominant_pattern_id,
            )

    except Exception as e:
        logger.error(
            "Pattern matching failed",
            error=str(e),
            analysis_id=state.analysis_id,
        )
        # Don't fail the pipeline

    # Update trace
    elapsed = time.time() - start_time
    updated_trace = state.trace.model_copy()
    updated_trace.nodes = [*state.trace.nodes, "pattern_match"]
    updated_trace.current_node = "pattern_match"
    updated_trace.node_timings["pattern_match"] = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    return {
        "trace": updated_trace,
        "matched_patterns": result.matched_patterns,
        "pattern_confidence_boost": result.confidence_boost,
    }


async def _get_active_patterns(graph, organization_id: str) -> list[dict]:
    """Get all active patterns for an organization."""
    try:
        result = await graph.query(
            """
            MATCH (p:Pattern)
            WHERE (p.organizationId = $org_id OR p.organizationId IS NULL)
            AND p.isActive = true
            RETURN p.id as id,
                   p.name as name,
                   p.description as description,
                   p.triggerCypher as trigger_cypher,
                   p.triggerEmbedding as trigger_embedding,
                   p.semanticThreshold as semantic_threshold,
                   p.salientFeatures as salient_features,
                   p.typicalExpectations as typical_expectations,
                   p.typicalAction as typical_action,
                   p.plausibleGoals as plausible_goals,
                   p.domain as domain,
                   p.confidenceThreshold as confidence_threshold,
                   p.confidenceBoost as confidence_boost,
                   p.accuracyRate as accuracy_rate
            ORDER BY p.accuracyRate DESC, p.timesMatched DESC
            LIMIT 50
            """,
            {"org_id": organization_id},
        )
        return result or []
    except Exception as e:
        logger.warning("Failed to get patterns", error=str(e))
        return []


async def _match_pattern(
    pattern: dict,
    content_embedding: list[float],
    content: str,
    graph,
    state: IntelligenceState,
) -> MatchedPattern | None:
    """
    Match a single pattern against content using two-stage matching.

    Stage 1: Semantic similarity (fast, vector-based)
    Stage 2: Structural matching (precise, Cypher-based)
    """
    pattern_id = pattern["id"]
    semantic_threshold = pattern.get("semantic_threshold", 0.8)
    trigger_embedding = pattern.get("trigger_embedding")

    # Stage 1: Semantic matching
    semantic_score = 0.0
    if trigger_embedding:
        semantic_score = _cosine_similarity(content_embedding, trigger_embedding)

        if semantic_score < semantic_threshold:
            # Below threshold - no match
            return None

    # Stage 2: Structural matching (if Cypher pattern exists)
    structural_match = False
    trigger_cypher = pattern.get("trigger_cypher")

    if trigger_cypher:
        try:
            # Execute the pattern's Cypher query with context
            cypher_result = await graph.query(
                trigger_cypher,
                {
                    "org_id": state.input.organization_id,
                    "content": content[:2000],
                    "source_type": state.input.source_type,
                },
            )
            structural_match = bool(cypher_result and len(cypher_result) > 0)
        except Exception as e:
            logger.debug(
                "Cypher pattern execution failed",
                pattern_id=pattern_id,
                error=str(e),
            )

    # Require either high semantic score OR structural match
    if semantic_score < 0.9 and not structural_match:
        return None

    # Pattern matched!
    return MatchedPattern(
        pattern_id=pattern_id,
        pattern_name=pattern.get("name", "Unknown"),
        description=pattern.get("description"),
        semantic_score=semantic_score,
        structural_match=structural_match,
        salient_features=pattern.get("salient_features", []),
        typical_expectations=pattern.get("typical_expectations", []),
        suggested_action=pattern.get("typical_action"),
        plausible_goals=pattern.get("plausible_goals", []),
        confidence_boost=pattern.get("confidence_boost", 0.15),
        domain=pattern.get("domain"),
    )


def _cosine_similarity(vec1: list[float], vec2: list[float]) -> float:
    """Calculate cosine similarity between two vectors."""
    if not vec1 or not vec2 or len(vec1) != len(vec2):
        return 0.0

    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    magnitude1 = sum(a * a for a in vec1) ** 0.5
    magnitude2 = sum(b * b for b in vec2) ** 0.5

    if magnitude1 == 0 or magnitude2 == 0:
        return 0.0

    return dot_product / (magnitude1 * magnitude2)


async def _record_pattern_match(graph, pattern_id: str) -> None:
    """Record that a pattern was matched (for learning metrics)."""
    try:
        await graph.query(
            """
            MATCH (p:Pattern {id: $pattern_id})
            SET p.timesMatched = COALESCE(p.timesMatched, 0) + 1,
                p.lastMatchedAt = datetime()
            """,
            {"pattern_id": pattern_id},
        )
    except Exception as e:
        logger.debug("Failed to record pattern match", error=str(e))


async def record_pattern_feedback(
    pattern_id: str,
    was_correct: bool,
    user_id: str,
    graph=None,
) -> None:
    """
    Record user feedback on pattern match for learning.

    Args:
        pattern_id: ID of the pattern
        was_correct: Whether the pattern match was correct
        user_id: ID of user providing feedback
        graph: Optional graph client
    """
    if graph is None:
        from ...graph.client import get_graph_client
        graph = await get_graph_client()

    try:
        if was_correct:
            # Confirmed - improve accuracy
            await graph.query(
                """
                MATCH (p:Pattern {id: $pattern_id})
                SET p.timesConfirmed = COALESCE(p.timesConfirmed, 0) + 1,
                    p.accuracyRate = toFloat(COALESCE(p.timesConfirmed, 0) + 1) /
                                     (COALESCE(p.timesConfirmed, 0) + COALESCE(p.timesRejected, 0) + 1)
                WITH p
                MATCH (u:Contact {userId: $user_id})
                MERGE (p)-[:CONFIRMED_BY {timestamp: datetime()}]->(u)
                """,
                {"pattern_id": pattern_id, "user_id": user_id},
            )
        else:
            # Rejected - decrease accuracy
            await graph.query(
                """
                MATCH (p:Pattern {id: $pattern_id})
                SET p.timesRejected = COALESCE(p.timesRejected, 0) + 1,
                    p.accuracyRate = toFloat(COALESCE(p.timesConfirmed, 0)) /
                                     (COALESCE(p.timesConfirmed, 0) + COALESCE(p.timesRejected, 0) + 1)
                WITH p
                MATCH (u:Contact {userId: $user_id})
                MERGE (p)-[:REJECTED_BY {timestamp: datetime()}]->(u)
                """,
                {"pattern_id": pattern_id, "user_id": user_id},
            )

            # Deactivate pattern if accuracy drops too low
            await graph.query(
                """
                MATCH (p:Pattern {id: $pattern_id})
                WHERE p.accuracyRate < 0.3 AND p.timesRejected >= 5
                SET p.isActive = false
                """,
                {"pattern_id": pattern_id},
            )

        logger.info(
            "Pattern feedback recorded",
            pattern_id=pattern_id,
            was_correct=was_correct,
            user_id=user_id,
        )

    except Exception as e:
        logger.error("Failed to record pattern feedback", error=str(e))


async def create_pattern_from_feedback(
    uio_id: str,
    pattern_name: str,
    description: str,
    salient_features: list[str],
    typical_action: str | None,
    user_id: str,
    organization_id: str,
    domain: str | None = None,
    graph=None,
) -> str | None:
    """
    Create a new pattern from user feedback on a UIO.

    When a user identifies a recurring pattern, they can create a new
    PatternNode to help recognize similar situations in the future.

    Args:
        uio_id: ID of the UIO that triggered pattern creation
        pattern_name: Name for the new pattern
        description: Description of when this pattern applies
        salient_features: What makes this situation distinctive
        typical_action: Suggested default response
        user_id: ID of user creating the pattern
        organization_id: Organization context
        domain: Optional domain (sales, engineering, etc.)
        graph: Optional graph client

    Returns:
        Pattern ID if created successfully, None otherwise
    """
    if graph is None:
        from ...graph.client import get_graph_client
        graph = await get_graph_client()

    try:
        from uuid import uuid4
        from datetime import datetime, timezone

        from ...embedding.service import get_embedding

        pattern_id = str(uuid4())

        # Generate embedding from name + description + features
        embedding_text = f"{pattern_name}. {description}. " + ". ".join(salient_features)
        trigger_embedding = await get_embedding(embedding_text)

        now = datetime.now(timezone.utc).isoformat()

        # Create the pattern node
        await graph.query(
            """
            CREATE (p:Pattern {
                id: $pattern_id,
                organizationId: $org_id,
                name: $name,
                description: $description,
                triggerEmbedding: $embedding,
                semanticThreshold: 0.8,
                salientFeatures: $salient_features,
                typicalAction: $typical_action,
                domain: $domain,
                confidenceThreshold: 0.7,
                confidenceBoost: 0.15,
                createdByUserId: $user_id,
                timesMatched: 0,
                timesConfirmed: 0,
                timesRejected: 0,
                accuracyRate: 1.0,
                isActive: true,
                createdAt: datetime($now),
                updatedAt: datetime($now)
            })
            WITH p
            MATCH (u:UIO {id: $uio_id})
            MERGE (p)-[:LEARNED_FROM {timestamp: datetime($now)}]->(u)
            RETURN p.id as id
            """,
            {
                "pattern_id": pattern_id,
                "org_id": organization_id,
                "name": pattern_name,
                "description": description,
                "embedding": trigger_embedding,
                "salient_features": salient_features,
                "typical_action": typical_action,
                "domain": domain,
                "user_id": user_id,
                "uio_id": uio_id,
                "now": now,
            },
        )

        logger.info(
            "Pattern created from feedback",
            pattern_id=pattern_id,
            pattern_name=pattern_name,
            user_id=user_id,
        )

        return pattern_id

    except Exception as e:
        logger.error("Failed to create pattern", error=str(e))
        return None
