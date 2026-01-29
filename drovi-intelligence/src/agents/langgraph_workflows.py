"""
LangGraph Agentic Workflows

Sophisticated agentic workflows for Drovi intelligence operations.
Uses LangGraph for state machine-based agent orchestration.

This is part of Phase 6 of the FalkorDB enhancement plan.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, TypedDict

import structlog

from src.config import get_settings

logger = structlog.get_logger()


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# =============================================================================
# State Definitions
# =============================================================================


class ResearchState(TypedDict):
    """State for customer research workflow."""
    customer_id: str | None
    customer_name: str | None
    organization_id: str
    context: dict[str, Any]
    relationships: list[dict[str, Any]]
    commitments: list[dict[str, Any]]
    risks: list[dict[str, Any]]
    insights: list[str]
    recommendations: list[str]
    status: str
    error: str | None


class RiskAnalysisState(TypedDict):
    """State for risk analysis workflow."""
    organization_id: str
    commitment_id: str | None
    identified_risks: list[dict[str, Any]]
    risk_factors: list[str]
    mitigation_strategies: list[str]
    priority_actions: list[str]
    status: str
    error: str | None


class IntelligenceBriefState(TypedDict):
    """State for intelligence briefing workflow."""
    organization_id: str
    time_period_days: int
    new_commitments: list[dict[str, Any]]
    at_risk_items: list[dict[str, Any]]
    key_changes: list[dict[str, Any]]
    influential_contacts: list[dict[str, Any]]
    executive_summary: str | None
    status: str
    error: str | None


# =============================================================================
# Workflow Implementations
# =============================================================================


class DroviWorkflows:
    """
    LangGraph workflows for Drovi intelligence.

    Provides pre-built workflows for common operations:
    - Customer research
    - Risk analysis
    - Intelligence briefing
    - Decision support
    """

    def __init__(self, organization_id: str):
        """Initialize workflows for an organization."""
        self.organization_id = organization_id
        self._graph = None
        self._graphrag = None
        self._llm_client = None

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

    async def _get_llm_client(self):
        """Get LLM client."""
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
    # Customer Research Workflow
    # =========================================================================

    async def run_customer_research(
        self,
        customer_name: str | None = None,
        customer_id: str | None = None,
    ) -> ResearchState:
        """
        Run customer research workflow.

        Gathers comprehensive context about a customer:
        1. Find customer
        2. Gather context (profile, history)
        3. Analyze relationships
        4. Identify risks
        5. Generate insights

        Args:
            customer_name: Name or email to search
            customer_id: Direct customer ID

        Returns:
            Complete research state with all findings
        """
        state: ResearchState = {
            "customer_id": customer_id,
            "customer_name": customer_name,
            "organization_id": self.organization_id,
            "context": {},
            "relationships": [],
            "commitments": [],
            "risks": [],
            "insights": [],
            "recommendations": [],
            "status": "started",
            "error": None,
        }

        try:
            # Step 1: Find customer
            state = await self._find_customer(state)
            if not state["customer_id"]:
                state["status"] = "not_found"
                state["error"] = "Customer not found"
                return state

            # Step 2: Gather context
            state = await self._gather_customer_context(state)

            # Step 3: Analyze relationships
            state = await self._analyze_relationships(state)

            # Step 4: Identify risks
            state = await self._identify_customer_risks(state)

            # Step 5: Generate insights
            state = await self._generate_insights(state)

            state["status"] = "completed"

        except Exception as e:
            logger.error("Customer research failed", error=str(e))
            state["status"] = "failed"
            state["error"] = str(e)

        return state

    async def _find_customer(self, state: ResearchState) -> ResearchState:
        """Find customer by name or ID."""
        graph = await self._get_graph()

        if state["customer_id"]:
            # Verify ID exists
            result = await graph.query(
                """
                MATCH (c:Contact {id: $id, organizationId: $orgId})
                RETURN c.id as id, c.displayName as name, c.email as email
                LIMIT 1
                """,
                {"id": state["customer_id"], "orgId": self.organization_id},
            )
        else:
            # Search by name
            result = await graph.query(
                """
                MATCH (c:Contact {organizationId: $orgId})
                WHERE c.displayName CONTAINS $name
                   OR c.email CONTAINS $name
                RETURN c.id as id, c.displayName as name, c.email as email
                LIMIT 1
                """,
                {"name": state["customer_name"] or "", "orgId": self.organization_id},
            )

        if result:
            state["customer_id"] = result[0].get("id")
            state["customer_name"] = result[0].get("name")
            state["context"]["email"] = result[0].get("email")

        return state

    async def _gather_customer_context(self, state: ResearchState) -> ResearchState:
        """Gather comprehensive customer context."""
        graph = await self._get_graph()

        # Get full profile
        result = await graph.query(
            """
            MATCH (c:Contact {id: $id, organizationId: $orgId})
            RETURN c.displayName as name, c.email as email,
                   c.company as company, c.title as title,
                   c.pagerankScore as influence_score,
                   c.communityId as community_id,
                   c.betweennessScore as bridge_score
            """,
            {"id": state["customer_id"], "orgId": self.organization_id},
        )

        if result:
            state["context"].update(result[0])

        # Get commitments
        commitments = await graph.query(
            """
            MATCH (c:Contact {id: $id, organizationId: $orgId})
                  -[:INVOLVED_IN]->(commitment:Commitment)
            WHERE commitment.validTo IS NULL
            RETURN commitment.id as id, commitment.title as title,
                   commitment.status as status, commitment.dueDate as due_date,
                   commitment.direction as direction
            ORDER BY commitment.dueDate ASC
            LIMIT 20
            """,
            {"id": state["customer_id"], "orgId": self.organization_id},
        )
        state["commitments"] = commitments or []

        return state

    async def _analyze_relationships(self, state: ResearchState) -> ResearchState:
        """Analyze customer relationships."""
        graph = await self._get_graph()

        # Get communication relationships
        result = await graph.query(
            """
            MATCH (c:Contact {id: $id, organizationId: $orgId})
                  -[r:COMMUNICATED_WITH]->(other:Contact)
            RETURN other.displayName as name, other.email as email,
                   other.company as company, r.count as message_count,
                   r.lastAt as last_communication
            ORDER BY r.count DESC
            LIMIT 10
            """,
            {"id": state["customer_id"], "orgId": self.organization_id},
        )

        state["relationships"] = result or []

        return state

    async def _identify_customer_risks(self, state: ResearchState) -> ResearchState:
        """Identify risks associated with customer."""
        graph = await self._get_graph()

        # Get direct risks
        result = await graph.query(
            """
            MATCH (c:Contact {id: $id, organizationId: $orgId})
                  <-[:INVOLVES_CONTACT]-(r:Risk)
            WHERE r.status IN ['identified', 'active']
            RETURN r.id as id, r.title as title, r.severity as severity,
                   r.impact as impact
            """,
            {"id": state["customer_id"], "orgId": self.organization_id},
        )

        state["risks"] = result or []

        # Also check for at-risk commitments
        at_risk = [c for c in state["commitments"] if c.get("status") == "at_risk"]
        if at_risk:
            state["risks"].append({
                "id": "commitment_risk",
                "title": f"{len(at_risk)} commitments at risk",
                "severity": "high" if len(at_risk) > 2 else "medium",
                "impact": "Relationship damage if commitments not fulfilled",
            })

        return state

    async def _generate_insights(self, state: ResearchState) -> ResearchState:
        """Generate insights using LLM."""
        llm = await self._get_llm_client()
        if not llm:
            return state

        settings = get_settings()

        # Prepare context summary
        context_summary = f"""
