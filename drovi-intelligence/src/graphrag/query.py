"""
GraphRAG Query Engine

Natural language query interface for the Drovi knowledge graph.
Translates user questions into graph queries and synthesizes answers.

Architecture:
1. Question analysis → LLM-based intent classification (with keyword fallback)
2. Entity extraction → Identify mentioned entities and topics
3. Query generation → Select or generate Cypher queries
4. Graph traversal → Execute queries (multi-template for cross-entity)
5. Fallback chain → Template → Dynamic Cypher → Fulltext → suggestions
6. Response synthesis → Rich natural language answer with citations
"""

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any

import structlog

from src.config import get_settings
from src.memory import MemoryService, get_memory_service
from src.memory.fast_memory import get_fast_memory

logger = structlog.get_logger()

# Global GraphRAG instance
_graphrag: "DroviGraphRAG | None" = None


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# =============================================================================
# Query Templates (15 templates covering all intents)
# =============================================================================

QUERY_TEMPLATES = {
    "influential_people": """
        MATCH (c:Contact {organizationId: $orgId})
        WHERE c.pagerankScore IS NOT NULL
        RETURN c.id as id, c.displayName as name, c.email as email,
               c.pagerankScore as influence_score, c.company as company,
               c.betweennessScore as bridge_score, c.communityId as community
        ORDER BY c.pagerankScore DESC
        LIMIT 10
    """,
    "open_commitments": """
        MATCH (c:Commitment {organizationId: $orgId})
        WHERE c.status IN ['active', 'pending', 'at_risk']
        RETURN c.id as id, c.title as title, c.status as status,
               c.debtorEmail as owner, c.dueDate as due_date,
               c.confidenceTier as confidence,
               c.validFrom as valid_from, c.validTo as valid_to,
               c.systemFrom as system_from, c.systemTo as system_to,
               c.createdAt as created_at, c.updatedAt as updated_at
        ORDER BY c.createdAt DESC
        LIMIT 20
    """,
    "commitments_filtered": """
        MATCH (c:Commitment {organizationId: $orgId})
        WHERE c.status IN ['active', 'pending', 'at_risk']
          AND (toLower(c.title) CONTAINS toLower($search)
               OR toLower(c.description) CONTAINS toLower($search))
        RETURN c.id as id, c.title as title, c.status as status,
               c.debtorEmail as owner, c.dueDate as due_date,
               c.confidenceTier as confidence,
               c.validFrom as valid_from, c.validTo as valid_to,
               c.systemFrom as system_from, c.systemTo as system_to,
               c.createdAt as created_at, c.updatedAt as updated_at
        ORDER BY c.createdAt DESC
        LIMIT 20
    """,
    "recent_decisions": """
        MATCH (d:Decision {organizationId: $orgId})
        RETURN d.id as id, d.title as title, d.outcome as outcome,
               d.madeBy as made_by, d.rationale as rationale,
               d.createdAt as decided_at,
               d.validFrom as valid_from, d.validTo as valid_to,
               d.systemFrom as system_from, d.systemTo as system_to,
               d.updatedAt as updated_at
        ORDER BY d.createdAt DESC
        LIMIT 10
    """,
    "decisions_filtered": """
        MATCH (d:Decision {organizationId: $orgId})
        WHERE toLower(d.title) CONTAINS toLower($search)
           OR toLower(d.rationale) CONTAINS toLower($search)
           OR toLower(d.outcome) CONTAINS toLower($search)
        RETURN d.id as id, d.title as title, d.outcome as outcome,
               d.madeBy as made_by, d.rationale as rationale,
               d.createdAt as decided_at,
               d.validFrom as valid_from, d.validTo as valid_to,
               d.systemFrom as system_from, d.systemTo as system_to,
               d.updatedAt as updated_at
        ORDER BY d.createdAt DESC
        LIMIT 10
    """,
    "active_risks": """
        MATCH (r:Risk {organizationId: $orgId})
        RETURN r.id as id, r.title as title, r.severity as severity,
               r.likelihood as likelihood, r.impact as impact,
               r.mitigations as mitigations, r.status as status,
               r.validFrom as valid_from, r.validTo as valid_to,
               r.systemFrom as system_from, r.systemTo as system_to,
               r.createdAt as created_at, r.updatedAt as updated_at
        ORDER BY r.severity DESC, r.createdAt DESC
        LIMIT 10
    """,
    "risks_filtered": """
        MATCH (r:Risk {organizationId: $orgId})
        WHERE toLower(r.title) CONTAINS toLower($search)
           OR toLower(r.impact) CONTAINS toLower($search)
        RETURN r.id as id, r.title as title, r.severity as severity,
               r.likelihood as likelihood, r.impact as impact,
               r.mitigations as mitigations, r.status as status,
               r.validFrom as valid_from, r.validTo as valid_to,
               r.systemFrom as system_from, r.systemTo as system_to,
               r.createdAt as created_at, r.updatedAt as updated_at
        ORDER BY r.severity DESC, r.createdAt DESC
        LIMIT 10
    """,
    "contact_relationships": """
        MATCH (c:Contact {organizationId: $orgId})-[r:COMMUNICATES_WITH]->(other:Contact)
        WHERE c.email CONTAINS $search OR c.displayName CONTAINS $search
              OR c.name CONTAINS $search
        RETURN c.displayName as contact_name, c.email as contact_email,
               other.displayName as communicates_with, other.company as their_company,
               r.count as message_count, r.sentimentAvg as sentiment,
               r.lastAt as last_communication
        ORDER BY r.count DESC
        LIMIT 20
    """,
    "top_communicators": """
        MATCH (c:Contact {organizationId: $orgId})-[r:COMMUNICATES_WITH]->(other:Contact)
        WITH c, count(r) as relationship_count,
             sum(r.count) as total_messages,
             collect(DISTINCT other.displayName)[0..5] as top_contacts
        RETURN c.displayName as name, c.email as email, c.company as company,
               relationship_count, total_messages, top_contacts
        ORDER BY total_messages DESC
        LIMIT 20
    """,
    "communication_clusters": """
        MATCH (c:Contact {organizationId: $orgId})
        WHERE c.communityId IS NOT NULL
        RETURN c.communityId as cluster_id, collect(c.displayName) as members,
               count(c) as size
        ORDER BY size DESC
        LIMIT 10
    """,
    "bridge_connectors": """
        MATCH (c:Contact {organizationId: $orgId})
        WHERE c.betweennessScore > 0.5
        RETURN c.id as id, c.displayName as name, c.email as email,
               c.betweennessScore as bridge_score, c.company as company,
               c.communityId as community
        ORDER BY c.betweennessScore DESC
        LIMIT 10
    """,
    "customer_360": """
        MATCH (c:Contact {organizationId: $orgId})
        WHERE c.email CONTAINS $search OR c.displayName CONTAINS $search
              OR c.name CONTAINS $search OR c.company CONTAINS $search
        OPTIONAL MATCH (c)<-[:OWNED_BY]-(commitment:Commitment)
        OPTIONAL MATCH (c)<-[:OWNED_BY]-(decision:Decision)
        OPTIONAL MATCH (c)-[comm:COMMUNICATES_WITH]->(other:Contact)
        RETURN c.displayName as name, c.email as email,
               c.company as company, c.roleType as role,
               c.title as job_title,
               c.pagerankScore as influence,
               c.betweennessScore as bridge_score,
               c.communityId as community,
               count(DISTINCT commitment) as commitments,
               count(DISTINCT decision) as decisions,
               count(DISTINCT other) as connections,
               sum(comm.count) as total_messages
        LIMIT 1
    """,
    "entity_search": """
        MATCH (c:Contact {organizationId: $orgId})
        WHERE toLower(c.company) CONTAINS toLower($search)
        OPTIONAL MATCH (c)<-[:OWNED_BY]-(commitment:Commitment)
        OPTIONAL MATCH (c)-[comm:COMMUNICATES_WITH]->(other:Contact)
        RETURN c.displayName as name, c.email as email,
               c.company as company, c.roleType as role,
               c.title as job_title,
               c.pagerankScore as influence,
               count(DISTINCT commitment) as commitments,
               count(DISTINCT other) as connections,
               sum(comm.count) as total_messages
        ORDER BY c.pagerankScore DESC
        LIMIT 10
    """,
    "commitments_at_risk": """
        MATCH (r:Risk {organizationId: $orgId})-[:THREATENS]->(c:Commitment {organizationId: $orgId})
        WHERE c.status IN ['active', 'pending', 'at_risk']
        RETURN c.id as commitment_id, c.title as commitment_title, c.status as commitment_status,
               c.dueDate as due_date, c.debtorEmail as owner,
               c.validFrom as commitment_valid_from, c.validTo as commitment_valid_to,
               c.systemFrom as commitment_system_from, c.systemTo as commitment_system_to,
               r.id as risk_id, r.title as risk_title, r.severity as risk_severity,
               r.impact as risk_impact,
               r.validFrom as risk_valid_from, r.validTo as risk_valid_to,
               r.systemFrom as risk_system_from, r.systemTo as risk_system_to
        ORDER BY r.severity DESC
        LIMIT 20
    """,
    "urgent_issues": """
        MATCH (n {organizationId: $orgId})
        WHERE (n:Risk AND n.severity IN ['high', 'critical'])
           OR (n:Commitment AND n.status = 'at_risk')
        RETURN labels(n)[0] as issue_type, n.id as id, n.title as title,
               n.severity as severity, n.status as status,
               n.impact as impact, n.dueDate as due_date,
               n.validFrom as valid_from, n.validTo as valid_to,
               n.systemFrom as system_from, n.systemTo as system_to,
               n.createdAt as created_at, n.updatedAt as updated_at
        ORDER BY n.severity DESC, n.createdAt DESC
        LIMIT 20
    """,
}

