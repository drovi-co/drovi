from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

temporalio = pytest.importorskip("temporalio")
from temporalio import activity  # noqa: E402
from temporalio.testing import WorkflowEnvironment  # noqa: E402
from temporalio.worker import Worker  # noqa: E402

from src.contexts.workflows.application.agent_team_monitor_workflow import AgentTeamMonitorWorkflow


@pytest.mark.unit
async def test_team_monitor_halts_on_required_failure_and_skips_future_stage() -> None:
    parent_statuses: list[str] = []
    run_statuses: dict[str, dict[str, str | None]] = {
        "run_stage_0": {"status": "queued", "failure_reason": None},
        "run_stage_1": {"status": "queued", "failure_reason": None},
    }
    skipped_updates: list[list[str]] = []

    @activity.defn(name="agent_runs.update_status")
    async def update_status(req: dict[str, Any]) -> None:
        if str(req.get("run_id")) == "parent_run":
            parent_statuses.append(str(req.get("status")))

    @activity.defn(name="agent_team.start_child_run")
    async def start_child_run(req: dict[str, Any]) -> dict[str, Any]:
        run_id = str(req.get("run_id"))
        if run_id == "run_stage_0":
            run_statuses[run_id] = {"status": "failed", "failure_reason": "planner error"}
        else:
            run_statuses[run_id] = {"status": "completed", "failure_reason": None}
        return {"run_id": run_id, "status": "accepted"}

    @activity.defn(name="agent_team.fetch_run_statuses")
    async def fetch_run_statuses(req: dict[str, Any]) -> dict[str, Any]:
        payload: dict[str, dict[str, Any]] = {}
        for run_id in req.get("run_ids") or []:
            data = run_statuses[str(run_id)]
            payload[str(run_id)] = {
                "status": data["status"],
                "failure_reason": data["failure_reason"],
                "is_terminal": data["status"] in {"completed", "failed", "cancelled"},
            }
        return {"statuses": payload}

    @activity.defn(name="agent_team.mark_runs_skipped")
    async def mark_runs_skipped(req: dict[str, Any]) -> dict[str, Any]:
        run_ids = [str(run_id) for run_id in req.get("run_ids") or []]
        skipped_updates.append(run_ids)
        for run_id in run_ids:
            run_statuses[run_id] = {"status": "cancelled", "failure_reason": str(req.get("reason"))}
        return {"updated": len(run_ids)}

    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="unit-team-monitor-required-failure",
            workflows=[AgentTeamMonitorWorkflow],
            activities=[
                update_status,
                start_child_run,
                fetch_run_statuses,
                mark_runs_skipped,
            ],
        ):
            handle = await env.client.start_workflow(
                AgentTeamMonitorWorkflow.run,
                {
                    "organization_id": "org_test",
                    "parent_run_id": "parent_run",
                    "team_id": "agteam_1",
                    "execution_policy": {"mode": "sequential", "dependency_failure_policy": "halt"},
                    "conflict_resolution": {"strategy": "required_roles_must_succeed", "required_role_ids": []},
                    "children": [
                        {
                            "run_id": "run_stage_0",
                            "deployment_id": "agdep_1",
                            "role_id": "role_planner",
                            "stage_index": 0,
                            "dependencies": [],
                            "is_required": True,
                        },
                        {
                            "run_id": "run_stage_1",
                            "deployment_id": "agdep_2",
                            "role_id": "role_executor",
                            "stage_index": 1,
                            "dependencies": ["run_stage_0"],
                            "is_required": True,
                        },
                    ],
                },
                id=f"team-monitor-{uuid4().hex[:8]}",
                task_queue="unit-team-monitor-required-failure",
            )
            result = await handle.result()

    assert result["status"] == "failed"
    assert parent_statuses[0] == "running"
    assert parent_statuses[-1] == "failed"
    assert skipped_updates == [["run_stage_1"]]


@pytest.mark.unit
async def test_team_monitor_best_effort_completes_with_partial_failures() -> None:
    parent_statuses: list[str] = []
    run_statuses: dict[str, dict[str, str | None]] = {
        "run_a": {"status": "queued", "failure_reason": None},
        "run_b": {"status": "queued", "failure_reason": None},
    }

    @activity.defn(name="agent_runs.update_status")
    async def update_status(req: dict[str, Any]) -> None:
        if str(req.get("run_id")) == "parent_best_effort":
            parent_statuses.append(str(req.get("status")))

    @activity.defn(name="agent_team.start_child_run")
    async def start_child_run(req: dict[str, Any]) -> dict[str, Any]:
        run_id = str(req.get("run_id"))
        if run_id == "run_a":
            run_statuses[run_id] = {"status": "failed", "failure_reason": "transient failure"}
        else:
            run_statuses[run_id] = {"status": "completed", "failure_reason": None}
        return {"run_id": run_id, "status": "accepted"}

    @activity.defn(name="agent_team.fetch_run_statuses")
    async def fetch_run_statuses(req: dict[str, Any]) -> dict[str, Any]:
        payload: dict[str, dict[str, Any]] = {}
        for run_id in req.get("run_ids") or []:
            data = run_statuses[str(run_id)]
            payload[str(run_id)] = {
                "status": data["status"],
                "failure_reason": data["failure_reason"],
                "is_terminal": data["status"] in {"completed", "failed", "cancelled"},
            }
        return {"statuses": payload}

    @activity.defn(name="agent_team.mark_runs_skipped")
    async def mark_runs_skipped(_req: dict[str, Any]) -> dict[str, Any]:
        return {"updated": 0}

    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="unit-team-monitor-best-effort",
            workflows=[AgentTeamMonitorWorkflow],
            activities=[
                update_status,
                start_child_run,
                fetch_run_statuses,
                mark_runs_skipped,
            ],
        ):
            handle = await env.client.start_workflow(
                AgentTeamMonitorWorkflow.run,
                {
                    "organization_id": "org_test",
                    "parent_run_id": "parent_best_effort",
                    "team_id": "agteam_2",
                    "execution_policy": {"mode": "parallel", "dependency_failure_policy": "best_effort"},
                    "conflict_resolution": {"strategy": "best_effort", "required_role_ids": []},
                    "children": [
                        {
                            "run_id": "run_a",
                            "deployment_id": "agdep_1",
                            "role_id": "role_a",
                            "stage_index": 0,
                            "dependencies": [],
                            "is_required": True,
                        },
                        {
                            "run_id": "run_b",
                            "deployment_id": "agdep_2",
                            "role_id": "role_b",
                            "stage_index": 0,
                            "dependencies": [],
                            "is_required": False,
                        },
                    ],
                },
                id=f"team-monitor-{uuid4().hex[:8]}",
                task_queue="unit-team-monitor-best-effort",
            )
            result = await handle.result()

    assert result["status"] == "completed"
    assert parent_statuses[0] == "running"
    assert parent_statuses[-1] == "completed"
