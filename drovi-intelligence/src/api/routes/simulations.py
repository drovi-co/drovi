"""Simulation API endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.db.client import get_db_session
from src.simulation.engine import run_simulation
from src.simulation.models import SimulationRequest, SimulationResponse

router = APIRouter(prefix="/simulations", tags=["Simulations"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")


@router.post("/run", response_model=SimulationResponse)
async def run_simulation_endpoint(
    request: SimulationRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    _validate_org_id(ctx, request.organization_id)
    return await run_simulation(request)


@router.get("/history")
async def list_simulations(
    organization_id: str,
    limit: int = 50,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    _validate_org_id(ctx, organization_id)
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id, scenario_name, created_at, output_payload
                FROM simulation_run
                WHERE organization_id = :org_id
                ORDER BY created_at DESC
                LIMIT :limit
                """
            ),
            {"org_id": organization_id, "limit": limit},
        )
        return [dict(row._mapping) for row in result.fetchall()]
