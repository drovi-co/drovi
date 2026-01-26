"""
Evolve Memory Node

Implements knowledge evolution from Supermemory research:
1. UPDATES: Detect contradicting facts -> create SUPERSEDES relationship
2. DERIVES: Match derivation rules -> create new EntityNode with DERIVED_FROM
3. FORGETS: Decay relevance_score based on access patterns

This node runs after persist to evolve the knowledge graph.
"""

import time
from datetime import datetime, timezone
from uuid import uuid4

import structlog

from ..state import (
    IntelligenceState,
    NodeTiming,
)

logger = structlog.get_logger()

# Configuration
CONTRADICTION_SIMILARITY_THRESHOLD = 0.85  # Threshold for detecting contradictions
DERIVATION_CONFIDENCE_MULTIPLIER = 0.8  # Confidence adjustment for derived facts
RELEVANCE_DECAY_THRESHOLD = 0.1  # Archive facts below this relevance


async def evolve_memory_node(state: IntelligenceState) -> dict:
    """
    Evolve memory by detecting updates, deriving new knowledge, and managing forgetting.

    From Supermemory research:
    - Memory evolves, updates, and derives/learns new information
    - Unlike RAG, memory tracks temporal validity and supersession

    Pipeline position: After persist, before finalize

    Args:
        state: Current intelligence state with persisted UIOs

    Returns:
        Dict with memory_evolution field containing evolution results
    """
    start_time = time.time()

    logger.info(
        "Starting memory evolution",
        analysis_id=state.analysis_id,
        organization_id=state.input.organization_id,
    )

    evolution_results = {
        "superseded_entities": [],  # Entities that were superseded by new info
        "derived_entities": [],  # New entities derived from existing facts
        "decayed_entities": [],  # Entities with reduced relevance
        "contradiction_detected": False,
    }

    try:
        from ...graph.client import get_graph_client

        graph = await get_graph_client()

        # 1. UPDATES: Detect and handle contradictions
        evolution_results["superseded_entities"] = await _handle_updates(
            state=state,
            graph=graph,
        )

        if evolution_results["superseded_entities"]:
            evolution_results["contradiction_detected"] = True
            logger.info(
                "Contradictions detected and superseded",
                count=len(evolution_results["superseded_entities"]),
            )

        # 2. DERIVES: Apply derivation rules to create new knowledge
        evolution_results["derived_entities"] = await _handle_derivations(
            state=state,
            graph=graph,
        )

        if evolution_results["derived_entities"]:
            logger.info(
                "New knowledge derived",
                count=len(evolution_results["derived_entities"]),
            )

        # 3. FORGETS: Update relevance scores (decay old, boost accessed)
        evolution_results["decayed_entities"] = await _handle_forgetting(
            state=state,
            graph=graph,
        )

        if evolution_results["decayed_entities"]:
            logger.info(
                "Entities decayed",
                count=len(evolution_results["decayed_entities"]),
            )

    except Exception as e:
        logger.error(
            "Memory evolution failed",
            error=str(e),
            analysis_id=state.analysis_id,
        )
        # Don't fail the pipeline, just log the error
        evolution_results["error"] = str(e)

    # Update trace
    elapsed = time.time() - start_time
    updated_trace = state.trace.model_copy()
    updated_trace.nodes = [*state.trace.nodes, "evolve_memory"]
    updated_trace.current_node = "evolve_memory"
    updated_trace.node_timings["evolve_memory"] = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    logger.info(
        "Memory evolution complete",
        analysis_id=state.analysis_id,
        superseded=len(evolution_results["superseded_entities"]),
        derived=len(evolution_results["derived_entities"]),
        decayed=len(evolution_results["decayed_entities"]),
        duration_ms=int(elapsed * 1000),
    )

    return {
        "trace": updated_trace,
        "memory_evolution": evolution_results,
    }


async def _handle_updates(state: IntelligenceState, graph) -> list[dict]:
    """
    Detect contradicting facts and create SUPERSEDES relationships.

    Example:
    - Old: "Alex works at Google"
    - New: "Alex started at Stripe"
    -> Old fact gets valid_to set, new fact linked via SUPERSEDES
    """
    superseded = []
    organization_id = state.input.organization_id

    # Get newly created entities from this extraction
    new_contacts = state.extracted.contacts

    for contact in new_contacts:
        if not contact.email or not contact.company:
            continue

        # Query for existing entities with this email but different company
        try:
            result = await graph.query(
                """
                MATCH (c:Contact {email: $email, organizationId: $org_id})
                WHERE c.company IS NOT NULL AND c.company <> $new_company
                AND c.validTo IS NULL
                RETURN c.id as id, c.company as old_company, c.name as name
                """,
                {
                    "email": contact.email,
                    "org_id": organization_id,
                    "new_company": contact.company,
                },
            )

            for row in result:
                # Found a contradiction - mark old entity as superseded
                old_id = row["id"]
                now = datetime.now(timezone.utc).isoformat()

                # Set valid_to on old entity
                await graph.query(
                    """
                    MATCH (old:Contact {id: $old_id})
                    SET old.validTo = datetime($now),
                        old.supersededById = $new_id
                    """,
                    {
                        "old_id": old_id,
                        "now": now,
                        "new_id": contact.id,
                    },
                )

                # Create SUPERSEDES relationship
                await graph.query(
                    """
                    MATCH (new:Contact {email: $email, organizationId: $org_id})
                    WHERE new.validTo IS NULL AND new.company = $new_company
                    MATCH (old:Contact {id: $old_id})
                    MERGE (new)-[:SUPERSEDES {
                        created_at: datetime($now),
                        reason: 'company_change'
                    }]->(old)
                    """,
                    {
                        "email": contact.email,
                        "org_id": organization_id,
                        "new_company": contact.company,
                        "old_id": old_id,
                        "now": now,
                    },
                )

                superseded.append({
                    "old_id": old_id,
                    "old_company": row["old_company"],
                    "new_company": contact.company,
                    "contact_name": row["name"],
                    "reason": "company_change",
                })

                logger.info(
                    "Entity superseded",
                    contact=contact.email,
                    old_company=row["old_company"],
                    new_company=contact.company,
                )

        except Exception as e:
            logger.warning(
                "Failed to check for contradictions",
                contact=contact.email,
                error=str(e),
            )

    return superseded


