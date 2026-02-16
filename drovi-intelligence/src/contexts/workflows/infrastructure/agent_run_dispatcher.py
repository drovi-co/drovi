from __future__ import annotations

from typing import Any

from src.config import get_settings

from .client import get_temporal_client


def run_workflow_id(run_id: str) -> str:
    return f"agent-run:{run_id}"


def team_monitor_workflow_id(parent_run_id: str) -> str:
    return f"agent-team-monitor:{parent_run_id}"


async def start_agent_run_workflow(payload: dict[str, Any]) -> None:
    try:
        from temporalio.exceptions import WorkflowAlreadyStartedError
    except ModuleNotFoundError as exc:  # pragma: no cover - optional dependency in some envs
        raise RuntimeError("temporalio dependency is not installed") from exc

    settings = get_settings()
    if not settings.temporal_enabled:
        raise RuntimeError("Temporal is disabled (TEMPORAL_ENABLED=false)")

    run_id = str(payload.get("run_id") or "")
    if not run_id:
        raise ValueError("run_id is required to start agent run workflow")

    client = await get_temporal_client()
    try:
        await client.start_workflow(
            "agents.run",
            payload,
            id=run_workflow_id(run_id),
            task_queue=settings.temporal_task_queue,
        )
    except WorkflowAlreadyStartedError:
        return


async def start_team_monitor_workflow(payload: dict[str, Any]) -> None:
    try:
        from temporalio.exceptions import WorkflowAlreadyStartedError
    except ModuleNotFoundError as exc:  # pragma: no cover - optional dependency in some envs
        raise RuntimeError("temporalio dependency is not installed") from exc

    settings = get_settings()
    if not settings.temporal_enabled:
        raise RuntimeError("Temporal is disabled (TEMPORAL_ENABLED=false)")

    parent_run_id = str(payload.get("parent_run_id") or "")
    if not parent_run_id:
        raise ValueError("parent_run_id is required to start team monitor workflow")

    client = await get_temporal_client()
    try:
        await client.start_workflow(
            "agents.team.monitor",
            payload,
            id=team_monitor_workflow_id(parent_run_id),
            task_queue=settings.temporal_task_queue,
        )
    except WorkflowAlreadyStartedError:
        return
