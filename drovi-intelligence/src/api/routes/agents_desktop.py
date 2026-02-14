from __future__ import annotations

from fastapi import APIRouter, Depends

from src.agentos.desktop import (
    DesktopActionRequest,
    DesktopActionResponse,
    DesktopBridgeControlRequest,
    DesktopBridgeControlResponse,
    DesktopBridgeHealthRequest,
    DesktopBridgeHealthResponse,
    DesktopBridgeService,
)
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context

from .agents_common import resolve_org_id

router = APIRouter()
_service = DesktopBridgeService()


@router.post("/desktop/actions", response_model=DesktopActionResponse)
async def execute_desktop_action(
    request: DesktopActionRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> DesktopActionResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _service.execute_action(
        request=request.model_copy(update={"organization_id": org_id}),
        actor_id=auth.user_id,
    )


@router.post("/desktop/health", response_model=DesktopBridgeHealthResponse)
async def desktop_bridge_health(
    request: DesktopBridgeHealthRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> DesktopBridgeHealthResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _service.health(
        request=request.model_copy(update={"organization_id": org_id}),
    )


@router.post("/desktop/control/disable", response_model=DesktopBridgeControlResponse)
async def disable_desktop_bridge(
    request: DesktopBridgeControlRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> DesktopBridgeControlResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _service.disable_bridge(
        request=request.model_copy(update={"organization_id": org_id}),
        actor_id=auth.user_id,
    )


@router.post("/desktop/control/enable", response_model=DesktopBridgeControlResponse)
async def enable_desktop_bridge(
    request: DesktopBridgeControlRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> DesktopBridgeControlResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _service.enable_bridge(
        request=request.model_copy(update={"organization_id": org_id}),
        actor_id=auth.user_id,
    )
