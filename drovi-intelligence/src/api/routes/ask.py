"""
Ask API - Natural Language Query Interface

Enables natural language questions over the Drovi knowledge graph.
Uses GraphRAG for intelligent query generation and response synthesis.

Examples:
- "Who are the most influential people in our network?"
- "What commitments are at risk?"
- "Show me recent decisions about the product launch"
- "Who connects the sales and engineering teams?"
"""

from datetime import datetime, timezone
from typing import Any

import structlog
from fastapi import APIRouter, Query, HTTPException
from pydantic import BaseModel, Field

from src.graphrag import query_graph

logger = structlog.get_logger()

router = APIRouter(prefix="/ask", tags=["Natural Language Query"])


def utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AskRequest(BaseModel):
    """Request body for natural language queries."""

    question: str = Field(
        ...,
        description="Natural language question about your knowledge graph",
        min_length=3,
        max_length=1000,
        examples=[
            "Who are the most influential people in our network?",
            "What commitments are at risk?",
            "Show me recent decisions",
        ],
    )
    organization_id: str = Field(
        ...,
        description="Organization ID to query",
    )
    include_evidence: bool = Field(
        default=True,
        description="Include source citations in the response",
    )


class AskResponse(BaseModel):
    """Response from natural language query."""

    answer: str = Field(
        description="Natural language answer to the question",
    )
    intent: str = Field(
        description="Classified intent of the question",
    )
    sources: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Source citations for the answer",
    )
    cypher_query: str | None = Field(
        default=None,
        description="The Cypher query used (if applicable)",
    )
    results_count: int = Field(
        description="Number of graph results used",
    )
    duration_seconds: float = Field(
        description="Query processing time",
    )
    timestamp: str = Field(
        description="Response timestamp",
    )


@router.post("", response_model=AskResponse)
async def ask_knowledge_graph(request: AskRequest) -> AskResponse:
    """
    Ask a natural language question about your knowledge graph.

    This endpoint uses GraphRAG to:
    1. Classify the intent of your question
    2. Generate appropriate graph queries
    3. Execute queries against FalkorDB
    4. Synthesize a natural language response

    **Supported Question Types:**

    - **Influence & Importance:** "Who are the most influential people?"
    - **Commitments:** "What commitments are at risk?"
    - **Decisions:** "What decisions were made recently?"
    - **Risks:** "What are the active risks?"
    - **Relationships (specific):** "Who does Margaret White communicate with?"
    - **Top Communicators (general):** "Who communicates the most?"
    - **Network Analysis:** "What clusters exist?", "Who are the bridge connectors?"
    - **Customer 360:** "Tell me about Aisha Chen"
    - **Entity/Company Search:** "Tell me about BuildRight Construction"
    - **Cross-Entity:** "Which commitments are threatened by risks?"
    - **Topic-Filtered:** "What decisions about Q1 product roadmap?"
    - **Urgent Issues:** "What key issues need immediate attention?"

    **Example Request:**
    ```json
    {
        "question": "Who are the most influential people in our network?",
        "organization_id": "org-123",
        "include_evidence": true
    }
    ```

    **Example Response:**
    ```json
    {
        "answer": "The most influential people in your network are: John Smith, Jane Doe, Bob Wilson...",
        "intent": "influential",
        "sources": [
            {"id": "contact-1", "name": "John Smith", "email": "john@example.com"},
            ...
        ],
        "cypher_query": "MATCH (c:Contact {organizationId: $orgId}) WHERE c.pagerankScore...",
        "results_count": 10,
        "duration_seconds": 0.234,
        "timestamp": "2024-01-15T10:30:00Z"
    }
    ```
    """
    logger.info(
        "Processing natural language query",
        question=request.question[:50],
        organization_id=request.organization_id,
    )

    try:
        result = await query_graph(
            question=request.question,
            organization_id=request.organization_id,
            include_evidence=request.include_evidence,
        )

        return AskResponse(**result)

    except Exception as e:
        logger.error(
            "Natural language query failed",
            question=request.question[:50],
            error=str(e),
        )
        raise HTTPException(
            status_code=500,
            detail=f"Query failed: {str(e)}",
        )


@router.get("")
async def ask_get(
    question: str = Query(
        ...,
        description="Natural language question",
        min_length=3,
    ),
    organization_id: str = Query(
        ...,
        description="Organization ID",
    ),
    include_evidence: bool = Query(
        default=True,
        description="Include source citations",
    ),
) -> AskResponse:
    """
    Ask a natural language question (GET version).

    Same as POST but using query parameters.
    Useful for quick testing and simple integrations.

    **Example:**
    ```
    GET /api/v1/ask?question=Who%20are%20the%20most%20influential%20people&organization_id=org-123
    ```
    """
    return await ask_knowledge_graph(
        AskRequest(
            question=question,
            organization_id=organization_id,
            include_evidence=include_evidence,
        )
    )


