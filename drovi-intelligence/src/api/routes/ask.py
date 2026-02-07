"""
Ask API - Natural Language Query Interface

Enables natural language questions over the Drovi knowledge graph.
Uses GraphRAG for intelligent query generation and response synthesis.

Includes 2-phase truth-first protocol for pilot surface:
- Phase A: Truth (< 200ms) - structured retrieval from graph
- Phase B: Reasoning (streaming) - LLM narrative synthesis

Examples:
- "Who are the most influential people in our network?"
- "What commitments are at risk?"
- "Show me recent decisions about the product launch"
- "Who connects the sales and engineering teams?"
"""

import asyncio
import json
import time
import re
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Literal

import structlog
from fastapi import APIRouter, Query, HTTPException, Depends
from fastapi.responses import StreamingResponse
from prometheus_client import Histogram
from pydantic import BaseModel, Field

from src.graphrag import query_graph
from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.private_sources import get_session_user_id, is_admin_or_internal
from src.auth.scopes import Scope
from src.agents import get_session_manager

logger = structlog.get_logger()

router = APIRouter(prefix="/ask", tags=["Natural Language Query"])

# Prometheus metrics
ask_truth_latency = Histogram(
    "drovi_ask_truth_latency_seconds",
    "Ask truth phase latency",
    ["organization_id"],
    buckets=[0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.0],
)

ask_total_latency = Histogram(
    "drovi_ask_total_latency_seconds",
    "Ask total latency including reasoning",
    ["organization_id", "mode"],
    buckets=[0.5, 1.0, 2.0, 3.0, 5.0, 10.0],
)

FOLLOWUP_PRONOUNS = {
    "he", "she", "they", "them", "his", "her", "their",
    "it", "its", "this", "that", "these", "those",
    "there", "here", "him", "hers",
}


def _is_followup_question(question: str) -> bool:
    tokens = re.findall(r"[a-z']+", question.lower())
    if len(tokens) <= 6:
        return True
    return any(token in FOLLOWUP_PRONOUNS for token in tokens)


def _extract_source_names(sources: list[dict[str, Any]]) -> list[str]:
    names: list[str] = []
    for source in sources:
        name = source.get("name") or source.get("title")
        if name and name not in names:
            names.append(name)
        if len(names) >= 5:
            break
    return names


