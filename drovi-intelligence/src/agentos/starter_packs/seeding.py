from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .models import StarterPackSeedDemoResponse, StarterPackTemplateSpec, TemplateGroup
from .registry import filter_starter_packs

if TYPE_CHECKING:
    from .service import StarterPackService


async def seed_demo_scenarios(
    service: "StarterPackService",
    *,
    organization_id: str,
    template_keys: list[TemplateGroup] | None = None,
    runs_per_template: int = 3,
    actor_id: str | None = None,
) -> StarterPackSeedDemoResponse:
    templates = filter_starter_packs(template_keys)
    seeded_templates: list[TemplateGroup] = []
    created_runs = 0
    created_work_products = 0
    created_eval_results = 0

    for template in templates:
        install_result = await service.install_template(
            organization_id=organization_id,
            template_key=template.key,
            actor_id=actor_id,
        )
        deployment_id = str(install_result["deployment_id"])
        seeded_templates.append(template.key)

        async with get_db_session() as session:
            for index in range(max(1, runs_per_template)):
                run_id = new_prefixed_id("agrun")
                created_at = utc_now() - timedelta(hours=(index + 1))
                started_at = created_at + timedelta(minutes=1)
                completed_at = started_at + timedelta(minutes=4)
                await session.execute(
                    text(
                        """
                        INSERT INTO agent_run (
                            id, organization_id, deployment_id, trigger_id, status,
                            initiated_by, started_at, completed_at, failure_reason, metadata,
                            created_at, updated_at
                        ) VALUES (
                            :id, :organization_id, :deployment_id, NULL, 'completed',
                            :initiated_by, :started_at, :completed_at, NULL,
                            CAST(:metadata AS JSONB), :created_at, :updated_at
                        )
                        """
                    ),
                    {
                        "id": run_id,
                        "organization_id": organization_id,
                        "deployment_id": deployment_id,
                        "initiated_by": actor_id or "seed.starter_packs",
                        "started_at": started_at,
                        "completed_at": completed_at,
                        "metadata": json_dumps_canonical(
                            {
                                "seeded": True,
                                "template_key": template.key,
                                "scenario": f"{template.key}-scenario-{index + 1}",
                            }
                        ),
                        "created_at": created_at,
                        "updated_at": completed_at,
                    },
                )
                await _seed_run_steps(
                    session=session,
                    organization_id=organization_id,
                    run_id=run_id,
                    created_at=created_at,
                )
                await _seed_work_product(
                    session=session,
                    organization_id=organization_id,
                    run_id=run_id,
                    template=template,
                    created_at=completed_at,
                )
                created_runs += 1
                created_work_products += 1
            await session.commit()

        eval_response = await service.run_eval_suite(
            organization_id=organization_id,
            template_key=template.key,
            deployment_id=deployment_id,
            persist_results=True,
        )
        created_eval_results += len(eval_response.metrics)

    return StarterPackSeedDemoResponse(
        organization_id=organization_id,
        seeded_templates=seeded_templates,
        created_runs=created_runs,
        created_work_products=created_work_products,
        created_eval_results=created_eval_results,
    )


async def _seed_run_steps(
    *,
    session: object,
    organization_id: str,
    run_id: str,
    created_at,
) -> None:
    step_specs = [
        ("context_retrieval", "completed"),
        ("planning", "completed"),
        ("report", "completed"),
    ]
    for index, (step_type, status) in enumerate(step_specs, start=1):
        started_at = created_at + timedelta(minutes=index)
        completed_at = started_at + timedelta(minutes=1)
        await session.execute(
            text(
                """
                INSERT INTO agent_run_step (
                    id, run_id, organization_id, step_index, step_type, status, input_payload,
                    output_payload, evidence_refs, started_at, completed_at, created_at
                ) VALUES (
                    gen_random_uuid(), :run_id, :organization_id, :step_index, :step_type, :status,
                    CAST(:input_payload AS JSONB), CAST(:output_payload AS JSONB), CAST(:evidence_refs AS JSONB),
                    :started_at, :completed_at, :created_at
                )
                """
            ),
            {
                "run_id": run_id,
                "organization_id": organization_id,
                "step_index": index,
                "step_type": step_type,
                "status": status,
                "input_payload": json_dumps_canonical({"seeded": True}),
                "output_payload": json_dumps_canonical({"summary": f"{step_type} complete"}),
                "evidence_refs": json_dumps_canonical({"count": 1}),
                "started_at": started_at,
                "completed_at": completed_at,
                "created_at": started_at,
            },
        )


async def _seed_work_product(
    *,
    session: object,
    organization_id: str,
    run_id: str,
    template: StarterPackTemplateSpec,
    created_at,
) -> None:
    payload = {
        "seeded": True,
        "template_key": template.key,
        "summary": template.summary,
        "evidence_refs": [f"evh_seed_{template.key}"],
    }
    await session.execute(
        text(
            """
            INSERT INTO agent_work_product (
                id, organization_id, run_id, product_type, title, status, artifact_ref, payload,
                created_at, updated_at
            ) VALUES (
                :id, :organization_id, :run_id, :product_type, :title, 'delivered',
                NULL, CAST(:payload AS JSONB), :created_at, :updated_at
            )
            """
        ),
        {
            "id": new_prefixed_id("agwp"),
            "organization_id": organization_id,
            "run_id": run_id,
            "product_type": template.default_work_product_type,
            "title": f"{template.name} demo output",
            "payload": json_dumps_canonical(payload),
            "created_at": created_at,
            "updated_at": created_at,
        },
    )