# =============================================================================
# Intent Classification
# =============================================================================

# Keyword patterns (fallback when LLM is unavailable)
INTENT_PATTERNS = {
    "influential": ["influential", "important people", "pagerank", "influence score", "most important"],
    "commitments": ["commitment", "promise", "agreed", "deliverable", "owe", "due date"],
    "decisions": ["decision", "decided", "chose", "determination", "chosen"],
    "risks": ["risk", "danger", "threat", "concern", "severity", "high severity"],
    "urgent_issues": ["urgent", "immediate attention", "pressing", "key issues",
                       "critical issues", "needs attention", "important issues"],
    "relationships": ["relationship", "communicate with", "talk to", "connected to",
                       "who does", "communicate"],
    "top_communicators": ["communicates the most", "most messages", "most active",
                           "communication volume", "who communicates most"],
    "clusters": ["cluster", "group", "community", "communities", "department"],
    "bridges": ["bridge", "connector", "connects groups", "between teams", "between groups",
                 "bridge connector"],
    "customer": ["tell me about", "everything about", "profile", "context on", "who is"],
    "entity": ["company", "organization", "firm", "corporation", "what is happening at"],
    "cross_entity": ["threatened by", "impacted by", "commitments are being threatened",
                      "risks threatening", "decisions impacting"],
}

# LLM classification prompt
CLASSIFICATION_SYSTEM_PROMPT = """You are an intent classifier for a knowledge graph query engine.
Classify the user's question into one of these intents:

- influential: Questions about who is important, influential, has high PageRank
- commitments: Questions about promises, deliverables, things owed
- decisions: Questions about choices made, determinations
- risks: Questions about dangers, threats, concerns
- urgent_issues: Questions about what needs immediate attention, pressing problems
- relationships: Questions about who communicates with a SPECIFIC NAMED person
- top_communicators: Questions about communication patterns WITHOUT a specific person name
- clusters: Questions about groups, communities, teams
- bridges: Questions about connectors between groups
- customer: Questions about a SPECIFIC NAMED person (Tell me about X, Who is X)
- entity: Questions about a SPECIFIC company or organization
- cross_entity: Questions combining entity types (risks threatening commitments, decisions impacting commitments)
- general: Questions that don't fit any specific intent

Respond with ONLY a JSON object (no markdown fences):
{"primary_intent": "string", "secondary_intents": [], "entity_name": "string or null", "topic_filter": "string or null", "is_cross_entity": false}"""