Customer: {state['customer_name']} ({state['context'].get('email', 'N/A')})
Company: {state['context'].get('company', 'Unknown')}
Title: {state['context'].get('title', 'Unknown')}
Influence Score: {state['context'].get('influence_score', 0):.2f}

Commitments ({len(state['commitments'])}):
{chr(10).join([f"- {c.get('title', 'N/A')} ({c.get('status', 'unknown')})" for c in state['commitments'][:5]])}

Relationships ({len(state['relationships'])}):
{chr(10).join([f"- {r.get('name', 'N/A')} ({r.get('message_count', 0)} messages)" for r in state['relationships'][:5]])}

Risks ({len(state['risks'])}):
{chr(10).join([f"- {r.get('title', 'N/A')} ({r.get('severity', 'unknown')})" for r in state['risks']])}
"""

        prompt = f"""Based on this customer intelligence, provide:
1. 3 key insights about this relationship
2. 3 actionable recommendations

{context_summary}

Format your response as:
INSIGHTS:
- insight 1
- insight 2
- insight 3

RECOMMENDATIONS:
- recommendation 1
- recommendation 2
- recommendation 3"""

        try:
            response = llm.chat.completions.create(
                model=settings.default_model_balanced,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=500,
                temperature=0.3,
            )

            content = response.choices[0].message.content.strip()

            # Parse response
            if "INSIGHTS:" in content and "RECOMMENDATIONS:" in content:
                insights_part = content.split("INSIGHTS:")[1].split("RECOMMENDATIONS:")[0]
                recommendations_part = content.split("RECOMMENDATIONS:")[1]

                state["insights"] = [
                    line.strip().lstrip("- ")
                    for line in insights_part.strip().split("\n")
                    if line.strip() and line.strip() != "-"
                ]
                state["recommendations"] = [
                    line.strip().lstrip("- ")
                    for line in recommendations_part.strip().split("\n")
                    if line.strip() and line.strip() != "-"
                ]

        except Exception as e:
            logger.warning("Insight generation failed", error=str(e))

        return state

    # =========================================================================
    # Risk Analysis Workflow
    # =========================================================================

    async def run_risk_analysis(
        self,
        commitment_id: str | None = None,
    ) -> RiskAnalysisState:
        """
        Run risk analysis workflow.

        Analyzes risks across the organization or for a specific commitment.

        Args:
            commitment_id: Optional commitment to focus on

        Returns:
            Risk analysis results with mitigation strategies
        """
        state: RiskAnalysisState = {
            "organization_id": self.organization_id,
            "commitment_id": commitment_id,
            "identified_risks": [],
            "risk_factors": [],
            "mitigation_strategies": [],
            "priority_actions": [],
            "status": "started",
            "error": None,
        }

        try:
            # Step 1: Identify risks
            state = await self._scan_risks(state)

            # Step 2: Analyze risk factors
            state = await self._analyze_risk_factors(state)

            # Step 3: Generate mitigation strategies
            state = await self._generate_mitigations(state)

            state["status"] = "completed"

        except Exception as e:
            logger.error("Risk analysis failed", error=str(e))
            state["status"] = "failed"
            state["error"] = str(e)

        return state

    async def _scan_risks(self, state: RiskAnalysisState) -> RiskAnalysisState:
        """Scan for identified risks."""
        graph = await self._get_graph()

        if state["commitment_id"]:
            # Risks for specific commitment
            result = await graph.query(
                """
                MATCH (c:Commitment {id: $commitmentId, organizationId: $orgId})
                      <-[:THREATENS]-(r:Risk)
                WHERE r.status IN ['identified', 'active']
                RETURN r.id as id, r.title as title, r.severity as severity,
                       r.impact as impact, r.likelihood as likelihood,
                       r.mitigations as existing_mitigations
                """,
                {"commitmentId": state["commitment_id"], "orgId": self.organization_id},
            )
        else:
            # All organization risks
            result = await graph.query(
                """
                MATCH (r:Risk {organizationId: $orgId})
                WHERE r.status IN ['identified', 'active']
                RETURN r.id as id, r.title as title, r.severity as severity,
                       r.impact as impact, r.likelihood as likelihood,
                       r.mitigations as existing_mitigations
                ORDER BY r.severity DESC
                LIMIT 20
                """,
                {"orgId": self.organization_id},
            )

        state["identified_risks"] = result or []
        return state

    async def _analyze_risk_factors(self, state: RiskAnalysisState) -> RiskAnalysisState:
        """Analyze contributing risk factors."""
        factors = []

        # Check for pattern-based factors
        high_severity = [r for r in state["identified_risks"] if r.get("severity") == "high"]
        if len(high_severity) > 3:
            factors.append("Multiple high-severity risks indicate systemic issues")

        # Check commitment health
        graph = await self._get_graph()
        at_risk_commitments = await graph.query(
            """
            MATCH (c:Commitment {organizationId: $orgId, status: 'at_risk'})
            RETURN count(c) as count
            """,
            {"orgId": self.organization_id},
        )

        if at_risk_commitments and at_risk_commitments[0].get("count", 0) > 5:
            factors.append("High number of at-risk commitments suggests capacity issues")

        state["risk_factors"] = factors
        return state

    async def _generate_mitigations(self, state: RiskAnalysisState) -> RiskAnalysisState:
        """Generate mitigation strategies."""
        llm = await self._get_llm_client()
        if not llm or not state["identified_risks"]:
            return state

        settings = get_settings()

        risks_summary = "\n".join([
            f"- {r.get('title', 'N/A')} (severity: {r.get('severity', 'unknown')})"
            for r in state["identified_risks"][:10]
        ])

        prompt = f"""Given these identified risks, provide mitigation strategies:

