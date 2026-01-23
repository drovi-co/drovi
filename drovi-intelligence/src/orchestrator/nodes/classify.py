"""
Classify Node

Classifies content to determine what types of intelligence can be extracted.
"""

import time

import structlog

from src.llm import get_llm_service, ClassificationOutput
from src.llm.prompts import get_classification_prompt
from ..state import IntelligenceState, Classification, Routing, NodeTiming, LLMCall

logger = structlog.get_logger()


async def classify_node(state: IntelligenceState) -> dict:
    """
    Classify content to determine extraction paths.

    This node:
    1. Analyzes the content to identify what types of intelligence are present
    2. Determines urgency, importance, and sentiment
    3. Identifies topics
    4. Sets routing flags for subsequent nodes

    Returns:
        State update with classification and routing
    """
    start_time = time.time()

    logger.info(
        "Classifying content",
        analysis_id=state.analysis_id,
        message_count=len(state.messages),
    )

    # Update trace
    state.trace.current_node = "classify"
    state.trace.nodes.append("classify")

    # Combine all message content
    content = "\n\n".join([msg.content for msg in state.messages])

    # Get LLM service
    llm = get_llm_service()

    # Build prompt
    messages = get_classification_prompt(content, state.input.user_email)

    try:
        # Make LLM call with structured output
        output, llm_call = await llm.complete_structured(
            messages=messages,
            output_schema=ClassificationOutput,
            model_tier="fast",  # Use fast model for classification
            node_name="classify",
        )

        # Build classification from output
        classification = Classification(
            has_intelligence=output.has_intelligence,
            has_commitments=output.has_commitments,
            has_decisions=output.has_decisions,
            has_claims=output.has_claims,
            has_risks=output.has_risks,
            has_questions=output.has_questions,
            intent=output.intent,
            topics=output.topics,
            urgency=output.urgency,
            importance=output.importance,
            sentiment=output.sentiment,
            confidence=output.confidence,
            reasoning=output.reasoning,
        )

        # Determine routing based on classification
        routing = Routing(
            should_extract_commitments=output.has_commitments,
            should_extract_decisions=output.has_decisions,
            should_analyze_risk=output.has_risks or output.urgency > 0.5,
            should_deduplicate=True,  # Always deduplicate
            escalate_to_human=output.confidence < 0.3,
            skip_remaining_nodes=not output.has_intelligence,
        )

        logger.info(
            "Classification complete",
            analysis_id=state.analysis_id,
            has_intelligence=classification.has_intelligence,
            has_commitments=classification.has_commitments,
            has_decisions=classification.has_decisions,
            urgency=classification.urgency,
            confidence=classification.confidence,
        )

        # Record LLM call in trace
        trace_llm_call = LLMCall(
            node="classify",
            model=llm_call.model,
            prompt_tokens=llm_call.prompt_tokens,
            completion_tokens=llm_call.completion_tokens,
            duration_ms=llm_call.duration_ms,
        )

        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )

        return {
            "classification": classification,
            "routing": routing,
            "trace": {
                **state.trace.model_dump(),
                "current_node": "classify",
                "nodes": state.trace.nodes + ["classify"],
                "node_timings": {
                    **state.trace.node_timings,
                    "classify": node_timing,
                },
                "llm_calls": state.trace.llm_calls + [trace_llm_call],
            },
        }

    except Exception as e:
        logger.error(
            "Classification failed",
            analysis_id=state.analysis_id,
            error=str(e),
        )

        # Return minimal classification on error
        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )

        return {
            "classification": Classification(
                has_intelligence=True,  # Assume there might be something
                confidence=0.0,
                reasoning=f"Classification failed: {str(e)}",
            ),
            "routing": Routing(
                escalate_to_human=True,
            ),
            "trace": {
                **state.trace.model_dump(),
                "current_node": "classify",
                "nodes": state.trace.nodes + ["classify"],
                "node_timings": {
                    **state.trace.node_timings,
                    "classify": node_timing,
                },
                "errors": state.trace.errors + [f"classify: {str(e)}"],
            },
        }
