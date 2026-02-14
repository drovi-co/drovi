from __future__ import annotations

from typing import Any

from sqlalchemy import text

from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .continuum_migration_utils import build_snapshot_hash, decode_json


class ContinuumMigrationStore:
    async def upsert_migration_record(
        self,
        *,
        session: Any,
        organization_id: str,
        continuum_id: str,
        continuum_version: int,
        mode: str,
        migration_status: str,
        equivalence_score: float,
        equivalence_report: dict[str, Any],
        role_id: str | None,
        profile_id: str | None,
        playbook_id: str | None,
        deployment_id: str | None,
        trigger_id: str | None,
        migrated_by_user_id: str | None,
    ) -> dict[str, Any]:
        now = utc_now()
        migration_id = new_prefixed_id("agmig")
        result = await session.execute(
            text(
                """
                INSERT INTO continuum_agent_migration (
                    id, organization_id, continuum_id, continuum_version, mode, migration_status,
                    equivalence_score, equivalence_report, role_id, profile_id, playbook_id,
                    deployment_id, trigger_id, migrated_by_user_id, created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :continuum_id, :continuum_version, :mode, :migration_status,
                    :equivalence_score, CAST(:equivalence_report AS JSONB), :role_id, :profile_id, :playbook_id,
                    :deployment_id, :trigger_id, :migrated_by_user_id, :created_at, :updated_at
                )
                ON CONFLICT (organization_id, continuum_id, continuum_version, mode)
                DO UPDATE SET
                    migration_status = EXCLUDED.migration_status,
                    equivalence_score = EXCLUDED.equivalence_score,
                    equivalence_report = EXCLUDED.equivalence_report,
                    role_id = EXCLUDED.role_id,
                    profile_id = EXCLUDED.profile_id,
                    playbook_id = EXCLUDED.playbook_id,
                    deployment_id = EXCLUDED.deployment_id,
                    trigger_id = EXCLUDED.trigger_id,
                    migrated_by_user_id = EXCLUDED.migrated_by_user_id,
                    updated_at = EXCLUDED.updated_at
                RETURNING id, organization_id, continuum_id, continuum_version, mode, migration_status,
                          equivalence_score, equivalence_report, role_id, profile_id, playbook_id,
                          deployment_id, trigger_id, migrated_by_user_id, created_at, updated_at
                """
            ),
            {
                "id": migration_id,
                "organization_id": organization_id,
                "continuum_id": continuum_id,
                "continuum_version": continuum_version,
                "mode": mode,
                "migration_status": migration_status,
                "equivalence_score": equivalence_score,
                "equivalence_report": json_dumps_canonical(equivalence_report),
                "role_id": role_id,
                "profile_id": profile_id,
                "playbook_id": playbook_id,
                "deployment_id": deployment_id,
                "trigger_id": trigger_id,
                "migrated_by_user_id": migrated_by_user_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        row = dict(result.fetchone()._mapping)
        row["equivalence_report"] = decode_json(row.get("equivalence_report"), fallback={})
        return row

    async def ensure_role(
        self,
        *,
        session: Any,
        organization_id: str,
        continuum_id: str,
        continuum_name: str,
        actor_user_id: str | None,
    ) -> str:
        role_key = f"legacy.continuum.{continuum_id}"
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_role
                WHERE organization_id = :organization_id AND role_key = :role_key
                """
            ),
            {"organization_id": organization_id, "role_key": role_key},
        )
        existing_row = existing.fetchone()
        if existing_row:
            return str(existing_row.id)

        role_id = new_prefixed_id("agrole")
        now = utc_now()
        await session.execute(
            text(
                """
                INSERT INTO agent_role (
                    id, organization_id, role_key, name, description, domain, status,
                    metadata, created_by_user_id, created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :role_key, :name, :description, :domain, :status,
                    CAST(:metadata AS JSONB), :created_by_user_id, :created_at, :updated_at
                )
                """
            ),
            {
                "id": role_id,
                "organization_id": organization_id,
                "role_key": role_key,
                "name": f"{continuum_name} (Legacy Migration)",
                "description": "Auto-generated from legacy continuum definition.",
                "domain": "legacy",
                "status": "active",
                "metadata": json_dumps_canonical({"source": "continuum", "source_continuum_id": continuum_id}),
                "created_by_user_id": actor_user_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        return role_id

    async def ensure_profile(
        self,
        *,
        session: Any,
        organization_id: str,
        role_id: str,
        continuum_id: str,
    ) -> str:
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_profile
                WHERE organization_id = :organization_id AND role_id = :role_id
                ORDER BY created_at ASC
                LIMIT 1
                """
            ),
            {"organization_id": organization_id, "role_id": role_id},
        )
        existing_row = existing.fetchone()
        if existing_row:
            return str(existing_row.id)

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
                    :id, :organization_id, :role_id, :name, :autonomy_tier,
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
                "name": "Legacy Continuum Profile",
                "autonomy_tier": "L1",
                "model_policy": json_dumps_canonical({"source": "continuum_migration"}),
                "tool_policy": json_dumps_canonical({"allow_all_registered": True}),
                "permission_scope": json_dumps_canonical(
                    {
                        "tools": [],
                        "sources": ["emails", "documents", "calendar"],
                        "channels": ["api"],
                        "allow_external_send": False,
                        "allowed_domains": [],
                    }
                ),
                "metadata": json_dumps_canonical({"source_continuum_id": continuum_id}),
                "created_at": now,
                "updated_at": now,
            },
        )
        return profile_id

    async def upsert_playbook(
        self,
        *,
        session: Any,
        organization_id: str,
        role_id: str,
        continuum_id: str,
        continuum_name: str,
        version: int,
        adapted: dict[str, Any],
        continuum_status: str,
    ) -> str:
        playbook = decode_json(adapted.get("playbook"), fallback={})
        now = utc_now()
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_playbook
                WHERE role_id = :role_id AND version = :version
                """
            ),
            {"role_id": role_id, "version": version},
        )
        existing_row = existing.fetchone()
        status = "active" if continuum_status == "active" else "draft"

        payload = {
            "name": str(playbook.get("name") or f"{continuum_name} (Migrated)"),
            "objective": str(playbook.get("objective") or ""),
            "constraints": json_dumps_canonical(decode_json(playbook.get("constraints"), fallback={})),
            "sop": json_dumps_canonical(decode_json(playbook.get("sop"), fallback={})),
            "success_criteria": json_dumps_canonical(decode_json(playbook.get("success_criteria"), fallback={})),
            "escalation_policy": json_dumps_canonical(decode_json(playbook.get("escalation_policy"), fallback={})),
            "dsl": json_dumps_canonical(
                {
                    **decode_json(playbook.get("dsl"), fallback={}),
                    "migration": {"source_continuum_id": continuum_id},
                }
            ),
            "status": status,
            "updated_at": now,
        }

        if existing_row:
            playbook_id = str(existing_row.id)
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
                    :id, :organization_id, :role_id, :version, :name, :objective,
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
                "version": version,
                "created_at": now,
                **payload,
            },
        )
        return playbook_id

    async def upsert_deployment(
        self,
        *,
        session: Any,
        organization_id: str,
        role_id: str,
        profile_id: str,
        playbook_id: str,
        version: int,
        continuum_id: str,
        continuum_status: str,
        actor_user_id: str | None,
    ) -> str:
        rollout_strategy = {"mode": "legacy_migration", "source_continuum_id": continuum_id}
        snapshot_hash = build_snapshot_hash(
            role_id=role_id,
            profile_id=profile_id,
            playbook_id=playbook_id,
            rollout_strategy=rollout_strategy,
        )
        status = "active" if continuum_status == "active" else "draft"
        now = utc_now()
        published_at = now if status == "active" else None

        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_deployment
                WHERE role_id = :role_id AND version = :version
                """
            ),
            {"role_id": role_id, "version": version},
        )
        existing_row = existing.fetchone()
        if existing_row:
            deployment_id = str(existing_row.id)
            await session.execute(
                text(
                    """
                    UPDATE agent_deployment
                    SET profile_id = :profile_id,
                        playbook_id = :playbook_id,
                        status = :status,
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
                    "status": status,
                    "rollout_strategy": json_dumps_canonical(rollout_strategy),
                    "snapshot_hash": snapshot_hash,
                    "published_at": published_at,
                    "updated_at": now,
                },
            )
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
                    :id, :organization_id, :role_id, :profile_id, :playbook_id, :version,
                    :status, CAST(:rollout_strategy AS JSONB), :snapshot_hash, :published_at,
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
                "version": version,
                "status": status,
                "rollout_strategy": json_dumps_canonical(rollout_strategy),
                "snapshot_hash": snapshot_hash,
                "published_at": published_at,
                "created_by_user_id": actor_user_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        return deployment_id

    async def upsert_trigger(
        self,
        *,
        session: Any,
        organization_id: str,
        deployment_id: str,
        trigger_hint: dict[str, Any],
    ) -> str:
        trigger_type = str(trigger_hint.get("trigger_type") or "manual")
        if trigger_type not in {"manual", "event", "schedule"}:
            trigger_type = "manual"
        trigger_spec = decode_json(trigger_hint.get("trigger_spec"), fallback={})
        if not trigger_spec:
            trigger_spec = {"source": "continuum_migration"}
        now = utc_now()
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_trigger
                WHERE organization_id = :organization_id
                  AND deployment_id = :deployment_id
                  AND trigger_type = :trigger_type
                ORDER BY created_at ASC
                LIMIT 1
                """
            ),
            {
                "organization_id": organization_id,
                "deployment_id": deployment_id,
                "trigger_type": trigger_type,
            },
        )
        existing_row = existing.fetchone()
        if existing_row:
            trigger_id = str(existing_row.id)
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
                    "id": trigger_id,
                    "trigger_spec": json_dumps_canonical(trigger_spec),
                    "updated_at": now,
                },
            )
            return trigger_id

        trigger_id = new_prefixed_id("agtrg")
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
                "id": trigger_id,
                "organization_id": organization_id,
                "deployment_id": deployment_id,
                "trigger_type": trigger_type,
                "trigger_spec": json_dumps_canonical(trigger_spec),
                "created_at": now,
                "updated_at": now,
            },
        )
        return trigger_id

    async def load_continuum_run_metrics(
        self,
        *,
        session: Any,
        organization_id: str,
        continuum_id: str,
        window_start: Any,
        window_end: Any,
    ) -> dict[str, Any]:
        result = await session.execute(
            text(
                """
                SELECT
                    COUNT(*)::int AS run_count,
                    COALESCE(AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END), 0.0) AS success_rate,
                    COALESCE(
                        AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, started_at) - started_at))),
                        0.0
                    ) AS avg_duration_seconds
                FROM continuum_run
                WHERE organization_id = :organization_id
                  AND continuum_id = :continuum_id
                  AND started_at >= :window_start
                  AND started_at <= :window_end
                """
            ),
            {
                "organization_id": organization_id,
                "continuum_id": continuum_id,
                "window_start": window_start,
                "window_end": window_end,
            },
        )
        row = result.fetchone()
        return {
            "run_count": int(getattr(row, "run_count", 0) or 0),
            "success_rate": float(getattr(row, "success_rate", 0.0) or 0.0),
            "avg_duration_seconds": float(getattr(row, "avg_duration_seconds", 0.0) or 0.0),
        }

    async def load_agent_run_metrics(
        self,
        *,
        session: Any,
        organization_id: str,
        deployment_id: str,
        window_start: Any,
        window_end: Any,
    ) -> dict[str, Any]:
        result = await session.execute(
            text(
                """
                SELECT
                    COUNT(*)::int AS run_count,
                    COALESCE(AVG(CASE WHEN status = 'completed' THEN 1.0 ELSE 0.0 END), 0.0) AS success_rate,
                    COALESCE(
                        AVG(
                            EXTRACT(
                                EPOCH FROM (
                                    COALESCE(completed_at, started_at, created_at) - COALESCE(started_at, created_at)
                                )
                            )
                        ),
                        0.0
                    ) AS avg_duration_seconds
                FROM agent_run
                WHERE organization_id = :organization_id
                  AND deployment_id = :deployment_id
                  AND created_at >= :window_start
                  AND created_at <= :window_end
                """
            ),
            {
                "organization_id": organization_id,
                "deployment_id": deployment_id,
                "window_start": window_start,
                "window_end": window_end,
            },
        )
        row = result.fetchone()
        return {
            "run_count": int(getattr(row, "run_count", 0) or 0),
            "success_rate": float(getattr(row, "success_rate", 0.0) or 0.0),
            "avg_duration_seconds": float(getattr(row, "avg_duration_seconds", 0.0) or 0.0),
        }