async def _handle_derivations(state: IntelligenceState, graph) -> list[dict]:
    """
    Apply derivation rules to create new inferred knowledge.

    Example derivation rule:
    - Pattern: Person has role PM + discusses payment topics
    - Output: "Person likely works on payments product"

    Uses derivation_rule table in PostgreSQL to get active rules,
    then executes them against the graph.
    """
    derived = []
    organization_id = state.input.organization_id

    try:
        # Get active derivation rules (from PostgreSQL)
        # For now, we'll use built-in rules. Later this can be extended
        # to read from derivation_rule table

        # Built-in rule: Job role inference
        # If someone has a role and discusses specific topics, infer their work area
        result = await graph.query(
            """
            MATCH (c:Contact {organizationId: $org_id})-[:MENTIONED_IN]->(ep:Episode)
            WHERE c.title IS NOT NULL
            AND c.validTo IS NULL
            WITH c, collect(DISTINCT ep.content) as contents
            WHERE size(contents) > 2
            RETURN c.id as contact_id, c.name as name, c.title as title, contents
            LIMIT 10
            """,
            {"org_id": organization_id},
        )

        # For now, we'll just log potential derivations
        # Full implementation would use LLM to derive new facts
        for row in result:
            logger.debug(
                "Potential derivation candidate",
                contact=row["name"],
                title=row["title"],
                episode_count=len(row["contents"]),
            )

    except Exception as e:
        logger.warning(
            "Failed to run derivation rules",
            error=str(e),
        )

    return derived


async def _handle_forgetting(state: IntelligenceState, graph) -> list[dict]:
    """
    Decay relevance scores for entities not recently accessed.

    From Supermemory research:
    - Memory should "forget" irrelevant information
    - Old exam info from 10th grade shouldn't dominate context

    Process:
    1. Decay all entities based on time since last access
    2. Boost entities that were just accessed
    3. Mark very low relevance entities for archival
    """
    decayed = []
    organization_id = state.input.organization_id

    try:
        # Decay entities not accessed in last 30 days
        # relevance_score = relevance_score * (1 - decay_rate)
        result = await graph.query(
            """
            MATCH (e:Entity {organizationId: $org_id})
            WHERE e.relevanceScore IS NOT NULL
            AND e.lastAccessedAt < datetime() - duration('P30D')
            AND e.validTo IS NULL
            WITH e, e.relevanceScore * (1 - COALESCE(e.decayRate, 0.01)) as new_score
            SET e.relevanceScore = new_score
            RETURN e.id as id, e.name as name, new_score
            """,
            {"org_id": organization_id},
        )

        for row in result:
            if row["new_score"] < RELEVANCE_DECAY_THRESHOLD:
                decayed.append({
                    "id": row["id"],
                    "name": row["name"],
                    "new_relevance": row["new_score"],
                })

        # Boost entities that were just mentioned (in this extraction)
        contact_emails = [c.email for c in state.extracted.contacts if c.email]
        if contact_emails:
            now = datetime.now(timezone.utc).isoformat()
            await graph.query(
                """
                MATCH (c:Contact {organizationId: $org_id})
                WHERE c.email IN $emails
                SET c.lastAccessedAt = datetime($now),
                    c.accessCount = COALESCE(c.accessCount, 0) + 1,
                    c.relevanceScore = CASE
                        WHEN c.relevanceScore IS NULL THEN 1.0
                        WHEN c.relevanceScore < 0.5 THEN c.relevanceScore + 0.1
                        ELSE LEAST(c.relevanceScore + 0.05, 1.0)
                    END
                """,
                {
                    "org_id": organization_id,
                    "emails": contact_emails,
                    "now": now,
                },
            )

    except Exception as e:
        logger.warning(
            "Failed to update relevance scores",
            error=str(e),
        )

    return decayed


async def run_derivation_rule(
    rule_id: str,
    organization_id: str,
    graph,
) -> list[dict]:
    """
    Execute a specific derivation rule from the database.

    Args:
        rule_id: ID of the derivation rule
        organization_id: Organization context
        graph: Graph client

    Returns:
        List of derived entities created
    """
    # This would read the rule from PostgreSQL and execute its Cypher pattern
    # For now, this is a placeholder for the full implementation
    return []