RISKS:
{risks_summary}

RISK FACTORS:
{chr(10).join(['- ' + f for f in state['risk_factors']]) if state['risk_factors'] else 'None identified'}

Provide:
1. 3 mitigation strategies
2. 3 priority actions to take immediately

Format as:
MITIGATIONS:
- strategy 1
- strategy 2
- strategy 3

PRIORITY ACTIONS:
- action 1
- action 2
- action 3"""

        try:
            response = llm.chat.completions.create(
                model=settings.default_model_balanced,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=400,
                temperature=0.3,
            )

            content = response.choices[0].message.content.strip()

            if "MITIGATIONS:" in content and "PRIORITY ACTIONS:" in content:
                mitigations_part = content.split("MITIGATIONS:")[1].split("PRIORITY ACTIONS:")[0]
                actions_part = content.split("PRIORITY ACTIONS:")[1]

                state["mitigation_strategies"] = [
                    line.strip().lstrip("- ")
                    for line in mitigations_part.strip().split("\n")
                    if line.strip() and line.strip() != "-"
                ]
                state["priority_actions"] = [
                    line.strip().lstrip("- ")
                    for line in actions_part.strip().split("\n")
                    if line.strip() and line.strip() != "-"
                ]

        except Exception as e:
            logger.warning("Mitigation generation failed", error=str(e))

        return state

    # =========================================================================
    # Intelligence Briefing Workflow
    # =========================================================================

    async def run_intelligence_brief(
        self,
        time_period_days: int = 7,
    ) -> IntelligenceBriefState:
        """
        Generate an intelligence briefing.

        Summarizes key intelligence for a time period:
        - New commitments
        - At-risk items
        - Key changes
        - Influential contacts

        Args:
            time_period_days: Number of days to cover

        Returns:
            Intelligence briefing state
        """
        state: IntelligenceBriefState = {
            "organization_id": self.organization_id,
            "time_period_days": time_period_days,
            "new_commitments": [],
            "at_risk_items": [],
            "key_changes": [],
            "influential_contacts": [],
            "executive_summary": None,
            "status": "started",
            "error": None,
        }

        try:
            # Gather data
            state = await self._gather_brief_data(state)

            # Generate summary
            state = await self._generate_executive_summary(state)

            state["status"] = "completed"

        except Exception as e:
            logger.error("Intelligence brief failed", error=str(e))
            state["status"] = "failed"
            state["error"] = str(e)

        return state

    async def _gather_brief_data(self, state: IntelligenceBriefState) -> IntelligenceBriefState:
        """Gather data for intelligence brief."""
        graph = await self._get_graph()
        from datetime import timedelta

        cutoff = (utc_now() - timedelta(days=state["time_period_days"])).isoformat()

        # New commitments
        new_commitments = await graph.query(
            """
            MATCH (c:Commitment {organizationId: $orgId})
            WHERE c.createdAt >= $cutoff
            RETURN c.id as id, c.title as title, c.status as status,
                   c.dueDate as due_date
            ORDER BY c.createdAt DESC
            LIMIT 10
            """,
            {"orgId": self.organization_id, "cutoff": cutoff},
        )
        state["new_commitments"] = new_commitments or []

        # At-risk items
        at_risk = await graph.query(
            """
            MATCH (c:Commitment {organizationId: $orgId, status: 'at_risk'})
            RETURN c.id as id, c.title as title, c.dueDate as due_date
            LIMIT 10
            """,
            {"orgId": self.organization_id},
        )
        state["at_risk_items"] = at_risk or []

        # Influential contacts
        influential = await graph.query(
            """
            MATCH (c:Contact {organizationId: $orgId})
            WHERE c.pagerankScore IS NOT NULL
            RETURN c.displayName as name, c.email as email,
                   c.pagerankScore as influence
            ORDER BY c.pagerankScore DESC
            LIMIT 5
            """,
            {"orgId": self.organization_id},
        )
        state["influential_contacts"] = influential or []

        return state

    async def _generate_executive_summary(
        self,
        state: IntelligenceBriefState,
    ) -> IntelligenceBriefState:
        """Generate executive summary."""
        llm = await self._get_llm_client()
        if not llm:
            return state

        settings = get_settings()

        brief_data = f"""
