from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import timedelta
from typing import Any

from temporalio import workflow

_TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
_FAILURE_STATUSES = {"failed", "cancelled"}


@workflow.defn(name="agents.team.monitor")
class AgentTeamMonitorWorkflow:
    """Orchestrates multi-agent team execution with staged handoffs and conflict policies."""

    @workflow.run
    async def run(self, req: dict[str, Any]) -> dict[str, Any]:
        organization_id = str(req.get("organization_id") or "")
        parent_run_id = str(req.get("parent_run_id") or "")
        if not organization_id or not parent_run_id:
            raise ValueError("AgentTeamMonitorWorkflow requires organization_id and parent_run_id")

        children = _normalize_children(req.get("children"))
        if not children:
            await self._update_parent_status(
                organization_id=organization_id,
                parent_run_id=parent_run_id,
                status="completed",
                metadata={"team_child_count": 0, "team_orchestration": "empty"},
            )
            return {
                "parent_run_id": parent_run_id,
                "status": "completed",
                "child_results": {},
                "failed_children": [],
                "skipped_children": [],
            }

        execution_policy = req.get("execution_policy") if isinstance(req.get("execution_policy"), dict) else {}
        conflict_resolution = req.get("conflict_resolution") if isinstance(req.get("conflict_resolution"), dict) else {}
        dependency_failure_policy = str(execution_policy.get("dependency_failure_policy") or "halt")
        conflict_strategy = str(conflict_resolution.get("strategy") or "required_roles_must_succeed")
        required_roles = {
            str(role_id)
            for role_id in conflict_resolution.get("required_role_ids") or []
            if isinstance(role_id, str) and role_id
        }

        stage_groups: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for child in children:
            stage_groups[int(child["stage_index"])] .append(child)
        ordered_stage_indexes = sorted(stage_groups.keys())

        await self._update_parent_status(
            organization_id=organization_id,
            parent_run_id=parent_run_id,
            status="running",
            metadata={
                "team_mode": execution_policy.get("mode") or "parallel",
                "team_child_count": len(children),
                "team_stage_count": len(ordered_stage_indexes),
            },
        )

        child_statuses: dict[str, str] = {}
        child_failure_reasons: dict[str, str | None] = {}
        failed_children: list[dict[str, Any]] = []
        skipped_children: list[dict[str, Any]] = []

        for stage_index in ordered_stage_indexes:
            stage_children = stage_groups[stage_index]
            launchable: list[dict[str, Any]] = []
            blocked: list[dict[str, Any]] = []

            for child in stage_children:
                dependency_ids = [dep for dep in child["dependencies"] if dep]
                dependency_failed = [
                    dep
                    for dep in dependency_ids
                    if child_statuses.get(dep) in _FAILURE_STATUSES
                ]
                if dependency_failed and dependency_failure_policy == "halt":
                    blocked.append(
                        {
                            "child": child,
                            "dependency_ids": dependency_failed,
                        }
                    )
                    continue
                launchable.append(child)

            if blocked:
                blocked_ids = [entry["child"]["run_id"] for entry in blocked]
                await workflow.execute_activity(
                    "agent_team.mark_runs_skipped",
                    {
                        "organization_id": organization_id,
                        "run_ids": blocked_ids,
                        "reason": "Dependency failed for required handoff",
                        "metadata": {
                            "stage_index": stage_index,
                            "dependency_failure_policy": dependency_failure_policy,
                        },
                    },
                    start_to_close_timeout=timedelta(seconds=30),
                )
                for entry in blocked:
                    child = entry["child"]
                    run_id = str(child["run_id"])
                    child_statuses[run_id] = "cancelled"
                    child_failure_reasons[run_id] = "Dependency failed for required handoff"
                    skipped_children.append(
                        {
                            "run_id": run_id,
                            "role_id": child["role_id"],
                            "stage_index": stage_index,
                            "reason": "dependency_failed",
                            "depends_on": entry["dependency_ids"],
                        }
                    )

            if launchable:
                await asyncio.gather(
                    *[
                        workflow.execute_activity(
                            "agent_team.start_child_run",
                            {
                                "organization_id": organization_id,
                                "run_id": child["run_id"],
                                "deployment_id": child["deployment_id"],
                                "role_id": child["role_id"],
                                "stage_index": stage_index,
                                "payload": _build_child_payload(req=req, child=child),
                                "steps": req.get("steps"),
                                "initiated_by": req.get("initiated_by"),
                                "resource_lane_key": _resource_lane_key(
                                    organization_id=organization_id,
                                    team_id=str(req.get("team_id") or ""),
                                    child=child,
                                    fallback=req.get("resource_lane_key"),
                                ),
                                "org_concurrency_cap": req.get("org_concurrency_cap"),
                                "lane_ttl_seconds": req.get("lane_ttl_seconds"),
                                "lane_max_attempts": req.get("lane_max_attempts"),
                                "lane_retry_seconds": req.get("lane_retry_seconds"),
                            },
                            start_to_close_timeout=timedelta(minutes=1),
                        )
                        for child in launchable
                    ]
                )

                stage_statuses = await self._wait_for_stage_completion(
                    organization_id=organization_id,
                    stage_children=launchable,
                    poll_seconds=2.0,
                )
                child_statuses.update({run_id: payload["status"] for run_id, payload in stage_statuses.items()})
                child_failure_reasons.update(
                    {
                        run_id: payload.get("failure_reason")
                        for run_id, payload in stage_statuses.items()
                    }
                )

            stage_failures = [
                child
                for child in stage_children
                if child_statuses.get(str(child["run_id"])) in _FAILURE_STATUSES
            ]
            if stage_failures:
                for child in stage_failures:
                    run_id = str(child["run_id"])
                    failed_children.append(
                        {
                            "run_id": run_id,
                            "role_id": child["role_id"],
                            "stage_index": stage_index,
                            "status": child_statuses.get(run_id, "failed"),
                            "failure_reason": child_failure_reasons.get(run_id),
                            "is_required": bool(child["is_required"]),
                        }
                    )

                should_abort, abort_reason = _should_abort(
                    dependency_failure_policy=dependency_failure_policy,
                    conflict_strategy=conflict_strategy,
                    required_roles=required_roles,
                    stage_failures=stage_failures,
                )
                if should_abort:
                    skipped_future = await self._skip_remaining_stages(
                        organization_id=organization_id,
                        stage_groups=stage_groups,
                        ordered_stage_indexes=ordered_stage_indexes,
                        current_stage_index=stage_index,
                    )
                    skipped_children.extend(skipped_future)
                    await self._update_parent_status(
                        organization_id=organization_id,
                        parent_run_id=parent_run_id,
                        status="failed",
                        failure_reason=abort_reason,
                        metadata={
                            "team_failed_stage": stage_index,
                            "team_conflict_strategy": conflict_strategy,
                            "dependency_failure_policy": dependency_failure_policy,
                            "failed_children": failed_children,
                            "skipped_children": skipped_children,
                        },
                    )
                    return {
                        "parent_run_id": parent_run_id,
                        "status": "failed",
                        "failed_children": failed_children,
                        "skipped_children": skipped_children,
                    }

        failed_count = len([status for status in child_statuses.values() if status in _FAILURE_STATUSES])
        final_status = "completed"
        if failed_count and conflict_strategy in {"halt_on_failure", "required_roles_must_succeed"}:
            final_status = "failed"

        await self._update_parent_status(
            organization_id=organization_id,
            parent_run_id=parent_run_id,
            status=final_status,
            failure_reason=("Team execution completed with non-recoverable failures" if final_status == "failed" else None),
            metadata={
                "team_conflict_strategy": conflict_strategy,
                "dependency_failure_policy": dependency_failure_policy,
                "failed_children": failed_children,
                "skipped_children": skipped_children,
                "child_statuses": child_statuses,
            },
        )

        return {
            "parent_run_id": parent_run_id,
            "status": final_status,
            "failed_children": failed_children,
            "skipped_children": skipped_children,
            "child_results": child_statuses,
        }

    async def _wait_for_stage_completion(
        self,
        *,
        organization_id: str,
        stage_children: list[dict[str, Any]],
        poll_seconds: float,
    ) -> dict[str, dict[str, Any]]:
        run_ids = [str(child["run_id"]) for child in stage_children]
        while True:
            status_payload = await workflow.execute_activity(
                "agent_team.fetch_run_statuses",
                {
                    "organization_id": organization_id,
                    "run_ids": run_ids,
                },
                start_to_close_timeout=timedelta(seconds=30),
            )
            statuses = status_payload.get("statuses") if isinstance(status_payload, dict) else {}
            if not isinstance(statuses, dict):
                statuses = {}

            all_terminal = True
            normalized: dict[str, dict[str, Any]] = {}
            for run_id in run_ids:
                payload = statuses.get(run_id)
                status = "accepted"
                failure_reason: str | None = None
                if isinstance(payload, dict):
                    status = str(payload.get("status") or "accepted")
                    raw_failure = payload.get("failure_reason")
                    failure_reason = str(raw_failure) if raw_failure is not None else None
                if status not in _TERMINAL_STATUSES:
                    all_terminal = False
                normalized[run_id] = {
                    "status": status,
                    "failure_reason": failure_reason,
                }

            if all_terminal:
                return normalized
            await workflow.sleep(poll_seconds)

    async def _skip_remaining_stages(
        self,
        *,
        organization_id: str,
        stage_groups: dict[int, list[dict[str, Any]]],
        ordered_stage_indexes: list[int],
        current_stage_index: int,
    ) -> list[dict[str, Any]]:
        remaining_ids: list[str] = []
        skipped_payload: list[dict[str, Any]] = []
        for stage_index in ordered_stage_indexes:
            if stage_index <= current_stage_index:
                continue
            for child in stage_groups[stage_index]:
                remaining_ids.append(str(child["run_id"]))
                skipped_payload.append(
                    {
                        "run_id": str(child["run_id"]),
                        "role_id": str(child["role_id"]),
                        "stage_index": stage_index,
                        "reason": "team_aborted",
                    }
                )

        if remaining_ids:
            await workflow.execute_activity(
                "agent_team.mark_runs_skipped",
                {
                    "organization_id": organization_id,
                    "run_ids": remaining_ids,
                    "reason": "Team orchestration aborted",
                    "metadata": {
                        "abort_stage_index": current_stage_index,
                    },
                },
                start_to_close_timeout=timedelta(seconds=30),
            )
        return skipped_payload

    async def _update_parent_status(
        self,
        *,
        organization_id: str,
        parent_run_id: str,
        status: str,
        metadata: dict[str, Any] | None = None,
        failure_reason: str | None = None,
    ) -> None:
        await workflow.execute_activity(
            "agent_runs.update_status",
            {
                "organization_id": organization_id,
                "run_id": parent_run_id,
                "status": status,
                "failure_reason": failure_reason,
                "metadata": metadata or {},
            },
            start_to_close_timeout=timedelta(seconds=30),
        )


