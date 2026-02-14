from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any, Callable
from uuid import uuid4

import pytest

temporalio = pytest.importorskip("temporalio")
from temporalio import activity  # noqa: E402
from temporalio.exceptions import ApplicationError  # noqa: E402
from temporalio.testing import WorkflowEnvironment  # noqa: E402
from temporalio.worker import Worker  # noqa: E402

from src.contexts.workflows.application.agent_run_workflow import AgentRunWorkflow


async def _wait_until(predicate: Callable[[], bool], *, timeout_seconds: float = 5.0) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    while loop.time() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("Timed out waiting for expected workflow condition")


@pytest.mark.unit
async def test_agent_run_pause_resume_and_lifecycle_events() -> None:
    statuses: list[str] = []
    events: list[str] = []
    lane_locks: dict[str, str] = {}
    org_slots: dict[str, set[str]] = {}
    approval_sent = False

    @activity.defn(name="agent_runs.update_status")
    async def update_status(req: dict[str, Any]) -> None:
        statuses.append(str(req.get("status")))

    @activity.defn(name="agent_runs.record_step")
    async def record_step(_req: dict[str, Any]) -> str:
        return str(uuid4())

    @activity.defn(name="agent_runs.execute_step")
    async def execute_step(req: dict[str, Any]) -> dict[str, Any]:
        nonlocal approval_sent
        payload = req.get("payload") or {}
        step_type = str(req.get("step_type") or "")
        approval_step = str(payload.get("approval_step") or "")
        if approval_step and approval_step == step_type and not approval_sent:
            approval_sent = True
            return {"status": "waiting_approval", "message": "approval required"}
        return {
            "status": "completed",
            "output": {"step_type": step_type},
            "evidence_refs": {},
            "token_usage": {"prompt_tokens": 10, "completion_tokens": 5},
            "tool_usage": [{"tool_id": "noop", "latency_ms": 1}],
        }

    @activity.defn(name="agent_runs.compensate")
    async def compensate(_req: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    @activity.defn(name="agent_runs.enqueue_dead_letter")
    async def enqueue_dead_letter(_req: dict[str, Any]) -> str:
        return "job_dlq_1"

    @activity.defn(name="agent_runs.emit_event")
    async def emit_event(req: dict[str, Any]) -> None:
        events.append(str(req.get("event_type")))

    @activity.defn(name="agent_runs.acquire_lane")
    async def acquire_lane(req: dict[str, Any]) -> bool:
        lane_key = str(req.get("lane_key") or "")
        token = str(req.get("token") or "")
        current = lane_locks.get(lane_key)
        if current in {None, token}:
            lane_locks[lane_key] = token
            return True
        return False

    @activity.defn(name="agent_runs.release_lane")
    async def release_lane(req: dict[str, Any]) -> None:
        lane_key = str(req.get("lane_key") or "")
        token = str(req.get("token") or "")
        if lane_locks.get(lane_key) == token:
            lane_locks.pop(lane_key, None)

    @activity.defn(name="agent_runs.acquire_org_slot")
    async def acquire_org_slot(req: dict[str, Any]) -> bool:
        org_lane_key = str(req.get("org_lane_key") or "")
        token = str(req.get("token") or "")
        max_concurrency = int(req.get("max_concurrency") or 1)
        slots = org_slots.setdefault(org_lane_key, set())
        if token in slots:
            return True
        if len(slots) < max_concurrency:
            slots.add(token)
            return True
        return False

    @activity.defn(name="agent_runs.release_org_slot")
    async def release_org_slot(req: dict[str, Any]) -> None:
        org_lane_key = str(req.get("org_lane_key") or "")
        token = str(req.get("token") or "")
        org_slots.setdefault(org_lane_key, set()).discard(token)

    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="unit-agent-run-pause-resume",
            workflows=[AgentRunWorkflow],
            activities=[
                update_status,
                record_step,
                execute_step,
                compensate,
                enqueue_dead_letter,
                emit_event,
                acquire_lane,
                release_lane,
                acquire_org_slot,
                release_org_slot,
            ],
        ):
            run_id = f"agrun_{uuid4().hex[:8]}"
            handle = await env.client.start_workflow(
                AgentRunWorkflow.run,
                {
                    "run_id": run_id,
                    "organization_id": "org_test",
                    "deployment_id": "agdep_1",
                    "steps": ["planning", "report"],
                    "payload": {"approval_step": "planning"},
                    "org_concurrency_cap": 2,
                },
                id=f"wf-{run_id}",
                task_queue="unit-agent-run-pause-resume",
            )
            await _wait_until(lambda: "waiting_approval" in events)
            await handle.signal("resume")
            result = await handle.result()

    assert result["status"] == "completed"
    assert events[0] == "accepted"
    assert "waiting_approval" in events
    assert events[-1] == "completed"
    assert "running" in statuses
    assert "waiting_approval" in statuses
    assert statuses[-1] == "completed"