Time Period: Last {state['time_period_days']} days

New Commitments ({len(state['new_commitments'])}):
{chr(10).join([f"- {c.get('title', 'N/A')}" for c in state['new_commitments'][:5]])}

At-Risk Items ({len(state['at_risk_items'])}):
{chr(10).join([f"- {c.get('title', 'N/A')}" for c in state['at_risk_items'][:5]])}

Top Influential Contacts:
{chr(10).join([f"- {c.get('name', 'N/A')} (score: {c.get('influence', 0):.2f})" for c in state['influential_contacts']])}
"""

        prompt = f"""Generate a concise executive summary (2-3 paragraphs) based on this intelligence data:

{brief_data}

Focus on:
1. Overall health of commitments and relationships
2. Key risks requiring attention
3. Notable patterns or opportunities"""

        try:
            response = llm.chat.completions.create(
                model=settings.default_model_balanced,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=400,
                temperature=0.3,
            )

            state["executive_summary"] = response.choices[0].message.content.strip()

        except Exception as e:
            logger.warning("Summary generation failed", error=str(e))

        return state


# =============================================================================
# Factory Functions
# =============================================================================

_workflow_instances: dict[str, DroviWorkflows] = {}


async def get_workflows(organization_id: str) -> DroviWorkflows:
    """Get workflows instance for an organization."""
    global _workflow_instances

    if organization_id not in _workflow_instances:
        _workflow_instances[organization_id] = DroviWorkflows(organization_id)

    return _workflow_instances[organization_id]
