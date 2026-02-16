from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy


@workflow.defn(name="agents.run")
class AgentRunWorkflow:
    """Durable run lifecycle workflow for AgentOS runtime execution."""

    def __init__(self) -> None:
        self._paused = False
        self._cancel_requested = False
        self._kill_requested = False

    @workflow.signal(name="pause")
    async def pause(self) -> None:
        self._paused = True

    @workflow.signal(name="resume")
    async def resume(self) -> None:
        self._paused = False

    @workflow.signal(name="cancel")
    async def cancel(self) -> None:
        self._cancel_requested = True

    @workflow.signal(name="kill")
    async def kill(self) -> None:
        self._kill_requested = True
        self._cancel_requested = True

    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        organization_id = str(req.get("organization_id") or "")
        run_id = str(req.get("run_id") or "")
        deployment_id = str(req.get("deployment_id") or "")
        if not organization_id or not run_id or not deployment_id:
            raise ValueError("AgentRunWorkflow requires organization_id, run_id, deployment_id")

        agent_lane_key = f"agent:{deployment_id}"
        resource_lane_key = str(req.get("resource_lane_key") or f"org:{organization_id}:deployment:{deployment_id}")
        org_lane_key = f"org:{organization_id}"
        lane_token = run_id
        lane_ttl_seconds = _coerce_positive_int(req.get("lane_ttl_seconds"), default=90)
        lane_max_attempts = _coerce_positive_int(req.get("lane_max_attempts"), default=180)
        lane_retry_seconds = _coerce_positive_int(req.get("lane_retry_seconds"), default=2)
        org_concurrency_cap = _coerce_positive_int(req.get("org_concurrency_cap"), default=4)

        await self._emit(organization_id=organization_id, run_id=run_id, event_type="accepted", payload={})

        completed_steps: list[dict[str, Any]] = []
        steps = req.get("steps") or [
            "context_retrieval",
            "planning",
            "tool_call",
            "verification",
            "commit",
            "report",
        ]

        try:
            await self._acquire_lane(
                lane_key=agent_lane_key,
                lane_token=lane_token,
                ttl_seconds=lane_ttl_seconds,
                max_attempts=lane_max_attempts,
                retry_seconds=lane_retry_seconds,
            )
            await self._acquire_lane(
                lane_key=resource_lane_key,
                lane_token=lane_token,
                ttl_seconds=lane_ttl_seconds,
                max_attempts=lane_max_attempts,
                retry_seconds=lane_retry_seconds,
            )
            await self._acquire_org_slot(
                org_lane_key=org_lane_key,
                lane_token=lane_token,
                max_concurrency=org_concurrency_cap,
                ttl_seconds=lane_ttl_seconds,
                max_attempts=lane_max_attempts,
                retry_seconds=lane_retry_seconds,
            )

            await workflow.execute_activity(
                "agent_runs.update_status",
                {
                    "organization_id": organization_id,
                    "run_id": run_id,
                    "status": "running",
                    "metadata": {"workflow_id": workflow.info().workflow_id},
                },
                start_to_close_timeout=timedelta(seconds=15),
            )
            await self._emit(organization_id=organization_id, run_id=run_id, event_type="running", payload={})

            for step_index, step_type in enumerate(steps, start=1):
                await self._wait_for_resume_if_needed(
                    organization_id=organization_id,
                    run_id=run_id,
                    org_lane_key=org_lane_key,
                    agent_lane_key=agent_lane_key,
                    resource_lane_key=resource_lane_key,
                    lane_token=lane_token,
                    lane_ttl_seconds=lane_ttl_seconds,
                    org_concurrency_cap=org_concurrency_cap,
                )
                await self._refresh_locks(
                    org_lane_key=org_lane_key,
                    agent_lane_key=agent_lane_key,
                    resource_lane_key=resource_lane_key,
                    lane_token=lane_token,
                    lane_ttl_seconds=lane_ttl_seconds,
                    org_concurrency_cap=org_concurrency_cap,
                )
                if self._kill_requested:
                    await workflow.execute_activity(
                        "agent_runs.update_status",
                        {
                            "organization_id": organization_id,
                            "run_id": run_id,
                            "status": "failed",
                            "failure_reason": "Run killed by operator",
                            "metadata": {"killed_at": workflow.now().isoformat()},
                        },
                        start_to_close_timeout=timedelta(seconds=15),
                    )
                    await self._emit(
                        organization_id=organization_id,
                        run_id=run_id,
                        event_type="failed",
                        payload={"reason": "killed"},
                    )
                    return {"run_id": run_id, "status": "failed", "completed_steps": completed_steps}

                if self._cancel_requested:
                    await workflow.execute_activity(
                        "agent_runs.update_status",
                        {
                            "organization_id": organization_id,
                            "run_id": run_id,
                            "status": "cancelled",
                            "metadata": {"cancelled_at": workflow.now().isoformat()},
                        },
                        start_to_close_timeout=timedelta(seconds=15),
                    )
                    await self._emit(
                        organization_id=organization_id,
                        run_id=run_id,
                        event_type="cancelled",
                        payload={"step_index": step_index},
                    )
                    return {"run_id": run_id, "status": "cancelled", "completed_steps": completed_steps}

                step_started_at = workflow.now().isoformat()
                await workflow.execute_activity(
                    "agent_runs.record_step",
                    {
                        "organization_id": organization_id,
                        "run_id": run_id,
                        "step_index": step_index,
                        "step_type": step_type,
                        "status": "running",
                        "input_payload": {"step_type": step_type},
                        "output_payload": {},
                        "evidence_refs": {},
                        "started_at": step_started_at,
                        "completed_at": None,
                    },
                    start_to_close_timeout=timedelta(seconds=15),
                )

                step_result = await workflow.execute_activity(
                    "agent_runs.execute_step",
                    {
                        "organization_id": organization_id,
                        "run_id": run_id,
                        "deployment_id": deployment_id,
                        "step_type": step_type,
                        "payload": req.get("payload") or {},
                    },
                    start_to_close_timeout=timedelta(minutes=5),
                    retry_policy=RetryPolicy(
                        initial_interval=timedelta(seconds=2),
                        maximum_interval=timedelta(seconds=30),
                        maximum_attempts=3,
                        non_retryable_error_types=["policy_block", "validation_error", "permission_denied"],
                    ),
                )

                step_status = str(step_result.get("status") or "failed")
                if step_status == "waiting_approval":
                    await workflow.execute_activity(
                        "agent_runs.record_step",
                        {
                            "organization_id": organization_id,
                            "run_id": run_id,
                            "step_index": step_index,
                            "step_type": step_type,
                            "status": "requires_approval",
                            "input_payload": {"step_type": step_type},
                            "output_payload": step_result,
                            "evidence_refs": step_result.get("evidence_refs") or {},
                            "started_at": step_started_at,
                            "completed_at": workflow.now().isoformat(),
                        },
                        start_to_close_timeout=timedelta(seconds=15),
                    )
                    self._paused = True
                    await workflow.execute_activity(
                        "agent_runs.update_status",
                        {
                            "organization_id": organization_id,
                            "run_id": run_id,
                            "status": "waiting_approval",
                            "metadata": {"step_type": step_type, "step_index": step_index},
                        },
                        start_to_close_timeout=timedelta(seconds=15),
                    )
                    await self._emit(
                        organization_id=organization_id,
                        run_id=run_id,
                        event_type="waiting_approval",
                        payload={"step_type": step_type, "step_index": step_index},
                    )
                    continue

                if step_status != "completed":
                    raise RuntimeError(
                        f"Step failed ({step_type}): {step_result.get('failure_type') or step_result.get('message')}"
                    )

                step_output = step_result.get("output") or {}
                step_evidence = step_result.get("evidence_refs") or {}
                await workflow.execute_activity(
                    "agent_runs.record_step",
                    {
                        "organization_id": organization_id,
                        "run_id": run_id,
                        "step_index": step_index,
                        "step_type": step_type,
                        "status": "completed",
                        "input_payload": {"step_type": step_type},
                        "output_payload": {
                            **step_output,
                            "token_usage": step_result.get("token_usage"),
                            "tool_usage": step_result.get("tool_usage"),
                        },
                        "evidence_refs": step_evidence,
                        "started_at": step_started_at,
                        "completed_at": workflow.now().isoformat(),
                    },
                    start_to_close_timeout=timedelta(seconds=15),
                )
                completed_steps.append({"step_index": step_index, "step_type": step_type})

            await workflow.execute_activity(
                "agent_runs.update_status",
                {
                    "organization_id": organization_id,
                    "run_id": run_id,
                    "status": "completed",
                    "metadata": {"completed_step_count": len(completed_steps)},
                },
                start_to_close_timeout=timedelta(seconds=15),
            )
            await self._emit(
                organization_id=organization_id,
                run_id=run_id,
                event_type="completed",
                payload={"completed_step_count": len(completed_steps)},
            )
            return {
                "run_id": run_id,
                "status": "completed",
                "completed_steps": completed_steps,
            }
        except Exception as exc:
            compensation = await workflow.execute_activity(
                "agent_runs.compensate",
                {
                    "organization_id": organization_id,
                    "run_id": run_id,
                    "completed_steps": list(reversed(completed_steps)),
                },
                start_to_close_timeout=timedelta(seconds=30),
            )
            dead_letter_job_id = await workflow.execute_activity(
                "agent_runs.enqueue_dead_letter",
                {
                    "organization_id": organization_id,
                    "run_id": run_id,
                    "reason": "unrecoverable_failure",
                    "metadata": {
                        "error": str(exc),
                        "compensation": compensation,
                    },
                },
                start_to_close_timeout=timedelta(seconds=15),
            )
            await workflow.execute_activity(
                "agent_runs.update_status",
                {
                    "organization_id": organization_id,
                    "run_id": run_id,
                    "status": "failed",
                    "failure_reason": str(exc),
                    "metadata": {"dead_letter_job_id": dead_letter_job_id},
                },
                start_to_close_timeout=timedelta(seconds=15),
            )
            await self._emit(
                organization_id=organization_id,
                run_id=run_id,
                event_type="failed",
                payload={"error": str(exc), "dead_letter_job_id": dead_letter_job_id},
            )
            return {
                "run_id": run_id,
                "status": "failed",
                "dead_letter_job_id": dead_letter_job_id,
                "error": str(exc),
            }
        finally:
            await workflow.execute_activity(
                "agent_runs.release_lane",
                {"lane_key": agent_lane_key, "token": lane_token},
                start_to_close_timeout=timedelta(seconds=10),
            )
            await workflow.execute_activity(
                "agent_runs.release_lane",
                {"lane_key": resource_lane_key, "token": lane_token},
                start_to_close_timeout=timedelta(seconds=10),
            )
            await workflow.execute_activity(
                "agent_runs.release_org_slot",
                {"org_lane_key": org_lane_key, "token": lane_token},
                start_to_close_timeout=timedelta(seconds=10),
            )

    async def _wait_for_resume_if_needed(
        self,
        *,
        organization_id: str,
        run_id: str,
        org_lane_key: str,
        agent_lane_key: str,
        resource_lane_key: str,
        lane_token: str,
        lane_ttl_seconds: int,
        org_concurrency_cap: int,
    ) -> None:
        if not self._paused:
            return
        await workflow.wait_condition(lambda: (not self._paused) or self._cancel_requested or self._kill_requested)
        if self._kill_requested:
            return
        await self._refresh_locks(
            org_lane_key=org_lane_key,
            agent_lane_key=agent_lane_key,
            resource_lane_key=resource_lane_key,
            lane_token=lane_token,
            lane_ttl_seconds=lane_ttl_seconds,
            org_concurrency_cap=org_concurrency_cap,
        )
        if not self._cancel_requested:
            await workflow.execute_activity(
                "agent_runs.update_status",
                {
                    "organization_id": organization_id,
                    "run_id": run_id,
                    "status": "running",
                    "metadata": {"resumed_at": workflow.now().isoformat()},
                },
                start_to_close_timeout=timedelta(seconds=15),
            )
            await self._emit(
                organization_id=organization_id,
                run_id=run_id,
                event_type="running",
                payload={"resumed": True},
            )

    async def _acquire_lane(
        self,
        *,
        lane_key: str,
        lane_token: str,
        ttl_seconds: int,
        max_attempts: int,
        retry_seconds: int,
    ) -> None:
        acquired = False
        attempts = 0
        while not acquired:
            attempts += 1
            acquired = await workflow.execute_activity(
                "agent_runs.acquire_lane",
                {"lane_key": lane_key, "token": lane_token, "ttl_seconds": ttl_seconds},
                start_to_close_timeout=timedelta(seconds=10),
            )
            if acquired:
                return
            if attempts > max_attempts:
                raise TimeoutError(f"Timed out acquiring lane {lane_key}")
            await workflow.sleep(timedelta(seconds=retry_seconds))

    async def _acquire_org_slot(
        self,
        *,
        org_lane_key: str,
        lane_token: str,
        max_concurrency: int,
        ttl_seconds: int,
        max_attempts: int,
        retry_seconds: int,
    ) -> None:
        acquired = False
        attempts = 0
        while not acquired:
            attempts += 1
            acquired = await workflow.execute_activity(
                "agent_runs.acquire_org_slot",
                {
                    "org_lane_key": org_lane_key,
                    "token": lane_token,
                    "max_concurrency": max_concurrency,
                    "ttl_seconds": ttl_seconds,
                },
                start_to_close_timeout=timedelta(seconds=10),
            )
            if acquired:
                return
            if attempts > max_attempts:
                raise TimeoutError(f"Timed out acquiring org concurrency slot {org_lane_key}")
            await workflow.sleep(timedelta(seconds=retry_seconds))

    async def _refresh_locks(
        self,
        *,
        org_lane_key: str,
        agent_lane_key: str,
        resource_lane_key: str,
        lane_token: str,
        lane_ttl_seconds: int,
        org_concurrency_cap: int,
    ) -> None:
        agent_lock = await workflow.execute_activity(
            "agent_runs.acquire_lane",
            {"lane_key": agent_lane_key, "token": lane_token, "ttl_seconds": lane_ttl_seconds},
            start_to_close_timeout=timedelta(seconds=10),
        )
        resource_lock = await workflow.execute_activity(
            "agent_runs.acquire_lane",
            {"lane_key": resource_lane_key, "token": lane_token, "ttl_seconds": lane_ttl_seconds},
            start_to_close_timeout=timedelta(seconds=10),
        )
        org_lock = await workflow.execute_activity(
            "agent_runs.acquire_org_slot",
            {
                "org_lane_key": org_lane_key,
                "token": lane_token,
                "max_concurrency": org_concurrency_cap,
                "ttl_seconds": lane_ttl_seconds,
            },
            start_to_close_timeout=timedelta(seconds=10),
        )
        if not bool(agent_lock):
            raise RuntimeError(f"Lost agent lane lock: {agent_lane_key}")
        if not bool(resource_lock):
            raise RuntimeError(f"Lost resource lane lock: {resource_lane_key}")
        if not bool(org_lock):
            raise RuntimeError(f"Lost org concurrency slot: {org_lane_key}")

    async def _emit(
        self,
        *,
        organization_id: str,
        run_id: str,
        event_type: str,
        payload: dict[str, Any],
    ) -> None:
        await workflow.execute_activity(
            "agent_runs.emit_event",
            {
                "organization_id": organization_id,
                "run_id": run_id,
                "event_type": event_type,
                "payload": payload,
            },
            start_to_close_timeout=timedelta(seconds=10),
        )


def _coerce_positive_int(value: Any, *, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if parsed <= 0:
        return default
    return parsed
