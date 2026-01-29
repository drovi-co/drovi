"""
AG2 Multi-Agent Integration

Enables multi-agent systems to collaborate using Drovi's knowledge graph.
Uses Together.ai SDK v2 for open source models (NOT OpenAI/GPT).

This is part of Phase 6 of the FalkorDB enhancement plan.
"""

import os
from typing import Any, Literal

import structlog

from src.config import get_settings

logger = structlog.get_logger()


def get_together_llm_config() -> dict[str, Any]:
    """
    Get Together.ai LLM configuration for AG2 agents.

    Uses Together.ai's OpenAI-compatible API with open source models.
    """
    settings = get_settings()

    if not settings.together_api_key:
        raise ValueError("TOGETHER_API_KEY is required for AG2 integration")

    return {
        "config_list": [{
            "model": settings.default_model_balanced,
            "api_key": settings.together_api_key,
            "base_url": "https://api.together.xyz/v1",
            "api_type": "openai",  # Together.ai uses OpenAI-compatible API
        }],
        "cache_seed": None,  # Disable caching for fresh responses
    }


class DroviAG2Integration:
    """
    AG2 (AutoGen) multi-agent integration with Drovi knowledge graph.

    Provides pre-configured agents with access to Drovi intelligence:
    - Customer research agents
    - Risk analysis agents
    - Commitment tracking agents
    - Decision support agents
    """

    def __init__(self, organization_id: str):
        """
        Initialize AG2 integration.

        Args:
            organization_id: Organization to scope agent access
        """
        self.organization_id = organization_id
        self._llm_config = None
        self._graph = None
        self._graphrag = None

    async def _get_llm_config(self) -> dict[str, Any]:
        """Get cached LLM config."""
        if self._llm_config is None:
            self._llm_config = get_together_llm_config()
        return self._llm_config

    async def _get_graph(self):
        """Get graph client."""
        if self._graph is None:
            from src.graph.client import get_graph_client
            self._graph = await get_graph_client()
        return self._graph

    async def _get_graphrag(self):
        """Get GraphRAG instance."""
        if self._graphrag is None:
            from src.graphrag import get_graphrag
            self._graphrag = await get_graphrag()
        return self._graphrag

    def create_knowledge_agent(
        self,
        name: str,
        system_message: str,
    ):
        """
        Create an AG2 agent with Drovi knowledge access.

        The agent can query the knowledge graph via function calls.

        Args:
            name: Agent name
            system_message: System prompt for the agent

        Returns:
            AG2 ConversableAgent with knowledge graph access
        """
        try:
            from autogen import ConversableAgent
        except ImportError:
            raise ImportError(
                "autogen (ag2) package not installed. "
                "Install with: pip install ag2[openai]"
            )

        llm_config = get_together_llm_config()

        # Add function calling capabilities
        llm_config["functions"] = self._get_agent_functions()

        agent = ConversableAgent(
            name=name,
            system_message=system_message,
            llm_config=llm_config,
            human_input_mode="NEVER",
        )

        return agent

    def _get_agent_functions(self) -> list[dict[str, Any]]:
        """Get function definitions for agent tools."""
        return [
            {
                "name": "search_knowledge",
                "description": "Search the knowledge graph for information",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Natural language search query",
                        },
                    },
                    "required": ["query"],
                },
            },
            {
                "name": "get_customer_info",
                "description": "Get information about a specific customer/contact",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "customer_name": {
                            "type": "string",
                            "description": "Name or email of the customer",
                        },
                    },
                    "required": ["customer_name"],
                },
            },
            {
                "name": "list_commitments",
                "description": "List commitments, optionally filtered by status",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "status": {
                            "type": "string",
                            "description": "Filter by status (open, at_risk, fulfilled)",
                            "enum": ["open", "at_risk", "fulfilled", "all"],
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Maximum number of results",
                        },
                    },
                },
            },
            {
                "name": "list_risks",
                "description": "List identified risks",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "severity": {
                            "type": "string",
                            "description": "Filter by severity",
                            "enum": ["low", "medium", "high", "critical", "all"],
                        },
                    },
                },
            },
            {
                "name": "get_influential_people",
                "description": "Get the most influential people in the network",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "limit": {
                            "type": "integer",
                            "description": "Number of people to return",
                        },
                    },
                },
            },
        ]

    async def execute_function(
        self,
        function_name: str,
        arguments: dict[str, Any],
    ) -> dict[str, Any]:
        """
        Execute a function call from an agent.

        Args:
            function_name: Name of the function to execute
            arguments: Function arguments

        Returns:
            Function result
        """
        graph = await self._get_graph()
        graphrag = await self._get_graphrag()

        if function_name == "search_knowledge":
            result = await graphrag.query(
                question=arguments["query"],
                organization_id=self.organization_id,
            )
            return {
                "answer": result["answer"],
                "sources": result.get("sources", [])[:5],
            }

        elif function_name == "get_customer_info":
            name = arguments["customer_name"]
            result = await graph.query(
                """
                MATCH (c:Contact {organizationId: $orgId})
                WHERE c.displayName CONTAINS $name
                   OR c.email CONTAINS $name
                OPTIONAL MATCH (c)-[:INVOLVED_IN]->(commitment:Commitment)
                WHERE commitment.status IN ['open', 'active']
                RETURN c.displayName as name, c.email as email,
                       c.company as company, c.pagerankScore as influence,
                       count(commitment) as open_commitments
                LIMIT 1
                """,
                {"orgId": self.organization_id, "name": name},
            )
            return result[0] if result else {"error": "Customer not found"}

        elif function_name == "list_commitments":
            status = arguments.get("status", "all")
            limit = arguments.get("limit", 10)

            status_filter = ""
            if status != "all":
                status_filter = "AND c.status = $status"

            result = await graph.query(
                f"""
                MATCH (c:Commitment {{organizationId: $orgId}})
                WHERE c.validTo IS NULL
                {status_filter}
                RETURN c.id as id, c.title as title, c.status as status,
                       c.dueDate as due_date, c.confidence as confidence
                ORDER BY c.dueDate ASC
                LIMIT $limit
                """,
                {"orgId": self.organization_id, "status": status, "limit": limit},
            )
            return {"commitments": result or [], "count": len(result or [])}

        elif function_name == "list_risks":
            severity = arguments.get("severity", "all")

            severity_filter = ""
            if severity != "all":
                severity_filter = "AND r.severity = $severity"

            result = await graph.query(
                f"""
                MATCH (r:Risk {{organizationId: $orgId}})
                WHERE r.status IN ['identified', 'active']
                {severity_filter}
                RETURN r.id as id, r.title as title, r.severity as severity,
                       r.impact as impact, r.mitigations as mitigations
                ORDER BY r.severity DESC
                LIMIT 20
                """,
                {"orgId": self.organization_id, "severity": severity},
            )
            return {"risks": result or [], "count": len(result or [])}

        elif function_name == "get_influential_people":
            limit = arguments.get("limit", 10)
            result = await graph.query(
                """
                MATCH (c:Contact {organizationId: $orgId})
                WHERE c.pagerankScore IS NOT NULL
                RETURN c.displayName as name, c.email as email,
                       c.company as company, c.pagerankScore as influence_score
                ORDER BY c.pagerankScore DESC
                LIMIT $limit
                """,
                {"orgId": self.organization_id, "limit": limit},
            )
            return {"influential_people": result or []}

        else:
            return {"error": f"Unknown function: {function_name}"}

    def create_research_team(self) -> dict[str, Any]:
        """
        Create a pre-configured research team of agents.

        Returns dict with:
        - researcher: Gathers information from knowledge graph
        - analyst: Analyzes patterns and risks
        - strategist: Develops action recommendations
        """
        researcher = self.create_knowledge_agent(
            name="researcher",
            system_message="""You are a research agent for customer intelligence.
Your role is to gather relevant information from the knowledge graph about
customers, their commitments, relationships, and communication patterns.
Use the available functions to search and retrieve information.
Be thorough but concise in your findings.""",
        )

        analyst = self.create_knowledge_agent(
            name="analyst",
            system_message="""You are an analyst agent for customer intelligence.
Your role is to analyze information gathered by the researcher and identify:
- Patterns in customer behavior
- Risks to commitments or relationships
- Opportunities for engagement
- Anomalies that need attention
Provide clear, actionable insights.""",
        )

        strategist = self.create_knowledge_agent(
            name="strategist",
            system_message="""You are a strategy agent for customer intelligence.
Your role is to develop recommendations based on the analyst's findings:
- Prioritized action items
- Risk mitigation strategies
- Relationship strengthening opportunities
- Follow-up suggestions
Be specific and practical in your recommendations.""",
        )

        return {
            "researcher": researcher,
            "analyst": analyst,
            "strategist": strategist,
        }

    def create_commitment_tracker(self) -> dict[str, Any]:
        """
        Create agents focused on commitment tracking.

        Returns dict with:
        - tracker: Monitors commitment status
        - alerter: Identifies at-risk commitments
        """
        tracker = self.create_knowledge_agent(
            name="commitment_tracker",
            system_message="""You are a commitment tracking agent.
Your role is to monitor and report on commitment status:
- Track open commitments and their deadlines
- Identify commitments approaching due dates
- Monitor commitment fulfillment rates
Use the list_commitments function to gather data.""",
        )

        alerter = self.create_knowledge_agent(
            name="commitment_alerter",
            system_message="""You are a commitment alert agent.
Your role is to identify and escalate at-risk commitments:
- Commitments past their due date
- Commitments with declining confidence
- Patterns of unfulfilled commitments
Provide clear alerts with context and recommendations.""",
        )

        return {
            "tracker": tracker,
            "alerter": alerter,
        }

    async def run_research_task(
        self,
        task: str,
        max_rounds: int = 5,
    ) -> dict[str, Any]:
        """
        Run a research task using the research team.

        Args:
            task: Description of the research task
            max_rounds: Maximum conversation rounds

        Returns:
            Research results with findings and recommendations
        """
        try:
            from autogen import GroupChat, GroupChatManager
        except ImportError:
            raise ImportError(
                "autogen (ag2) package not installed. "
                "Install with: pip install ag2[openai]"
            )

        team = self.create_research_team()
        llm_config = await self._get_llm_config()

        group_chat = GroupChat(
            agents=[team["researcher"], team["analyst"], team["strategist"]],
            messages=[],
            max_round=max_rounds,
        )

        manager = GroupChatManager(
            groupchat=group_chat,
            llm_config=llm_config,
        )

        # Initiate the task
        result = team["researcher"].initiate_chat(
            manager,
            message=f"Research Task: {task}",
        )

        return {
            "task": task,
            "conversation": [
                {"sender": msg.get("name", "unknown"), "content": msg.get("content", "")}
                for msg in result.chat_history
            ],
            "rounds": len(result.chat_history),
        }


# =============================================================================
# Factory Functions
# =============================================================================

_ag2_instances: dict[str, DroviAG2Integration] = {}


async def get_ag2_integration(organization_id: str) -> DroviAG2Integration:
    """Get AG2 integration instance for an organization."""
    global _ag2_instances

    if organization_id not in _ag2_instances:
        _ag2_instances[organization_id] = DroviAG2Integration(organization_id)

    return _ag2_instances[organization_id]