@pytest.mark.unit
async def test_agent_run_retries_transient_failures_then_completes() -> None:
    attempts: dict[str, int] = defaultdict(int)
    dead_letter_jobs: list[str] = []

    @activity.defn(name="agent_runs.update_status")
    async def update_status(_req: dict[str, Any]) -> None:
        return None

    @activity.defn(name="agent_runs.record_step")
    async def record_step(_req: dict[str, Any]) -> str:
        return str(uuid4())

    @activity.defn(name="agent_runs.execute_step")
    async def execute_step(req: dict[str, Any]) -> dict[str, Any]:
        step_type = str(req.get("step_type") or "")
        attempts[step_type] += 1
        if step_type == "tool_call" and attempts[step_type] < 3:
            raise ApplicationError("transient tool failure", type="tool_transient")
        return {
            "status": "completed",
            "output": {"attempt": attempts[step_type]},
            "evidence_refs": {},
            "token_usage": {"prompt_tokens": 1, "completion_tokens": 1},
            "tool_usage": [],
        }

    @activity.defn(name="agent_runs.compensate")
    async def compensate(_req: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    @activity.defn(name="agent_runs.enqueue_dead_letter")
    async def enqueue_dead_letter(_req: dict[str, Any]) -> str:
        dead_letter_jobs.append("job_dlq")
        return "job_dlq"

    @activity.defn(name="agent_runs.emit_event")
    async def emit_event(_req: dict[str, Any]) -> None:
        return None

    @activity.defn(name="agent_runs.acquire_lane")
    async def acquire_lane(_req: dict[str, Any]) -> bool:
        return True

    @activity.defn(name="agent_runs.release_lane")
    async def release_lane(_req: dict[str, Any]) -> None:
        return None

    @activity.defn(name="agent_runs.acquire_org_slot")
    async def acquire_org_slot(_req: dict[str, Any]) -> bool:
        return True

    @activity.defn(name="agent_runs.release_org_slot")
    async def release_org_slot(_req: dict[str, Any]) -> None:
        return None

    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="unit-agent-run-retry",
            workflows=[AgentRunWorkflow],
            activities=[
                update_status,
                record_step,
                execute_step,
                compensate,
                enqueue_dead_letter,
                emit_event,
                acquire_lane,
                release_lane,
                acquire_org_slot,
                release_org_slot,
            ],
        ):
            run_id = f"agrun_{uuid4().hex[:8]}"
            handle = await env.client.start_workflow(
                AgentRunWorkflow.run,
                {
                    "run_id": run_id,
                    "organization_id": "org_test",
                    "deployment_id": "agdep_retry",
                    "steps": ["tool_call"],
                    "org_concurrency_cap": 2,
                },
                id=f"wf-{run_id}",
                task_queue="unit-agent-run-retry",
            )
            result = await handle.result()

    assert result["status"] == "completed"
    assert attempts["tool_call"] == 3
    assert dead_letter_jobs == []


