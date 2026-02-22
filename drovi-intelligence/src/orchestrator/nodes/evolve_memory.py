"""
Evolve Memory Node

Implements knowledge evolution from Supermemory research:
1. UPDATES: Detect contradicting facts -> create SUPERSEDES relationship
2. DERIVES: Match derivation rules -> create new EntityNode with DERIVED_FROM
3. FORGETS: Decay relevance_score based on access patterns

This node runs after persist to evolve the knowledge graph.
"""

import time
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
from uuid import uuid4

import structlog

from src.db import get_raw_query_pool
from src.db.rls import rls_context
from src.graph.types import GraphNodeType

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
                    SET old.validTo = $now,
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
                        created_at: $now,
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


_TEMPLATE_PLACEHOLDER_RE = re.compile(
    r"\{([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\}"
)
_PATTERN_ALIAS_RE = re.compile(r"\(([A-Za-z_][A-Za-z0-9_]*)\s*:")


def _extract_aliases_from_pattern(pattern: str) -> list[str]:
    aliases = _PATTERN_ALIAS_RE.findall(pattern or "")
    unique: list[str] = []
    for alias in aliases:
        if alias not in unique:
            unique.append(alias)
    return unique


def _render_template(template: str, context: dict[str, dict[str, object]]) -> str:
    """Render placeholders like {alias.property} from a match context."""
    if not template:
        return ""

    def _replace(match: re.Match[str]) -> str:
        alias = match.group(1)
        prop = match.group(2)
        value = context.get(alias, {}).get(prop)
        return "" if value is None else str(value)

    return _TEMPLATE_PLACEHOLDER_RE.sub(_replace, template).strip()


async def _list_active_derivation_rules(organization_id: str) -> list[dict]:
    """Load active derivation rules from PostgreSQL."""
    query = """
        SELECT
            id,
            organization_id,
            name,
            description,
            input_pattern,
            output_entity_type,
            output_template,
            confidence_multiplier,
            domain,
            is_active
        FROM derivation_rule
        WHERE is_active = TRUE
          AND (organization_id IS NULL OR organization_id = $1)
        ORDER BY organization_id NULLS FIRST, created_at ASC
        LIMIT 100
    """
    try:
        pool = await get_raw_query_pool()
        with rls_context(organization_id, is_internal=True):
            async with pool.acquire() as conn:
                rows = await conn.fetch(query, organization_id)
        return [dict(row) for row in rows]
    except Exception as exc:
        logger.warning(
            "Failed to list derivation rules",
            organization_id=organization_id,
            error=str(exc),
        )
        return []


async def _get_derivation_rule(rule_id: str, organization_id: str) -> dict | None:
    query = """
        SELECT
            id,
            organization_id,
            name,
            description,
            input_pattern,
            output_entity_type,
            output_template,
            confidence_multiplier,
            domain,
            is_active
        FROM derivation_rule
        WHERE id = $1
          AND (organization_id IS NULL OR organization_id = $2)
          AND is_active = TRUE
        LIMIT 1
    """
    try:
        pool = await get_raw_query_pool()
        with rls_context(organization_id, is_internal=True):
            async with pool.acquire() as conn:
                row = await conn.fetchrow(query, rule_id, organization_id)
        return dict(row) if row else None
    except Exception as exc:
        logger.warning(
            "Failed to load derivation rule",
            rule_id=rule_id,
            organization_id=organization_id,
            error=str(exc),
        )
        return None


async def _record_derivation_rule_match(
    *,
    organization_id: str,
    rule_id: str,
    match_count: int,
) -> None:
    if match_count <= 0:
        return

    query = """
        UPDATE derivation_rule
        SET
            times_matched = COALESCE(times_matched, 0) + $1,
            last_matched_at = NOW(),
            updated_at = NOW()
        WHERE id = $2
          AND (organization_id IS NULL OR organization_id = $3)
    """
    try:
        pool = await get_raw_query_pool()
        with rls_context(organization_id, is_internal=True):
            async with pool.acquire() as conn:
                await conn.execute(query, match_count, rule_id, organization_id)
    except Exception as exc:
        logger.warning(
            "Failed to record derivation rule usage",
            rule_id=rule_id,
            organization_id=organization_id,
            error=str(exc),
        )


