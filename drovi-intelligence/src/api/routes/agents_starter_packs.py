from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from src.agentos.control_plane import emit_control_plane_audit_event
from src.agentos.starter_packs import (
    StarterPackEvalRunResponse,
    StarterPackInstallResponse,
    StarterPackSeedDemoResponse,
    StarterPackService,
    StarterPackTemplateModel,
    TemplateGroup,
)
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context

from .agents_common import resolve_org_id

router = APIRouter()
_starter_pack_service = StarterPackService()


class StarterPackInstallRequest(BaseModel):
    organization_id: str


class StarterPackEvalRunRequest(BaseModel):
    organization_id: str
    deployment_id: str | None = None
    persist_results: bool = True


class StarterPackSeedDemoRequest(BaseModel):
    organization_id: str
    template_keys: list[TemplateGroup] | None = None
    runs_per_template: int = Field(default=3, ge=1, le=20)


@router.get("/starter-packs", response_model=list[StarterPackTemplateModel])
async def list_starter_packs(
    organization_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> list[StarterPackTemplateModel]:
    org_id = resolve_org_id(auth, organization_id)
    return await _starter_pack_service.list_templates(organization_id=org_id)


@router.post("/starter-packs/{template_key}/install", response_model=StarterPackInstallResponse)
async def install_starter_pack(
    template_key: TemplateGroup,
    request: StarterPackInstallRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> StarterPackInstallResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    try:
        result = await _starter_pack_service.install_template(
            organization_id=org_id,
            template_key=template_key,
            actor_id=auth.user_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.starter_pack.installed",
        actor_id=auth.user_id,
        resource_type="starter_pack",
        resource_id=template_key,
        metadata=result,
    )
    return StarterPackInstallResponse.model_validate(result)


@router.post("/starter-packs/{template_key}/evals/run", response_model=StarterPackEvalRunResponse)
async def run_starter_pack_eval(
    template_key: TemplateGroup,
    request: StarterPackEvalRunRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> StarterPackEvalRunResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    try:
        result = await _starter_pack_service.run_eval_suite(
            organization_id=org_id,
            template_key=template_key,
            deployment_id=request.deployment_id,
            persist_results=request.persist_results,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.starter_pack.eval_run",
        actor_id=auth.user_id,
        resource_type="starter_pack",
        resource_id=template_key,
        metadata=result.model_dump(mode="json"),
    )
    return result


@router.post("/starter-packs/seed-demo", response_model=StarterPackSeedDemoResponse)
async def seed_starter_pack_demo(
    request: StarterPackSeedDemoRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> StarterPackSeedDemoResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    response = await _starter_pack_service.seed_demo_scenarios(
        organization_id=org_id,
        template_keys=request.template_keys,
        runs_per_template=request.runs_per_template,
        actor_id=auth.user_id,
    )
    await emit_control_plane_audit_event(
        organization_id=org_id,
        action="agentos.starter_pack.seed_demo",
        actor_id=auth.user_id,
        resource_type="starter_pack",
        resource_id="seed_demo",
        metadata=response.model_dump(mode="json"),
    )
    return response
