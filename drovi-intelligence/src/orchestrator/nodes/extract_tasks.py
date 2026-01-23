"""
Extract Tasks Node

Extracts actionable tasks from content for Kanban board/task management.
Creates tasks from commitments, requests, and action items.
"""

import time

import structlog

from src.llm import get_llm_service, TaskExtractionOutput
from src.llm.prompts import get_task_extraction_prompt
from ..state import (
    IntelligenceState,
    ExtractedTask,
    ExtractedIntelligence,
    NodeTiming,
    LLMCall,
)

logger = structlog.get_logger()


async def extract_tasks_node(state: IntelligenceState) -> dict:
    """
    Extract tasks from content.

    This node:
    1. Extracts all actionable tasks from the content
    2. Creates tasks from commitments and requests
    3. Identifies assignees, due dates, and priorities
    4. Links tasks to source commitments and claims
    5. Identifies task dependencies and subtasks

    Returns:
        State update with extracted tasks
    """
    start_time = time.time()

    logger.info(
        "Extracting tasks",
        analysis_id=state.analysis_id,
        commitment_count=len(state.extracted.commitments),
        claim_count=len(state.extracted.claims),
    )

    # Update trace
    state.trace.current_node = "extract_tasks"
    state.trace.nodes.append("extract_tasks")

    # Combine all message content
    content = "\n\n".join([msg.content for msg in state.messages])

    # Prepare commitments context for the prompt
    commitments_dicts = [
        {
            "title": c.title,
            "description": c.description,
            "direction": c.direction,
            "debtor_name": c.debtor_name,
            "creditor_name": c.creditor_name,
            "due_date_text": c.due_date_text,
            "priority": c.priority,
        }
        for c in state.extracted.commitments
    ]

    # Prepare claims context
    claims_dicts = [
        {
            "type": c.type,
            "content": c.content,
            "quoted_text": c.quoted_text,
        }
        for c in state.extracted.claims
    ]

    # Get LLM service
    llm = get_llm_service()

    # Build prompt
    messages = get_task_extraction_prompt(
        content=content,
        commitments=commitments_dicts,
        claims=claims_dicts,
        user_email=state.input.user_email,
        user_name=state.input.user_name,
    )

    try:
        # Make LLM call with structured output
        output, llm_call = await llm.complete_structured(
            messages=messages,
            output_schema=TaskExtractionOutput,
            model_tier="balanced",
            node_name="extract_tasks",
        )

        # Convert to state task objects
        tasks = []
        for i, task in enumerate(output.tasks):
            # Link to commitment if specified
            commitment_id = None
            if task.commitment_index is not None and task.commitment_index < len(state.extracted.commitments):
                commitment_id = state.extracted.commitments[task.commitment_index].id

            # Build depends_on list (task IDs from this extraction)
            depends_on = []
            for dep_idx in task.depends_on_task_indices:
                if dep_idx < i and dep_idx < len(tasks):
                    depends_on.append(tasks[dep_idx].id)

            # Build blocks list (task IDs from this extraction)
            blocks = []
            for block_idx in task.blocks_task_indices:
                if block_idx < i and block_idx < len(tasks):
                    blocks.append(tasks[block_idx].id)

            # Get parent task ID if this is a subtask
            parent_task_id = None
            if task.is_subtask and task.parent_task_index is not None:
                if task.parent_task_index < i and task.parent_task_index < len(tasks):
                    parent_task_id = tasks[task.parent_task_index].id

            tasks.append(ExtractedTask(
                title=task.title,
                description=task.description,
                status=task.status,
                priority=task.priority,
                assignee_name=task.assignee_name,
                assignee_email=task.assignee_email,
                assignee_is_user=task.assignee_is_user,
                created_by_name=task.created_by_name,
                created_by_email=task.created_by_email,
                due_date=task.due_date,
                due_date_text=task.due_date_text,
                due_date_confidence=task.due_date_confidence,
                estimated_effort=task.estimated_effort,
                depends_on=depends_on,
                blocks=blocks,
                commitment_id=commitment_id,
                parent_task_id=parent_task_id,
                project=task.project,
                tags=task.tags,
                quoted_text=task.quoted_text,
                confidence=task.confidence,
                reasoning=task.reasoning,
            ))

        # Update subtask_ids for parent tasks
        for task in tasks:
            if task.parent_task_id:
                for parent_task in tasks:
                    if parent_task.id == task.parent_task_id:
                        parent_task.subtask_ids.append(task.id)
                        break

        # Update extracted intelligence
        extracted = ExtractedIntelligence(
            claims=state.extracted.claims,
            commitments=state.extracted.commitments,
            decisions=state.extracted.decisions,
            tasks=tasks,
            topics=state.extracted.topics,
            risks=state.extracted.risks,
            contacts=state.extracted.contacts,
        )

        logger.info(
            "Tasks extracted",
            analysis_id=state.analysis_id,
            task_count=len(tasks),
            assigned_to_user=sum(1 for t in tasks if t.assignee_is_user),
            with_due_date=sum(1 for t in tasks if t.due_date is not None),
            high_priority=sum(1 for t in tasks if t.priority in ("high", "urgent")),
        )

        # Record LLM call
        trace_llm_call = LLMCall(
            node="extract_tasks",
            model=llm_call.model,
            prompt_tokens=llm_call.prompt_tokens,
            completion_tokens=llm_call.completion_tokens,
            duration_ms=llm_call.duration_ms,
        )

        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )

        # Update confidence
        avg_confidence = sum(t.confidence for t in tasks) / len(tasks) if tasks else 0.0

        return {
            "extracted": extracted,
            "confidence": {
                **state.confidence.model_dump(),
                "by_type": {
                    **state.confidence.by_type,
                    "tasks": avg_confidence,
                },
            },
            "trace": {
                **state.trace.model_dump(),
                "current_node": "extract_tasks",
                "node_timings": {
                    **state.trace.node_timings,
                    "extract_tasks": node_timing,
                },
                "llm_calls": state.trace.llm_calls + [trace_llm_call],
            },
        }

    except Exception as e:
        logger.error(
            "Task extraction failed",
            analysis_id=state.analysis_id,
            error=str(e),
        )

        node_timing = NodeTiming(
            started_at=start_time,
            completed_at=time.time(),
        )

        return {
            "trace": {
                **state.trace.model_dump(),
                "current_node": "extract_tasks",
                "node_timings": {
                    **state.trace.node_timings,
                    "extract_tasks": node_timing,
                },
                "errors": state.trace.errors + [f"extract_tasks: {str(e)}"],
            },
        }
