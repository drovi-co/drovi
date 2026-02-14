#!/usr/bin/env python3
"""
Seed AgentOS demo data for investor and pilot walkthroughs.

Usage:
  python scripts/seed_agentos_demo.py --org-id org_demo --owner-user-id user_demo
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text

from src.db.client import close_db, get_db_session, init_db
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now


@dataclass(frozen=True)
class DemoRoleSpec:
    role_key: str
    name: str
    objective: str
    domain: str
    trigger_type: str
    trigger_spec: dict[str, Any]


ROLE_SPECS = [
    DemoRoleSpec(
        role_key="sales.sdr",
        name="Sales SDR Agent",
        objective="Qualify inbound leads and draft evidence-backed follow-ups.",
        domain="sales",
        trigger_type="event",
        trigger_spec={"event_name": "lead.created", "priority": 5},
    ),
    DemoRoleSpec(
        role_key="legal.advice_timeline",
        name="Advice Timeline Sentinel",
        objective="Track legal advice evolution with exact evidence and drift detection.",
        domain="legal",
        trigger_type="schedule",
        trigger_spec={"interval_minutes": 120},
    ),
    DemoRoleSpec(
        role_key="accounting.filing_missing_docs",
        name="Filing & Missing Docs Agent",
        objective="Monitor filing deadlines and missing client documents.",
        domain="accounting",
        trigger_type="schedule",
        trigger_spec={"interval_minutes": 180},
    ),
]


async def _ensure_role(
    *,
    organization_id: str,
    owner_user_id: str | None,
    spec: DemoRoleSpec,
) -> str:
    async with get_db_session() as session:
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_role
                WHERE organization_id = :organization_id
                  AND role_key = :role_key
                """
            ),
            {"organization_id": organization_id, "role_key": spec.role_key},
        )
        row = existing.fetchone()
        if row:
            return str(row.id)

        role_id = new_prefixed_id("agrole")
        now = utc_now()
        await session.execute(
            text(
                """
                INSERT INTO agent_role (
                    id, organization_id, role_key, name, description, domain, status,
                    metadata, created_by_user_id, created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :role_key, :name, :description, :domain, 'active',
                    CAST(:metadata AS JSONB), :created_by_user_id, :created_at, :updated_at
                )
                """
            ),
            {
                "id": role_id,
                "organization_id": organization_id,
                "role_key": spec.role_key,
                "name": spec.name,
                "description": spec.objective,
                "domain": spec.domain,
                "metadata": json_dumps_canonical({"demo": True}),
                "created_by_user_id": owner_user_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        await session.commit()
        return role_id


async def _ensure_profile(*, organization_id: str, role_id: str) -> str:
    async with get_db_session() as session:
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_profile
                WHERE organization_id = :organization_id
                  AND role_id = :role_id
                ORDER BY created_at ASC
                LIMIT 1
                """
            ),
            {"organization_id": organization_id, "role_id": role_id},
        )
        row = existing.fetchone()
        if row:
            return str(row.id)

        profile_id = new_prefixed_id("agprof")
        now = utc_now()
        await session.execute(
            text(
                """
                INSERT INTO agent_profile (
                    id, organization_id, role_id, name, autonomy_tier,
                    model_policy, tool_policy, permission_scope, metadata,
                    created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :role_id, :name, 'L2',
                    CAST(:model_policy AS JSONB), CAST(:tool_policy AS JSONB),
                    CAST(:permission_scope AS JSONB), CAST(:metadata AS JSONB),
                    :created_at, :updated_at
                )
                """
            ),
            {
                "id": profile_id,
                "organization_id": organization_id,
                "role_id": role_id,
                "name": "Demo profile",
                "model_policy": json_dumps_canonical({"model_tier": "balanced"}),
                "tool_policy": json_dumps_canonical({"allow_all_registered": True}),
                "permission_scope": json_dumps_canonical(
                    {
                        "tools": [],
                        "sources": ["emails", "documents", "calendar", "crm"],
                        "channels": ["email", "slack", "teams", "api"],
                        "allow_external_send": False,
                        "allowed_domains": [],
                    }
                ),
                "metadata": json_dumps_canonical({"demo": True}),
                "created_at": now,
                "updated_at": now,
            },
        )
        await session.commit()
        return profile_id


async def _upsert_playbook(
    *,
    organization_id: str,
    role_id: str,
    spec: DemoRoleSpec,
) -> str:
    async with get_db_session() as session:
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_playbook
                WHERE role_id = :role_id AND version = 1
                """
            ),
            {"role_id": role_id},
        )
        row = existing.fetchone()
        now = utc_now()
        payload = {
            "name": f"{spec.name} Playbook",
            "objective": spec.objective,
            "constraints": json_dumps_canonical({"required_tools": [], "required_read_scopes": []}),
            "sop": json_dumps_canonical(
                {
                    "steps": [
                        {"id": "collect", "action": "context.retrieve"},
                        {"id": "draft", "action": "compose.output"},
                        {"id": "verify", "action": "verify.evidence"},
                    ]
                }
            ),
            "success_criteria": json_dumps_canonical({"evidence_coverage": 0.9}),
            "escalation_policy": json_dumps_canonical({"requires_approval_for_external_send": True}),
            "dsl": json_dumps_canonical({"demo": True, "template": spec.role_key}),
            "status": "active",
            "updated_at": now,
        }
        if row:
            playbook_id = str(row.id)
            await session.execute(
                text(
                    """
                    UPDATE agent_playbook
                    SET name = :name,
                        objective = :objective,
                        constraints = CAST(:constraints AS JSONB),
                        sop = CAST(:sop AS JSONB),
                        success_criteria = CAST(:success_criteria AS JSONB),
                        escalation_policy = CAST(:escalation_policy AS JSONB),
                        dsl = CAST(:dsl AS JSONB),
                        status = :status,
                        updated_at = :updated_at
                    WHERE id = :id
                    """
                ),
                {"id": playbook_id, **payload},
            )
            await session.commit()
            return playbook_id

        playbook_id = new_prefixed_id("agplay")
        await session.execute(
            text(
                """
                INSERT INTO agent_playbook (
                    id, organization_id, role_id, version, name, objective,
                    constraints, sop, success_criteria, escalation_policy,
                    dsl, status, created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :role_id, 1, :name, :objective,
                    CAST(:constraints AS JSONB), CAST(:sop AS JSONB), CAST(:success_criteria AS JSONB),
                    CAST(:escalation_policy AS JSONB), CAST(:dsl AS JSONB),
                    :status, :created_at, :updated_at
                )
                """
            ),
            {
                "id": playbook_id,
                "organization_id": organization_id,
                "role_id": role_id,
                "created_at": now,
                **payload,
            },
        )
        await session.commit()
        return playbook_id