def _normalize_children(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    children: list[dict[str, Any]] = []
    for raw in value:
        if not isinstance(raw, dict):
            continue
        run_id = str(raw.get("run_id") or "")
        deployment_id = str(raw.get("deployment_id") or "")
        role_id = str(raw.get("role_id") or "")
        if not run_id or not deployment_id or not role_id:
            continue

        stage_index_raw = raw.get("stage_index")
        try:
            stage_index = int(stage_index_raw)
        except (TypeError, ValueError):
            stage_index = 0

        dependencies_raw = raw.get("dependencies")
        dependencies = [str(dep) for dep in dependencies_raw if str(dep)] if isinstance(dependencies_raw, list) else []

        children.append(
            {
                "run_id": run_id,
                "deployment_id": deployment_id,
                "role_id": role_id,
                "stage_index": max(stage_index, 0),
                "dependencies": dependencies,
                "is_required": bool(raw.get("is_required", True)),
                "specialization_prompt": raw.get("specialization_prompt"),
                "constraints": raw.get("constraints") if isinstance(raw.get("constraints"), dict) else {},
            }
        )

    return children


def _build_child_payload(*, req: dict[str, Any], child: dict[str, Any]) -> dict[str, Any]:
    return {
        "objective": req.get("objective"),
        "objective_context": req.get("objective_context") if isinstance(req.get("objective_context"), dict) else {},
        "team_context": {
            "parent_run_id": req.get("parent_run_id"),
            "team_id": req.get("team_id"),
            "role_id": child.get("role_id"),
            "stage_index": child.get("stage_index"),
            "dependencies": child.get("dependencies") or [],
            "is_required": bool(child.get("is_required", True)),
        },
        "specialization_prompt": child.get("specialization_prompt"),
        "constraints": child.get("constraints") if isinstance(child.get("constraints"), dict) else {},
    }


def _resource_lane_key(
    *,
    organization_id: str,
    team_id: str,
    child: dict[str, Any],
    fallback: Any,
) -> str:
    if isinstance(fallback, str) and fallback.strip():
        return fallback.strip()
    stage_index = int(child.get("stage_index") or 0)
    role_id = str(child.get("role_id") or "role")
    if team_id:
        return f"team:{organization_id}:{team_id}:stage:{stage_index}:role:{role_id}"
    return f"team:{organization_id}:stage:{stage_index}:role:{role_id}"


def _should_abort(
    *,
    dependency_failure_policy: str,
    conflict_strategy: str,
    required_roles: set[str],
    stage_failures: list[dict[str, Any]],
) -> tuple[bool, str]:
    if not stage_failures:
        return False, ""

    if dependency_failure_policy == "halt":
        return True, "Dependency failure policy halted team execution"

    if conflict_strategy == "halt_on_failure":
        return True, "Conflict strategy halted execution on stage failure"

    if conflict_strategy == "required_roles_must_succeed":
        for child in stage_failures:
            role_id = str(child.get("role_id") or "")
            if bool(child.get("is_required", True)) or role_id in required_roles:
                return True, "Required role failure halted team execution"

    return False, ""
