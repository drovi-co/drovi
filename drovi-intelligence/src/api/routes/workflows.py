"""
Workflows API - Agent Workflow Endpoints

Exposes LangGraph and AG2 workflows via REST API.
Enables programmatic access to:
- Customer research workflows
- Risk analysis workflows
- Intelligence briefings
- Multi-agent research tasks
"""

from datetime import datetime, timezone
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

logger = structlog.get_logger()

router = APIRouter(prefix="/workflows", tags=["Agent Workflows"])


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


# =============================================================================
# Request/Response Models
# =============================================================================


class CustomerResearchRequest(BaseModel):
    """Request for customer research workflow."""

    organization_id: str = Field(..., description="Organization ID")
    customer_name: str | None = Field(None, description="Customer name to search")
    customer_id: str | None = Field(None, description="Direct customer ID")


class CustomerResearchResponse(BaseModel):
    """Response from customer research workflow."""

    customer_id: str | None
    customer_name: str | None
    context: dict[str, Any]
    relationships: list[dict[str, Any]]
    commitments: list[dict[str, Any]]
    risks: list[dict[str, Any]]
    insights: list[str]
    recommendations: list[str]
    status: str
    error: str | None = None


class RiskAnalysisRequest(BaseModel):
    """Request for risk analysis workflow."""

    organization_id: str = Field(..., description="Organization ID")
    commitment_id: str | None = Field(None, description="Optional commitment to focus on")


class RiskAnalysisResponse(BaseModel):
    """Response from risk analysis workflow."""

    organization_id: str
    commitment_id: str | None
    identified_risks: list[dict[str, Any]]
    risk_factors: list[str]
    mitigation_strategies: list[str]
    priority_actions: list[str]
    status: str
    error: str | None = None


class IntelligenceBriefRequest(BaseModel):
    """Request for intelligence brief workflow."""

    organization_id: str = Field(..., description="Organization ID")
    time_period_days: int = Field(7, description="Number of days to cover", ge=1, le=90)


class IntelligenceBriefResponse(BaseModel):
    """Response from intelligence brief workflow."""

    organization_id: str
    time_period_days: int
    new_commitments: list[dict[str, Any]]
    at_risk_items: list[dict[str, Any]]
    key_changes: list[dict[str, Any]]
    influential_contacts: list[dict[str, Any]]
    executive_summary: str | None
    status: str
    error: str | None = None


class MultiAgentResearchRequest(BaseModel):
    """Request for multi-agent research task."""

    organization_id: str = Field(..., description="Organization ID")
    task: str = Field(..., description="Research task description")
    max_rounds: int = Field(5, description="Maximum conversation rounds", ge=1, le=20)


class MultiAgentResearchResponse(BaseModel):
    """Response from multi-agent research."""

    task: str
    conversation: list[dict[str, str]]
    rounds: int
    status: str
    error: str | None = None


# =============================================================================
# Workflow Endpoints
# =============================================================================


@router.post("/customer-research", response_model=CustomerResearchResponse)
async def run_customer_research(request: CustomerResearchRequest) -> CustomerResearchResponse:
    """
    Run customer research workflow.

    This workflow gathers comprehensive intelligence about a customer:
    1. Finds the customer by name or ID
    2. Gathers context (profile, history, communications)
    3. Analyzes relationships in the network
    4. Identifies associated risks
    5. Generates AI-powered insights and recommendations

    **Example Request:**
    ```json
    {
        "organization_id": "org-123",
        "customer_name": "John Smith"
    }
    ```
    """
    from src.agents.langgraph_workflows import get_workflows

    logger.info(
        "Starting customer research workflow",
        customer_name=request.customer_name,
        customer_id=request.customer_id,
        organization_id=request.organization_id,
    )

    try:
        workflows = await get_workflows(request.organization_id)
        result = await workflows.run_customer_research(
            customer_name=request.customer_name,
            customer_id=request.customer_id,
        )

        return CustomerResearchResponse(**result)

    except Exception as e:
        logger.error("Customer research workflow failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Workflow failed: {str(e)}")