async def _upsert_deployment(
    *,
    organization_id: str,
    role_id: str,
    profile_id: str,
    playbook_id: str,
    owner_user_id: str | None,
) -> str:
    async with get_db_session() as session:
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_deployment
                WHERE role_id = :role_id AND version = 1
                """
            ),
            {"role_id": role_id},
        )
        row = existing.fetchone()
        now = utc_now()
        rollout_strategy = {"mode": "demo_seed"}
        snapshot_hash = new_prefixed_id("snap")
        if row:
            deployment_id = str(row.id)
            await session.execute(
                text(
                    """
                    UPDATE agent_deployment
                    SET profile_id = :profile_id,
                        playbook_id = :playbook_id,
                        status = 'active',
                        rollout_strategy = CAST(:rollout_strategy AS JSONB),
                        snapshot_hash = :snapshot_hash,
                        published_at = :published_at,
                        updated_at = :updated_at
                    WHERE id = :id
                    """
                ),
                {
                    "id": deployment_id,
                    "profile_id": profile_id,
                    "playbook_id": playbook_id,
                    "rollout_strategy": json_dumps_canonical(rollout_strategy),
                    "snapshot_hash": snapshot_hash,
                    "published_at": now,
                    "updated_at": now,
                },
            )
            await session.commit()
            return deployment_id

        deployment_id = new_prefixed_id("agdep")
        await session.execute(
            text(
                """
                INSERT INTO agent_deployment (
                    id, organization_id, role_id, profile_id, playbook_id, version,
                    status, rollout_strategy, snapshot_hash, published_at,
                    created_by_user_id, created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :role_id, :profile_id, :playbook_id, 1,
                    'active', CAST(:rollout_strategy AS JSONB), :snapshot_hash, :published_at,
                    :created_by_user_id, :created_at, :updated_at
                )
                """
            ),
            {
                "id": deployment_id,
                "organization_id": organization_id,
                "role_id": role_id,
                "profile_id": profile_id,
                "playbook_id": playbook_id,
                "rollout_strategy": json_dumps_canonical(rollout_strategy),
                "snapshot_hash": snapshot_hash,
                "published_at": now,
                "created_by_user_id": owner_user_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        await session.commit()
        return deployment_id


async def _upsert_trigger(
    *,
    organization_id: str,
    deployment_id: str,
    spec: DemoRoleSpec,
) -> None:
    async with get_db_session() as session:
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_trigger
                WHERE organization_id = :organization_id
                  AND deployment_id = :deployment_id
                  AND trigger_type = :trigger_type
                LIMIT 1
                """
            ),
            {
                "organization_id": organization_id,
                "deployment_id": deployment_id,
                "trigger_type": spec.trigger_type,
            },
        )
        row = existing.fetchone()
        now = utc_now()
        if row:
            await session.execute(
                text(
                    """
                    UPDATE agent_trigger
                    SET trigger_spec = CAST(:trigger_spec AS JSONB),
                        is_enabled = TRUE,
                        updated_at = :updated_at
                    WHERE id = :id
                    """
                ),
                {
                    "id": str(row.id),
                    "trigger_spec": json_dumps_canonical(spec.trigger_spec),
                    "updated_at": now,
                },
            )
            await session.commit()
            return

        await session.execute(
            text(
                """
                INSERT INTO agent_trigger (
                    id, organization_id, deployment_id, trigger_type, trigger_spec,
                    is_enabled, created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :deployment_id, :trigger_type, CAST(:trigger_spec AS JSONB),
                    TRUE, :created_at, :updated_at
                )
                """
            ),
            {
                "id": new_prefixed_id("agtrg"),
                "organization_id": organization_id,
                "deployment_id": deployment_id,
                "trigger_type": spec.trigger_type,
                "trigger_spec": json_dumps_canonical(spec.trigger_spec),
                "created_at": now,
                "updated_at": now,
            },
        )
        await session.commit()


