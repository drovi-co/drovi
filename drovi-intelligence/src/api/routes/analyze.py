"""
Intelligence Analysis Endpoints

Provides streaming intelligence extraction via LangGraph orchestrator.
"""

from datetime import datetime
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.orchestrator.graph import compile_intelligence_graph
from src.orchestrator.state import IntelligenceState, AnalysisInput

router = APIRouter()
logger = structlog.get_logger()


class AnalyzeRequest(BaseModel):
    """Request body for intelligence analysis."""

    content: str = Field(..., description="Content to analyze")
    source_type: Literal[
        "email",
        "slack",
        "notion",
        "google_docs",
        "whatsapp",
        "calendar",
        "meeting",
        "call",
        "recording",
        "transcript",
        "api",
        "manual",
    ] = Field(default="api")
    source_id: str | None = Field(default=None, description="Optional source identifier")
    organization_id: str = Field(..., description="Organization ID")
    conversation_id: str | None = Field(default=None)
    message_ids: list[str] | None = Field(default=None)
    user_email: str | None = Field(default=None)
    user_name: str | None = Field(default=None)
    candidate_only: bool = Field(default=False, description="Only persist candidates, skip full synthesis")

    # Analysis options
    extract_commitments: bool = Field(default=True)
    extract_decisions: bool = Field(default=True)
    analyze_risk: bool = Field(default=True)
    deduplicate: bool = Field(default=True)


class AnalyzeResponse(BaseModel):
    """Response body for intelligence analysis."""

    analysis_id: str
    success: bool
    claims: list[dict] = Field(default_factory=list)
    commitments: list[dict] = Field(default_factory=list)
    decisions: list[dict] = Field(default_factory=list)
    tasks: list[dict] = Field(default_factory=list)
    risks: list[dict] = Field(default_factory=list)
    confidence: float
    needs_review: bool
    processing_time_ms: int


@router.post("/analyze")
async def analyze_content(
    request: AnalyzeRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> AnalyzeResponse:
    """
    Analyze content and extract intelligence.

    Returns extracted claims, commitments, decisions, and risks.

    Requires `write` scope.
    """
    # Use organization_id from auth context if not in request, or validate match
    if ctx.organization_id != "internal" and request.organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )

    start_time = datetime.utcnow()
    logger.info(
        "Starting analysis",
        organization_id=request.organization_id,
        source_type=request.source_type,
        content_length=len(request.content),
        key_id=ctx.key_id,
    )

    try:
        # Create orchestrator graph
        graph = compile_intelligence_graph()

        # Build initial state
        initial_state = IntelligenceState(
            input=AnalysisInput(
                organization_id=request.organization_id,
                content=request.content,
                source_type=request.source_type,
                source_id=request.source_id,
                conversation_id=request.conversation_id,
                message_ids=request.message_ids,
                user_email=request.user_email,
                user_name=request.user_name,
                candidate_only=request.candidate_only,
            ),
            routing={
                "should_extract_commitments": request.extract_commitments,
                "should_extract_decisions": request.extract_decisions,
                "should_analyze_risk": request.analyze_risk,
                "should_deduplicate": request.deduplicate,
                "candidate_only": request.candidate_only,
            },
        )

        # Run the orchestrator (returns dict, not IntelligenceState)
        final_state = await graph.ainvoke(initial_state)

        # Calculate processing time
        processing_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        # Access dict keys (LangGraph returns state as dict)
        extracted = final_state.get("extracted", {})
        confidence = final_state.get("confidence", {})

        # Helper to convert Pydantic models to dicts
        def to_dict_list(items):
            if not items:
                return []
            encoded = []
            for item in items:
                if hasattr(item, "model_dump"):
                    encoded.append(item.model_dump(mode="json"))
                else:
                    encoded.append(jsonable_encoder(item))
            return encoded

        # Get extracted items
        claims = extracted.get("claims", []) if isinstance(extracted, dict) else getattr(extracted, "claims", [])
        commitments = extracted.get("commitments", []) if isinstance(extracted, dict) else getattr(extracted, "commitments", [])
        decisions = extracted.get("decisions", []) if isinstance(extracted, dict) else getattr(extracted, "decisions", [])
        tasks = extracted.get("tasks", []) if isinstance(extracted, dict) else getattr(extracted, "tasks", [])
        risks = extracted.get("risks", []) if isinstance(extracted, dict) else getattr(extracted, "risks", [])

        response = AnalyzeResponse(
            analysis_id=final_state.get("analysis_id", "unknown"),
            success=True,
            claims=to_dict_list(claims),
            commitments=to_dict_list(commitments),
            decisions=to_dict_list(decisions),
            tasks=to_dict_list(tasks),
            risks=to_dict_list(risks),
            confidence=confidence.get("overall", 0.0) if isinstance(confidence, dict) else getattr(confidence, "overall", 0.0),
            needs_review=confidence.get("needs_review", False) if isinstance(confidence, dict) else getattr(confidence, "needs_review", False),
            processing_time_ms=processing_time,
        )
        return ORJSONResponse(content=response.model_dump(mode="json"))

    except Exception as e:
        logger.error("Analysis failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.post("/analyze/stream")
async def analyze_content_stream(
    request: AnalyzeRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Analyze content with streaming updates.

    Returns Server-Sent Events (SSE) with progress updates.

    Requires `write` scope.
    """
    # Validate organization_id matches auth context
    if ctx.organization_id != "internal" and request.organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )

    logger.info(
        "Starting streaming analysis",
        organization_id=request.organization_id,
        source_type=request.source_type,
        key_id=ctx.key_id,
    )

    async def generate_events():
        try:
            # Create orchestrator graph
            graph = compile_intelligence_graph()

            # Build initial state
            initial_state = IntelligenceState(
                input=AnalysisInput(
                    organization_id=request.organization_id,
                    content=request.content,
                    source_type=request.source_type,
                    source_id=request.source_id,
                    conversation_id=request.conversation_id,
                    message_ids=request.message_ids,
                    user_email=request.user_email,
                    user_name=request.user_name,
                ),
                routing={
                    "should_extract_commitments": request.extract_commitments,
                    "should_extract_decisions": request.extract_decisions,
                    "should_analyze_risk": request.analyze_risk,
                    "should_deduplicate": request.deduplicate,
                },
            )

            # Stream through the graph
            async for event in graph.astream(initial_state):
                yield {
                    "event": "progress",
                    "data": {
                        "node": event.get("node", "unknown"),
                        "state": event.get("state", {}),
                    },
                }

            yield {
                "event": "complete",
                "data": {"success": True},
            }

        except Exception as e:
            logger.error("Streaming analysis failed", error=str(e))
            yield {
                "event": "error",
                "data": {"error": str(e)},
            }

    return EventSourceResponse(generate_events())