@router.post("/risk-analysis", response_model=RiskAnalysisResponse)
async def run_risk_analysis(request: RiskAnalysisRequest) -> RiskAnalysisResponse:
    """
    Run risk analysis workflow.

    Analyzes risks across the organization or for a specific commitment:
    1. Scans for identified risks
    2. Analyzes contributing risk factors
    3. Generates mitigation strategies
    4. Prioritizes immediate actions

    **Example Request:**
    ```json
    {
        "organization_id": "org-123",
        "commitment_id": "commitment-456"
    }
    ```
    """
    from src.agents.langgraph_workflows import get_workflows

    logger.info(
        "Starting risk analysis workflow",
        commitment_id=request.commitment_id,
        organization_id=request.organization_id,
    )

    try:
        workflows = await get_workflows(request.organization_id)
        result = await workflows.run_risk_analysis(
            commitment_id=request.commitment_id,
        )

        return RiskAnalysisResponse(**result)

    except Exception as e:
        logger.error("Risk analysis workflow failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Workflow failed: {str(e)}")


@router.post("/intelligence-brief", response_model=IntelligenceBriefResponse)
async def run_intelligence_brief(request: IntelligenceBriefRequest) -> IntelligenceBriefResponse:
    """
    Generate an intelligence briefing.

    Summarizes key intelligence for a time period:
    - New commitments created
    - Items at risk
    - Key changes in the graph
    - Most influential contacts
    - AI-generated executive summary

    **Example Request:**
    ```json
    {
        "organization_id": "org-123",
        "time_period_days": 7
    }
    ```
    """
    from src.agents.langgraph_workflows import get_workflows

    logger.info(
        "Starting intelligence brief workflow",
        time_period_days=request.time_period_days,
        organization_id=request.organization_id,
    )

    try:
        workflows = await get_workflows(request.organization_id)
        result = await workflows.run_intelligence_brief(
            time_period_days=request.time_period_days,
        )

        return IntelligenceBriefResponse(**result)

    except Exception as e:
        logger.error("Intelligence brief workflow failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Workflow failed: {str(e)}")


@router.post("/multi-agent-research", response_model=MultiAgentResearchResponse)
async def run_multi_agent_research(request: MultiAgentResearchRequest) -> MultiAgentResearchResponse:
    """
    Run a multi-agent research task using AG2.

    Creates a team of specialized agents that collaborate:
    - Researcher: Gathers information from the knowledge graph
    - Analyst: Analyzes patterns and risks
    - Strategist: Develops recommendations

    **Example Request:**
    ```json
    {
        "organization_id": "org-123",
        "task": "Research our relationship with Acme Corp and identify risks",
        "max_rounds": 5
    }
    ```

    Note: Requires AG2 (autogen) to be installed.
    """
    from src.agents.ag2_integration import get_ag2_integration

    logger.info(
        "Starting multi-agent research",
        task=request.task[:50],
        organization_id=request.organization_id,
    )

    try:
        ag2 = await get_ag2_integration(request.organization_id)
        result = await ag2.run_research_task(
            task=request.task,
            max_rounds=request.max_rounds,
        )

        return MultiAgentResearchResponse(
            **result,
            status="completed",
        )

    except ImportError as e:
        logger.warning("AG2 not installed", error=str(e))
        raise HTTPException(
            status_code=501,
            detail="Multi-agent research requires AG2 (autogen). Install with: pip install ag2[openai]",
        )
    except Exception as e:
        logger.error("Multi-agent research failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Research failed: {str(e)}")


# =============================================================================
# LlamaIndex Endpoints
# =============================================================================


class DocumentIngestionRequest(BaseModel):
    """Request for document ingestion."""

    organization_id: str = Field(..., description="Organization ID")
    documents: list[str] = Field(..., description="List of document texts")
    metadata: list[dict[str, Any]] | None = Field(None, description="Optional metadata per document")


class DocumentIngestionResponse(BaseModel):
    """Response from document ingestion."""

    documents_processed: int
    duration_seconds: float
    organization_id: str
    status: str


class KnowledgeQueryRequest(BaseModel):
    """Request for knowledge graph query."""

    organization_id: str = Field(..., description="Organization ID")
    question: str = Field(..., description="Natural language question")
    include_text: bool = Field(True, description="Include source text")
    similarity_top_k: int = Field(10, description="Number of similar nodes", ge=1, le=50)


class KnowledgeQueryResponse(BaseModel):
    """Response from knowledge graph query."""

    answer: str
    sources: list[dict[str, Any]]
    duration_seconds: float | None = None
    organization_id: str
    status: str
    error: str | None = None


