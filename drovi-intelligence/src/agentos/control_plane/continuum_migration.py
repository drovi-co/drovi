from __future__ import annotations

from datetime import timedelta
from typing import Any

import structlog
from sqlalchemy import text

from src.continuum.dsl import ContinuumDefinition
from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .compat import convert_continuum_to_playbook
from .continuum_migration_store import ContinuumMigrationStore
from .continuum_migration_utils import bounded, decode_json, ratio

logger = structlog.get_logger()


class ContinuumMigrationService:
    """Migration orchestration from legacy Continuum runtime to AgentOS."""

    def __init__(self, *, store: ContinuumMigrationStore | None = None) -> None:
        self._store = store or ContinuumMigrationStore()

    async def list_legacy_continuums(
        self,
        *,
        organization_id: str,
        continuum_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT c.id, c.organization_id, c.name, c.description, c.status,
                           c.current_version, c.active_version, c.updated_at,
                           cv.definition, cv.definition_hash, cv.created_at AS version_created_at
                    FROM continuum c
                    LEFT JOIN continuum_version cv
                      ON cv.continuum_id = c.id
                     AND cv.organization_id = c.organization_id
                     AND cv.version = COALESCE(c.active_version, c.current_version)
                    WHERE c.organization_id = :organization_id
                    ORDER BY c.updated_at DESC
                    """
                ),
                {"organization_id": organization_id},
            )
            rows = [dict(row._mapping) for row in result.fetchall()]

        if continuum_ids:
            allowed = set(continuum_ids)
            rows = [row for row in rows if str(row.get("id")) in allowed]
        return rows

    def calculate_equivalence(
        self,
        *,
        continuum_definition_payload: dict[str, Any],
    ) -> tuple[float, dict[str, Any], dict[str, Any]]:
        definition = ContinuumDefinition.model_validate(continuum_definition_payload)
        adapted = convert_continuum_to_playbook(continuum_definition_payload)

        adapted_playbook = adapted.get("playbook", {})
        adapted_trigger = adapted.get("trigger_hint", {})

        original_step_count = float(len(definition.steps))
        adapted_step_count = float(len(decode_json(adapted_playbook.get("sop"), fallback={}).get("steps", [])))
        step_score = ratio(original_step_count, adapted_step_count)

        original_proof_count = float(len(definition.proofs))
        adapted_proof_count = float(
            len(decode_json(adapted_playbook.get("success_criteria"), fallback={}).get("proofs", []))
        )
        proof_score = ratio(original_proof_count, adapted_proof_count)

        if definition.schedule.type == "on_demand":
            expected_trigger_type = "manual"
            schedule_detail_score = 1.0
        else:
            expected_trigger_type = "schedule"
            schedule_spec = decode_json(adapted_trigger.get("trigger_spec"), fallback={})
            if definition.schedule.type == "cron":
                schedule_detail_score = 1.0 if schedule_spec.get("cron") == definition.schedule.cron else 0.0
            else:
                expected_interval = int(definition.schedule.interval_minutes or 60)
                actual_interval = schedule_spec.get("interval_minutes")
                if isinstance(actual_interval, int):
                    schedule_detail_score = (
                        1.0
                        if actual_interval == expected_interval
                        else ratio(float(expected_interval), float(actual_interval))
                    )
                else:
                    schedule_detail_score = 0.0

        trigger_type_score = 1.0 if adapted_trigger.get("trigger_type") == expected_trigger_type else 0.0
        schedule_score = bounded((trigger_type_score * 0.7) + (schedule_detail_score * 0.3))

        source_escalation = definition.escalation.model_dump(mode="json")
        adapted_escalation = decode_json(adapted_playbook.get("escalation_policy"), fallback={})
        source_keys = set(source_escalation.keys())
        adapted_keys = set(adapted_escalation.keys())
        if not source_keys and not adapted_keys:
            escalation_score = 1.0
        else:
            escalation_score = ratio(float(len(source_keys & adapted_keys)), float(len(source_keys | adapted_keys)))

        weighted = (
            (step_score * 0.4)
            + (proof_score * 0.25)
            + (schedule_score * 0.2)
            + (escalation_score * 0.15)
        )
        score = round(bounded(weighted), 4)
        report = {
            "score_breakdown": {
                "steps": round(step_score, 4),
                "proofs": round(proof_score, 4),
                "schedule": round(schedule_score, 4),
                "escalation": round(escalation_score, 4),
            },
            "counts": {
                "original_steps": int(original_step_count),
                "adapted_steps": int(adapted_step_count),
                "original_proofs": int(original_proof_count),
                "adapted_proofs": int(adapted_proof_count),
            },
            "schedule": {
                "original_type": definition.schedule.type,
                "adapted_trigger_type": adapted_trigger.get("trigger_type"),
                "original_interval_minutes": definition.schedule.interval_minutes,
                "adapted_interval_minutes": decode_json(adapted_trigger.get("trigger_spec"), fallback={}).get(
                    "interval_minutes"
                ),
                "original_cron": definition.schedule.cron,
                "adapted_cron": decode_json(adapted_trigger.get("trigger_spec"), fallback={}).get("cron"),
            },
        }
        return score, report, adapted

    async def migrate_continuums(
        self,
        *,
        organization_id: str,
        continuum_ids: list[str] | None,
        dry_run: bool,
        actor_user_id: str | None,
    ) -> list[dict[str, Any]]:
        legacy_rows = await self.list_legacy_continuums(
            organization_id=organization_id,
            continuum_ids=continuum_ids,
        )
        if not legacy_rows:
            return []

        responses: list[dict[str, Any]] = []
        mode = "dry_run" if dry_run else "applied"

        for row in legacy_rows:
            continuum_id = str(row["id"])
            version = int(row.get("active_version") or row.get("current_version") or 1)
            raw_definition = decode_json(row.get("definition"), fallback={})
            if not raw_definition:
                responses.append(
                    {
                        "continuum_id": continuum_id,
                        "continuum_version": version,
                        "migration_status": "failed",
                        "mode": mode,
                        "equivalence_score": 0.0,
                        "equivalence_report": {"error": "Missing active continuum definition"},
                    }
                )
                continue

            score, report, adapted = self.calculate_equivalence(
                continuum_definition_payload=raw_definition,
            )
            role_id: str | None = None
            profile_id: str | None = None
            playbook_id: str | None = None
            deployment_id: str | None = None
            trigger_id: str | None = None
            status = "completed"

            try:
                async with get_db_session() as session:
                    if not dry_run:
                        role_id = await self._store.ensure_role(
                            session=session,
                            organization_id=organization_id,
                            continuum_id=continuum_id,
                            continuum_name=str(row.get("name") or f"Legacy Continuum {continuum_id}"),
                            actor_user_id=actor_user_id,
                        )
                        profile_id = await self._store.ensure_profile(
                            session=session,
                            organization_id=organization_id,
                            role_id=role_id,
                            continuum_id=continuum_id,
                        )
                        playbook_id = await self._store.upsert_playbook(
                            session=session,
                            organization_id=organization_id,
                            role_id=role_id,
                            continuum_id=continuum_id,
                            continuum_name=str(row.get("name") or f"Legacy Continuum {continuum_id}"),
                            version=version,
                            adapted=adapted,
                            continuum_status=str(row.get("status") or "draft"),
                        )
                        deployment_id = await self._store.upsert_deployment(
                            session=session,
                            organization_id=organization_id,
                            role_id=role_id,
                            profile_id=profile_id,
                            playbook_id=playbook_id,
                            version=version,
                            continuum_id=continuum_id,
                            continuum_status=str(row.get("status") or "draft"),
                            actor_user_id=actor_user_id,
                        )
                        trigger_id = await self._store.upsert_trigger(
                            session=session,
                            organization_id=organization_id,
                            deployment_id=deployment_id,
                            trigger_hint=decode_json(adapted.get("trigger_hint"), fallback={}),
                        )

                    migration_record = await self._store.upsert_migration_record(
                        session=session,
                        organization_id=organization_id,
                        continuum_id=continuum_id,
                        continuum_version=version,
                        mode=mode,
                        migration_status=status,
                        equivalence_score=score,
                        equivalence_report=report,
                        role_id=role_id,
                        profile_id=profile_id,
                        playbook_id=playbook_id,
                        deployment_id=deployment_id,
                        trigger_id=trigger_id,
                        migrated_by_user_id=actor_user_id,
                    )
                    await session.commit()
            except Exception as exc:
                status = "failed"
                report = {**report, "error": str(exc)}
                logger.warning(
                    "Continuum migration failed",
                    organization_id=organization_id,
                    continuum_id=continuum_id,
                    error=str(exc),
                )
                async with get_db_session() as session:
                    migration_record = await self._store.upsert_migration_record(
                        session=session,
                        organization_id=organization_id,
                        continuum_id=continuum_id,
                        continuum_version=version,
                        mode=mode,
                        migration_status=status,
                        equivalence_score=score,
                        equivalence_report=report,
                        role_id=role_id,
                        profile_id=profile_id,
                        playbook_id=playbook_id,
                        deployment_id=deployment_id,
                        trigger_id=trigger_id,
                        migrated_by_user_id=actor_user_id,
                    )
                    await session.commit()

            responses.append(
                {
                    "migration_id": migration_record["id"],
                    "continuum_id": continuum_id,
                    "continuum_version": version,
                    "mode": mode,
                    "migration_status": status,
                    "equivalence_score": score,
                    "equivalence_report": report,
                    "role_id": role_id,
                    "profile_id": profile_id,
                    "playbook_id": playbook_id,
                    "deployment_id": deployment_id,
                    "trigger_id": trigger_id,
                }
            )
        return responses

    async def list_migrations(
        self,
        *,
        organization_id: str,
        continuum_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        query = """
            SELECT id, organization_id, continuum_id, continuum_version, mode, migration_status,
                   equivalence_score, equivalence_report, role_id, profile_id, playbook_id,
                   deployment_id, trigger_id, migrated_by_user_id, created_at, updated_at
            FROM continuum_agent_migration
            WHERE organization_id = :organization_id
        """
        params: dict[str, Any] = {"organization_id": organization_id, "limit": limit}
        if continuum_id:
            query += " AND continuum_id = :continuum_id"
            params["continuum_id"] = continuum_id
        query += " ORDER BY created_at DESC LIMIT :limit"

        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = [dict(row._mapping) for row in result.fetchall()]

        for row in rows:
            row["equivalence_report"] = decode_json(row.get("equivalence_report"), fallback={})
        return rows

    async def run_shadow_validation(
        self,
        *,
        organization_id: str,
        continuum_ids: list[str] | None,
        lookback_days: int,
        actor_user_id: str | None,
    ) -> list[dict[str, Any]]:
        legacy_rows = await self.list_legacy_continuums(
            organization_id=organization_id,
            continuum_ids=continuum_ids,
        )
        if not legacy_rows:
            return []

        now = utc_now()
        window_start = now - timedelta(days=max(1, lookback_days))
        responses: list[dict[str, Any]] = []

        for row in legacy_rows:
            continuum_id = str(row["id"])
            async with get_db_session() as session:
                migration_result = await session.execute(
                    text(
                        """
                        SELECT id, deployment_id
                        FROM continuum_agent_migration
                        WHERE organization_id = :organization_id
                          AND continuum_id = :continuum_id
                          AND mode = 'applied'
                          AND migration_status = 'completed'
                        ORDER BY created_at DESC
                        LIMIT 1
                        """
                    ),
                    {"organization_id": organization_id, "continuum_id": continuum_id},
                )
                migration_row = migration_result.fetchone()
                deployment_id = str(migration_row.deployment_id) if migration_row and migration_row.deployment_id else None

                continuum_metrics = await self._store.load_continuum_run_metrics(
                    session=session,
                    organization_id=organization_id,
                    continuum_id=continuum_id,
                    window_start=window_start,
                    window_end=now,
                )

                agent_metrics = {
                    "run_count": 0,
                    "success_rate": 0.0,
                    "avg_duration_seconds": 0.0,
                }
                if deployment_id:
                    agent_metrics = await self._store.load_agent_run_metrics(
                        session=session,
                        organization_id=organization_id,
                        deployment_id=deployment_id,
                        window_start=window_start,
                        window_end=now,
                    )

                run_count_parity = ratio(
                    float(continuum_metrics["run_count"]),
                    float(agent_metrics["run_count"]),
                )
                status_parity = bounded(
                    1.0 - abs(float(continuum_metrics["success_rate"]) - float(agent_metrics["success_rate"]))
                )
                duration_parity = ratio(
                    float(continuum_metrics["avg_duration_seconds"]),
                    float(agent_metrics["avg_duration_seconds"]),
                )
                score = round(bounded((run_count_parity + status_parity + duration_parity) / 3.0), 4)
                report = {
                    "continuum_metrics": continuum_metrics,
                    "agent_metrics": agent_metrics,
                    "run_count_parity": round(run_count_parity, 4),
                    "status_parity": round(status_parity, 4),
                    "duration_parity": round(duration_parity, 4),
                }

                validation_id = new_prefixed_id("agshadow")
                await session.execute(
                    text(
                        """
                        INSERT INTO continuum_shadow_validation (
                            id, organization_id, continuum_id, migration_id,
                            window_start, window_end,
                            continuum_run_count, agent_run_count,
                            status_parity, duration_parity, score, report,
                            created_by_user_id, created_at
                        ) VALUES (
                            :id, :organization_id, :continuum_id, :migration_id,
                            :window_start, :window_end,
                            :continuum_run_count, :agent_run_count,
                            :status_parity, :duration_parity, :score, CAST(:report AS JSONB),
                            :created_by_user_id, :created_at
                        )
                        """
                    ),
                    {
                        "id": validation_id,
                        "organization_id": organization_id,
                        "continuum_id": continuum_id,
                        "migration_id": str(migration_row.id) if migration_row else None,
                        "window_start": window_start,
                        "window_end": now,
                        "continuum_run_count": int(continuum_metrics["run_count"]),
                        "agent_run_count": int(agent_metrics["run_count"]),
                        "status_parity": status_parity,
                        "duration_parity": duration_parity,
                        "score": score,
                        "report": json_dumps_canonical(report),
                        "created_by_user_id": actor_user_id,
                        "created_at": now,
                    },
                )
                await session.commit()

                responses.append(
                    {
                        "id": validation_id,
                        "organization_id": organization_id,
                        "continuum_id": continuum_id,
                        "migration_id": str(migration_row.id) if migration_row else None,
                        "window_start": window_start,
                        "window_end": now,
                        "continuum_run_count": int(continuum_metrics["run_count"]),
                        "agent_run_count": int(agent_metrics["run_count"]),
                        "status_parity": round(status_parity, 4),
                        "duration_parity": round(duration_parity, 4),
                        "score": score,
                        "report": report,
                        "created_by_user_id": actor_user_id,
                        "created_at": now,
                    }
                )

        return responses

    async def list_shadow_validations(
        self,
        *,
        organization_id: str,
        continuum_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        query = """
            SELECT id, organization_id, continuum_id, migration_id, window_start, window_end,
                   continuum_run_count, agent_run_count, status_parity, duration_parity,
                   score, report, created_by_user_id, created_at
            FROM continuum_shadow_validation
            WHERE organization_id = :organization_id
        """
        params: dict[str, Any] = {"organization_id": organization_id, "limit": limit}
        if continuum_id:
            query += " AND continuum_id = :continuum_id"
            params["continuum_id"] = continuum_id
        query += " ORDER BY created_at DESC LIMIT :limit"

        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = [dict(row._mapping) for row in result.fetchall()]

        for row in rows:
            row["report"] = decode_json(row.get("report"), fallback={})
        return rows
