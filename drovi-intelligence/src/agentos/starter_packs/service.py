from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .models import (
    StarterPackEvalMetricResult,
    StarterPackEvalRunResponse,
    StarterPackSeedDemoResponse,
    StarterPackTemplateModel,
    StarterPackTemplateSpec,
    TemplateGroup,
)
from .registry import get_starter_pack, list_starter_packs
from .seeding import seed_demo_scenarios as seed_demo_scenarios_impl


@dataclass(frozen=True)
class _InstalledTemplateState:
    role_id: str
    deployment_id: str


class StarterPackService:
    async def list_templates(self, *, organization_id: str) -> list[StarterPackTemplateModel]:
        installed = await self._installed_templates_by_key(organization_id=organization_id)
        templates: list[StarterPackTemplateModel] = []
        for template in list_starter_packs():
            state = installed.get(template.key)
            templates.append(
                StarterPackTemplateModel(
                    key=template.key,
                    name=template.name,
                    summary=template.summary,
                    domain=template.domain,
                    role_key=template.role_key,
                    autonomy_tier=template.autonomy_tier,
                    default_work_product_type=template.default_work_product_type,
                    eval_suite=template.eval_suite,
                    installed=state is not None,
                    installed_deployment_id=state.deployment_id if state else None,
                    installed_role_id=state.role_id if state else None,
                )
            )
        return templates

    async def install_template(
        self,
        *,
        organization_id: str,
        template_key: TemplateGroup,
        actor_id: str | None = None,
    ) -> dict[str, Any]:
        template = get_starter_pack(template_key)
        created_flags = {
            "role": False,
            "profile": False,
            "playbook": False,
            "deployment": False,
            "triggers": False,
        }

        async with get_db_session() as session:
            role_id = await self._ensure_role(
                session=session,
                organization_id=organization_id,
                template=template,
                actor_id=actor_id,
                created_flags=created_flags,
            )
            profile_id = await self._ensure_profile(
                session=session,
                organization_id=organization_id,
                template=template,
                role_id=role_id,
                created_flags=created_flags,
            )
            playbook_id = await self._ensure_playbook(
                session=session,
                organization_id=organization_id,
                template=template,
                role_id=role_id,
                created_flags=created_flags,
            )
            deployment_id = await self._ensure_deployment(
                session=session,
                organization_id=organization_id,
                template=template,
                role_id=role_id,
                profile_id=profile_id,
                playbook_id=playbook_id,
                actor_id=actor_id,
                created_flags=created_flags,
            )
            created_triggers = await self._ensure_triggers(
                session=session,
                organization_id=organization_id,
                template=template,
                deployment_id=deployment_id,
            )
            created_flags["triggers"] = created_triggers > 0
            await session.commit()

        return {
            "template_key": template.key,
            "organization_id": organization_id,
            "role_id": role_id,
            "profile_id": profile_id,
            "playbook_id": playbook_id,
            "deployment_id": deployment_id,
            "created": created_flags,
        }

    async def run_eval_suite(
        self,
        *,
        organization_id: str,
        template_key: TemplateGroup,
        deployment_id: str | None = None,
        persist_results: bool = True,
    ) -> StarterPackEvalRunResponse:
        template = get_starter_pack(template_key)
        resolved_deployment_id = deployment_id or await self._resolve_deployment_for_template(
            organization_id=organization_id,
            template=template,
        )
        if not resolved_deployment_id:
            raise ValueError("No deployment found for template")

        samples = await self._collect_eval_samples(
            organization_id=organization_id,
            deployment_id=resolved_deployment_id,
        )
        metrics: list[StarterPackEvalMetricResult] = []
        for metric_spec in template.eval_suite.metrics:
            metric_value = _metric_value(metric_name=metric_spec.metric_name, samples=samples)
            passed = _metric_passed(
                comparator=metric_spec.comparator,
                metric_value=metric_value,
                threshold=metric_spec.threshold,
            )
            metrics.append(
                StarterPackEvalMetricResult(
                    metric_name=metric_spec.metric_name,
                    metric_value=metric_value,
                    threshold=metric_spec.threshold,
                    comparator=metric_spec.comparator,
                    passed=passed,
                    description=metric_spec.description,
                )
            )

        suite_passed = all(metric.passed for metric in metrics)
        response = StarterPackEvalRunResponse(
            template_key=template.key,
            organization_id=organization_id,
            deployment_id=resolved_deployment_id,
            suite_name=template.eval_suite.suite_name,
            passed=suite_passed,
            metrics=metrics,
        )

        if persist_results:
            await self._persist_eval_results(
                organization_id=organization_id,
                deployment_id=resolved_deployment_id,
                suite_name=template.eval_suite.suite_name,
                metrics=metrics,
            )

        return response

    async def seed_demo_scenarios(
        self,
        *,
        organization_id: str,
        template_keys: list[TemplateGroup] | None = None,
        runs_per_template: int = 3,
        actor_id: str | None = None,
    ) -> StarterPackSeedDemoResponse:
        return await seed_demo_scenarios_impl(
            self,
            organization_id=organization_id,
            template_keys=template_keys,
            runs_per_template=runs_per_template,
            actor_id=actor_id,
        )

    async def _installed_templates_by_key(
        self, *, organization_id: str
    ) -> dict[TemplateGroup, _InstalledTemplateState]:
        query = text(
            """
            SELECT r.role_key, r.id AS role_id, d.id AS deployment_id
            FROM agent_role r
            INNER JOIN agent_deployment d ON d.role_id = r.id
            WHERE r.organization_id = :organization_id
              AND d.organization_id = :organization_id
              AND d.status IN ('active', 'canary', 'draft')
            ORDER BY d.updated_at DESC
            """
        )
        async with get_db_session() as session:
            result = await session.execute(query, {"organization_id": organization_id})
            rows = result.fetchall()

        installed: dict[TemplateGroup, _InstalledTemplateState] = {}
        by_role_key = {template.role_key: template.key for template in list_starter_packs()}
        for row in rows:
            role_key = str(row.role_key)
            template_key = by_role_key.get(role_key)
            if template_key is None or template_key in installed:
                continue
            installed[template_key] = _InstalledTemplateState(
                role_id=str(row.role_id),
                deployment_id=str(row.deployment_id),
            )
        return installed

    async def _ensure_role(
        self,
        *,
        session: Any,
        organization_id: str,
        template: StarterPackTemplateSpec,
        actor_id: str | None,
        created_flags: dict[str, bool],
    ) -> str:
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_role
                WHERE organization_id = :organization_id
                  AND role_key = :role_key
                """
            ),
            {"organization_id": organization_id, "role_key": template.role_key},
        )
        row = existing.fetchone()
        if row is not None:
            return str(row.id)

        role_id = new_prefixed_id("agrole")
        await session.execute(
            text(
                """
                INSERT INTO agent_role (
                    id, organization_id, role_key, name, description, domain, status, metadata,
                    created_by_user_id, created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :role_key, :name, :description, :domain, 'active',
                    CAST(:metadata AS JSONB), :created_by_user_id, :created_at, :updated_at
                )
                """
            ),
            {
                "id": role_id,
                "organization_id": organization_id,
                "role_key": template.role_key,
                "name": template.role_name,
                "description": template.role_description,
                "domain": template.domain,
                "metadata": json_dumps_canonical(
                    {"starter_pack_key": template.key, "summary": template.summary}
                ),
                "created_by_user_id": actor_id,
                "created_at": utc_now(),
                "updated_at": utc_now(),
            },
        )
        created_flags["role"] = True
        return role_id

    async def _ensure_profile(
        self,
        *,
        session: Any,
        organization_id: str,
        template: StarterPackTemplateSpec,
        role_id: str,
        created_flags: dict[str, bool],
    ) -> str:
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_profile
                WHERE organization_id = :organization_id
                  AND role_id = :role_id
                  AND name = :name
                ORDER BY updated_at DESC
                LIMIT 1
                """
            ),
            {
                "organization_id": organization_id,
                "role_id": role_id,
                "name": template.profile_name,
            },
        )
        row = existing.fetchone()
        if row is not None:
            return str(row.id)

        profile_id = new_prefixed_id("agprof")
        await session.execute(
            text(
                """
                INSERT INTO agent_profile (
                    id, organization_id, role_id, name, autonomy_tier, model_policy, tool_policy,
                    permission_scope, metadata, created_at, updated_at
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
                "name": template.profile_name,
                "autonomy_tier": template.autonomy_tier,
                "model_policy": json_dumps_canonical(template.model_policy),
                "tool_policy": json_dumps_canonical(template.tool_policy),
                "permission_scope": json_dumps_canonical(template.permission_scope),
                "metadata": json_dumps_canonical({"starter_pack_key": template.key}),
                "created_at": utc_now(),
                "updated_at": utc_now(),
            },
        )
        created_flags["profile"] = True
        return profile_id

    async def _ensure_playbook(
        self,
        *,
        session: Any,
        organization_id: str,
        template: StarterPackTemplateSpec,
        role_id: str,
        created_flags: dict[str, bool],
    ) -> str:
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_playbook
                WHERE organization_id = :organization_id
                  AND role_id = :role_id
                  AND name = :name
                ORDER BY version DESC
                LIMIT 1
                """
            ),
            {
                "organization_id": organization_id,
                "role_id": role_id,
                "name": template.playbook_name,
            },
        )
        row = existing.fetchone()
        if row is not None:
            return str(row.id)

        version = await self._next_version(
            session=session,
            table="agent_playbook",
            role_id=role_id,
        )
        playbook_id = new_prefixed_id("agplay")
        now = utc_now()
        await session.execute(
            text(
                """
                INSERT INTO agent_playbook (
                    id, organization_id, role_id, version, name, objective,
                    constraints, sop, success_criteria, escalation_policy, dsl, status,
                    created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :role_id, :version, :name, :objective,
                    CAST(:constraints AS JSONB), CAST(:sop AS JSONB), CAST(:success_criteria AS JSONB),
                    CAST(:escalation_policy AS JSONB), CAST(:dsl AS JSONB), 'active',
                    :created_at, :updated_at
                )
                """
            ),
            {
                "id": playbook_id,
                "organization_id": organization_id,
                "role_id": role_id,
                "version": version,
                "name": template.playbook_name,
                "objective": template.objective,
                "constraints": json_dumps_canonical(template.constraints),
                "sop": json_dumps_canonical(template.sop),
                "success_criteria": json_dumps_canonical(template.success_criteria),
                "escalation_policy": json_dumps_canonical(template.escalation_policy),
                "dsl": json_dumps_canonical(template.dsl),
                "created_at": now,
                "updated_at": now,
            },
        )
        created_flags["playbook"] = True
        return playbook_id

    async def _ensure_deployment(
        self,
        *,
        session: Any,
        organization_id: str,
        template: StarterPackTemplateSpec,
        role_id: str,
        profile_id: str,
        playbook_id: str,
        actor_id: str | None,
        created_flags: dict[str, bool],
    ) -> str:
        existing = await session.execute(
            text(
                """
                SELECT id
                FROM agent_deployment
                WHERE organization_id = :organization_id
                  AND role_id = :role_id
                  AND profile_id = :profile_id
                  AND playbook_id = :playbook_id
                ORDER BY version DESC
                LIMIT 1
                """
            ),
            {
                "organization_id": organization_id,
                "role_id": role_id,
                "profile_id": profile_id,
                "playbook_id": playbook_id,
            },
        )
        row = existing.fetchone()
        if row is not None:
            return str(row.id)

        version = await self._next_version(session=session, table="agent_deployment", role_id=role_id)
        deployment_id = new_prefixed_id("agdep")
        now = utc_now()
        rollout_strategy = {"mode": "starter_pack", "template_key": template.key}
        snapshot_hash = hashlib.sha256(
            json_dumps_canonical(
                {
                    "role_id": role_id,
                    "profile_id": profile_id,
                    "playbook_id": playbook_id,
                    "rollout_strategy": rollout_strategy,
                }
            ).encode("utf-8")
        ).hexdigest()
        await session.execute(
            text(
                """
                INSERT INTO agent_deployment (
                    id, organization_id, role_id, profile_id, playbook_id, version, status,
                    rollout_strategy, snapshot_hash, published_at, created_by_user_id, created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :role_id, :profile_id, :playbook_id, :version, 'active',
                    CAST(:rollout_strategy AS JSONB), :snapshot_hash, :published_at,
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
                "rollout_strategy": json_dumps_canonical(rollout_strategy),
                "snapshot_hash": snapshot_hash,
                "published_at": now,
                "created_by_user_id": actor_id,
                "created_at": now,
                "updated_at": now,
            },
        )
        created_flags["deployment"] = True
        return deployment_id

    async def _ensure_triggers(
        self,
        *,
        session: Any,
        organization_id: str,
        template: StarterPackTemplateSpec,
        deployment_id: str,
    ) -> int:
        if not template.trigger_specs:
            return 0

        existing = await session.execute(
            text(
                """
                SELECT trigger_type, trigger_spec
                FROM agent_trigger
                WHERE organization_id = :organization_id
                  AND deployment_id = :deployment_id
                """
            ),
            {
                "organization_id": organization_id,
                "deployment_id": deployment_id,
            },
        )
        existing_pairs = {
            (str(row.trigger_type), json_dumps_canonical(row.trigger_spec or {}))
            for row in existing.fetchall()
        }
        created = 0
        for spec in template.trigger_specs:
            trigger_type = str(spec.get("trigger_type") or "manual")
            trigger_spec = dict(spec.get("trigger_spec") or {})
            pair = (trigger_type, json_dumps_canonical(trigger_spec))
            if pair in existing_pairs:
                continue
            await session.execute(
                text(
                    """
                    INSERT INTO agent_trigger (
                        id, organization_id, deployment_id, trigger_type, trigger_spec, is_enabled, created_at, updated_at
                    ) VALUES (
                        :id, :organization_id, :deployment_id, :trigger_type, CAST(:trigger_spec AS JSONB), true,
                        :created_at, :updated_at
                    )
                    """
                ),
                {
                    "id": new_prefixed_id("agtrg"),
                    "organization_id": organization_id,
                    "deployment_id": deployment_id,
                    "trigger_type": trigger_type,
                    "trigger_spec": json_dumps_canonical(trigger_spec),
                    "created_at": utc_now(),
                    "updated_at": utc_now(),
                },
            )
            created += 1
        return created

    async def _resolve_deployment_for_template(
        self,
        *,
        organization_id: str,
        template: StarterPackTemplateSpec,
    ) -> str | None:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT d.id
                    FROM agent_deployment d
                    INNER JOIN agent_role r ON r.id = d.role_id
                    WHERE d.organization_id = :organization_id
                      AND r.role_key = :role_key
                    ORDER BY d.updated_at DESC
                    LIMIT 1
                    """
                ),
                {"organization_id": organization_id, "role_key": template.role_key},
            )
            row = result.fetchone()
        if row is None:
            return None
        return str(row.id)

    async def _collect_eval_samples(
        self,
        *,
        organization_id: str,
        deployment_id: str,
    ) -> dict[str, float]:
        trailing_cutoff = utc_now() - timedelta(days=30)
        async with get_db_session() as session:
            run_counts_result = await session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) AS total_runs,
                        COUNT(*) FILTER (WHERE status = 'completed') AS completed_runs
                    FROM agent_run
                    WHERE organization_id = :organization_id
                      AND deployment_id = :deployment_id
                      AND created_at >= :cutoff
                    """
                ),
                {
                    "organization_id": organization_id,
                    "deployment_id": deployment_id,
                    "cutoff": trailing_cutoff,
                },
            )
            run_counts = run_counts_result.fetchone()

            work_product_result = await session.execute(
                text(
                    """
                    SELECT
                        COUNT(*) AS total_products,
                        COUNT(*) FILTER (WHERE status IN ('delivered', 'generated')) AS successful_products,
                        COUNT(*) FILTER (WHERE artifact_ref IS NOT NULL) AS with_evidence
                    FROM agent_work_product
                    WHERE organization_id = :organization_id
                      AND run_id IN (
                        SELECT id
                        FROM agent_run
                        WHERE organization_id = :organization_id
                          AND deployment_id = :deployment_id
                          AND created_at >= :cutoff
                      )
                    """
                ),
                {
                    "organization_id": organization_id,
                    "deployment_id": deployment_id,
                    "cutoff": trailing_cutoff,
                },
            )
            work_counts = work_product_result.fetchone()

            approval_result = await session.execute(
                text(
                    """
                    SELECT COUNT(*) AS pending_approvals
                    FROM agent_approval_request
                    WHERE organization_id = :organization_id
                      AND deployment_id = :deployment_id
                      AND status IN ('pending', 'escalated')
                    """
                ),
                {
                    "organization_id": organization_id,
                    "deployment_id": deployment_id,
                },
            )
            approval_counts = approval_result.fetchone()

        total_runs = float(run_counts.total_runs or 0.0)
        completed_runs = float(run_counts.completed_runs or 0.0)
        total_products = float(work_counts.total_products or 0.0)
        successful_products = float(work_counts.successful_products or 0.0)
        with_evidence = float(work_counts.with_evidence or 0.0)
        pending_approvals = float(approval_counts.pending_approvals or 0.0)

        return {
            "run_success_rate": completed_runs / total_runs if total_runs else 0.0,
            "work_product_delivery_rate": successful_products / total_products if total_products else 0.0,
            "evidence_link_rate": with_evidence / total_products if total_products else 0.0,
            "approval_backlog": pending_approvals,
        }

    async def _persist_eval_results(
        self,
        *,
        organization_id: str,
        deployment_id: str,
        suite_name: str,
        metrics: list[StarterPackEvalMetricResult],
    ) -> None:
        now = utc_now()
        async with get_db_session() as session:
            for metric in metrics:
                await session.execute(
                    text(
                        """
                        INSERT INTO agent_eval_result (
                            id, organization_id, deployment_id, run_id, suite_name, metric_name,
                            metric_value, threshold, passed, metadata, evaluated_at, created_at
                        ) VALUES (
                            :id, :organization_id, :deployment_id, NULL, :suite_name, :metric_name,
                            :metric_value, :threshold, :passed, CAST(:metadata AS JSONB), :evaluated_at, :created_at
                        )
                        """
                    ),
                    {
                        "id": new_prefixed_id("ageval"),
                        "organization_id": organization_id,
                        "deployment_id": deployment_id,
                        "suite_name": suite_name,
                        "metric_name": metric.metric_name,
                        "metric_value": metric.metric_value,
                        "threshold": metric.threshold,
                        "passed": metric.passed,
                        "metadata": json_dumps_canonical(
                            {
                                "source": "starter_pack_eval",
                                "comparator": metric.comparator,
                                "description": metric.description,
                            }
                        ),
                        "evaluated_at": now,
                        "created_at": now,
                    },
                )
            await session.commit()

    async def _next_version(self, *, session: Any, table: str, role_id: str) -> int:
        result = await session.execute(
            text(f"SELECT COALESCE(MAX(version), 0) AS max_version FROM {table} WHERE role_id = :role_id"),
            {"role_id": role_id},
        )
        row = result.fetchone()
        max_version = int(row.max_version) if row is not None and row.max_version is not None else 0
        return max_version + 1


def _metric_value(*, metric_name: str, samples: dict[str, float]) -> float:
    return float(samples.get(metric_name, 0.0))


def _metric_passed(*, comparator: str, metric_value: float, threshold: float) -> bool:
    if comparator == "gte":
        return metric_value >= threshold
    if comparator == "lte":
        return metric_value <= threshold
    return False