@router.post("/llamaindex/ingest", response_model=DocumentIngestionResponse)
async def ingest_documents(request: DocumentIngestionRequest) -> DocumentIngestionResponse:
    """
    Ingest documents into the LlamaIndex knowledge graph.

    Extracts triplets (subject, predicate, object) from documents
    and stores them in FalkorDB for later querying.

    **Example Request:**
    ```json
    {
        "organization_id": "org-123",
        "documents": [
            "John Smith is the CEO of Acme Corp.",
            "Acme Corp is headquartered in San Francisco."
        ]
    }
    ```
    """
    from src.llamaindex import get_llamaindex

    logger.info(
        "Ingesting documents to knowledge graph",
        document_count=len(request.documents),
        organization_id=request.organization_id,
    )

    try:
        llamaindex = await get_llamaindex(request.organization_id)
        result = await llamaindex.add_documents(
            documents=request.documents,
            metadata=request.metadata,
        )

        return DocumentIngestionResponse(**result)

    except ImportError as e:
        logger.warning("LlamaIndex not installed", error=str(e))
        raise HTTPException(
            status_code=501,
            detail="LlamaIndex integration requires additional packages. Install with: pip install llama-index llama-index-graph-stores-falkordb",
        )
    except Exception as e:
        logger.error("Document ingestion failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")


@router.post("/llamaindex/query", response_model=KnowledgeQueryResponse)
async def query_knowledge_graph(request: KnowledgeQueryRequest) -> KnowledgeQueryResponse:
    """
    Query the LlamaIndex knowledge graph.

    Uses the knowledge graph index to answer natural language questions
    with graph-based reasoning.

    **Example Request:**
    ```json
    {
        "organization_id": "org-123",
        "question": "Who is the CEO of Acme Corp?"
    }
    ```
    """
    from src.llamaindex import get_llamaindex

    logger.info(
        "Querying knowledge graph",
        question=request.question[:50],
        organization_id=request.organization_id,
    )

    try:
        llamaindex = await get_llamaindex(request.organization_id)
        result = await llamaindex.query(
            question=request.question,
            include_text=request.include_text,
            similarity_top_k=request.similarity_top_k,
        )

        return KnowledgeQueryResponse(**result)

    except ImportError as e:
        logger.warning("LlamaIndex not installed", error=str(e))
        raise HTTPException(
            status_code=501,
            detail="LlamaIndex integration requires additional packages.",
        )
    except Exception as e:
        logger.error("Knowledge query failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.get("/llamaindex/triplets")
async def get_triplets(
    organization_id: str,
    subject: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """
    Get triplets from the knowledge graph.

    Returns subject-predicate-object triplets, optionally filtered
    by subject.

    **Example:**
    ```
    GET /api/v1/workflows/llamaindex/triplets?organization_id=org-123&subject=Acme
    ```
    """
    from src.llamaindex import get_llamaindex

    try:
        llamaindex = await get_llamaindex(organization_id)
        triplets = await llamaindex.get_triplets(subject=subject, limit=limit)

        return {
            "triplets": triplets,
            "count": len(triplets),
            "organization_id": organization_id,
        }

    except Exception as e:
        logger.error("Get triplets failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed: {str(e)}")


@router.get("/llamaindex/entity-context")
async def get_entity_context(
    organization_id: str,
    entity_name: str,
    depth: int = 2,
) -> dict[str, Any]:
    """
    Get context around an entity from the knowledge graph.

    **Example:**
    ```
    GET /api/v1/workflows/llamaindex/entity-context?organization_id=org-123&entity_name=John&depth=2
    ```
    """
    from src.llamaindex import get_llamaindex

    try:
        llamaindex = await get_llamaindex(organization_id)
        context = await llamaindex.get_entity_context(
            entity_name=entity_name,
            depth=depth,
        )

        return context

    except Exception as e:
        logger.error("Get entity context failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed: {str(e)}")


# =============================================================================
# Workflow Status Endpoints
# =============================================================================


@router.get("/health")
async def check_workflows_health() -> dict[str, Any]:
    """
    Check health of workflow systems.

    Returns availability status of:
    - LangGraph workflows
    - AG2 multi-agent system
    - LlamaIndex integration
    """
    health = {
        "langgraph": "available",
        "ag2": "unknown",
        "llamaindex": "unknown",
        "timestamp": utc_now().isoformat(),
    }

    # Check AG2
    try:
        import autogen
        health["ag2"] = "available"
    except ImportError:
        health["ag2"] = "not_installed"

    # Check LlamaIndex
    try:
        import llama_index
        health["llamaindex"] = "available"
    except ImportError:
        health["llamaindex"] = "not_installed"

    return health
