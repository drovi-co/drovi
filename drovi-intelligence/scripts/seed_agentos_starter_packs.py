#!/usr/bin/env python3
"""Seed AgentOS starter-pack demo scenarios for a target organization."""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import cast

import structlog

from src.agentos.starter_packs import StarterPackService, TemplateGroup
from src.db.client import close_db, init_db

logger = structlog.get_logger()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed starter-pack scenarios for an organization.")
    parser.add_argument("--organization-id", required=True, help="Target organization id.")
    parser.add_argument(
        "--template-key",
        action="append",
        default=None,
        help="Optional template key to seed. Can be passed multiple times.",
    )
    parser.add_argument(
        "--runs-per-template",
        type=int,
        default=3,
        help="Number of synthetic runs to create per template (default: 3).",
    )
    parser.add_argument(
        "--actor-id",
        default="seed.starter_packs",
        help="Actor id used for created rows and audit metadata.",
    )
    return parser.parse_args()


async def _run() -> None:
    args = _parse_args()
    template_keys = cast(list[TemplateGroup] | None, args.template_key)

    await init_db()
    try:
        service = StarterPackService()
        response = await service.seed_demo_scenarios(
            organization_id=args.organization_id,
            template_keys=template_keys,
            runs_per_template=max(1, min(args.runs_per_template, 20)),
            actor_id=args.actor_id,
        )
        logger.info(
            "Starter-pack seed complete",
            organization_id=args.organization_id,
            seeded_templates=response.seeded_templates,
            created_runs=response.created_runs,
            created_work_products=response.created_work_products,
            created_eval_results=response.created_eval_results,
        )
        print(json.dumps(response.model_dump(mode="json"), indent=2, sort_keys=True))
    finally:
        await close_db()


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
