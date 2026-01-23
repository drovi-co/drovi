"""
Generate Brief Node

Generates a concise 3-line brief summary for the conversation/thread,
along with suggested actions and open loop detection.
"""

import time
from typing import Literal

import structlog
from pydantic import BaseModel, Field

from src.llm import get_llm_service
from ..state import IntelligenceState, NodeTiming, LLMCall

logger = structlog.get_logger()


# =============================================================================
# BRIEF OUTPUT SCHEMA
# =============================================================================


class OpenLoop(BaseModel):
    """An open loop (unanswered question or pending item) in the conversation."""

    description: str = Field(description="Brief description of the open loop")
    owner: str | None = Field(default=None, description="Who needs to address this")
    is_blocking: bool = Field(default=False, description="Is this blocking progress?")


class BriefOutput(BaseModel):
    """Structured output for brief generation."""

    # 3-line brief
    brief_summary: str = Field(
        description="A concise 3-line summary of the conversation. "
        "Line 1: What is this about? "
        "Line 2: What's the current status/context? "
        "Line 3: What action is needed (if any)?"
    )

    # Suggested action
    suggested_action: Literal[
        "respond", "review", "delegate", "schedule", "archive",
        "follow_up", "waiting", "none"
    ] = Field(description="The recommended next action")

    suggested_action_reason: str = Field(
        description="Brief explanation for the suggested action"
    )

    # Open loops
    open_loops: list[OpenLoop] = Field(
        default_factory=list,
        description="Unanswered questions or pending items that need resolution"
    )

    # Priority tier based on urgency + importance
    priority_tier: Literal["urgent", "high", "medium", "low"] = Field(
        description="Overall priority tier for inbox sorting"
    )


# =============================================================================
# BRIEF GENERATION PROMPT
# =============================================================================


def get_brief_prompt(
    content: str,
    classification: dict,
    commitments_count: int,
    decisions_count: int,
    user_email: str | None = None,
) -> list[dict]:
    """Build the prompt for brief generation."""

    user_context = f"The user's email is {user_email}." if user_email else ""

    # Include classification context
    intent = classification.get("intent", "unknown")
    urgency = classification.get("urgency", 0)
    importance = classification.get("importance", 0)

    system_prompt = f"""You are an expert at summarizing email threads and conversations for busy professionals.

Your task is to generate a concise, actionable brief that helps the user quickly understand:
1. What this conversation is about
2. What's the current status
3. What action (if any) they need to take

{user_context}

Context from analysis:
- Intent: {intent}
- Urgency score: {urgency:.2f}
- Importance score: {importance:.2f}
- Commitments found: {commitments_count}
- Decisions found: {decisions_count}

Guidelines:
- Keep the brief to exactly 3 lines, each line focused on a specific aspect
- Be specific - mention names, dates, and key details
- If action is needed, be clear about what and by when
- Detect any "open loops" - unanswered questions or pending items
- Consider urgency + importance to determine priority tier

Priority tier guidelines:
- urgent: Needs immediate attention (today), high stakes
- high: Important, should handle soon (within 1-2 days)
- medium: Standard priority, handle in normal workflow
- low: Informational, can wait or be batched"""

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Generate a brief for this conversation:\n\n{content}"},
    ]


# =============================================================================
# BRIEF GENERATION NODE
# =============================================================================


async def generate_brief_node(state: IntelligenceState) -> dict:
    """
    Generate a brief summary for the conversation.

    This node:
    1. Uses the content and classification to generate a 3-line brief
    2. Detects open loops (unanswered questions, pending items)
    3. Suggests the next action
    4. Determines priority tier

    Returns:
        State update with brief data
    """
    start_time = time.time()

    logger.info(
        "Generating brief",
        analysis_id=state.analysis_id,
        conversation_id=state.input.conversation_id,
    )

    # Update trace
    state.trace.current_node = "generate_brief"
    state.trace.nodes.append("generate_brief")

    # Skip if no conversation_id (can't update conversation table)
    if not state.input.conversation_id:
        logger.info("Skipping brief generation - no conversation_id")
        return _build_skip_response(state, start_time, "No conversation_id provided")

    # Combine content
    content = "\n\n".join([msg.content for msg in state.messages])
    if not content.strip():
        content = state.input.content

    # Get LLM service
    llm = get_llm_service()

    # Build prompt with classification context
    classification_dict = {
        "intent": state.classification.intent,
        "urgency": state.classification.urgency,
        "importance": state.classification.importance,
        "sentiment": state.classification.sentiment,
    }

    messages = get_brief_prompt(
        content=content[:8000],  # Limit content length
        classification=classification_dict,
        commitments_count=len(state.extracted.commitments),
        decisions_count=len(state.extracted.decisions),
        user_email=state.input.user_email,
    )

    try:
        # Make LLM call with structured output
        output, llm_call = await llm.complete_structured(
            messages=messages,
            output_schema=BriefOutput,
            model_tier="fast",  # Use fast model for brief generation
            node_name="generate_brief",
        )

        logger.info(
            "Brief generated",
            analysis_id=state.analysis_id,
            priority_tier=output.priority_tier,
            suggested_action=output.suggested_action,
            open_loop_count=len(output.open_loops),
        )

        # Record LLM call
        trace_llm_call = LLMCall(
            node="generate_brief",
            model=llm_call.model,
            prompt_tokens=llm_call.prompt_tokens,
            completion_tokens=llm_call.completion_tokens,
            duration_ms=llm_call.duration_ms,
        )

        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )

        # Store brief data in state for persist node to use
        return {
            "brief": {
                "brief_summary": output.brief_summary,
                "suggested_action": output.suggested_action,
                "suggested_action_reason": output.suggested_action_reason,
                "open_loops": [loop.model_dump() for loop in output.open_loops],
                "has_open_loops": len(output.open_loops) > 0,
                "open_loop_count": len(output.open_loops),
                "priority_tier": output.priority_tier,
            },
            "trace": {
                **state.trace.model_dump(),
                "current_node": "generate_brief",
                "nodes": state.trace.nodes + ["generate_brief"],
                "node_timings": {
                    **state.trace.node_timings,
                    "generate_brief": node_timing,
                },
                "llm_calls": state.trace.llm_calls + [trace_llm_call],
            },
        }

    except Exception as e:
        logger.error(
            "Brief generation failed",
            analysis_id=state.analysis_id,
            error=str(e),
        )
        return _build_skip_response(state, start_time, f"Brief generation failed: {str(e)}")


def _build_skip_response(state: IntelligenceState, start_time: float, reason: str) -> dict:
    """Build a response when skipping brief generation."""
    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    # Use classification data for fallback values
    priority_tier = "medium"
    if state.classification.urgency > 0.7:
        priority_tier = "urgent"
    elif state.classification.urgency > 0.5 or state.classification.importance > 0.7:
        priority_tier = "high"
    elif state.classification.urgency < 0.3 and state.classification.importance < 0.3:
        priority_tier = "low"

    return {
        "brief": {
            "brief_summary": None,
            "suggested_action": "none",
            "suggested_action_reason": reason,
            "open_loops": [],
            "has_open_loops": False,
            "open_loop_count": 0,
            "priority_tier": priority_tier,
        },
        "trace": {
            **state.trace.model_dump(),
            "current_node": "generate_brief",
            "nodes": state.trace.nodes + ["generate_brief"],
            "node_timings": {
                **state.trace.node_timings,
                "generate_brief": node_timing,
            },
        },
    }
