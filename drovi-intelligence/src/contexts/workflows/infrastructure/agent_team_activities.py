from __future__ import annotations

from typing import Any

from sqlalchemy import text
from temporalio import activity

from src.contexts.workflows.infrastructure.agent_run_dispatcher import start_agent_run_workflow
from src.db.client import get_db_session
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now


_TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


@activity.defn(name="agent_team.start_child_run")
async def start_child_run(req: dict[str, Any]) -> dict[str, Any]:
    run_id = str(req.get("run_id") or "")
    organization_id = str(req.get("organization_id") or "")
    deployment_id = str(req.get("deployment_id") or "")
    if not run_id or not organization_id or not deployment_id:
        raise ValueError("agent_team.start_child_run requires run_id, organization_id, deployment_id")

    payload = req.get("payload") if isinstance(req.get("payload"), dict) else {}
    steps = req.get("steps") if isinstance(req.get("steps"), list) else None

    workflow_payload: dict[str, Any] = {
        "run_id": run_id,
        "organization_id": organization_id,
        "deployment_id": deployment_id,
        "trigger_id": req.get("trigger_id"),
        "initiated_by": req.get("initiated_by"),
        "payload": payload,
        "resource_lane_key": req.get("resource_lane_key"),
        "steps": steps,
    }
    for key in (
        "org_concurrency_cap",
        "lane_ttl_seconds",
        "lane_max_attempts",
        "lane_retry_seconds",
    ):
        value = req.get(key)
        if value is not None:
            workflow_payload[key] = value

    now = utc_now()
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                UPDATE agent_run
                SET status = 'accepted',
                    updated_at = :updated_at,
                    metadata = COALESCE(metadata, '{}'::jsonb) || CAST(:metadata AS JSONB)
                WHERE organization_id = :organization_id
                  AND id = :run_id
                  AND status IN ('queued', 'accepted')
                """
            ),
            {
                "organization_id": organization_id,
                "run_id": run_id,
                "updated_at": now,
                "metadata": json_dumps_canonical(
                    {
                        "team_monitor_dispatched_at": now.isoformat(),
                        "team_stage_index": req.get("stage_index"),
                        "team_role_id": req.get("role_id"),
                    }
                ),
            },
        )
        await session.commit()

    try:
        await start_agent_run_workflow(workflow_payload)
    except Exception as exc:
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    UPDATE agent_run
                    SET status = 'failed',
                        failure_reason = :failure_reason,
                        completed_at = :completed_at,
                        updated_at = :updated_at
                    WHERE organization_id = :organization_id
                      AND id = :run_id
                    """
                ),
                {
                    "organization_id": organization_id,
                    "run_id": run_id,
                    "failure_reason": str(exc),
                    "completed_at": utc_now(),
                    "updated_at": utc_now(),
                },
            )
            await session.commit()
        raise

    return {
        "run_id": run_id,
        "status": "accepted",
    }


@activity.defn(name="agent_team.fetch_run_statuses")
async def fetch_run_statuses(req: dict[str, Any]) -> dict[str, Any]:
    organization_id = str(req.get("organization_id") or "")
    run_ids_raw = req.get("run_ids")
    run_ids = [str(run_id) for run_id in run_ids_raw if str(run_id)] if isinstance(run_ids_raw, list) else []
    if not organization_id or not run_ids:
        return {"statuses": {}}

    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id,
                       status,
                       failure_reason
                FROM agent_run
                WHERE organization_id = :organization_id
                  AND id = ANY(:run_ids)
                """
            ),
            {
                "organization_id": organization_id,
                "run_ids": run_ids,
            },
        )
        rows = result.fetchall()

    statuses: dict[str, dict[str, Any]] = {}
    for row in rows:
        statuses[str(row.id)] = {
            "status": str(row.status),
            "failure_reason": row.failure_reason,
            "is_terminal": str(row.status) in _TERMINAL_STATUSES,
        }
    return {"statuses": statuses}


@activity.defn(name="agent_team.mark_runs_skipped")
async def mark_runs_skipped(req: dict[str, Any]) -> dict[str, Any]:
    organization_id = str(req.get("organization_id") or "")
    run_ids_raw = req.get("run_ids")
    reason = str(req.get("reason") or "Skipped by team orchestration policy")
    metadata = req.get("metadata") if isinstance(req.get("metadata"), dict) else {}
    run_ids = [str(run_id) for run_id in run_ids_raw if str(run_id)] if isinstance(run_ids_raw, list) else []

    if not organization_id or not run_ids:
        return {"updated": 0}

    now = utc_now()
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                UPDATE agent_run
                SET status = 'cancelled',
                    failure_reason = COALESCE(failure_reason, :failure_reason),
                    completed_at = COALESCE(completed_at, :completed_at),
                    updated_at = :updated_at,
                    metadata = COALESCE(metadata, '{}'::jsonb) || CAST(:metadata AS JSONB)
                WHERE organization_id = :organization_id
                  AND id = ANY(:run_ids)
                  AND status NOT IN ('completed', 'failed', 'cancelled')
                """
            ),
            {
                "organization_id": organization_id,
                "run_ids": run_ids,
                "failure_reason": reason,
                "completed_at": now,
                "updated_at": now,
                "metadata": json_dumps_canonical(
                    {
                        **metadata,
                        "team_skip_reason": reason,
                        "team_skip_at": now.isoformat(),
                    }
                ),
            },
        )
        await session.commit()

    rowcount = int(result.rowcount or 0)
    return {"updated": rowcount}
