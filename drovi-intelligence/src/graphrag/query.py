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
from src.graph.client import get_graph_client, DroviGraph

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
        AND (c.validTo IS NULL OR c.validTo > $now)
        RETURN c.id as id, c.title as title, c.status as status,
               c.debtorEmail as owner, c.dueDate as due_date,
               c.confidenceTier as confidence
        ORDER BY c.createdAt DESC
        LIMIT 20
    """,
    "commitments_filtered": """
        MATCH (c:Commitment {organizationId: $orgId})
        WHERE c.status IN ['active', 'pending', 'at_risk']
          AND (c.validTo IS NULL OR c.validTo > $now)
          AND (toLower(c.title) CONTAINS toLower($search)
               OR toLower(c.description) CONTAINS toLower($search))
        RETURN c.id as id, c.title as title, c.status as status,
               c.debtorEmail as owner, c.dueDate as due_date,
               c.confidenceTier as confidence
        ORDER BY c.createdAt DESC
        LIMIT 20
    """,
    "recent_decisions": """
        MATCH (d:Decision {organizationId: $orgId})
        WHERE d.validTo IS NULL
        RETURN d.id as id, d.title as title, d.outcome as outcome,
               d.madeBy as made_by, d.rationale as rationale,
               d.createdAt as decided_at
        ORDER BY d.createdAt DESC
        LIMIT 10
    """,
    "decisions_filtered": """
        MATCH (d:Decision {organizationId: $orgId})
        WHERE d.validTo IS NULL
          AND (toLower(d.title) CONTAINS toLower($search)
               OR toLower(d.rationale) CONTAINS toLower($search)
               OR toLower(d.outcome) CONTAINS toLower($search))
        RETURN d.id as id, d.title as title, d.outcome as outcome,
               d.madeBy as made_by, d.rationale as rationale,
               d.createdAt as decided_at
        ORDER BY d.createdAt DESC
        LIMIT 10
    """,
    "active_risks": """
        MATCH (r:Risk {organizationId: $orgId})
        WHERE r.validTo IS NULL OR r.validTo > $now
        RETURN r.id as id, r.title as title, r.severity as severity,
               r.likelihood as likelihood, r.impact as impact,
               r.mitigations as mitigations, r.status as status
        ORDER BY r.severity DESC, r.createdAt DESC
        LIMIT 10
    """,
    "risks_filtered": """
        MATCH (r:Risk {organizationId: $orgId})
        WHERE (r.validTo IS NULL OR r.validTo > $now)
          AND (toLower(r.title) CONTAINS toLower($search)
               OR toLower(r.impact) CONTAINS toLower($search))
        RETURN r.id as id, r.title as title, r.severity as severity,
               r.likelihood as likelihood, r.impact as impact,
               r.mitigations as mitigations, r.status as status
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
        WHERE (r.validTo IS NULL OR r.validTo > $now)
          AND c.status IN ['active', 'pending', 'at_risk']
        RETURN c.id as commitment_id, c.title as commitment_title, c.status as commitment_status,
               c.dueDate as due_date, c.debtorEmail as owner,
               r.id as risk_id, r.title as risk_title, r.severity as risk_severity,
               r.impact as risk_impact
        ORDER BY r.severity DESC
        LIMIT 20
    """,
    "urgent_issues": """
        MATCH (n {organizationId: $orgId})
        WHERE (n:Risk AND n.severity IN ['high', 'critical'] AND (n.validTo IS NULL OR n.validTo > $now))
           OR (n:Commitment AND n.status = 'at_risk' AND (n.validTo IS NULL OR n.validTo > $now))
        RETURN labels(n)[0] as issue_type, n.id as id, n.title as title,
               n.severity as severity, n.status as status,
               n.impact as impact, n.dueDate as due_date
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
        self._graph: DroviGraph | None = None
        self._llm_client = None

    async def _get_graph(self) -> DroviGraph:
        if self._graph is None:
            self._graph = await get_graph_client()
        return self._graph

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

        # Step 5: Synthesize response
        answer = await self._synthesize_response(
            question=question,
            intent=intent,
            results=graph_results,
            include_evidence=include_evidence,
        )

        # Step 6: Extract sources
        sources = self._extract_sources(graph_results) if include_evidence and graph_results else []

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

        return {
            "answer": answer,
            "intent": intent,
            "sources": sources,
            "cypher_query": QUERY_TEMPLATES.get(template_key),
            "results_count": len(graph_results),
            "duration_seconds": duration,
            "timestamp": utc_now().isoformat(),
        }

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
        graph = await self._get_graph()
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
            results = await graph.query(query, params)
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

            graph = await self._get_graph()
            params = {
                "orgId": organization_id,
                "now": utc_now().isoformat(),
                "search": "",
            }
            return await graph.query(cypher, params) or []

        except Exception as e:
            logger.warning("Dynamic Cypher generation failed", error=str(e))
            return []

    async def _fulltext_fallback(
        self,
        question: str,
        organization_id: str,
    ) -> list[dict[str, Any]]:
        """Search across multiple node types using fulltext as final fallback."""
        graph = await self._get_graph()
        search_terms = self._extract_search_terms(question)
        search_text = " ".join(search_terms[:3]) if search_terms else question[:50]

        labels_to_search = ["Contact", "Commitment", "Decision", "Risk", "Entity"]
        all_results: list[dict[str, Any]] = []

        for label in labels_to_search:
            try:
                results = await graph.fulltext_search(
                    label=label,
                    query_text=search_text,
                    organization_id=organization_id,
                    limit=5,
                )
                for r in results:
                    node = r.get("node", r)
                    if isinstance(node, dict):
                        node["_source_label"] = label
                    all_results.append(node if isinstance(node, dict) else r)
            except Exception:
                continue

        return all_results

    # =========================================================================
    # Response Synthesis
    # =========================================================================

    async def _synthesize_response(
        self,
        question: str,
        intent: str,
        results: list[dict[str, Any]],
        include_evidence: bool,
    ) -> str:
        """Synthesize a natural language response from graph results."""
        if not results:
            return self._generate_no_results_response(intent)

        # Try LLM synthesis
        llm = await self._get_llm_client()
        if llm:
            return await self._llm_synthesize(question, intent, results, llm)

        # Fallback to template synthesis
        return self._template_synthesize(intent, results, include_evidence)

    async def _llm_synthesize(
        self,
        question: str,
        intent: str,
        results: list[dict[str, Any]],
        llm: Any,
    ) -> str:
        """Use LLM for rich response synthesis."""
        settings = get_settings()

        results_json = json.dumps(results[:15], indent=2, default=str)

        user_prompt = f"""Question: {question}

Intent: {intent}
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
            return self._template_synthesize(intent, results, True)

    def _template_synthesize(
        self,
        intent: str,
        results: list[dict[str, Any]],
        include_evidence: bool,
    ) -> str:
        """Template-based response synthesis (fallback)."""
        if intent == "influential":
            names = [r.get("name", r.get("email", "Unknown")) for r in results[:5]]
            return f"The most influential people in your network are: {', '.join(names)}. Rankings are based on PageRank analysis of communication patterns."

        if intent == "commitments":
            count = len(results)
            at_risk = sum(1 for r in results if r.get("status") == "at_risk")
            return f"Found {count} open commitments. {at_risk} are currently at risk and may need attention."

        if intent == "decisions":
            recent = results[:3]
            if recent:
                titles = [r.get("title", "Untitled") for r in recent]
                return f"Recent decisions include: {'; '.join(titles)}."
            return "No recent decisions found."

        if intent == "risks":
            high_severity = [r for r in results if r.get("severity") in ("high", "critical")]
            return f"Found {len(results)} active risks. {len(high_severity)} are high severity and require immediate attention."

        if intent == "relationships":
            if results:
                contact = results[0].get("contact_name", "This contact")
                comm_count = sum(r.get("message_count", 0) or 0 for r in results)
                return f"{contact} has communicated {comm_count} times with {len(results)} other contacts."
            return "No communication relationships found matching your query."

        if intent == "top_communicators":
            if results:
                top = results[:3]
                lines = [f"- {r.get('name', '?')} ({r.get('total_messages', 0)} messages, {r.get('relationship_count', 0)} connections)" for r in top]
                return f"Top communicators in your network:\n" + "\n".join(lines)
            return "No communication data found."

        if intent == "clusters":
            cluster_count = len(results)
            largest = results[0].get("size", 0) if results else 0
            return f"Detected {cluster_count} communication clusters. The largest has {largest} members."

        if intent == "bridges":
            if results:
                names = [r.get("name", r.get("email", "Unknown")) for r in results[:3]]
                return f"Key bridge connectors: {', '.join(names)}. They connect different groups and are valuable for introductions."
            return "No significant bridge connectors identified yet."

        if intent == "customer":
            if results:
                r = results[0]
                name = r.get("name", "Unknown")
                company = r.get("company", "Unknown company")
                commitments = r.get("commitments", 0)
                connections = r.get("connections", 0)
                influence = r.get("influence", 0)
                return f"{name} from {company}: {commitments} commitments, {connections} connections, influence score {influence or 0:.2f}."
            return "No matching contact found."

        if intent == "entity":
            if results:
                company = results[0].get("company", "Unknown")
                count = len(results)
                names = [r.get("name", "?") for r in results[:5]]
                return f"Found {count} contacts at {company}: {', '.join(names)}."
            return "No matching company or entity found."

        if intent == "cross_entity":
            if results:
                count = len(results)
                return f"Found {count} cross-entity relationships. " + \
                       "; ".join(f"{r.get('risk_title', '?')} threatens {r.get('commitment_title', '?')}" for r in results[:3])
            return "No cross-entity relationships found."

        if intent == "urgent_issues":
            if results:
                count = len(results)
                types = set(r.get("issue_type", "unknown") for r in results)
                return f"Found {count} issues needing attention ({', '.join(types)}): " + \
                       "; ".join(f"[{r.get('issue_type', '?')}] {r.get('title', '?')}" for r in results[:5])
            return "No urgent issues identified."

        return f"Found {len(results)} results matching your query."

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
) -> dict[str, Any]:
    """Convenience function to query the knowledge graph."""
    graphrag = await get_graphrag()
    return await graphrag.query(
        question=question,
        organization_id=organization_id,
        include_evidence=include_evidence,
    )