async def _seed_runs(
    *,
    organization_id: str,
    deployment_id: str,
) -> None:
    statuses = ["completed", "completed", "completed", "failed", "completed"]
    now = utc_now()
    async with get_db_session() as session:
        for index, status in enumerate(statuses):
            run_id = new_prefixed_id("agrun")
            started_at = now
            completed_at = now if status in {"completed", "failed"} else None
            await session.execute(
                text(
                    """
                    INSERT INTO agent_run (
                        id, organization_id, deployment_id, status,
                        initiated_by, started_at, completed_at, failure_reason,
                        metadata, created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :deployment_id, :status,
                        :initiated_by, :started_at, :completed_at, :failure_reason,
                        CAST(:metadata AS JSONB), :created_at, :updated_at
                    )
                    ON CONFLICT (id) DO NOTHING
                    """
                ),
                {
                    "id": run_id,
                    "organization_id": organization_id,
                    "deployment_id": deployment_id,
                    "status": status,
                    "initiated_by": "demo-seed",
                    "started_at": started_at,
                    "completed_at": completed_at,
                    "failure_reason": "simulated_tool_failure"
                    if status == "failed"
                    else None,
                    "metadata": json_dumps_canonical(
                        {"demo": True, "sequence": index + 1}
                    ),
                    "created_at": now,
                    "updated_at": now,
                },
            )
        await session.commit()


async def seed_agentos_demo(*, org_id: str, owner_user_id: str | None) -> None:
    for spec in ROLE_SPECS:
        role_id = await _ensure_role(
            organization_id=org_id,
            owner_user_id=owner_user_id,
            spec=spec,
        )
        profile_id = await _ensure_profile(organization_id=org_id, role_id=role_id)
        playbook_id = await _upsert_playbook(
            organization_id=org_id,
            role_id=role_id,
            spec=spec,
        )
        deployment_id = await _upsert_deployment(
            organization_id=org_id,
            role_id=role_id,
            profile_id=profile_id,
            playbook_id=playbook_id,
            owner_user_id=owner_user_id,
        )
        await _upsert_trigger(
            organization_id=org_id,
            deployment_id=deployment_id,
            spec=spec,
        )
        await _seed_runs(organization_id=org_id, deployment_id=deployment_id)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed AgentOS demo data")
    parser.add_argument("--org-id", required=True, help="Target organization id")
    parser.add_argument("--owner-user-id", default=None, help="Optional creator user id")
    return parser.parse_args()


async def _main() -> None:
    args = _parse_args()
    await init_db()
    try:
        await seed_agentos_demo(org_id=args.org_id, owner_user_id=args.owner_user_id)
        print(f"Seeded AgentOS demo data for org: {args.org_id}")
    finally:
        await close_db()


if __name__ == "__main__":
    asyncio.run(_main())