@router.get("/intents")
async def list_supported_intents() -> dict[str, Any]:
    """
    List supported question intents and example questions.

    Returns a mapping of intent types to example questions
    that the GraphRAG engine can handle.
    """
    return {
        "intents": {
            "influential": {
                "description": "Questions about influence and importance",
                "examples": [
                    "Who are the most influential people?",
                    "Who are the key decision makers?",
                    "Who has the highest PageRank?",
                ],
                "graph_features": ["PageRank", "influence scoring"],
            },
            "commitments": {
                "description": "Questions about commitments and promises",
                "examples": [
                    "What commitments are at risk?",
                    "Show me open commitments",
                    "What deliverables are pending?",
                ],
                "graph_features": ["Commitment nodes", "status tracking"],
            },
            "decisions": {
                "description": "Questions about decisions made",
                "examples": [
                    "What decisions were made recently?",
                    "Show me the decision about X",
                    "Who made this decision?",
                ],
                "graph_features": ["Decision nodes", "rationale tracking"],
            },
            "risks": {
                "description": "Questions about risks and issues",
                "examples": [
                    "What are the active risks?",
                    "Are there any high severity risks?",
                    "What risks affect this commitment?",
                ],
                "graph_features": ["Risk nodes", "severity scoring"],
            },
            "relationships": {
                "description": "Questions about a specific person's communication relationships",
                "examples": [
                    "Who does John communicate with?",
                    "Show me Margaret White's connections",
                    "How often does Alice talk to Bob?",
                ],
                "graph_features": ["COMMUNICATES_WITH relationships", "message counts"],
            },
            "top_communicators": {
                "description": "Questions about overall communication patterns without a specific person",
                "examples": [
                    "Who communicates the most?",
                    "Which people communicate the most?",
                    "Show me the most active communicators",
                ],
                "graph_features": ["COMMUNICATES_WITH aggregation", "message counts"],
            },
            "clusters": {
                "description": "Questions about communication clusters",
                "examples": [
                    "What communication clusters exist?",
                    "Show me team groupings",
                    "What communities have formed?",
                ],
                "graph_features": ["Community detection", "CDLP algorithm"],
            },
            "bridges": {
                "description": "Questions about bridge connectors",
                "examples": [
                    "Who are the bridge connectors?",
                    "Who connects different teams?",
                    "Who can introduce me to X?",
                ],
                "graph_features": ["Betweenness centrality", "introduction paths"],
            },
            "customer": {
                "description": "Questions about a specific person/contact",
                "examples": [
                    "Tell me about Aisha Chen",
                    "What's the context on Kenneth Singh?",
                    "Show me everything about [person]",
                ],
                "graph_features": ["Customer 360 view", "relationship context"],
            },
            "entity": {
                "description": "Questions about a company or organization",
                "examples": [
                    "Tell me about BuildRight Construction",
                    "What is happening at GlobalRetail?",
                    "Who works at [company name]?",
                ],
                "graph_features": ["Entity search", "company contacts", "commitments"],
            },
            "commitments_at_risk": {
                "description": "Cross-entity questions about commitments threatened by risks",
                "examples": [
                    "Which commitments are being threatened by risks?",
                    "What risks are impacting our commitments?",
                    "Show me risk-to-commitment relationships",
                ],
                "graph_features": ["THREATENS relationships", "Risk→Commitment mapping"],
            },
            "urgent_issues": {
                "description": "Questions about urgent issues needing immediate attention",
                "examples": [
                    "What key issues need immediate attention?",
                    "What is urgent right now?",
                    "Show me critical problems",
                ],
                "graph_features": ["High-severity risks", "at-risk commitments"],
            },
        },
        "tips": [
            "Be specific with names and entities for better results",
            "Ask about companies by name to see all contacts and commitments there",
            "Combine topics like 'What decisions about Q1 roadmap?' for filtered results",
            "Use the include_evidence flag to see source citations",
            "Run analytics jobs first (PageRank, communities) for full insights",
            "The system uses LLM-powered intent classification for accurate routing",
        ],
    }


@router.get("/health")
async def check_graphrag_health() -> dict[str, Any]:
    """
    Check GraphRAG health and capabilities.

    Returns status of graph connection and available features.
    """
    from src.graphrag import get_graphrag

    graphrag = await get_graphrag()
    graph_status = "unknown"
    llm_status = "unknown"

    try:
        graph = await graphrag._get_graph()
        await graph.query("RETURN 1")
        graph_status = "connected"
    except Exception as e:
        graph_status = f"error: {str(e)}"

    try:
        llm = await graphrag._get_llm_client()
        llm_status = "configured" if llm else "not_configured"
    except Exception as e:
        llm_status = f"error: {str(e)}"

    return {
        "status": "healthy" if graph_status == "connected" else "degraded",
        "graph": graph_status,
        "llm": llm_status,
        "timestamp": utc_now().isoformat(),
    }
