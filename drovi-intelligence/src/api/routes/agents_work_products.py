from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from src.agentos.work_products import (
    WorkProductDeliveryRequest,
    WorkProductDeliveryResult,
    WorkProductGenerateRequest,
    WorkProductRecord,
    WorkProductService,
)
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context

from .agents_common import resolve_org_id

router = APIRouter()

_service = WorkProductService()


@router.get("/work-products", response_model=list[WorkProductRecord])
async def list_work_products(
    organization_id: str | None = None,
    run_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[WorkProductRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _service.list_work_products(
        organization_id=org_id,
        run_id=run_id,
        limit=limit,
        offset=offset,
    )


@router.get("/work-products/{work_product_id}", response_model=WorkProductRecord)
async def get_work_product(
    work_product_id: str,
    organization_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> WorkProductRecord:
    org_id = resolve_org_id(auth, organization_id)
    record = await _service.get_work_product(
        organization_id=org_id,
        work_product_id=work_product_id,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Work product not found")
    return record


@router.post("/work-products", response_model=WorkProductRecord)
async def create_work_product(
    request: WorkProductGenerateRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> WorkProductRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    normalized_request = request.model_copy(update={"organization_id": org_id})
    try:
        return await _service.generate_work_product(
            request=normalized_request,
            actor_id=auth.user_id,
        )
    except ValueError as exc:
        raise _to_http_error(exc) from exc


@router.post("/work-products/{work_product_id}/deliver", response_model=WorkProductDeliveryResult)
async def deliver_work_product(
    work_product_id: str,
    request: WorkProductDeliveryRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> WorkProductDeliveryResult:
    org_id = resolve_org_id(auth, request.organization_id)
    normalized_request = request.model_copy(update={"organization_id": org_id})
    try:
        return await _service.deliver_work_product(
            work_product_id=work_product_id,
            request=normalized_request,
            actor_id=auth.user_id,
        )
    except ValueError as exc:
        raise _to_http_error(exc) from exc


def _to_http_error(exc: ValueError) -> HTTPException:
    detail = str(exc)
    status_code = _status_for_error(detail)
    return HTTPException(status_code=status_code, detail=detail)


def _status_for_error(detail: str) -> int:
    message = detail.lower()
    not_found_terms = ("not found", "missing", "unknown")
    if any(term in message for term in not_found_terms):
        return 404
    validation_terms = ("requires", "invalid", "unsupported", "verification", "no ")
    if any(term in message for term in validation_terms):
        return 400
    return 422