@pytest.mark.unit
async def test_agent_run_policy_block_is_not_retried_and_goes_dead_letter() -> None:
    attempts: dict[str, int] = defaultdict(int)
    dead_letter_jobs: list[str] = []
    statuses: list[str] = []

    @activity.defn(name="agent_runs.update_status")
    async def update_status(req: dict[str, Any]) -> None:
        statuses.append(str(req.get("status")))

    @activity.defn(name="agent_runs.record_step")
    async def record_step(_req: dict[str, Any]) -> str:
        return str(uuid4())

    @activity.defn(name="agent_runs.execute_step")
    async def execute_step(req: dict[str, Any]) -> dict[str, Any]:
        step_type = str(req.get("step_type") or "")
        attempts[step_type] += 1
        raise ApplicationError("blocked", type="policy_block", non_retryable=True)

    @activity.defn(name="agent_runs.compensate")
    async def compensate(_req: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    @activity.defn(name="agent_runs.enqueue_dead_letter")
    async def enqueue_dead_letter(_req: dict[str, Any]) -> str:
        dead_letter_jobs.append("job_dlq")
        return "job_dlq"

    @activity.defn(name="agent_runs.emit_event")
    async def emit_event(_req: dict[str, Any]) -> None:
        return None

    @activity.defn(name="agent_runs.acquire_lane")
    async def acquire_lane(_req: dict[str, Any]) -> bool:
        return True

    @activity.defn(name="agent_runs.release_lane")
    async def release_lane(_req: dict[str, Any]) -> None:
        return None

    @activity.defn(name="agent_runs.acquire_org_slot")
    async def acquire_org_slot(_req: dict[str, Any]) -> bool:
        return True

    @activity.defn(name="agent_runs.release_org_slot")
    async def release_org_slot(_req: dict[str, Any]) -> None:
        return None

    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="unit-agent-run-policy-block",
            workflows=[AgentRunWorkflow],
            activities=[
                update_status,
                record_step,
                execute_step,
                compensate,
                enqueue_dead_letter,
                emit_event,
                acquire_lane,
                release_lane,
                acquire_org_slot,
                release_org_slot,
            ],
        ):
            run_id = f"agrun_{uuid4().hex[:8]}"
            handle = await env.client.start_workflow(
                AgentRunWorkflow.run,
                {
                    "run_id": run_id,
                    "organization_id": "org_test",
                    "deployment_id": "agdep_policy",
                    "steps": ["commit"],
                },
                id=f"wf-{run_id}",
                task_queue="unit-agent-run-policy-block",
            )
            result = await handle.result()

    assert result["status"] == "failed"
    assert attempts["commit"] == 1
    assert dead_letter_jobs == ["job_dlq"]
    assert statuses[-1] == "failed"


@pytest.mark.unit
async def test_agent_run_lane_timeout_enters_dead_letter() -> None:
    dead_letter_jobs: list[str] = []
    statuses: list[str] = []

    @activity.defn(name="agent_runs.update_status")
    async def update_status(req: dict[str, Any]) -> None:
        statuses.append(str(req.get("status")))

    @activity.defn(name="agent_runs.record_step")
    async def record_step(_req: dict[str, Any]) -> str:
        return str(uuid4())

    @activity.defn(name="agent_runs.execute_step")
    async def execute_step(_req: dict[str, Any]) -> dict[str, Any]:
        return {"status": "completed", "output": {}, "evidence_refs": {}, "token_usage": {}, "tool_usage": []}

    @activity.defn(name="agent_runs.compensate")
    async def compensate(_req: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    @activity.defn(name="agent_runs.enqueue_dead_letter")
    async def enqueue_dead_letter(_req: dict[str, Any]) -> str:
        dead_letter_jobs.append("job_dlq")
        return "job_dlq"

    @activity.defn(name="agent_runs.emit_event")
    async def emit_event(_req: dict[str, Any]) -> None:
        return None

    @activity.defn(name="agent_runs.acquire_lane")
    async def acquire_lane(_req: dict[str, Any]) -> bool:
        return False

    @activity.defn(name="agent_runs.release_lane")
    async def release_lane(_req: dict[str, Any]) -> None:
        return None

    @activity.defn(name="agent_runs.acquire_org_slot")
    async def acquire_org_slot(_req: dict[str, Any]) -> bool:
        return True

    @activity.defn(name="agent_runs.release_org_slot")
    async def release_org_slot(_req: dict[str, Any]) -> None:
        return None

    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="unit-agent-run-lane-timeout",
            workflows=[AgentRunWorkflow],
            activities=[
                update_status,
                record_step,
                execute_step,
                compensate,
                enqueue_dead_letter,
                emit_event,
                acquire_lane,
                release_lane,
                acquire_org_slot,
                release_org_slot,
            ],
        ):
            run_id = f"agrun_{uuid4().hex[:8]}"
            handle = await env.client.start_workflow(
                AgentRunWorkflow.run,
                {
                    "run_id": run_id,
                    "organization_id": "org_test",
                    "deployment_id": "agdep_timeout",
                    "lane_max_attempts": 2,
                    "lane_retry_seconds": 1,
                },
                id=f"wf-{run_id}",
                task_queue="unit-agent-run-lane-timeout",
            )
            result = await handle.result()

    assert result["status"] == "failed"
    assert dead_letter_jobs == ["job_dlq"]
    assert statuses[-1] == "failed"