# Schema for dynamic Cypher generation
GRAPH_SCHEMA_PROMPT = """Generate a READ-ONLY FalkorDB Cypher query for this question.

SCHEMA:
Nodes: Contact(id, organizationId, email, name, displayName, company, title, roleType, pagerankScore, betweennessScore, communityId), Commitment(id, organizationId, title, description, status, debtorEmail, dueDate, confidenceTier), Decision(id, organizationId, title, outcome, madeBy, rationale, status), Risk(id, organizationId, title, severity, likelihood, impact, mitigations, status), Entity(id, organizationId, name, entityType, summary), Episode(id, organizationId, name, content, sourceType)
Relationships: (Contact)-[:COMMUNICATES_WITH {count, sentimentAvg, lastAt}]->(Contact), (Commitment)-[:OWNED_BY]->(Contact), (Decision)-[:OWNED_BY]->(Contact), (Risk)-[:THREATENS]->(Commitment), (Decision)-[:IMPACTS]->(Commitment), (*)-[:EXTRACTED_FROM]->(Episode)

RULES:
1. ALWAYS filter by organizationId = $orgId
2. ONLY MATCH/RETURN/WHERE/WITH/ORDER BY/LIMIT — NO writes
3. Use $orgId, $search, $now as parameters
4. LIMIT to 20 max
5. Return human-readable column aliases

Return ONLY the Cypher query, no explanation."""

# Rich synthesis system prompt
SYNTHESIS_SYSTEM_PROMPT = """You are Drovi Intelligence, an AI-powered knowledge graph analyst.
You provide structured, insightful answers about an organization's communication network,
commitments, decisions, risks, and relationships.

RESPONSE RULES:
1. Start with a direct 1-2 sentence answer to the question
2. Follow with structured details using bullet points or numbered lists
3. Include specific numbers, names, dates, and metrics — never be vague
4. End with 1-2 actionable insights or recommendations when appropriate
5. If results are empty or insufficient, explain what data might be missing
6. Never fabricate data — only reference what is in the query results
7. Keep the response concise — aim for 3-8 sentences total

FORMATTING BY INTENT:
- People questions: Name, role, company, key metric
- Commitments: Title, owner, status, due date
- Decisions: Title, who decided, outcome
- Risks: Title, severity, impact
- Relationships: Contact, communication volume, sentiment
- Clusters: Size, notable members
- Cross-entity: Show linkage clearly

TONE: Concise, professional, analytically confident. Like a senior analyst briefing."""


# =============================================================================
# Cypher Validation
# =============================================================================

CYPHER_BLOCKLIST = {"CREATE", "DELETE", "SET", "MERGE", "REMOVE", "DETACH", "DROP"}


def _validate_cypher(cypher: str) -> bool:
    """Validate that generated Cypher is read-only."""
    upper = cypher.upper()
    for blocked in CYPHER_BLOCKLIST:
        if re.search(rf"\b{blocked}\b", upper):
            return False
    return True


# =============================================================================
# GraphRAG Engine
# =============================================================================