async def _handle_derivations(state: IntelligenceState, graph) -> list[dict]:
    """
    Apply derivation rules to create new inferred knowledge.

    Example derivation rule:
    - Pattern: Person has role PM + discusses payment topics
    - Output: "Person likely works on payments product"

    Uses derivation_rule table in PostgreSQL to get active rules,
    then executes them against the graph.
    """
    derived: list[dict] = []
    organization_id = state.input.organization_id

    rules = await _list_active_derivation_rules(organization_id)
    if not rules:
        return derived

    for rule in rules:
        rule_id = str(rule.get("id") or "")
        if not rule_id:
            continue
        try:
            created = await run_derivation_rule(
                rule_id=rule_id,
                organization_id=organization_id,
                graph=graph,
                rule=rule,
            )
            if created:
                await _record_derivation_rule_match(
                    organization_id=organization_id,
                    rule_id=rule_id,
                    match_count=len(created),
                )
                derived.extend(created)
        except Exception as exc:
            logger.warning(
                "Failed to execute derivation rule",
                organization_id=organization_id,
                rule_id=rule_id,
                error=str(exc),
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
        cutoff_date = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        result = await graph.query(
            """
            MATCH (e:Entity {organizationId: $org_id})
            WHERE e.relevanceScore IS NOT NULL
            AND e.lastAccessedAt < $cutoff_date
            AND e.validTo IS NULL
            WITH e, e.relevanceScore * (1 - COALESCE(e.decayRate, 0.01)) as new_score
            SET e.relevanceScore = new_score
            RETURN e.id as id, e.name as name, new_score
            """,
            {"org_id": organization_id, "cutoff_date": cutoff_date},
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
                SET c.lastAccessedAt = $now,
                    c.accessCount = COALESCE(c.accessCount, 0) + 1,
                    c.relevanceScore = CASE
                        WHEN c.relevanceScore IS NULL THEN 1.0
                        WHEN c.relevanceScore < 0.5 THEN c.relevanceScore + 0.1
                        WHEN c.relevanceScore + 0.05 > 1.0 THEN 1.0
                        ELSE c.relevanceScore + 0.05
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
    *,
    rule: dict | None = None,
    limit: int = 50,
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
    rule_record = rule or await _get_derivation_rule(rule_id, organization_id)
    if not rule_record:
        return []

    input_pattern = str(rule_record.get("input_pattern") or "").strip()
    if not input_pattern:
        return []

    aliases = _extract_aliases_from_pattern(input_pattern)
    if not aliases:
        logger.warning(
            "Derivation rule skipped: no aliases found in pattern",
            rule_id=rule_id,
            organization_id=organization_id,
        )
        return []

    output_template = rule_record.get("output_template") or {}
    if isinstance(output_template, str):
        try:
            output_template = json.loads(output_template)
        except Exception:
            output_template = {}
    if not isinstance(output_template, dict):
        output_template = {}

    org_filters = [
        f"({alias}.organizationId = $org_id OR {alias}.organization_id = $org_id)"
        for alias in aliases
    ]
    active_filters = [f"{alias}.validTo IS NULL" for alias in aliases]
    return_clause = ", ".join(f"{alias} as {alias}" for alias in aliases)

    query = f"""
        MATCH {input_pattern}
        WHERE {' AND '.join(org_filters + active_filters)}
        RETURN {return_clause}
        LIMIT $limit
    """

    try:
        matches = await graph.query(
            query,
            {"org_id": organization_id, "limit": max(1, min(int(limit), 200))},
        )
    except Exception as exc:
        logger.warning(
            "Derivation rule query failed",
            rule_id=rule_id,
            organization_id=organization_id,
            error=str(exc),
        )
        return []

    derived_entities: list[dict] = []
    now = datetime.now(timezone.utc).isoformat()

    name_template = str(output_template.get("nameTemplate") or "").strip()
    summary_template = str(output_template.get("summaryTemplate") or "").strip()
    property_templates = output_template.get("properties")
    if not isinstance(property_templates, dict):
        property_templates = {}

    output_entity_type = str(rule_record.get("output_entity_type") or "fact")
    confidence_multiplier = float(
        rule_record.get("confidence_multiplier") or DERIVATION_CONFIDENCE_MULTIPLIER
    )
    derived_confidence = min(
        1.0,
        max(0.0, DERIVATION_CONFIDENCE_MULTIPLIER * confidence_multiplier),
    )

    for row in matches:
        context: dict[str, dict[str, object]] = {}
        source_ids: list[str] = []

        for alias in aliases:
            node = row.get(alias)
            if not isinstance(node, dict):
                continue
            node_ctx = dict(node)
            context[alias] = node_ctx
            node_id = node_ctx.get("id")
            if node_id is not None:
                source_ids.append(str(node_id))

        source_ids = sorted(set(source_ids))
        if not source_ids:
            continue

        derived_name = _render_template(name_template, context)
        if not derived_name:
            primary_alias = aliases[0]
            fallback_name = context.get(primary_alias, {}).get("name")
            if fallback_name:
                derived_name = f"{fallback_name} ({output_entity_type})"
            else:
                continue

        summary = _render_template(summary_template, context)
        rendered_properties: dict[str, object] = {}
        for key, value_template in property_templates.items():
            if isinstance(value_template, str):
                rendered_properties[key] = _render_template(value_template, context)
            else:
                rendered_properties[key] = value_template

        fingerprint_source = "|".join(
            [rule_id, output_entity_type.lower(), derived_name.lower(), *source_ids]
        )
        fingerprint = hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest()

        existing = await graph.query(
            """
            MATCH (d:Entity {organizationId: $org_id, derivationFingerprint: $fingerprint})
            WHERE d.validTo IS NULL
            RETURN d.id as id
            LIMIT 1
            """,
            {"org_id": organization_id, "fingerprint": fingerprint},
        )
        if existing:
            continue

        derived_id = f"drv_{uuid4().hex}"
        node_props = {
            "name": derived_name,
            "summary": summary or None,
            "entityType": output_entity_type,
            "confidence": derived_confidence,
            "derivationRule": rule_id,
            "derivationSourceIds": source_ids,
            "derivationFingerprint": fingerprint,
            "derivationContext": rendered_properties or None,
            "domain": rule_record.get("domain"),
            "relevanceScore": 0.7,
            "lastAccessedAt": now,
            "accessCount": 0,
            "validFrom": now,
        }

        await graph.create_node(
            GraphNodeType.ENTITY,
            derived_id,
            organization_id,
            node_props,
        )

        for source_id in source_ids:
            await graph.query(
                """
                MATCH (d:Entity {id: $derived_id, organizationId: $org_id})
                MATCH (s {id: $source_id})
                WHERE s.organizationId = $org_id OR s.organization_id = $org_id
                MERGE (d)-[r:DERIVED_FROM]->(s)
                SET r.createdAt = COALESCE(r.createdAt, $now),
                    r.ruleId = $rule_id
                """,
                {
                    "derived_id": derived_id,
                    "source_id": source_id,
                    "org_id": organization_id,
                    "rule_id": rule_id,
                    "now": now,
                },
            )

        derived_entities.append(
            {
                "id": derived_id,
                "name": derived_name,
                "entity_type": output_entity_type,
                "rule_id": rule_id,
                "source_ids": source_ids,
                "confidence": derived_confidence,
            }
        )

    return derived_entities