@pytest.mark.unit
async def test_agent_run_lane_scheduler_serializes_same_resource() -> None:
    lane_locks: dict[str, str] = {}
    org_slots: dict[str, set[str]] = {}
    max_parallel_steps = 0
    active_steps = 0
    active_steps_lock = asyncio.Lock()

    @activity.defn(name="agent_runs.update_status")
    async def update_status(_req: dict[str, Any]) -> None:
        return None

    @activity.defn(name="agent_runs.record_step")
    async def record_step(_req: dict[str, Any]) -> str:
        return str(uuid4())

    @activity.defn(name="agent_runs.execute_step")
    async def execute_step(_req: dict[str, Any]) -> dict[str, Any]:
        nonlocal max_parallel_steps, active_steps
        async with active_steps_lock:
            active_steps += 1
            max_parallel_steps = max(max_parallel_steps, active_steps)
        try:
            await asyncio.sleep(0.05)
            return {
                "status": "completed",
                "output": {"ok": True},
                "evidence_refs": {},
                "token_usage": {"prompt_tokens": 1, "completion_tokens": 1},
                "tool_usage": [],
            }
        finally:
            async with active_steps_lock:
                active_steps -= 1

    @activity.defn(name="agent_runs.compensate")
    async def compensate(_req: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    @activity.defn(name="agent_runs.enqueue_dead_letter")
    async def enqueue_dead_letter(_req: dict[str, Any]) -> str:
        return "job_dlq"

    @activity.defn(name="agent_runs.emit_event")
    async def emit_event(_req: dict[str, Any]) -> None:
        return None

    @activity.defn(name="agent_runs.acquire_lane")
    async def acquire_lane(req: dict[str, Any]) -> bool:
        lane_key = str(req.get("lane_key") or "")
        token = str(req.get("token") or "")
        current = lane_locks.get(lane_key)
        if current in {None, token}:
            lane_locks[lane_key] = token
            return True
        return False

    @activity.defn(name="agent_runs.release_lane")
    async def release_lane(req: dict[str, Any]) -> None:
        lane_key = str(req.get("lane_key") or "")
        token = str(req.get("token") or "")
        if lane_locks.get(lane_key) == token:
            lane_locks.pop(lane_key, None)

    @activity.defn(name="agent_runs.acquire_org_slot")
    async def acquire_org_slot(req: dict[str, Any]) -> bool:
        org_lane_key = str(req.get("org_lane_key") or "")
        token = str(req.get("token") or "")
        max_concurrency = int(req.get("max_concurrency") or 1)
        slots = org_slots.setdefault(org_lane_key, set())
        if token in slots:
            return True
        if len(slots) < max_concurrency:
            slots.add(token)
            return True
        return False

    @activity.defn(name="agent_runs.release_org_slot")
    async def release_org_slot(req: dict[str, Any]) -> None:
        org_lane_key = str(req.get("org_lane_key") or "")
        token = str(req.get("token") or "")
        org_slots.setdefault(org_lane_key, set()).discard(token)

    async with await WorkflowEnvironment.start_time_skipping() as env:
        async with Worker(
            env.client,
            task_queue="unit-agent-run-lanes",
            workflows=[AgentRunWorkflow],
            activities=[
                update_status,
                record_step,
                execute_step,
                compensate,
                enqueue_dead_letter,
                emit_event,
                acquire_lane,
                release_lane,
                acquire_org_slot,
                release_org_slot,
            ],
        ):
            run_1 = f"agrun_{uuid4().hex[:8]}"
            run_2 = f"agrun_{uuid4().hex[:8]}"
            handle_1 = await env.client.start_workflow(
                AgentRunWorkflow.run,
                {
                    "run_id": run_1,
                    "organization_id": "org_test",
                    "deployment_id": "agdep_same",
                    "steps": ["tool_call"],
                    "resource_lane_key": "resource:shared",
                    "org_concurrency_cap": 2,
                },
                id=f"wf-{run_1}",
                task_queue="unit-agent-run-lanes",
            )
            handle_2 = await env.client.start_workflow(
                AgentRunWorkflow.run,
                {
                    "run_id": run_2,
                    "organization_id": "org_test",
                    "deployment_id": "agdep_same",
                    "steps": ["tool_call"],
                    "resource_lane_key": "resource:shared",
                    "org_concurrency_cap": 2,
                },
                id=f"wf-{run_2}",
                task_queue="unit-agent-run-lanes",
            )
            result_1, result_2 = await asyncio.gather(handle_1.result(), handle_2.result())

    assert result_1["status"] == "completed"
    assert result_2["status"] == "completed"
    assert max_parallel_steps == 1


@pytest.mark.unit
async def test_agent_run_survives_worker_restart_during_retry_cycle() -> None:
    attempts = 0

    @activity.defn(name="agent_runs.update_status")
    async def update_status(_req: dict[str, Any]) -> None:
        return None

    @activity.defn(name="agent_runs.record_step")
    async def record_step(_req: dict[str, Any]) -> str:
        return str(uuid4())

    @activity.defn(name="agent_runs.execute_step")
    async def execute_step(req: dict[str, Any]) -> dict[str, Any]:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise ApplicationError("transient failure", type="tool_transient")
        return {
            "status": "completed",
            "output": {"attempt": attempts},
            "evidence_refs": {},
            "token_usage": {"prompt_tokens": 1, "completion_tokens": 1},
            "tool_usage": [],
        }

    @activity.defn(name="agent_runs.compensate")
    async def compensate(_req: dict[str, Any]) -> dict[str, Any]:
        return {"ok": True}

    @activity.defn(name="agent_runs.enqueue_dead_letter")
    async def enqueue_dead_letter(_req: dict[str, Any]) -> str:
        return "job_dlq"

    @activity.defn(name="agent_runs.emit_event")
    async def emit_event(_req: dict[str, Any]) -> None:
        return None

    @activity.defn(name="agent_runs.acquire_lane")
    async def acquire_lane(_req: dict[str, Any]) -> bool:
        return True

    @activity.defn(name="agent_runs.release_lane")
    async def release_lane(_req: dict[str, Any]) -> None:
        return None

    @activity.defn(name="agent_runs.acquire_org_slot")
    async def acquire_org_slot(_req: dict[str, Any]) -> bool:
        return True

    @activity.defn(name="agent_runs.release_org_slot")
    async def release_org_slot(_req: dict[str, Any]) -> None:
        return None

    async with await WorkflowEnvironment.start_time_skipping() as env:
        run_id = f"agrun_{uuid4().hex[:8]}"
        handle = None
        async with Worker(
            env.client,
            task_queue="unit-agent-run-restart",
            max_cached_workflows=0,
            workflows=[AgentRunWorkflow],
            activities=[
                update_status,
                record_step,
                execute_step,
                compensate,
                enqueue_dead_letter,
                emit_event,
                acquire_lane,
                release_lane,
                acquire_org_slot,
                release_org_slot,
            ],
        ):
            handle = await env.client.start_workflow(
                AgentRunWorkflow.run,
                {
                    "run_id": run_id,
                    "organization_id": "org_test",
                    "deployment_id": "agdep_restart",
                    "steps": ["tool_call"],
                },
                id=f"wf-{run_id}",
                task_queue="unit-agent-run-restart",
            )
            await _wait_until(lambda: attempts >= 1)

        assert handle is not None

        async with Worker(
            env.client,
            task_queue="unit-agent-run-restart",
            max_cached_workflows=0,
            workflows=[AgentRunWorkflow],
            activities=[
                update_status,
                record_step,
                execute_step,
                compensate,
                enqueue_dead_letter,
                emit_event,
                acquire_lane,
                release_lane,
                acquire_org_slot,
                release_org_slot,
            ],
        ):
            result = await handle.result()

    assert result["status"] == "completed"
    assert attempts == 3
