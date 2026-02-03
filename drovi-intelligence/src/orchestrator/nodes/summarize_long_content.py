"""
Summarize Long Content Node

If content is very long, summarize it into extraction-focused chunks.
"""

import time

import structlog

from src.llm import get_llm_service
from src.orchestrator.state import IntelligenceState, NodeTiming

logger = structlog.get_logger()


SUMMARY_SYSTEM_PROMPT = """You are a precise summarizer for business intelligence extraction.
Summarize the content focusing ONLY on:
- commitments/promises/obligations
- decisions (explicit choices made)
- tasks/action items
- deadlines/dates
- risks/issues
Do NOT include salutations, signatures, or marketing fluff."""


async def summarize_long_content_node(state: IntelligenceState) -> dict:
    """
    Summarize long content to keep extraction prompts within limits.
    """
    start_time = time.time()

    state.trace.current_node = "summarize_long_content"
    state.trace.nodes.append("summarize_long_content")

    full_text = "\n\n".join([m.content for m in state.messages])
    if len(full_text) < 12000:
        return {}

    logger.info(
        "Summarizing long content",
        analysis_id=state.analysis_id,
        content_length=len(full_text),
    )

    # Chunk the content
    chunk_size = 4000
    chunks = [full_text[i:i + chunk_size] for i in range(0, len(full_text), chunk_size)]

    llm = get_llm_service()
    summaries: list[str] = []

    for idx, chunk in enumerate(chunks, start=1):
        prompt = [
            {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
            {"role": "user", "content": f"Chunk {idx}/{len(chunks)}:\n{chunk}"},
        ]
        summary, _call = await llm.complete(
            messages=prompt,
            model_tier="fast",
            temperature=0.0,
            max_tokens=600,
            node_name="summarize_long_content",
        )
        summaries.append(summary.strip())

    summarized = "\n\n".join(summaries).strip()
    if not summarized:
        return {}

    node_timing = NodeTiming(
        started_at=start_time,
        completed_at=time.time(),
    )

    updated_trace = state.trace.model_copy()
    updated_trace.current_node = "summarize_long_content"
    updated_trace.node_timings["summarize_long_content"] = node_timing

    cleaned_content = state.cleaned_content or {}
    cleaned_content.update({
        "summary": summarized,
        "summary_chunks": len(chunks),
        "summary_length": len(summarized),
    })

    return {
        "cleaned_content": cleaned_content,
        "trace": updated_trace,
    }
