from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from src.agentos.browser import (
    BrowserActionLogRecord,
    BrowserActionRequest,
    BrowserActionResponse,
    BrowserArtifactRecord,
    BrowserCloseSessionRequest,
    BrowserCreateSessionRequest,
    BrowserSecretRecord,
    BrowserSecretUpsertRequest,
    BrowserService,
    BrowserSessionRecord,
)
from src.agentos.browser.models import BrowserProviderType, BrowserSessionStatus
from src.auth.context import AuthContext
from src.auth.middleware import get_auth_context

from .agents_common import resolve_org_id

router = APIRouter()
_service = BrowserService()


@router.post("/browser/sessions", response_model=BrowserSessionRecord)
async def create_browser_session(
    request: BrowserCreateSessionRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> BrowserSessionRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _service.create_session(
        request=request.model_copy(update={"organization_id": org_id}),
        actor_id=auth.user_id,
    )


@router.get("/browser/sessions", response_model=list[BrowserSessionRecord])
async def list_browser_sessions(
    organization_id: str | None = None,
    status: BrowserSessionStatus | None = Query(default=None),
    deployment_id: str | None = Query(default=None),
    run_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[BrowserSessionRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _service.list_sessions(
        organization_id=org_id,
        status=status,
        deployment_id=deployment_id,
        run_id=run_id,
        limit=limit,
        offset=offset,
    )


@router.get("/browser/sessions/{session_id}", response_model=BrowserSessionRecord)
async def get_browser_session(
    session_id: str,
    organization_id: str | None = None,
    auth: AuthContext = Depends(get_auth_context),
) -> BrowserSessionRecord:
    org_id = resolve_org_id(auth, organization_id)
    return await _service.get_session(organization_id=org_id, session_id=session_id)


@router.post("/browser/sessions/{session_id}/actions", response_model=BrowserActionResponse)
async def execute_browser_action(
    session_id: str,
    request: BrowserActionRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> BrowserActionResponse:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _service.execute_action(
        organization_id=org_id,
        session_id=session_id,
        request=request.model_copy(update={"organization_id": org_id}),
        actor_id=auth.user_id,
    )


@router.post("/browser/sessions/{session_id}/close", response_model=BrowserSessionRecord)
async def close_browser_session(
    session_id: str,
    request: BrowserCloseSessionRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> BrowserSessionRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _service.close_session(
        organization_id=org_id,
        session_id=session_id,
        reason=request.reason,
        actor_id=auth.user_id,
    )


@router.get("/browser/sessions/{session_id}/actions", response_model=list[BrowserActionLogRecord])
async def list_browser_action_logs(
    session_id: str,
    organization_id: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[BrowserActionLogRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _service.list_action_logs(
        organization_id=org_id,
        session_id=session_id,
        limit=limit,
        offset=offset,
    )


@router.get("/browser/sessions/{session_id}/artifacts", response_model=list[BrowserArtifactRecord])
async def list_browser_artifacts(
    session_id: str,
    organization_id: str | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(get_auth_context),
) -> list[BrowserArtifactRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _service.list_artifacts(
        organization_id=org_id,
        session_id=session_id,
        limit=limit,
        offset=offset,
    )


@router.put("/browser/providers/{provider}/secrets/{secret_name}", response_model=BrowserSecretRecord)
async def upsert_browser_provider_secret(
    provider: BrowserProviderType,
    secret_name: str,
    request: BrowserSecretUpsertRequest,
    auth: AuthContext = Depends(get_auth_context),
) -> BrowserSecretRecord:
    org_id = resolve_org_id(auth, request.organization_id)
    return await _service.upsert_secret(
        organization_id=org_id,
        provider=provider,
        secret_name=secret_name,
        secret_value=request.secret_value,
        metadata=request.metadata,
        actor_id=auth.user_id,
    )


@router.get("/browser/secrets", response_model=list[BrowserSecretRecord])
async def list_browser_provider_secrets(
    organization_id: str | None = None,
    provider: BrowserProviderType | None = Query(default=None),
    auth: AuthContext = Depends(get_auth_context),
) -> list[BrowserSecretRecord]:
    org_id = resolve_org_id(auth, organization_id)
    return await _service.list_secrets(organization_id=org_id, provider=provider)
