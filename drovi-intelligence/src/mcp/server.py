"""
MCP Server Implementation

Implements the Model Context Protocol server for AI agent access to Drovi Intelligence.
Supports stdio and SSE transports.
"""

import asyncio
import json
from datetime import datetime
from typing import Any

import structlog
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    CallToolResult,
    ListToolsResult,
    TextContent,
    Tool,
)

from src.mcp.tools import TOOL_DEFINITIONS

logger = structlog.get_logger()


class DroviMCPServer:
    """
    Drovi Intelligence MCP Server.

    Exposes intelligence tools for AI agents via MCP protocol.
    """

    def __init__(self):
        """Initialize the MCP server."""
        self.server = Server("drovi-intelligence")
        self._setup_handlers()

    def _setup_handlers(self):
        """Set up MCP request handlers."""

        @self.server.list_tools()
        async def list_tools() -> list[Tool]:
            """List available tools."""
            return [
                Tool(
                    name=tool["name"],
                    description=tool["description"],
                    inputSchema=tool["inputSchema"],
                )
                for tool in TOOL_DEFINITIONS
            ]

        @self.server.call_tool()
        async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
            """Execute a tool and return results."""
            logger.info("MCP tool called", tool=name, arguments=arguments)

            try:
                result = await self._execute_tool(name, arguments)
                return [
                    TextContent(
                        type="text",
                        text=json.dumps(result, indent=2, default=str),
                    )
                ]
            except Exception as e:
                logger.error("MCP tool execution failed", tool=name, error=str(e))
                return [
                    TextContent(
                        type="text",
                        text=json.dumps({"error": str(e)}, indent=2),
                    )
                ]

    async def _execute_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Execute a tool by name with given arguments."""

        # Customer Context Tools
        if name == "get_customer_context":
            return await self._get_customer_context(arguments)
        elif name == "search_customers":
            return await self._search_customers(arguments)
        elif name == "get_customer_timeline":
            return await self._get_customer_timeline(arguments)
        elif name == "get_relationship_health":
            return await self._get_relationship_health(arguments)
        elif name == "generate_relationship_summary":
            return await self._generate_relationship_summary(arguments)
        elif name == "list_open_commitments":
            return await self._list_open_commitments(arguments)

        # Analytics Tools
        elif name == "get_organization_profile":
            return await self._get_organization_profile(arguments)
        elif name == "list_blindspots":
            return await self._list_blindspots(arguments)
        elif name == "dismiss_blindspot":
            return await self._dismiss_blindspot(arguments)
        elif name == "get_calibration_metrics":
            return await self._get_calibration_metrics(arguments)
        elif name == "get_signal_noise_stats":
            return await self._get_signal_noise_stats(arguments)
        elif name == "list_patterns":
            return await self._list_patterns(arguments)
        elif name == "record_pattern_feedback":
            return await self._record_pattern_feedback(arguments)
        elif name == "get_organizational_health":
            return await self._get_organizational_health(arguments)

        # Search Tools
        elif name == "search_intelligence":
            return await self._search_intelligence(arguments)

        # Memory Tools
        elif name == "query_memory":
            return await self._query_memory(arguments)
        elif name == "add_memory":
            return await self._add_memory(arguments)

        # Advanced Search Tools (Cognee-style)
        elif name == "insights_search":
            return await self._insights_search(arguments)
        elif name == "find_connection_path":
            return await self._find_connection_path(arguments)
        elif name == "get_related_context":
            return await self._get_related_context(arguments)

        # GraphRAG & Natural Language Tools
        elif name == "ask_knowledge_graph":
            return await self._ask_knowledge_graph(arguments)
        elif name == "get_influential_contacts":
            return await self._get_influential_contacts(arguments)
        elif name == "get_communication_clusters":
            return await self._get_communication_clusters(arguments)
        elif name == "get_bridge_connectors":
            return await self._get_bridge_connectors(arguments)

        # Temporal Memory Tools
        elif name == "temporal_search":
            return await self._temporal_search(arguments)
        elif name == "get_knowledge_evolution":
            return await self._get_knowledge_evolution(arguments)
        elif name == "compare_knowledge_states":
            return await self._compare_knowledge_states(arguments)
        elif name == "get_daily_summary":
            return await self._get_daily_summary(arguments)

        # Graph Tools
        elif name == "get_node":
            return await self._get_node(arguments)
        elif name == "get_node_neighbors":
            return await self._get_node_neighbors(arguments)

        else:
            raise ValueError(f"Unknown tool: {name}")

    # =========================================================================
    # CUSTOMER CONTEXT TOOL IMPLEMENTATIONS
    # =========================================================================

    async def _get_customer_context(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get complete customer context."""
        from src.customer.context_aggregator import get_customer_context_aggregator
        from src.graph.client import get_graph_client

        organization_id = args["organization_id"]
        contact_id = args.get("contact_id")
        email = args.get("email")

        if not contact_id and email:
            # Find contact by email
            graph = await get_graph_client()
            result = await graph.query(
                """
                MATCH (c:Contact {email: $email, organizationId: $org_id})
                RETURN c.id as id
                LIMIT 1
                """,
                {"email": email, "org_id": organization_id},
            )
            if result:
                contact_id = result[0]["id"]

        if not contact_id:
            return {"error": "Contact not found"}

        aggregator = await get_customer_context_aggregator()
        context = await aggregator.get_customer_context(
            contact_id=contact_id,
            organization_id=organization_id,
            include_history=args.get("include_timeline", True),
            max_timeline_items=args.get("max_timeline_items", 50),
        )

        return {
            "contact_id": context.contact_id,
            "email": context.email,
            "name": context.name,
            "company": context.company,
            "title": context.title,
            "interaction_count": context.interaction_count,
            "last_interaction": context.last_interaction.isoformat() if context.last_interaction else None,
            "relationship_health": context.relationship_health,
            "source_types": context.source_types,
            "open_commitments": [
                {
                    "id": c.id,
                    "title": c.title,
                    "status": c.status,
                    "direction": c.direction,
                    "due_date": c.due_date.isoformat() if c.due_date else None,
                }
                for c in context.open_commitments
            ],
            "related_decisions": [
                {
                    "id": d.id,
                    "title": d.title,
                    "status": d.status,
                }
                for d in context.related_decisions
            ],
            "top_topics": context.top_topics,
            "relationship_summary": context.relationship_summary,
        }

    async def _search_customers(self, args: dict[str, Any]) -> dict[str, Any]:
        """Search for customers."""
        from src.customer.context_aggregator import get_customer_context_aggregator

        aggregator = await get_customer_context_aggregator()
        results = await aggregator.search_customers(
            query=args["query"],
            organization_id=args["organization_id"],
            limit=args.get("limit", 20),
        )

        return {
            "results": [
                {
                    "id": c.id,
                    "email": c.email,
                    "name": c.name,
                    "company": c.company,
                    "title": c.title,
                }
                for c in results
            ],
            "total": len(results),
        }

    async def _get_customer_timeline(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get customer timeline."""
        from src.customer.context_aggregator import get_customer_context_aggregator

        aggregator = await get_customer_context_aggregator()
        timeline = await aggregator.get_contact_timeline(
            contact_id=args["contact_id"],
            organization_id=args["organization_id"],
            limit=args.get("limit", 50),
        )

        return {
            "contact_id": args["contact_id"],
            "events": [
                {
                    "id": e.id,
                    "event_type": e.event_type,
                    "title": e.title,
                    "summary": e.summary,
                    "source_type": e.source_type,
                    "reference_time": e.reference_time.isoformat() if e.reference_time else None,
                }
                for e in timeline
            ],
        }

    async def _get_relationship_health(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get relationship health score."""
        from src.customer.context_aggregator import get_customer_context_aggregator

        aggregator = await get_customer_context_aggregator()
        health = await aggregator.compute_relationship_health(
            contact_id=args["contact_id"],
            organization_id=args["organization_id"],
        )

        return {
            "contact_id": args["contact_id"],
            "health_score": health,
            "interpretation": (
                "healthy" if health > 0.7 else "needs_attention" if health > 0.4 else "at_risk"
            ),
        }

    async def _generate_relationship_summary(self, args: dict[str, Any]) -> dict[str, Any]:
        """Generate relationship summary."""
        from src.customer.context_aggregator import get_customer_context_aggregator

        aggregator = await get_customer_context_aggregator()
        summary = await aggregator.generate_relationship_summary(
            contact_id=args["contact_id"],
            organization_id=args["organization_id"],
        )

        return {
            "contact_id": args["contact_id"],
            "summary": summary,
            "generated_at": datetime.utcnow().isoformat(),
        }

    async def _list_open_commitments(self, args: dict[str, Any]) -> dict[str, Any]:
        """List open commitments for a contact."""
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        status_filter = ""
        params = {
            "contact_id": args["contact_id"],
            "org_id": args["organization_id"],
        }

        if args.get("status"):
            status_filter = "AND c.status = $status"
            params["status"] = args["status"]

        result = await graph.query(
            f"""
            MATCH (contact:Contact {{id: $contact_id, organizationId: $org_id}})
                  -[:INVOLVED_IN]->(c:Commitment)
            WHERE c.organizationId = $org_id
            AND c.validTo IS NULL
            {status_filter}
            RETURN c.id as id,
                   c.title as title,
                   c.status as status,
                   c.priority as priority,
                   c.direction as direction,
                   c.dueDate as due_date,
                   c.confidence as confidence
            ORDER BY c.dueDate ASC
            """,
            params,
        )

        return {
            "contact_id": args["contact_id"],
            "commitments": [
                {
                    "id": row.get("id"),
                    "title": row.get("title"),
                    "status": row.get("status"),
                    "priority": row.get("priority"),
                    "direction": row.get("direction"),
                    "due_date": row.get("due_date"),
                    "confidence": row.get("confidence", 0),
                }
                for row in (result or [])
            ],
        }

    # =========================================================================
    # ANALYTICS TOOL IMPLEMENTATIONS
    # =========================================================================

    async def _get_organization_profile(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get organization profile."""
        from src.analytics.blindspot_detection import get_blindspot_detection_service

        service = await get_blindspot_detection_service()
        profile = await service.analyze_organization(
            organization_id=args["organization_id"],
            days=args.get("days", 30),
        )

        return {
            "organization_id": args["organization_id"],
            "total_commitments": profile.total_commitments,
            "open_commitments": profile.open_commitments,
            "commitment_fulfillment_rate": profile.commitment_fulfillment_rate,
            "total_decisions": profile.total_decisions,
            "decision_reversal_rate": profile.decision_reversal_rate,
            "organizational_health_score": profile.organizational_health_score,
            "blindspot_count": len(profile.blindspots),
        }

    async def _list_blindspots(self, args: dict[str, Any]) -> dict[str, Any]:
        """List blindspots."""
        from src.analytics.blindspot_detection import get_blindspot_detection_service

        service = await get_blindspot_detection_service()
        profile = await service.analyze_organization(
            organization_id=args["organization_id"],
            days=args.get("days", 30),
        )

        blindspots = profile.blindspots
        if args.get("severity"):
            blindspots = [b for b in blindspots if b.severity.value == args["severity"]]
        if args.get("blindspot_type"):
            blindspots = [b for b in blindspots if b.blindspot_type.value == args["blindspot_type"]]

        return {
            "organization_id": args["organization_id"],
            "blindspots": [
                {
                    "id": b.id,
                    "type": b.blindspot_type.value,
                    "title": b.title,
                    "description": b.description,
                    "severity": b.severity.value,
                    "suggested_action": b.suggested_action,
                }
                for b in blindspots
            ],
            "total": len(blindspots),
        }

    async def _dismiss_blindspot(self, args: dict[str, Any]) -> dict[str, Any]:
        """Dismiss a blindspot."""
        from src.analytics.blindspot_detection import get_blindspot_detection_service

        service = await get_blindspot_detection_service()
        success = await service.dismiss_blindspot(
            organization_id=args["organization_id"],
            blindspot_id=args["blindspot_id"],
            reason=args["reason"],
        )

        return {
            "blindspot_id": args["blindspot_id"],
            "dismissed": success,
            "reason": args["reason"],
        }

    async def _get_calibration_metrics(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get calibration metrics."""
        from src.finetuning.calibration import (
            PredictionType,
            get_calibration_service,
            interpret_calibration,
        )

        service = await get_calibration_service()

        pred_type = None
        if args.get("prediction_type"):
            try:
                pred_type = PredictionType(args["prediction_type"])
            except ValueError:
                return {"error": f"Invalid prediction type: {args['prediction_type']}"}

        metrics = await service.get_calibration_metrics(
            organization_id=args["organization_id"],
            prediction_type=pred_type,
            days=args.get("days", 90),
        )

        interpretation = interpret_calibration(metrics)

        return {
            "organization_id": args["organization_id"],
            "brier_score": metrics.brier_score,
            "reliability": metrics.reliability,
            "resolution": metrics.resolution,
            "adjustment_factor": metrics.adjustment_factor,
            "interpretation": interpretation,
        }

    async def _get_signal_noise_stats(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get signal/noise statistics."""
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        result = await graph.query(
            """
            MATCH (u:UIO)
            WHERE u.organizationId = $org_id
            AND u.signalClassification IS NOT NULL
            RETURN
                u.signalClassification as classification,
                count(*) as count
            """,
            {"org_id": args["organization_id"]},
        )

        total = sum(row.get("count", 0) for row in (result or []))
        signals = sum(row.get("count", 0) for row in (result or []) if row.get("classification") == "signal")
        noise = sum(row.get("count", 0) for row in (result or []) if row.get("classification") == "noise")

        return {
            "organization_id": args["organization_id"],
            "total_intelligence": total,
            "signals": signals,
            "noise": noise,
            "signal_percentage": signals / total * 100 if total > 0 else 0,
            "noise_percentage": noise / total * 100 if total > 0 else 0,
        }

    async def _list_patterns(self, args: dict[str, Any]) -> dict[str, Any]:
        """List patterns."""
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        query = """
            MATCH (p:Pattern)
            WHERE p.organizationId = $org_id
        """
        params: dict = {"org_id": args["organization_id"]}

        if args.get("active_only", True):
            query += " AND p.isActive = true"
        if args.get("domain"):
            query += " AND p.domain = $domain"
            params["domain"] = args["domain"]

        query += """
            RETURN p.id as id,
                   p.name as name,
                   p.description as description,
                   p.domain as domain,
                   p.timesMatched as times_matched,
                   p.accuracyRate as accuracy_rate
            ORDER BY p.timesMatched DESC
        """

        result = await graph.query(query, params)

        return {
            "organization_id": args["organization_id"],
            "patterns": [
                {
                    "id": row.get("id"),
                    "name": row.get("name"),
                    "description": row.get("description"),
                    "domain": row.get("domain"),
                    "times_matched": row.get("times_matched", 0),
                    "accuracy_rate": row.get("accuracy_rate", 1.0),
                }
                for row in (result or [])
            ],
        }

    async def _record_pattern_feedback(self, args: dict[str, Any]) -> dict[str, Any]:
        """Record pattern feedback."""
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        if args["was_correct"]:
            await graph.query(
                """
                MATCH (p:Pattern {id: $pattern_id, organizationId: $org_id})
                SET p.timesConfirmed = COALESCE(p.timesConfirmed, 0) + 1
                RETURN p.id
                """,
                {"pattern_id": args["pattern_id"], "org_id": args["organization_id"]},
            )
        else:
            await graph.query(
                """
                MATCH (p:Pattern {id: $pattern_id, organizationId: $org_id})
                SET p.timesRejected = COALESCE(p.timesRejected, 0) + 1
                RETURN p.id
                """,
                {"pattern_id": args["pattern_id"], "org_id": args["organization_id"]},
            )

        return {
            "pattern_id": args["pattern_id"],
            "feedback_recorded": True,
            "was_correct": args["was_correct"],
        }

    async def _get_organizational_health(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get organizational health."""
        from src.analytics.blindspot_detection import get_blindspot_detection_service

        service = await get_blindspot_detection_service()
        profile = await service.analyze_organization(
            organization_id=args["organization_id"],
            days=args.get("days", 30),
        )

        return {
            "organization_id": args["organization_id"],
            "overall_health_score": profile.organizational_health_score,
            "breakdown": {
                "commitment_health": profile.commitment_fulfillment_rate,
                "decision_health": 1.0 - profile.decision_reversal_rate,
            },
            "summary": {
                "total_commitments": profile.total_commitments,
                "open_commitments": profile.open_commitments,
                "total_decisions": profile.total_decisions,
                "blindspots_detected": len(profile.blindspots),
            },
        }

    # =========================================================================
    # SEARCH TOOL IMPLEMENTATIONS
    # =========================================================================

    async def _search_intelligence(self, args: dict[str, Any]) -> dict[str, Any]:
        """Perform hybrid search."""
        from src.search.hybrid import get_hybrid_search

        search = await get_hybrid_search()

        results = await search.search(
            query=args["query"],
            organization_id=args["organization_id"],
            types=args.get("types"),
            source_types=args.get("source_types"),
            include_graph_context=args.get("include_graph_context", False),
            limit=args.get("limit", 20),
        )

        return {
            "query": args["query"],
            "results": results,
            "count": len(results),
        }

    # =========================================================================
    # MEMORY TOOL IMPLEMENTATIONS
    # =========================================================================

    async def _query_memory(self, args: dict[str, Any]) -> dict[str, Any]:
        """Query memory system."""
        from src.memory.graphiti_memory import get_memory_service

        memory = await get_memory_service()

        results = await memory.search(
            query=args["query"],
            organization_id=args["organization_id"],
            user_id=args.get("user_id"),
            limit=args.get("limit", 10),
        )

        return {
            "query": args["query"],
            "results": [
                {
                    "content": r.content,
                    "source": r.source,
                    "relevance": r.relevance,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in results
            ],
        }

    async def _add_memory(self, args: dict[str, Any]) -> dict[str, Any]:
        """Add to memory system."""
        from src.memory.graphiti_memory import get_memory_service

        memory = await get_memory_service()

        episode_id = await memory.add(
            content=args["content"],
            organization_id=args["organization_id"],
            source=args["source"],
            metadata=args.get("metadata", {}),
        )

        return {
            "episode_id": episode_id,
            "added": True,
        }

    # =========================================================================
    # ADVANCED SEARCH TOOL IMPLEMENTATIONS (COGNEE-STYLE)
    # =========================================================================

    async def _insights_search(self, args: dict[str, Any]) -> dict[str, Any]:
        """Perform multi-hop reasoning search."""
        from src.search.hybrid_cognee import get_cognee_search

        search = await get_cognee_search()
        result = await search.search(
            query=args["query"],
            organization_id=args["organization_id"],
            search_type=args.get("search_type", "insights"),
            limit=args.get("limit", 20),
            include_synthesis=args.get("include_synthesis", True),
        )

        return result

    async def _find_connection_path(self, args: dict[str, Any]) -> dict[str, Any]:
        """Find path between two nodes."""
        from src.search.hybrid_cognee import get_cognee_search

        search = await get_cognee_search()
        result = await search.find_path_between(
            source_id=args["source_id"],
            target_id=args["target_id"],
            organization_id=args["organization_id"],
            max_hops=args.get("max_hops", 4),
        )

        return result

    async def _get_related_context(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get related context for a node."""
        from src.search.hybrid_cognee import get_cognee_search

        search = await get_cognee_search()
        result = await search.get_related_context(
            node_id=args["node_id"],
            organization_id=args["organization_id"],
            relationship_types=args.get("relationship_types"),
            limit=args.get("limit", 20),
        )

        return result

    # =========================================================================
    # GRAPHRAG & NATURAL LANGUAGE TOOL IMPLEMENTATIONS
    # =========================================================================

    async def _ask_knowledge_graph(self, args: dict[str, Any]) -> dict[str, Any]:
        """Ask natural language questions about the knowledge graph."""
        from src.graphrag import query_graph

        result = await query_graph(
            question=args["question"],
            organization_id=args["organization_id"],
            include_evidence=args.get("include_evidence", True),
        )

        return {
            "question": args["question"],
            "answer": result["answer"],
            "intent": result["intent"],
            "sources": result.get("sources", []),
            "cypher_query": result.get("cypher_query"),
            "results_count": result["results_count"],
            "duration_seconds": result["duration_seconds"],
        }

    async def _get_influential_contacts(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get influential contacts based on PageRank scores."""
        from src.graph.client import get_graph_client

        graph = await get_graph_client()
        limit = args.get("limit", 20)
        min_score = args.get("min_score", 0.0)

        result = await graph.query(
            """
            MATCH (c:Contact {organizationId: $orgId})
            WHERE c.pagerankScore IS NOT NULL
            AND c.pagerankScore >= $minScore
            RETURN c.id as id, c.displayName as name, c.email as email,
                   c.company as company, c.pagerankScore as influence_score,
                   c.communityId as community_id
            ORDER BY c.pagerankScore DESC
            LIMIT $limit
            """,
            {
                "orgId": args["organization_id"],
                "minScore": min_score,
                "limit": limit,
            },
        )

        return {
            "organization_id": args["organization_id"],
            "contacts": [
                {
                    "id": row.get("id"),
                    "name": row.get("name"),
                    "email": row.get("email"),
                    "company": row.get("company"),
                    "influence_score": row.get("influence_score", 0),
                    "community_id": row.get("community_id"),
                }
                for row in (result or [])
            ],
            "total": len(result or []),
        }

    async def _get_communication_clusters(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get communication clusters from CDLP community detection."""
        from src.graph.client import get_graph_client

        graph = await get_graph_client()
        min_size = args.get("min_size", 2)
        limit = args.get("limit", 20)

        result = await graph.query(
            """
            MATCH (c:Contact {organizationId: $orgId})
            WHERE c.communityId IS NOT NULL
            WITH c.communityId as cluster_id, collect({
                id: c.id,
                name: c.displayName,
                email: c.email,
                company: c.company
            }) as members
            WHERE size(members) >= $minSize
            RETURN cluster_id, members, size(members) as size
            ORDER BY size DESC
            LIMIT $limit
            """,
            {
                "orgId": args["organization_id"],
                "minSize": min_size,
                "limit": limit,
            },
        )

        return {
            "organization_id": args["organization_id"],
            "clusters": [
                {
                    "cluster_id": row.get("cluster_id"),
                    "members": row.get("members", []),
                    "size": row.get("size", 0),
                }
                for row in (result or [])
            ],
            "total_clusters": len(result or []),
        }

    async def _get_bridge_connectors(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get bridge connectors based on betweenness centrality."""
        from src.graph.client import get_graph_client

        graph = await get_graph_client()
        limit = args.get("limit", 20)
        min_score = args.get("min_score", 0.1)

        result = await graph.query(
            """
            MATCH (c:Contact {organizationId: $orgId})
            WHERE c.betweennessScore IS NOT NULL
            AND c.betweennessScore >= $minScore
            RETURN c.id as id, c.displayName as name, c.email as email,
                   c.company as company, c.betweennessScore as bridge_score,
                   c.communityId as community_id
            ORDER BY c.betweennessScore DESC
            LIMIT $limit
            """,
            {
                "orgId": args["organization_id"],
                "minScore": min_score,
                "limit": limit,
            },
        )

        return {
            "organization_id": args["organization_id"],
            "connectors": [
                {
                    "id": row.get("id"),
                    "name": row.get("name"),
                    "email": row.get("email"),
                    "company": row.get("company"),
                    "bridge_score": row.get("bridge_score", 0),
                    "community_id": row.get("community_id"),
                }
                for row in (result or [])
            ],
            "total": len(result or []),
            "description": "Bridge connectors link different groups and are valuable for introductions.",
        }

    # =========================================================================
    # TEMPORAL MEMORY TOOL IMPLEMENTATIONS
    # =========================================================================

    async def _temporal_search(self, args: dict[str, Any]) -> dict[str, Any]:
        """Search knowledge as of a specific point in time."""
        from datetime import datetime
        from src.memory.graphiti_enhanced import get_enhanced_graphiti

        as_of = datetime.fromisoformat(args["as_of"].replace("Z", "+00:00"))
        if as_of.tzinfo is not None:
            as_of = as_of.replace(tzinfo=None)

        enhanced = await get_enhanced_graphiti(args["organization_id"])
        results = await enhanced.temporal_search(
            query=args["query"],
            as_of=as_of,
            num_results=args.get("num_results", 10),
        )

        return {
            "query": args["query"],
            "as_of": args["as_of"],
            "organization_id": args["organization_id"],
            "results": results,
            "total": len(results),
        }

    async def _get_knowledge_evolution(self, args: dict[str, Any]) -> dict[str, Any]:
        """Track knowledge evolution over time."""
        from datetime import datetime
        from src.memory.graphiti_enhanced import get_enhanced_graphiti

        start_time = datetime.fromisoformat(args["start_time"].replace("Z", "+00:00"))
        end_time = datetime.fromisoformat(args["end_time"].replace("Z", "+00:00"))

        if start_time.tzinfo is not None:
            start_time = start_time.replace(tzinfo=None)
        if end_time.tzinfo is not None:
            end_time = end_time.replace(tzinfo=None)

        enhanced = await get_enhanced_graphiti(args["organization_id"])
        evolution = await enhanced.get_knowledge_evolution(
            entity_name=args["entity_name"],
            start_time=start_time,
            end_time=end_time,
            sample_points=args.get("sample_points", 5),
        )

        return {
            "entity_name": args["entity_name"],
            "organization_id": args["organization_id"],
            "start_time": args["start_time"],
            "end_time": args["end_time"],
            "evolution": evolution,
            "sample_count": len(evolution),
        }

    async def _compare_knowledge_states(self, args: dict[str, Any]) -> dict[str, Any]:
        """Compare knowledge at two points in time."""
        from datetime import datetime
        from src.memory.graphiti_enhanced import get_enhanced_graphiti

        time_a = datetime.fromisoformat(args["time_a"].replace("Z", "+00:00"))
        time_b = datetime.fromisoformat(args["time_b"].replace("Z", "+00:00"))

        if time_a.tzinfo is not None:
            time_a = time_a.replace(tzinfo=None)
        if time_b.tzinfo is not None:
            time_b = time_b.replace(tzinfo=None)

        enhanced = await get_enhanced_graphiti(args["organization_id"])
        comparison = await enhanced.compare_knowledge_states(
            query=args["query"],
            time_a=time_a,
            time_b=time_b,
        )

        return comparison

    async def _get_daily_summary(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get daily intelligence summary."""
        from datetime import datetime
        from src.memory.graphiti_enhanced import get_enhanced_graphiti

        date = datetime.strptime(args["date"], "%Y-%m-%d")

        enhanced = await get_enhanced_graphiti(args["organization_id"])
        summary = await enhanced.get_daily_summary(date=date)

        return summary

    # =========================================================================
    # GRAPH TOOL IMPLEMENTATIONS
    # =========================================================================

    async def _get_node(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get a node from the graph."""
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        # Try to match any node type
        result = await graph.query(
            """
            MATCH (n {id: $node_id, organizationId: $org_id})
            RETURN n, labels(n) as labels
            LIMIT 1
            """,
            {"node_id": args["node_id"], "org_id": args["organization_id"]},
        )

        if not result:
            return {"error": "Node not found"}

        node = result[0]["n"]
        labels = result[0]["labels"]

        response = {
            "id": args["node_id"],
            "type": labels[0] if labels else "Unknown",
            "properties": dict(node),
        }

        if args.get("include_relationships"):
            neighbors = await graph.query(
                """
                MATCH (n {id: $node_id, organizationId: $org_id})-[r]-(m)
                RETURN type(r) as relationship, m.id as neighbor_id, labels(m) as neighbor_labels
                LIMIT 50
                """,
                {"node_id": args["node_id"], "org_id": args["organization_id"]},
            )
            response["relationships"] = [
                {
                    "type": row["relationship"],
                    "neighbor_id": row["neighbor_id"],
                    "neighbor_type": row["neighbor_labels"][0] if row["neighbor_labels"] else "Unknown",
                }
                for row in (neighbors or [])
            ]

        return response

    async def _get_node_neighbors(self, args: dict[str, Any]) -> dict[str, Any]:
        """Get node neighbors."""
        from src.graph.client import get_graph_client

        graph = await get_graph_client()

        depth = args.get("depth", 1)
        limit = args.get("limit", 50)

        # Build relationship type filter
        rel_filter = ""
        if args.get("relationship_types"):
            rel_types = "|".join(args["relationship_types"])
            rel_filter = f":{rel_types}"

        result = await graph.query(
            f"""
            MATCH (n {{id: $node_id, organizationId: $org_id}})-[r{rel_filter}*1..{depth}]-(m)
            RETURN DISTINCT m.id as id, labels(m) as labels, m as properties
            LIMIT {limit}
            """,
            {"node_id": args["node_id"], "org_id": args["organization_id"]},
        )

        return {
            "node_id": args["node_id"],
            "neighbors": [
                {
                    "id": row["id"],
                    "type": row["labels"][0] if row["labels"] else "Unknown",
                    "properties": dict(row["properties"]) if row["properties"] else {},
                }
                for row in (result or [])
            ],
        }

    async def run_stdio(self):
        """Run the MCP server with stdio transport."""
        logger.info("Starting Drovi MCP Server (stdio)")
        async with stdio_server() as (read_stream, write_stream):
            await self.server.run(
                read_stream,
                write_stream,
                self.server.create_initialization_options(),
            )


def create_mcp_server() -> DroviMCPServer:
    """Create and return the MCP server instance."""
    return DroviMCPServer()


async def main():
    """Main entry point for the MCP server."""
    server = create_mcp_server()
    await server.run_stdio()


if __name__ == "__main__":
    asyncio.run(main())
