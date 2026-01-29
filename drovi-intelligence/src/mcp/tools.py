"""
MCP Tool Definitions

Defines all tools available via the MCP server with their schemas.
"""

from typing import Any

# Tool definitions following MCP specification
TOOL_DEFINITIONS: list[dict[str, Any]] = [
    # =============================================================================
    # CUSTOMER CONTEXT TOOLS
    # =============================================================================
    {
        "name": "get_customer_context",
        "description": "Get complete context about a customer/contact. Aggregates all intelligence including commitments, decisions, timeline, relationships, and more via graph traversal.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "contact_id": {
                    "type": "string",
                    "description": "The unique ID of the contact",
                },
                "email": {
                    "type": "string",
                    "description": "Email address of the contact (alternative to contact_id)",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "include_timeline": {
                    "type": "boolean",
                    "description": "Whether to include interaction timeline",
                    "default": True,
                },
                "max_timeline_items": {
                    "type": "integer",
                    "description": "Maximum number of timeline items to return",
                    "default": 50,
                },
            },
            "required": ["organization_id"],
            "oneOf": [
                {"required": ["contact_id"]},
                {"required": ["email"]},
            ],
        },
    },
    {
        "name": "search_customers",
        "description": "Search for customers/contacts by name, email, or company.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query string",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results",
                    "default": 20,
                },
            },
            "required": ["query", "organization_id"],
        },
    },
    {
        "name": "get_customer_timeline",
        "description": "Get chronological interaction timeline for a customer.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "contact_id": {
                    "type": "string",
                    "description": "The unique ID of the contact",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of events",
                    "default": 50,
                },
            },
            "required": ["contact_id", "organization_id"],
        },
    },
    {
        "name": "get_relationship_health",
        "description": "Get relationship health score for a customer with breakdown factors.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "contact_id": {
                    "type": "string",
                    "description": "The unique ID of the contact",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
            },
            "required": ["contact_id", "organization_id"],
        },
    },
    {
        "name": "generate_relationship_summary",
        "description": "Generate an AI summary of the relationship with a customer.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "contact_id": {
                    "type": "string",
                    "description": "The unique ID of the contact",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
            },
            "required": ["contact_id", "organization_id"],
        },
    },
    {
        "name": "list_open_commitments",
        "description": "Get open commitments for a customer, optionally filtered by status.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "contact_id": {
                    "type": "string",
                    "description": "The unique ID of the contact",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "status": {
                    "type": "string",
                    "description": "Filter by commitment status",
                    "enum": ["open", "fulfilled", "broken", "deferred"],
                },
            },
            "required": ["contact_id", "organization_id"],
        },
    },
    # =============================================================================
    # ANALYTICS & BLINDSPOT TOOLS
    # =============================================================================
    {
        "name": "get_organization_profile",
        "description": "Get comprehensive organization intelligence profile including summary metrics, detected blindspots, and organizational health score.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "days": {
                    "type": "integer",
                    "description": "Analysis period in days",
                    "default": 30,
                    "minimum": 7,
                    "maximum": 365,
                },
            },
            "required": ["organization_id"],
        },
    },
    {
        "name": "list_blindspots",
        "description": "List detected organizational blindspots with severity and evidence.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "days": {
                    "type": "integer",
                    "description": "Analysis period in days",
                    "default": 30,
                },
                "severity": {
                    "type": "string",
                    "description": "Filter by severity",
                    "enum": ["low", "medium", "high"],
                },
                "blindspot_type": {
                    "type": "string",
                    "description": "Filter by blindspot type",
                },
            },
            "required": ["organization_id"],
        },
    },
    {
        "name": "dismiss_blindspot",
        "description": "Dismiss a blindspot with feedback. This feeds back into the detection system to improve accuracy.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "blindspot_id": {
                    "type": "string",
                    "description": "The blindspot ID to dismiss",
                },
                "reason": {
                    "type": "string",
                    "description": "Reason for dismissal",
                },
            },
            "required": ["organization_id", "blindspot_id", "reason"],
        },
    },
    {
        "name": "get_calibration_metrics",
        "description": "Get confidence calibration metrics using Brier score decomposition. Helps understand prediction accuracy.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "prediction_type": {
                    "type": "string",
                    "description": "Filter by prediction type",
                },
                "days": {
                    "type": "integer",
                    "description": "Analysis period in days",
                    "default": 90,
                },
            },
            "required": ["organization_id"],
        },
    },
    {
        "name": "get_signal_noise_stats",
        "description": "Get statistics about signal vs noise classification. Uses Wheeler's Statistical Process Control methodology.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "days": {
                    "type": "integer",
                    "description": "Analysis period in days",
                    "default": 30,
                },
            },
            "required": ["organization_id"],
        },
    },
    {
        "name": "list_patterns",
        "description": "List recognition patterns for the organization. Uses Klein's Recognition-Primed Decision methodology.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "domain": {
                    "type": "string",
                    "description": "Filter by domain",
                },
                "active_only": {
                    "type": "boolean",
                    "description": "Only return active patterns",
                    "default": True,
                },
            },
            "required": ["organization_id"],
        },
    },
    {
        "name": "record_pattern_feedback",
        "description": "Record feedback on a pattern match to update accuracy metrics.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "pattern_id": {
                    "type": "string",
                    "description": "The pattern ID",
                },
                "was_correct": {
                    "type": "boolean",
                    "description": "Whether the pattern match was correct",
                },
                "reason": {
                    "type": "string",
                    "description": "Optional reason for feedback",
                },
            },
            "required": ["organization_id", "pattern_id", "was_correct"],
        },
    },
    {
        "name": "get_organizational_health",
        "description": "Get overall organizational health score with breakdown by category.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "days": {
                    "type": "integer",
                    "description": "Analysis period in days",
                    "default": 30,
                },
            },
            "required": ["organization_id"],
        },
    },
    # =============================================================================
    # SEARCH TOOLS
    # =============================================================================
    {
        "name": "search_intelligence",
        "description": "Perform hybrid search across the knowledge graph combining vector (semantic), full-text (keyword), and graph (relationship) search.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "types": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Node types to search (commitment, decision, contact, etc.)",
                },
                "source_types": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Filter by source types (email, slack, etc.)",
                },
                "include_graph_context": {
                    "type": "boolean",
                    "description": "Include connected nodes in results",
                    "default": False,
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum results",
                    "default": 20,
                },
            },
            "required": ["query", "organization_id"],
        },
    },
    # =============================================================================
    # MEMORY TOOLS
    # =============================================================================
    {
        "name": "query_memory",
        "description": "Query the agentic memory system. Search episodes and facts with temporal awareness.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural language query",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "user_id": {
                    "type": "string",
                    "description": "Optional user ID for personalized results",
                },
                "as_of": {
                    "type": "string",
                    "format": "date-time",
                    "description": "Query as of this timestamp (temporal search)",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum results",
                    "default": 10,
                },
            },
            "required": ["query", "organization_id"],
        },
    },
    {
        "name": "add_memory",
        "description": "Add a new episode/fact to the memory system.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "The content to remember",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "source": {
                    "type": "string",
                    "description": "Source of the memory (e.g., 'user_input', 'agent_observation')",
                },
                "metadata": {
                    "type": "object",
                    "description": "Additional metadata",
                },
            },
            "required": ["content", "organization_id", "source"],
        },
    },
    # =============================================================================
    # ADVANCED SEARCH TOOLS (COGNEE-STYLE)
    # =============================================================================
    {
        "name": "insights_search",
        "description": "Multi-hop reasoning search that expands through graph relationships to find connected insights. Best for complex questions requiring context from multiple sources.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "search_type": {
                    "type": "string",
                    "description": "Search strategy to use",
                    "enum": ["similarity", "graph", "hybrid", "insights"],
                    "default": "insights",
                },
                "include_synthesis": {
                    "type": "boolean",
                    "description": "Include LLM-synthesized answer",
                    "default": True,
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum results",
                    "default": 20,
                },
            },
            "required": ["query", "organization_id"],
        },
    },
    {
        "name": "find_connection_path",
        "description": "Find the shortest path between two nodes in the knowledge graph. Useful for understanding how entities are related.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source_id": {
                    "type": "string",
                    "description": "ID of the source node",
                },
                "target_id": {
                    "type": "string",
                    "description": "ID of the target node",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "max_hops": {
                    "type": "integer",
                    "description": "Maximum number of hops to search",
                    "default": 4,
                },
            },
            "required": ["source_id", "target_id", "organization_id"],
        },
    },
    {
        "name": "get_related_context",
        "description": "Get all related context for a specific node, grouped by relationship type.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "node_id": {
                    "type": "string",
                    "description": "ID of the node to get context for",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "relationship_types": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Filter by specific relationship types",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum related items per type",
                    "default": 20,
                },
            },
            "required": ["node_id", "organization_id"],
        },
    },
    # =============================================================================
    # GRAPHRAG & NATURAL LANGUAGE TOOLS
    # =============================================================================
    {
        "name": "ask_knowledge_graph",
        "description": "Ask natural language questions about your knowledge graph. Uses GraphRAG to understand intent, query the graph, and synthesize a natural language answer with citations.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "Natural language question (e.g., 'Who are the most influential people?', 'What commitments are at risk?')",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "include_evidence": {
                    "type": "boolean",
                    "description": "Include source citations in the response",
                    "default": True,
                },
            },
            "required": ["question", "organization_id"],
        },
    },
    {
        "name": "get_influential_contacts",
        "description": "Get the most influential contacts based on PageRank analysis of communication patterns. Higher scores indicate greater network influence.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of contacts to return",
                    "default": 20,
                },
                "min_score": {
                    "type": "number",
                    "description": "Minimum PageRank score threshold",
                    "default": 0.0,
                },
            },
            "required": ["organization_id"],
        },
    },
    {
        "name": "get_communication_clusters",
        "description": "Get communication clusters detected via CDLP community detection algorithm. Shows groups of people who communicate frequently together.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "min_size": {
                    "type": "integer",
                    "description": "Minimum cluster size to include",
                    "default": 2,
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of clusters to return",
                    "default": 20,
                },
            },
            "required": ["organization_id"],
        },
    },
    {
        "name": "get_bridge_connectors",
        "description": "Get bridge connectors - people who connect different groups based on betweenness centrality. These are valuable for introductions across teams.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of contacts to return",
                    "default": 20,
                },
                "min_score": {
                    "type": "number",
                    "description": "Minimum betweenness score threshold",
                    "default": 0.1,
                },
            },
            "required": ["organization_id"],
        },
    },
    # =============================================================================
    # TEMPORAL MEMORY TOOLS
    # =============================================================================
    {
        "name": "temporal_search",
        "description": "Search knowledge as it existed at a specific point in time. Enables time-travel queries like 'What did we know on March 15?'",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "as_of": {
                    "type": "string",
                    "format": "date-time",
                    "description": "Point in time to query (ISO 8601 format)",
                },
                "num_results": {
                    "type": "integer",
                    "description": "Maximum number of results",
                    "default": 10,
                },
            },
            "required": ["query", "organization_id", "as_of"],
        },
    },
    {
        "name": "get_knowledge_evolution",
        "description": "Track how knowledge about an entity evolved over time. Shows what was known at different points.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "entity_name": {
                    "type": "string",
                    "description": "Name of the entity to track",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "start_time": {
                    "type": "string",
                    "format": "date-time",
                    "description": "Start of tracking period (ISO 8601)",
                },
                "end_time": {
                    "type": "string",
                    "format": "date-time",
                    "description": "End of tracking period (ISO 8601)",
                },
                "sample_points": {
                    "type": "integer",
                    "description": "Number of time points to sample",
                    "default": 5,
                },
            },
            "required": ["entity_name", "organization_id", "start_time", "end_time"],
        },
    },
    {
        "name": "compare_knowledge_states",
        "description": "Compare what was known at two different points in time. Shows what changed between dates.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Query to compare across time",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "time_a": {
                    "type": "string",
                    "format": "date-time",
                    "description": "First time point (ISO 8601)",
                },
                "time_b": {
                    "type": "string",
                    "format": "date-time",
                    "description": "Second time point (ISO 8601)",
                },
            },
            "required": ["query", "organization_id", "time_a", "time_b"],
        },
    },
    {
        "name": "get_daily_summary",
        "description": "Get a summary of intelligence recorded on a specific day.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "date": {
                    "type": "string",
                    "format": "date",
                    "description": "Date to summarize (YYYY-MM-DD)",
                },
            },
            "required": ["organization_id", "date"],
        },
    },
    # =============================================================================
    # GRAPH TOOLS
    # =============================================================================
    {
        "name": "get_node",
        "description": "Get a specific node from the knowledge graph by ID.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "node_id": {
                    "type": "string",
                    "description": "The node ID",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "include_relationships": {
                    "type": "boolean",
                    "description": "Include connected nodes",
                    "default": False,
                },
            },
            "required": ["node_id", "organization_id"],
        },
    },
    {
        "name": "get_node_neighbors",
        "description": "Get nodes connected to a specific node.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "node_id": {
                    "type": "string",
                    "description": "The node ID",
                },
                "organization_id": {
                    "type": "string",
                    "description": "The organization ID",
                },
                "relationship_types": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Filter by relationship types",
                },
                "depth": {
                    "type": "integer",
                    "description": "Traversal depth",
                    "default": 1,
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum nodes per level",
                    "default": 50,
                },
            },
            "required": ["node_id", "organization_id"],
        },
    },
]


def get_tool_by_name(name: str) -> dict[str, Any] | None:
    """Get a tool definition by name."""
    for tool in TOOL_DEFINITIONS:
        if tool["name"] == name:
            return tool
    return None