async def _augment_question_with_session(
    question: str,
    session,
) -> tuple[str, bool]:
    if not session:
        return question, False
    if not _is_followup_question(question):
        return question, False

    recent_queries = session.context.get_recent_queries(1)
    recent_names = session.metadata.get("recent_entity_names") or []

    context_lines = []
    if recent_names:
        context_lines.append(f"Recently discussed: {', '.join(recent_names[:5])}.")
    if recent_queries:
        context_lines.append(f"Previous question: {recent_queries[0]}")

    if not context_lines:
        return question, False

    context_hint = "Context: " + " ".join(context_lines) + " Resolve pronouns accordingly."
    augmented = f"{context_hint}\n\nQuestion: {question}"
    return augmented, True


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
    session_id: str | None = Field(
        default=None,
        description="Optional session ID for follow-up context",
    )
    include_evidence: bool = Field(
        default=True,
        description="Include source citations in the response",
    )
    user_id: str | None = Field(
        default=None,
        description="Optional user ID for RAM-layer personalization",
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
    session_id: str | None = Field(
        default=None,
        description="Session ID for follow-up queries",
    )
    context_used: bool = Field(
        default=False,
        description="Whether prior session context was used to interpret the question",
    )
    closest_matches_used: bool = Field(
        default=False,
        description="Whether closest-match fallback was used",
    )
    user_context: dict[str, Any] | None = Field(
        default=None,
        description="RAM-layer user context included in the response",
    )


@router.post("", response_model=AskResponse)
async def ask_knowledge_graph(
    request: AskRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> AskResponse:
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

    # Validate org access against auth context.
    org_id = request.organization_id or ctx.organization_id
    if not org_id or org_id == "internal":
        raise HTTPException(status_code=400, detail="organization_id is required")
    if (
        ctx.organization_id != "internal"
        and request.organization_id
        and request.organization_id != ctx.organization_id
    ):
        raise HTTPException(status_code=403, detail="Organization ID mismatch with authenticated key")

    session_user_id = get_session_user_id(ctx)
    is_admin = is_admin_or_internal(ctx)

    session = None
    context_used = False

    try:
        session_manager = await get_session_manager()
        session = await session_manager.get_or_create_session(
            request.session_id,
            org_id,
        )
    except Exception as exc:
        logger.warning("Ask session unavailable", error=str(exc))

    try:
        augmented_question, context_used = await _augment_question_with_session(
            request.question,
            session,
        )

        # Never trust client-supplied user_id for visibility boundaries.
        # For personalization, prefer the authenticated session user id.
        effective_user_id = session_user_id or (session.metadata.get("user_id") if session else None)
        if request.user_id and session_user_id and request.user_id != session_user_id:
            logger.warning(
                "ask_user_id_mismatch_ignored",
                request_user_id=request.user_id,
                session_user_id=session_user_id,
            )

        result = await query_graph(
            question=augmented_question,
            organization_id=org_id,
            include_evidence=request.include_evidence,
            user_id=effective_user_id,
            visibility_user_id=session_user_id,
            visibility_is_admin=is_admin,
        )

        if session:
            session.add_interaction(
                request.question,
                result.get("answer", ""),
                metadata={"intent": result.get("intent")},
            )
            session.context.add_search_results(result.get("sources", []), request.question)
            session.metadata["recent_entity_names"] = _extract_source_names(result.get("sources", []))
            session.metadata["last_intent"] = result.get("intent")
            await session_manager.update_session(session)

        result["session_id"] = session.session_id if session else None
        result["context_used"] = context_used
        result["closest_matches_used"] = result.get("closest_matches_used", False)
        result["user_context"] = result.get("user_context")

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
    session_id: str | None = Query(
        default=None,
        description="Optional session ID for follow-up context",
    ),
    include_evidence: bool = Query(
        default=True,
        description="Include source citations",
    ),
    user_id: str | None = Query(
        default=None,
        description="Optional user ID for RAM-layer personalization",
    ),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
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
            session_id=session_id,
            include_evidence=include_evidence,
            user_id=user_id,
        ),
        ctx=ctx,
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


# =============================================================================
# 2-Phase Truth-First Protocol (Pilot Surface)
# =============================================================================


class AskStreamRequest(BaseModel):
    """Request for 2-phase streaming ask."""

    organization_id: str = Field(..., description="Organization ID")
    query: str = Field(..., min_length=3, max_length=1000, description="Natural language query")
    session_id: str | None = Field(default=None, description="Optional session ID for follow-up context")
    mode: Literal["truth", "truth+reasoning"] = Field(
        default="truth+reasoning",
        description="Response mode: truth only or truth + streaming reasoning",
    )


class TruthResult(BaseModel):
    """Individual result in truth phase."""

    type: str
    id: str
    title: str
    status: str
    confidence: float
    evidence_id: str | None = None


class Citation(BaseModel):
    """Citation for evidence."""

    index: int
    evidence_id: str
    snippet: str
    source: str
    date: str


class TruthEvent(BaseModel):
    """Truth phase event (Phase A)."""

    type: str = "truth"
    query_understood: str
    results: list[TruthResult]
    citations: list[Citation]
    session_id: str | None = None
    context_used: bool = False


async def _retrieve_truth(
    organization_id: str,
    query: str,
    session_id: str | None = None,
    context_used: bool = False,
    user_id: str | None = None,
    visibility_user_id: str | None = None,
    visibility_is_admin: bool = False,
) -> tuple[TruthEvent, list[dict]]:
    """
    Phase A: Retrieve structured truth from graph (< 200ms target).

    Returns truth event and raw results for reasoning phase.
    """
    start = time.time()

    try:
        # Use existing GraphRAG query
        result = await query_graph(
            question=query,
            organization_id=organization_id,
            include_evidence=True,
            user_id=user_id,
            visibility_user_id=visibility_user_id,
            visibility_is_admin=visibility_is_admin,
        )

        # Transform to truth format
        results = []
        citations = []

        for i, source in enumerate(result.get("sources", [])[:10]):
            # Build result
            results.append(
                TruthResult(
                    type=source.get("type", "item"),
                    id=source.get("id", f"item_{i}"),
                    title=source.get("title") or source.get("name", "Unknown"),
                    status=source.get("status", "unknown"),
                    confidence=source.get("confidence", 0.8),
                    evidence_id=source.get("evidence_id"),
                )
            )

            # Build citation if evidence exists
            if source.get("evidence_id"):
                citations.append(
                    Citation(
                        index=i + 1,
                        evidence_id=source["evidence_id"],
                        snippet=source.get("snippet", source.get("title", ""))[:200],
                        source=source.get("source_type", "unknown"),
                        date=source.get("date", utc_now().strftime("%Y-%m-%d")),
                    )
                )

        truth = TruthEvent(
            query_understood=result.get("intent", "general query"),
            results=results,
            citations=citations,
            session_id=session_id,
            context_used=context_used,
        )

        latency = time.time() - start
        ask_truth_latency.labels(organization_id=organization_id).observe(latency)

        logger.info(
            "Truth phase completed",
            organization_id=organization_id,
            results_count=len(results),
            latency_ms=round(latency * 1000),
        )

        return truth, result.get("sources", [])

    except Exception as e:
        logger.error("Truth phase failed", error=str(e), organization_id=organization_id)
        # Return empty truth on error
        return TruthEvent(
            query_understood="query processing",
            results=[],
            citations=[],
            session_id=session_id,
            context_used=context_used,
        ), []


async def _stream_reasoning(
    query: str,
    truth: TruthEvent,
    raw_results: list[dict],
    organization_id: str,
) -> AsyncGenerator[str, None]:
    """
    Phase B: Stream reasoning tokens from LLM.

    Synthesizes natural language explanation based on truth.
    """
    from src.graphrag import get_graphrag

    try:
        graphrag = await get_graphrag()
        llm = await graphrag._get_llm_client()

        if not llm:
            # No LLM configured, return simple summary
            summary = f"Found {len(truth.results)} results for your query about {truth.query_understood}."
            if truth.results:
                summary += " The top results include: "
                summary += ", ".join(r.title for r in truth.results[:3])
                summary += "."

            for char in summary:
                yield char
                await asyncio.sleep(0.01)
            return

        # Build context from truth
        context = f"Query: {query}\n\nResults found:\n"
        for i, result in enumerate(truth.results[:5]):
            context += f"{i+1}. [{result.type}] {result.title} (status: {result.status}, confidence: {result.confidence:.0%})\n"

        if truth.citations:
            context += "\nEvidence citations:\n"
            for citation in truth.citations[:5]:
                context += f"[{citation.index}] {citation.snippet} ({citation.source}, {citation.date})\n"

        # Stream from LLM
        prompt = f"""Based on the following search results, provide a concise analysis for the user.
Reference citations using [1], [2] etc format when mentioning specific items.

{context}

Provide a helpful, conversational summary:"""

        # Use streaming if available
        response = await llm.agenerate([prompt])
        text = response.generations[0][0].text

        # Simulate streaming by yielding character by character
        for char in text:
            yield char
            await asyncio.sleep(0.005)

    except Exception as e:
        logger.error("Reasoning phase failed", error=str(e))
        yield f"Unable to generate reasoning: {str(e)}"


def _sse_event(event_type: str, data: dict) -> str:
    """Format SSE event."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


async def _ask_stream_generator(
    request: AskStreamRequest,
    *,
    session_user_id: str | None,
    is_admin: bool,
) -> AsyncGenerator[str, None]:
    """
    Generate SSE stream for 2-phase ask protocol.

    Events:
    - truth: Structured results (Phase A, < 200ms)
    - reasoning_start: Reasoning phase begins
    - token: Individual reasoning token
    - done: Stream complete with stats
    - error: Error occurred
    """
    start_time = time.time()
    total_tokens = 0
    session = None
    context_used = False
    session_manager = None

    try:
        session_manager = await get_session_manager()
        session = await session_manager.get_or_create_session(
            request.session_id,
            request.organization_id,
        )
    except Exception as exc:
        logger.warning("Ask stream session unavailable", error=str(exc))

    try:
        augmented_query, context_used = await _augment_question_with_session(
            request.query,
            session,
        )

        # Phase A: Truth (< 200ms target)
        truth, raw_results = await _retrieve_truth(
            organization_id=request.organization_id,
            query=augmented_query,
            session_id=session.session_id if session else None,
            context_used=context_used,
            user_id=session_user_id,
            visibility_user_id=session_user_id,
            visibility_is_admin=is_admin,
        )

        yield _sse_event("truth", truth.model_dump())

        # If truth-only mode, we're done
        if request.mode == "truth":
            latency_ms = (time.time() - start_time) * 1000
            yield _sse_event("done", {
                "total_tokens": 0,
                "latency_ms": round(latency_ms),
            })
            return

        # Phase B: Reasoning (streaming)
        yield _sse_event("reasoning_start", {})

        reasoning_buffer = ""
        async for token in _stream_reasoning(
            query=request.query,
            truth=truth,
            raw_results=raw_results,
            organization_id=request.organization_id,
        ):
            reasoning_buffer += token
            total_tokens += 1
            yield _sse_event("token", {"token": token})

        if session and session_manager:
            session.add_interaction(
                request.query,
                reasoning_buffer,
                metadata={"intent": truth.query_understood},
            )
            session.context.add_search_results(raw_results or [], request.query)
            session.metadata["recent_entity_names"] = _extract_source_names(raw_results or [])
            session.metadata["last_intent"] = truth.query_understood
            await session_manager.update_session(session)

        # Done
        latency_ms = (time.time() - start_time) * 1000
        ask_total_latency.labels(
            organization_id=request.organization_id,
            mode=request.mode,
        ).observe(latency_ms / 1000)

        yield _sse_event("done", {
            "total_tokens": total_tokens,
            "latency_ms": round(latency_ms),
        })

        logger.info(
            "Ask stream completed",
            organization_id=request.organization_id,
            total_tokens=total_tokens,
            latency_ms=round(latency_ms),
        )

    except Exception as e:
        logger.error("Ask stream failed", error=str(e))
        yield _sse_event("error", {"message": str(e)})


@router.post("/stream")
async def ask_stream(
    request: AskStreamRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
) -> StreamingResponse:
    """
    2-Phase Truth-First Ask Protocol (SSE Streaming).

    This endpoint implements the truth-first protocol for the pilot surface:

    **Phase A: Truth (< 200ms)**
    - Retrieves structured results from the knowledge graph
    - Returns immediately with evidence and citations
    - User sees "truth" before any LLM processing

    **Phase B: Reasoning (streaming)**
    - LLM synthesizes natural language explanation
    - Tokens stream after truth is delivered
    - References citations from Phase A

    **SSE Event Types:**
    - `truth`: Structured results (query_understood, results, citations)
    - `reasoning_start`: Reasoning phase begins
    - `token`: Individual reasoning token
    - `done`: Stream complete (total_tokens, latency_ms)
    - `error`: Error occurred (message)

    **Example Usage:**
    ```javascript
    const response = await fetch('/api/v1/ask/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: 'org_123',
        query: 'What did we promise Acme Corp?',
        mode: 'truth+reasoning'
      })
    });

    const reader = response.body.getReader();
    // Parse SSE events...
    ```
    """
    if ctx.organization_id != "internal" and request.organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch with authenticated key")

    session_user_id = get_session_user_id(ctx)
    is_admin = is_admin_or_internal(ctx)

    return StreamingResponse(
        _ask_stream_generator(request, session_user_id=session_user_id, is_admin=is_admin),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