class DroviGraphRAG:
    """
    Natural language query engine for Drovi's knowledge graph.

    Combines LLM-based intent classification, multi-template query execution,
    dynamic Cypher generation, and rich response synthesis.
    """

    def __init__(self):
        self._llm_client = None
        self._memory_services: dict[str, Any] = {}

    async def _get_memory_service(self, organization_id: str):
        if organization_id not in self._memory_services:
            self._memory_services[organization_id] = await get_memory_service(organization_id)
        return self._memory_services[organization_id]

    async def _get_llm_client(self):
        if self._llm_client is None:
            settings = get_settings()
            if settings.together_api_key:
                try:
                    from together import Together
                    self._llm_client = Together(api_key=settings.together_api_key)
                except ImportError:
                    logger.warning("together package not installed")
        return self._llm_client

    # =========================================================================
    # Intent Classification
    # =========================================================================

    async def _classify_intent(self, question: str) -> dict[str, Any]:
        """
        Classify intent using LLM with keyword fallback.

        Returns dict with primary_intent, secondary_intents, entity_name,
        topic_filter, is_cross_entity.
        """
        # Try LLM classification first
        try:
            result = await self._classify_intent_llm(question)
            if result:
                return result
        except Exception as e:
            logger.warning("LLM intent classification failed, using keyword fallback", error=str(e))

        # Keyword fallback
        return self._classify_intent_keywords(question)

    async def _classify_intent_llm(self, question: str) -> dict[str, Any] | None:
        """Classify intent using LLM."""
        llm = await self._get_llm_client()
        if not llm:
            return None

        settings = get_settings()

        try:
            response = llm.chat.completions.create(
                model=settings.default_model_fast,
                messages=[
                    {"role": "system", "content": CLASSIFICATION_SYSTEM_PROMPT},
                    {"role": "user", "content": question},
                ],
                max_tokens=200,
                temperature=0.0,
            )
            content = response.choices[0].message.content.strip()

            # Strip markdown fences if present
            if content.startswith("```"):
                content = re.sub(r"^```(?:json)?\s*", "", content)
                content = re.sub(r"\s*```$", "", content)

            result = json.loads(content)

            # Validate required fields
            if "primary_intent" not in result:
                return None

            return {
                "primary_intent": result.get("primary_intent", "general"),
                "secondary_intents": result.get("secondary_intents", []),
                "entity_name": result.get("entity_name"),
                "topic_filter": result.get("topic_filter"),
                "is_cross_entity": result.get("is_cross_entity", False),
            }

        except Exception as e:
            logger.warning("LLM classification parse failed", error=str(e))
            return None

    def _classify_intent_keywords(self, question: str) -> dict[str, Any]:
        """Classify intent using keyword scoring (fallback)."""
        question_lower = question.lower()

        best_intent = "general"
        best_score = 0

        for intent, keywords in INTENT_PATTERNS.items():
            score = sum(1 for kw in keywords if kw in question_lower)
            if score > best_score:
                best_score = score
                best_intent = intent

        # Extract entity name from question (proper nouns)
        entity_name = self._extract_entity_name(question)

        # Detect topic filter
        topic_filter = None
        if best_intent in ("decisions", "commitments", "risks"):
            search_terms = self._extract_search_terms(question)
            # If there are content-specific terms beyond the intent keywords, use as topic filter
            intent_kws = set()
            for kws in INTENT_PATTERNS.values():
                intent_kws.update(kws)
            non_intent_terms = [t for t in search_terms if t.lower() not in intent_kws]
            if non_intent_terms:
                topic_filter = " ".join(non_intent_terms[:3])

        return {
            "primary_intent": best_intent,
            "secondary_intents": [],
            "entity_name": entity_name,
            "topic_filter": topic_filter,
            "is_cross_entity": best_intent == "cross_entity",
        }

    def _extract_entity_name(self, question: str) -> str | None:
        """Extract proper nouns (person or company names) from a question."""
        stop_words = {
            "who", "what", "when", "where", "why", "how", "is", "are",
            "the", "a", "an", "to", "for", "of", "in", "on", "with",
            "our", "my", "their", "about", "tell", "me", "show", "list",
            "find", "get", "give", "can", "you", "please", "everything",
            "currently", "right", "now", "most", "frequently", "does",
            "which", "what", "many", "much",
        }

        words = question.split()
        proper_nouns = []
        current_name: list[str] = []

        for word in words:
            clean = word.strip("?.,!;:")
            if clean and clean[0].isupper() and clean.lower() not in stop_words:
                current_name.append(clean)
            else:
                if len(current_name) >= 2:
                    proper_nouns.append(" ".join(current_name))
                elif len(current_name) == 1 and current_name[0] not in ("I", "The", "A"):
                    # Single capitalized word at start of sentence is likely not a name
                    # unless it's a clear entity
                    pass
                current_name = []

        if len(current_name) >= 2:
            proper_nouns.append(" ".join(current_name))

        return proper_nouns[0] if proper_nouns else None

    def _extract_search_terms(self, question: str) -> list[str]:
        """Extract search terms from a question."""
        stop_words = {
            "who", "what", "when", "where", "why", "how", "is", "are",
            "the", "a", "an", "to", "for", "of", "in", "on", "with",
            "our", "my", "their", "about", "tell", "me", "show", "list",
            "find", "get", "give", "can", "you", "please", "everything",
            "currently", "right", "now", "most", "frequently", "does",
            "which", "many", "much",
        }

        # Check for proper nouns first
        entity_name = self._extract_entity_name(question)
        if entity_name:
            lower_words = question.lower().split()
            terms = [w.strip("?.,!;:") for w in lower_words
                     if w.strip("?.,!;:") not in stop_words and len(w.strip("?.,!;:")) > 2]
            return [entity_name] + terms

        lower_words = question.lower().split()
        return [w.strip("?.,!;:") for w in lower_words
                if w.strip("?.,!;:") not in stop_words and len(w.strip("?.,!;:")) > 2]

    # =========================================================================
    # Template Selection
    # =========================================================================

    def _get_template_key(
        self,
        intent: str,
        has_topic: bool = False,
        has_entity_name: bool = False,
    ) -> str:
        """Map intent to query template key with smart variant selection."""
        # Cross-entity templates
        if intent == "cross_entity":
            return "commitments_at_risk"

        # Topic-filtered variants
        if intent == "decisions" and has_topic:
            return "decisions_filtered"
        if intent == "commitments" and has_topic:
            return "commitments_filtered"
        if intent == "risks" and has_topic:
            return "risks_filtered"

        # Relationship variants
        if intent == "relationships" and not has_entity_name:
            return "top_communicators"
        if intent == "top_communicators":
            return "top_communicators"

        standard_map = {
            "influential": "influential_people",
            "commitments": "open_commitments",
            "decisions": "recent_decisions",
            "risks": "active_risks",
            "relationships": "contact_relationships",
            "clusters": "communication_clusters",
            "bridges": "bridge_connectors",
            "customer": "customer_360",
            "entity": "entity_search",
            "urgent_issues": "urgent_issues",
        }
        return standard_map.get(intent, "influential_people")

    # =========================================================================
    # Query Execution
    # =========================================================================

    async def query(
        self,
        question: str,
        organization_id: str,
        include_evidence: bool = True,
        max_results: int = 20,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Answer a natural language question about the knowledge graph.

        Uses LLM intent classification, multi-template execution,
        and a fallback chain to ensure results.
        """
        start_time = utc_now()

        logger.info(
            "Processing GraphRAG query",
            question=question[:100],
            organization_id=organization_id,
        )

        user_context = None
        if user_id:
            try:
                fast_memory = await get_fast_memory()
                user_context = await fast_memory.get_user_context(user_id, organization_id)
            except Exception as exc:
                logger.warning("Failed to load user context", error=str(exc))

        # Step 1: Classify intent
        classification = await self._classify_intent(question)
        intent = classification["primary_intent"]
        entity_name = classification.get("entity_name")
        topic_filter = classification.get("topic_filter")
        is_cross_entity = classification.get("is_cross_entity", False)
        secondary_intents = classification.get("secondary_intents", [])

        # Step 2: Determine search terms
        search_terms = self._extract_search_terms(question)
        # Use entity_name as primary search term if available
        primary_search = entity_name or (search_terms[0] if search_terms else "")
        # If there's a topic filter from LLM, prefer it
        if topic_filter:
            primary_search = topic_filter

        # Step 3: Execute queries
        if is_cross_entity or len(secondary_intents) > 0:
            # Multi-template execution
            all_intents = [intent] + secondary_intents
            graph_results = await self._execute_multi_query(
                intents=all_intents,
                organization_id=organization_id,
                search_term=primary_search,
                topic_filter=topic_filter,
                has_entity_name=entity_name is not None,
                max_results=max_results,
            )
        else:
            # Single template execution
            graph_results = await self._execute_graph_query(
                intent=intent,
                organization_id=organization_id,
                search_term=primary_search,
                topic_filter=topic_filter,
                has_entity_name=entity_name is not None,
                max_results=max_results,
            )

        # Step 4: Fallback chain if empty
        fallback_used = False
        if not graph_results:
            graph_results = await self._fallback_chain(question, organization_id)
            fallback_used = bool(graph_results)

        # Step 4.2: Closest-match fallback if still empty
        closest_matches_used = False
        if not graph_results:
            closest_matches = await self._closest_matches_fallback(question, organization_id)
            if closest_matches:
                graph_results = closest_matches
                fallback_used = True
                closest_matches_used = True

        # Step 4.5: Enrich with evidence citations (if available)
        if include_evidence and graph_results:
            await self._attach_evidence(graph_results, organization_id)

        # Step 5: Temporal consistency + decay
        temporal_context = self._apply_temporal_consistency(graph_results)
        current_results = temporal_context["current"]
        historical_results = temporal_context["historical"]
        future_results = temporal_context["future"]

        # Deprioritize stale items via decay
        current_results = MemoryService.apply_temporal_decay(current_results)
        historical_results = MemoryService.apply_temporal_decay(historical_results)

        # Prefer current results for synthesis; fall back to historical if none
        synthesis_results = current_results if current_results else (historical_results or graph_results)

        temporal_note = self._format_temporal_note(temporal_context["summary"])

        # Step 6: Synthesize response
        answer = await self._synthesize_response(
            question=question,
            intent=intent,
            results=synthesis_results,
            include_evidence=include_evidence,
            temporal_note=temporal_note,
            user_context=user_context,
            closest_matches=closest_matches_used,
        )

        # Step 7: Extract sources (include historical context for auditability)
        sources_input = synthesis_results
        if historical_results:
            sources_input = synthesis_results + historical_results
        if future_results:
            sources_input = sources_input + future_results
        sources = self._extract_sources(sources_input) if include_evidence and sources_input else []

        duration = (utc_now() - start_time).total_seconds()

        template_key = self._get_template_key(
            intent,
            has_topic=topic_filter is not None,
            has_entity_name=entity_name is not None,
        )

        logger.info(
            "GraphRAG query completed",
            intent=intent,
            template=template_key,
            results_count=len(graph_results),
            fallback_used=fallback_used,
            duration=duration,
        )

        user_context_payload = None
        if user_context is not None:
            user_context_payload = (
                user_context.model_dump() if hasattr(user_context, "model_dump") else user_context
            )

        return {
            "answer": answer,
            "intent": intent,
            "sources": sources,
            "cypher_query": QUERY_TEMPLATES.get(template_key),
            "results_count": len(synthesis_results),
            "duration_seconds": duration,
            "timestamp": utc_now().isoformat(),
            "closest_matches_used": closest_matches_used,
            "user_context": user_context_payload,
        }

    async def _attach_evidence(
        self,
        results: list[dict[str, Any]],
        organization_id: str,
    ) -> None:
        """Attach evidence metadata to result rows when available."""
        uio_ids = self._collect_uio_ids(results)
        if not uio_ids:
            return

        memory = await self._get_memory_service(organization_id)
        try:
            evidence_map = await memory.get_uio_evidence(uio_ids)
        except Exception as exc:
            logger.warning("Failed to fetch evidence for GraphRAG results", error=str(exc))
            return

        for result in results:
            uio_id = self._extract_uio_id(result)
            if not uio_id:
                continue
            evidence_list = evidence_map.get(uio_id) or []
            if not evidence_list:
                continue
            result["evidence"] = evidence_list
            primary = evidence_list[0]
            result["evidence_id"] = primary.get("evidence_id")
            result["snippet"] = self._truncate_snippet(primary.get("quoted_text"))
            result["source_type"] = primary.get("source_type")
            result["date"] = primary.get("source_timestamp")

    @staticmethod
    def _truncate_snippet(text: str | None, max_len: int = 200) -> str | None:
        if not text:
            return None
        cleaned = text.strip().replace("\n", " ")
        return cleaned[:max_len] + ("…" if len(cleaned) > max_len else "")

    @staticmethod
    def _collect_uio_ids(results: list[dict[str, Any]]) -> list[str]:
        ids: set[str] = set()
        for result in results:
            for key in ("id", "commitment_id", "decision_id", "risk_id"):
                value = result.get(key)
                if value:
                    ids.add(str(value))
        return list(ids)

    @staticmethod
    def _extract_uio_id(result: dict[str, Any]) -> str | None:
        for key in ("id", "commitment_id", "decision_id", "risk_id"):
            value = result.get(key)
            if value:
                return str(value)
        return None

    async def _execute_graph_query(
        self,
        intent: str,
        organization_id: str,
        search_term: str,
        topic_filter: str | None = None,
        has_entity_name: bool = False,
        max_results: int = 20,
    ) -> list[dict[str, Any]]:
        """Execute a single template query."""
        memory = await self._get_memory_service(organization_id)
        template_key = self._get_template_key(
            intent,
            has_topic=topic_filter is not None,
            has_entity_name=has_entity_name,
        )
        query = QUERY_TEMPLATES.get(template_key)
        if not query:
            return []

        params = {
            "orgId": organization_id,
            "now": utc_now().isoformat(),
            "search": search_term or "",
            "limit": max_results,
        }

        try:
            results = await memory.graph_query(query, params)
            return results or []
        except Exception as e:
            logger.error("Graph query failed", intent=intent, template=template_key, error=str(e))
            return []

    async def _execute_multi_query(
        self,
        intents: list[str],
        organization_id: str,
        search_term: str,
        topic_filter: str | None,
        has_entity_name: bool,
        max_results: int,
    ) -> list[dict[str, Any]]:
        """Execute multiple templates in parallel and merge results."""
        tasks = [
            self._execute_graph_query(
                intent=intent,
                organization_id=organization_id,
                search_term=search_term,
                topic_filter=topic_filter,
                has_entity_name=has_entity_name,
                max_results=max_results,
            )
            for intent in intents
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        merged = []
        for intent, result in zip(intents, results):
            if isinstance(result, Exception):
                logger.warning("Multi-query failed for intent", intent=intent, error=str(result))
            elif result:
                merged.extend(result)

        return merged

    # =========================================================================
    # Fallback Chain
    # =========================================================================

    async def _fallback_chain(
        self,
        question: str,
        organization_id: str,
    ) -> list[dict[str, Any]]:
        """
        Fallback chain when template query returns empty:
        1. Dynamic Cypher generation via LLM
        2. Fulltext search across all node types
        """
        # Level 2: Dynamic Cypher
        results = await self._dynamic_cypher_query(question, organization_id)
        if results:
            logger.info("Fallback: dynamic Cypher returned results", count=len(results))
            return results

        # Level 3: Fulltext search
        results = await self._fulltext_fallback(question, organization_id)
        if results:
            logger.info("Fallback: fulltext search returned results", count=len(results))
            return results

        return []

    # =========================================================================
    # Temporal Consistency + Decay
    # =========================================================================

    def _parse_datetime(self, value: Any) -> datetime | None:
        if isinstance(value, datetime):
            return value.replace(tzinfo=None)
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                return None
        return None

    def _collect_temporal_candidates(self, result: dict[str, Any]) -> dict[str, list[datetime]]:
        valid_froms: list[datetime] = []
        valid_tos: list[datetime] = []
        system_froms: list[datetime] = []
        system_tos: list[datetime] = []

        for key, value in result.items():
            key_lower = key.lower()
            parsed = self._parse_datetime(value)
            if not parsed:
                continue

            if "valid_from" in key_lower or "validfrom" in key_lower:
                valid_froms.append(parsed)
            elif "valid_to" in key_lower or "validto" in key_lower:
                valid_tos.append(parsed)
            elif "system_from" in key_lower or "systemfrom" in key_lower:
                system_froms.append(parsed)
            elif "system_to" in key_lower or "systemto" in key_lower:
                system_tos.append(parsed)

        return {
            "valid_froms": valid_froms,
            "valid_tos": valid_tos,
            "system_froms": system_froms,
            "system_tos": system_tos,
        }

    def _determine_temporal_status(
        self,
        result: dict[str, Any],
        now: datetime,
    ) -> tuple[str, datetime | None]:
        candidates = self._collect_temporal_candidates(result)
        valid_froms = candidates["valid_froms"]
        valid_tos = candidates["valid_tos"]
        system_froms = candidates["system_froms"]
        system_tos = candidates["system_tos"]

        froms = valid_froms or system_froms
        tos = valid_tos or system_tos

        if froms and any(dt > now for dt in froms):
            return "future", None
        if tos and any(dt <= now for dt in tos):
            best_superseded = max((dt for dt in tos if dt <= now), default=None)
            return "historical", best_superseded
        if not froms and not tos:
            return "unknown", None
        return "current", None

    def _apply_temporal_consistency(self, results: list[dict[str, Any]]) -> dict[str, Any]:
        now = utc_now()
        current: list[dict[str, Any]] = []
        historical: list[dict[str, Any]] = []
        future: list[dict[str, Any]] = []
        last_superseded_at: datetime | None = None

        for result in results:
            status, superseded_at = self._determine_temporal_status(result, now)
            result["temporal_status"] = status
            if superseded_at:
                result["temporal_superseded_at"] = superseded_at.isoformat()
                if last_superseded_at is None or superseded_at > last_superseded_at:
                    last_superseded_at = superseded_at

            if status == "historical":
                historical.append(result)
            elif status == "future":
                future.append(result)
            else:
                current.append(result)

        summary = {
            "current_count": len(current),
            "historical_count": len(historical),
            "future_count": len(future),
            "last_superseded_at": last_superseded_at,
        }

        return {
            "current": current,
            "historical": historical,
            "future": future,
            "summary": summary,
        }

    def _format_temporal_note(self, summary: dict[str, Any]) -> str | None:
        historical_count = summary.get("historical_count", 0)
        future_count = summary.get("future_count", 0)
        last_superseded_at = summary.get("last_superseded_at")

        notes = []
        if historical_count:
            if isinstance(last_superseded_at, datetime):
                notes.append(
                    f"Note: {historical_count} related items were superseded (latest on {last_superseded_at.date().isoformat()})."
                )
            else:
                notes.append(f"Note: {historical_count} related items were superseded in the past.")
        if future_count:
            notes.append(f"Note: {future_count} items appear to take effect in the future.")

        return " ".join(notes) if notes else None

    async def _dynamic_cypher_query(
        self,
        question: str,
        organization_id: str,
    ) -> list[dict[str, Any]]:
        """Generate and execute a dynamic Cypher query using LLM."""
        llm = await self._get_llm_client()
        if not llm:
            return []

        settings = get_settings()

        try:
            response = llm.chat.completions.create(
                model=settings.default_model_balanced,
                messages=[
                    {"role": "system", "content": GRAPH_SCHEMA_PROMPT},
                    {"role": "user", "content": question},
                ],
                max_tokens=300,
                temperature=0.0,
            )
            cypher = response.choices[0].message.content.strip()

            # Strip markdown fences if present
            if cypher.startswith("```"):
                cypher = re.sub(r"^```(?:cypher)?\s*", "", cypher)
                cypher = re.sub(r"\s*```$", "", cypher)

            # Validate
            if not _validate_cypher(cypher):
                logger.warning("Dynamic Cypher rejected: contains write operations", cypher=cypher[:100])
                return []

            memory = await self._get_memory_service(organization_id)
            params = {
                "orgId": organization_id,
                "now": utc_now().isoformat(),
                "search": "",
            }
            return await memory.graph_query(cypher, params) or []

        except Exception as e:
            logger.warning("Dynamic Cypher generation failed", error=str(e))
            return []

    async def _fulltext_fallback(
        self,
        question: str,
        organization_id: str,
    ) -> list[dict[str, Any]]:
        """Search across multiple node types using fulltext as final fallback."""
        memory = await self._get_memory_service(organization_id)
        search_terms = self._extract_search_terms(question)
        search_text = " ".join(search_terms[:3]) if search_terms else question[:50]

        labels_to_search = ["Contact", "Commitment", "Decision", "Risk", "Entity"]
        all_results: list[dict[str, Any]] = []

        for label in labels_to_search:
            try:
                results = await memory.fulltext_search(label=label, query_text=search_text, limit=5)
                for r in results:
                    node = r.get("node", r)
                    if isinstance(node, dict):
                        node["_source_label"] = label
                    all_results.append(node if isinstance(node, dict) else r)
            except Exception:
                continue

        return all_results

    async def _closest_matches_fallback(
        self,
        question: str,
        organization_id: str,
        limit: int = 8,
    ) -> list[dict[str, Any]]:
        """Return closest semantic matches when no direct results exist."""
        try:
            from src.search.hybrid import HybridSearch
        except Exception as exc:
            logger.warning("Hybrid search unavailable for closest matches", error=str(exc))
            return []

        search = HybridSearch()
        try:
            matches = await search.search(
                query=question,
                organization_id=organization_id,
                limit=limit,
            )
        except Exception as exc:
            logger.warning("Closest match search failed", error=str(exc))
            return []

        normalized: list[dict[str, Any]] = []
        for match in matches:
            props = match.get("properties") or {}
            title = match.get("title") or props.get("title") or props.get("name") or props.get("displayName")
            normalized.append(
                {
                    **props,
                    "id": match.get("id"),
                    "type": match.get("type") or props.get("type"),
                    "title": title,
                    "score": match.get("score"),
                    "match_source": match.get("match_source", "hybrid"),
                    "suggested": True,
                }
            )

        return normalized

    # =========================================================================
    # Response Synthesis
    # =========================================================================

    async def _synthesize_response(
        self,
        question: str,
        intent: str,
        results: list[dict[str, Any]],
        include_evidence: bool,
        temporal_note: str | None = None,
        user_context: Any | None = None,
        closest_matches: bool = False,
    ) -> str:
        """Synthesize a natural language response from graph results."""
        if not results:
            return self._generate_no_results_response(intent)

        # Try LLM synthesis
        llm = await self._get_llm_client()
        if llm:
            return await self._llm_synthesize(
                question,
                intent,
                results,
                llm,
                temporal_note,
                user_context=user_context,
                closest_matches=closest_matches,
            )

        # Fallback to template synthesis
        return self._template_synthesize(intent, results, include_evidence, temporal_note, closest_matches)

    async def _llm_synthesize(
        self,
        question: str,
        intent: str,
        results: list[dict[str, Any]],
        llm: Any,
        temporal_note: str | None,
        user_context: Any | None = None,
        closest_matches: bool = False,
    ) -> str:
        """Use LLM for rich response synthesis."""
        settings = get_settings()

        results_json = json.dumps(results[:15], indent=2, default=str)
        temporal_context = temporal_note or "No superseded or future-dated items detected."
        user_context_str = self._format_user_context(user_context)
        fallback_note = (
            "Note: No exact matches were found; the results below are the closest related matches."
            if closest_matches
            else "Exact matches found."
        )

        user_prompt = f"""Question: {question}

Intent: {intent}
Temporal context: {temporal_context}
Fallback note: {fallback_note}
User context: {user_context_str or "None"}
Results ({len(results)} total):
{results_json}

Provide a structured, insightful answer based on these results."""

        try:
            response = llm.chat.completions.create(
                model=settings.default_model_balanced,
                messages=[
                    {"role": "system", "content": SYNTHESIS_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=800,
                temperature=0.3,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.warning("LLM synthesis failed", error=str(e))
            return self._template_synthesize(intent, results, True, temporal_note, closest_matches)

    @staticmethod
    def _format_user_context(user_context: Any | None) -> str:
        if user_context is None:
            return ""
        if hasattr(user_context, "model_dump"):
            data = user_context.model_dump()
        elif isinstance(user_context, dict):
            data = user_context
        else:
            return ""

        def _list(value: Any) -> str:
            if isinstance(value, list):
                return ", ".join(str(v) for v in value if v)
            return str(value) if value is not None else ""

        parts: list[str] = []
        for key, label in (
            ("name", "Name"),
            ("role", "Role"),
            ("timezone", "Timezone"),
            ("priorities", "Priorities"),
            ("current_focus", "Current focus"),
            ("recent_topics", "Recent topics"),
            ("active_projects", "Active projects"),
            ("vip_contact_emails", "VIP contacts"),
        ):
            value = _list(data.get(key))
            if value:
                parts.append(f"{label}: {value}")

        counts = []
        for key, label in (
            ("unread_commitments_count", "Unread commitments"),
            ("overdue_commitments_count", "Overdue commitments"),
            ("pending_decisions_count", "Pending decisions"),
        ):
            value = data.get(key)
            if value:
                counts.append(f"{label}={value}")

        if counts:
            parts.append("Counts: " + ", ".join(counts))

        return " | ".join(parts)

    def _template_synthesize(
        self,
        intent: str,
        results: list[dict[str, Any]],
        include_evidence: bool,
        temporal_note: str | None,
        closest_matches: bool = False,
    ) -> str:
        """Template-based response synthesis (fallback)."""
        if closest_matches:
            titles = [r.get("title") or r.get("name") or r.get("id", "Unknown") for r in results[:5]]
            response = (
                "No exact matches found. Closest related items include: "
                + ", ".join([t for t in titles if t])
                + "."
            )
            return f"{response} {temporal_note}".strip() if temporal_note else response
        if intent == "influential":
            names = [r.get("name", r.get("email", "Unknown")) for r in results[:5]]
            response = f"The most influential people in your network are: {', '.join(names)}. Rankings are based on PageRank analysis of communication patterns."
            return f"{response} {temporal_note}".strip() if temporal_note else response

        if intent == "commitments":
            count = len(results)
            at_risk = sum(1 for r in results if r.get("status") == "at_risk")
            response = f"Found {count} open commitments. {at_risk} are currently at risk and may need attention."
            return f"{response} {temporal_note}".strip() if temporal_note else response

        if intent == "decisions":
            recent = results[:3]
            if recent:
                titles = [r.get("title", "Untitled") for r in recent]
                response = f"Recent decisions include: {'; '.join(titles)}."
                return f"{response} {temporal_note}".strip() if temporal_note else response
            response = "No recent decisions found."
            return f"{response} {temporal_note}".strip() if temporal_note else response

        if intent == "risks":
            high_severity = [r for r in results if r.get("severity") in ("high", "critical")]
            response = f"Found {len(results)} active risks. {len(high_severity)} are high severity and require immediate attention."
            return f"{response} {temporal_note}".strip() if temporal_note else response

        if intent == "relationships":
            if results:
                contact = results[0].get("contact_name", "This contact")
                comm_count = sum(r.get("message_count", 0) or 0 for r in results)
                response = f"{contact} has communicated {comm_count} times with {len(results)} other contacts."
                return f"{response} {temporal_note}".strip() if temporal_note else response
            response = "No communication relationships found matching your query."
            return f"{response} {temporal_note}".strip() if temporal_note else response

        if intent == "top_communicators":
            if results:
                top = results[:3]
                lines = [f"- {r.get('name', '?')} ({r.get('total_messages', 0)} messages, {r.get('relationship_count', 0)} connections)" for r in top]
                response = f"Top communicators in your network:\n" + "\n".join(lines)
                return f"{response} {temporal_note}".strip() if temporal_note else response
            response = "No communication data found."
            return f"{response} {temporal_note}".strip() if temporal_note else response

        if intent == "clusters":
            cluster_count = len(results)
            largest = results[0].get("size", 0) if results else 0
            response = f"Detected {cluster_count} communication clusters. The largest has {largest} members."
            return f"{response} {temporal_note}".strip() if temporal_note else response

        if intent == "bridges":
            if results:
                names = [r.get("name", r.get("email", "Unknown")) for r in results[:3]]
                response = f"Key bridge connectors: {', '.join(names)}. They connect different groups and are valuable for introductions."
                return f"{response} {temporal_note}".strip() if temporal_note else response
            response = "No significant bridge connectors identified yet."
            return f"{response} {temporal_note}".strip() if temporal_note else response

        if intent == "customer":
            if results:
                r = results[0]
                name = r.get("name", "Unknown")
                company = r.get("company", "Unknown company")
                commitments = r.get("commitments", 0)
                connections = r.get("connections", 0)
                influence = r.get("influence", 0)
                response = f"{name} from {company}: {commitments} commitments, {connections} connections, influence score {influence or 0:.2f}."
                return f"{response} {temporal_note}".strip() if temporal_note else response
            response = "No matching contact found."
            return f"{response} {temporal_note}".strip() if temporal_note else response

        if intent == "entity":
            if results:
                company = results[0].get("company", "Unknown")
                count = len(results)
                names = [r.get("name", "?") for r in results[:5]]
                response = f"Found {count} contacts at {company}: {', '.join(names)}."
                return f"{response} {temporal_note}".strip() if temporal_note else response
            response = "No matching company or entity found."
            return f"{response} {temporal_note}".strip() if temporal_note else response

        if intent == "cross_entity":
            if results:
                count = len(results)
                response = f"Found {count} cross-entity relationships. " + \
                       "; ".join(f"{r.get('risk_title', '?')} threatens {r.get('commitment_title', '?')}" for r in results[:3])
                return f"{response} {temporal_note}".strip() if temporal_note else response
            response = "No cross-entity relationships found."
            return f"{response} {temporal_note}".strip() if temporal_note else response

        if intent == "urgent_issues":
            if results:
                count = len(results)
                types = set(r.get("issue_type", "unknown") for r in results)
                response = f"Found {count} issues needing attention ({', '.join(types)}): " + \
                       "; ".join(f"[{r.get('issue_type', '?')}] {r.get('title', '?')}" for r in results[:5])
                return f"{response} {temporal_note}".strip() if temporal_note else response
            response = "No urgent issues identified."
            return f"{response} {temporal_note}".strip() if temporal_note else response

        response = f"Found {len(results)} results matching your query."
        return f"{response} {temporal_note}".strip() if temporal_note else response

    def _generate_no_results_response(self, intent: str) -> str:
        """Generate a response when no results are found."""
        responses = {
            "influential": "No influence scores have been computed yet. Run the PageRank analytics job first.",
            "commitments": "No open commitments found for this organization.",
            "decisions": "No decisions have been recorded yet.",
            "risks": "No active risks identified.",
            "relationships": "No communication relationships found for this contact.",
            "top_communicators": "No communication data found. Communication relationships need to be ingested first.",
            "clusters": "No communication clusters detected. This usually means there isn't enough communication data yet.",
            "bridges": "No bridge connectors identified.",
            "customer": "No matching contact found. Try searching by full name or email.",
            "entity": "No matching company found. Try the exact company name.",
            "cross_entity": "No cross-entity relationships found (e.g., risks threatening commitments).",
            "urgent_issues": "No urgent issues identified. All commitments and risks appear stable.",
        }
        return responses.get(intent, "No results found for your query. Try rephrasing or being more specific.")

    # =========================================================================
    # Source Extraction
    # =========================================================================

    def _extract_sources(self, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Extract source citations from results, handling all node shapes."""
        sources = []

        for r in results[:10]:
            source: dict[str, Any] = {"type": "graph_node"}

            # ID extraction (different result shapes)
            source["id"] = (
                r.get("id")
                or r.get("commitment_id")
                or r.get("decision_id")
                or r.get("risk_id")
                or r.get("cluster_id")
            )

            # Name extraction (priority order)
            name = (
                r.get("name")
                or r.get("displayName")
                or r.get("contact_name")
                or r.get("title")
                or r.get("commitment_title")
                or r.get("decision_title")
                or r.get("risk_title")
            )

            # Cluster-specific handling
            if "cluster_id" in r:
                members = r.get("members", [])
                size = r.get("size", 0)
                source["type"] = "cluster"
                if members and isinstance(members, list):
                    preview = ", ".join(str(m) for m in members[:3])
                    name = f"Cluster: {preview}{'...' if len(members) > 3 else ''} ({size} members)"
                else:
                    name = f"Cluster {r['cluster_id']} ({size} members)"

            # Cross-entity handling
            if "commitment_title" in r and "risk_title" in r:
                source["type"] = "risk_threatens_commitment"
                name = f"{r.get('risk_title', 'Risk')} → {r.get('commitment_title', 'Commitment')}"

            # Urgent issues handling
            if "issue_type" in r:
                source["type"] = r["issue_type"]

            if name:
                source["name"] = name
            if r.get("email") or r.get("contact_email"):
                source["email"] = r.get("email") or r.get("contact_email")
            if r.get("severity"):
                source["severity"] = r["severity"]
            if r.get("status") or r.get("commitment_status"):
                source["status"] = r.get("status") or r.get("commitment_status")
            if r.get("temporal_status"):
                source["temporal_status"] = r.get("temporal_status")
            if r.get("temporal_superseded_at"):
                source["temporal_superseded_at"] = r.get("temporal_superseded_at")
            if r.get("evidence_id"):
                source["evidence_id"] = r.get("evidence_id")
            if r.get("snippet"):
                source["snippet"] = r.get("snippet")
            if r.get("source_type"):
                source["source_type"] = r.get("source_type")
            if r.get("date"):
                source["date"] = r.get("date")

            valid_from = r.get("valid_from") or r.get("validFrom")
            valid_to = r.get("valid_to") or r.get("validTo")
            system_from = r.get("system_from") or r.get("systemFrom")
            system_to = r.get("system_to") or r.get("systemTo")
            if valid_from:
                source["valid_from"] = valid_from
            if valid_to:
                source["valid_to"] = valid_to
            if system_from:
                source["system_from"] = system_from
            if system_to:
                source["system_to"] = system_to

            # Only add if meaningful
            if source.get("id") or source.get("name"):
                sources.append(source)

        return sources

    async def ask(
        self,
        question: str,
        organization_id: str,
    ) -> str:
        """Simple interface to ask a question and get just the answer."""
        result = await self.query(
            question=question,
            organization_id=organization_id,
            include_evidence=False,
        )
        return result["answer"]


# =============================================================================
# Factory Functions
# =============================================================================


async def get_graphrag() -> DroviGraphRAG:
    """Get or create the global GraphRAG instance."""
    global _graphrag
    if _graphrag is None:
        _graphrag = DroviGraphRAG()
    return _graphrag


async def query_graph(
    question: str,
    organization_id: str,
    include_evidence: bool = True,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Convenience function to query the knowledge graph."""
    graphrag = await get_graphrag()
    return await graphrag.query(
        question=question,
        organization_id=organization_id,
        include_evidence=include_evidence,
        user_id=user_id,
    )
