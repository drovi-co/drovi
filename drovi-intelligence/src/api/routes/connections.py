"""
Connection Management API Routes

Provides endpoints for managing data source connections:
- CRUD operations for connections
- OAuth flow initiation and callback
- Sync management (trigger, status, history)
- Stream configuration
"""

from datetime import datetime, timedelta, timezone
import inspect
import secrets
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.config import get_settings
from src.connectors.base.config import AuthType, SyncMode
from src.connectors.base.connector import ConnectorRegistry
from src.connectors.connector_requirements import get_missing_env_for_connector
from src.connectors.definitions.registry import get_connector_definition

logger = structlog.get_logger()

router = APIRouter(prefix="/connections", tags=["Connections"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    """Validate organization_id matches auth context."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


def _resolve_oauth_provider_and_scopes(connector_type: str):
    """Resolve OAuth provider/scopes for a connector type."""
    from src.connectors.auth.oauth2 import OAuth2Provider

    definition = get_connector_definition(connector_type)
    if not definition or not definition.oauth_provider:
        raise HTTPException(
            status_code=400,
            detail=f"Connector '{connector_type}' does not support OAuth",
        )

    try:
        provider = OAuth2Provider(definition.oauth_provider)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Connector '{connector_type}' maps to unsupported OAuth provider "
                f"'{definition.oauth_provider}'"
            ),
        ) from exc

    scopes = list(definition.oauth_scopes) if definition.oauth_scopes else None
    return provider, scopes


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================


class CreateConnectionRequest(BaseModel):
    """Request to create a new connection."""

    connector_type: str = Field(..., description="Type of connector (gmail, slack, notion, etc.)")
    name: str = Field(..., description="Display name for this connection")
    organization_id: str = Field(..., description="Organization ID")
    config: dict[str, Any] = Field(default_factory=dict, description="Connector-specific config")


class ConnectionResponse(BaseModel):
    """Connection response model."""

    id: str
    connector_type: str
    name: str
    organization_id: str
    status: str
    created_at: datetime
    last_sync_at: datetime | None = None
    sync_enabled: bool = True
    streams: list[str] = Field(default_factory=list)


class UpdateConnectionRequest(BaseModel):
    """Request to update a connection."""

    name: str | None = None
    sync_enabled: bool | None = None
    config: dict[str, Any] | None = None


class OAuthInitRequest(BaseModel):
    """Request to initiate OAuth flow."""

    connector_type: str
    organization_id: str
    redirect_uri: str
    state: str | None = None


class OAuthInitResponse(BaseModel):
    """Response with OAuth authorization URL."""

    authorization_url: str
    auth_url: str
    state: str


class OAuthCallbackRequest(BaseModel):
    """OAuth callback request."""

    code: str
    state: str


class SyncRequest(BaseModel):
    """Request to trigger a sync."""

    streams: list[str] | None = Field(
        default=None,
        description="Specific streams to sync. If None, sync all enabled streams.",
    )
    full_refresh: bool = Field(
        default=False,
        description="Force full refresh instead of incremental sync",
    )


class BackfillRequest(BaseModel):
    """Request to trigger a backfill."""

    start_date: datetime = Field(..., description="Backfill start date (ISO 8601)")
    end_date: datetime | None = Field(
        default=None,
        description="Backfill end date (ISO 8601). Defaults to now.",
    )
    window_days: int = Field(default=7, ge=1, le=90, description="Window size in days")
    streams: list[str] | None = Field(
        default=None,
        description="Specific streams to backfill. If None, backfill all enabled streams.",
    )
    throttle_seconds: float = Field(
        default=1.0,
        ge=0.0,
        le=30.0,
        description="Delay between backfill windows to respect rate limits",
    )


class ReplayRequest(BaseModel):
    """Request to replay sync from an explicit checkpoint."""

    checkpoint_cursor: dict[str, Any] | None = Field(
        default=None,
        description="Optional cursor checkpoint override applied before replay sync.",
    )
    streams: list[str] | None = Field(
        default=None,
        description="Optional stream subset to replay. If omitted, all enabled streams are replayed.",
    )
    full_refresh: bool = Field(
        default=False,
        description="Force replay as full refresh after checkpoint override.",
    )


class SyncStatusResponse(BaseModel):
    """Sync status response."""

    connection_id: str
    status: str  # idle, running, failed
    last_sync_at: datetime | None = None
    current_sync_id: str | None = None
    progress: dict[str, Any] | None = None


class SyncHistoryItem(BaseModel):
    """A sync job history item."""

    id: str
    status: str
    started_at: datetime
    completed_at: datetime | None = None
    records_synced: int = 0
    error_message: str | None = None


class ConnectionHealthResponse(BaseModel):
    """Deterministic source health response."""

    connection_id: str
    organization_id: str
    connector_type: str
    status: str
    reason_code: str
    reason: str
    last_sync_at: datetime | None = None
    minutes_since_last_sync: float | None = None
    stale_after_minutes: int
    sync_slo_breached: bool
    sync_slo_minutes: int
    recent_failures: int
    recovery_action: str
    last_error: str | None = None
    checked_at: datetime


class StreamConfigRequest(BaseModel):
    """Request to configure streams."""

    stream_name: str
    enabled: bool = True
    sync_mode: str = "incremental"  # full_refresh, incremental
    cursor_field: str | None = None


# =============================================================================
# CONNECTION CRUD ENDPOINTS
# =============================================================================


@router.get("/connectors")
async def list_connectors(
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    List available connector types.

    Returns all registered connectors with their capabilities.

    Requires `read` scope.
    """
    from src.connectors.bootstrap import ensure_connectors_registered

    ensure_connectors_registered()
    settings = get_settings()
    connectors = []
    for connector_type, connector_class in ConnectorRegistry._connectors.items():
        if inspect.isabstract(connector_class):
            logger.debug(
                "Skipping abstract connector",
                connector_type=connector_type,
            )
            continue
        missing_env = get_missing_env_for_connector(connector_type, settings)
        configured = len(missing_env) == 0
        try:
            connector = connector_class()
        except TypeError as e:
            logger.warning(
                "Failed to instantiate connector",
                connector_type=connector_type,
                error=str(e),
            )
            continue
        connectors.append({
            "type": connector_type,
            "configured": configured,
            "missing_env": missing_env,
            "capabilities": {
                "supports_incremental": connector.capabilities.supports_incremental,
                "supports_full_refresh": connector.capabilities.supports_full_refresh,
                "supports_webhooks": connector.capabilities.supports_webhooks,
                "supports_real_time": connector.capabilities.supports_real_time,
            },
        })

    return {"connectors": connectors}


@router.post("", response_model=ConnectionResponse)
async def create_connection(
    request: CreateConnectionRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE_CONNECTIONS)),
):
    """
    Create a new data source connection.

    This creates the connection record. For OAuth-based connectors,
    use the /oauth/initiate endpoint to start the OAuth flow.

    Requires `write:connections` scope.
    """
    _validate_org_id(ctx, request.organization_id)
    from src.db.client import get_db_session
    from src.db.models.connections import Connection

    # Validate connector type
    if request.connector_type not in ConnectorRegistry._connectors:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown connector type: {request.connector_type}. "
                   f"Available: {list(ConnectorRegistry._connectors.keys())}",
        )

    async with get_db_session() as session:
        connection = Connection(
            connector_type=request.connector_type,
            name=request.name,
            organization_id=request.organization_id,
            config=request.config,
            status="pending_auth",
            sync_enabled=True,
            created_at=datetime.utcnow(),
        )
        session.add(connection)
        await session.commit()
        await session.refresh(connection)

    logger.info(
        "Connection created",
        connection_id=str(connection.id),
        connector_type=request.connector_type,
        organization_id=request.organization_id,
    )

    return ConnectionResponse(
        id=str(connection.id),
        connector_type=request.connector_type,
        name=request.name,
        organization_id=request.organization_id,
        status="pending_auth",
        created_at=connection.created_at,
        streams=[],
    )


@router.get("", response_model=list[ConnectionResponse])
async def list_connections(
    organization_id: str = Query(..., description="Organization ID"),
    connector_type: str | None = Query(None, description="Filter by connector type"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    List all connections for an organization.

    Requires `read` scope.
    """
    _validate_org_id(ctx, organization_id)
    from sqlalchemy import select
    from src.db.client import get_db_session
    from src.db.models.connections import Connection

    async with get_db_session() as session:
        query = select(Connection).where(Connection.organization_id == organization_id)

        if connector_type:
            query = query.where(Connection.connector_type == connector_type)

        result = await session.execute(query)
        connections = result.scalars().all()

    return [
        ConnectionResponse(
            id=str(conn.id),
            connector_type=conn.connector_type,
            name=conn.name,
            organization_id=conn.organization_id,
            status=conn.status,
            created_at=conn.created_at,
            last_sync_at=conn.last_sync_at,
            sync_enabled=conn.sync_enabled,
            streams=list(conn.streams_config or []),
        )
        for conn in connections
    ]


@router.get("/{connection_id}", response_model=ConnectionResponse)
async def get_connection(
    connection_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get a specific connection.

    Requires `read` scope.
    """
    from sqlalchemy import select
    from src.db.client import get_db_session
    from src.db.models.connections import Connection

    async with get_db_session() as session:
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    return ConnectionResponse(
        id=str(connection.id),
        connector_type=connection.connector_type,
        name=connection.name,
        organization_id=connection.organization_id,
        status=connection.status,
        created_at=connection.created_at,
        last_sync_at=connection.last_sync_at,
        sync_enabled=connection.sync_enabled,
        streams=list(connection.streams_config or []),
    )


@router.patch("/{connection_id}", response_model=ConnectionResponse)
async def update_connection(
    connection_id: str,
    request: UpdateConnectionRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE_CONNECTIONS)),
):
    """
    Update a connection.

    Requires `write:connections` scope.
    """
    from sqlalchemy import select
    from src.db.client import get_db_session
    from src.db.models.connections import Connection

    async with get_db_session() as session:
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        if request.name is not None:
            connection.name = request.name
        if request.sync_enabled is not None:
            connection.sync_enabled = request.sync_enabled
        if request.config is not None:
            connection.config = {**connection.config, **request.config}

        connection.updated_at = datetime.utcnow()
        await session.commit()
        await session.refresh(connection)

    return ConnectionResponse(
        id=str(connection.id),
        connector_type=connection.connector_type,
        name=connection.name,
        organization_id=connection.organization_id,
        status=connection.status,
        created_at=connection.created_at,
        last_sync_at=connection.last_sync_at,
        sync_enabled=connection.sync_enabled,
        streams=list(connection.streams_config or []),
    )


@router.delete("/{connection_id}")
async def delete_connection(
    connection_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE_CONNECTIONS)),
):
    """
    Delete a connection.

    This also revokes any OAuth tokens and cancels scheduled syncs.

    Requires `write:connections` scope.
    """
    from sqlalchemy import delete, select, update
    from src.db.client import get_db_session
    from src.db.models.background_jobs import BackgroundJob
    from src.db.models.connections import Connection, OAuthToken, SyncJobHistory, SyncState
    from src.db.models.connector_webhooks import ConnectorWebhookInbox
    from src.connectors.auth.oauth2 import configure_oauth
    from src.connectors.auth.token_store import get_token_store

    async with get_db_session() as session:
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")
        _validate_org_id(ctx, str(connection.organization_id))

    # Best-effort OAuth revocation before deleting local records.
    try:
        provider, _scopes = _resolve_oauth_provider_and_scopes(connection.connector_type)
        token_store = await get_token_store()
        tokens = await token_store.get_tokens(
            connection_id=connection_id,
            organization_id=str(connection.organization_id),
        )
        if tokens:
            settings = get_settings()
            oauth_manager = configure_oauth(
                google_client_id=settings.google_client_id,
                google_client_secret=settings.google_client_secret,
                microsoft_client_id=settings.microsoft_client_id,
                microsoft_client_secret=settings.microsoft_client_secret,
                slack_client_id=settings.slack_client_id,
                slack_client_secret=settings.slack_client_secret,
                notion_client_id=settings.notion_client_id,
                notion_client_secret=settings.notion_client_secret,
                hubspot_client_id=settings.hubspot_client_id,
                hubspot_client_secret=settings.hubspot_client_secret,
            )
            await oauth_manager.revoke_token(provider=provider, tokens=tokens)
    except HTTPException:
        # Non-OAuth connectors are valid here.
        pass
    except Exception as exc:
        logger.warning(
            "OAuth revocation failed during connection delete",
            connection_id=connection_id,
            error=str(exc),
        )

    async with get_db_session() as session:
        # Cancel queued/running sync jobs for this connection.
        await session.execute(
            update(BackgroundJob)
            .where(BackgroundJob.organization_id == str(connection.organization_id))
            .where(BackgroundJob.resource_key == f"connection:{connection_id}")
            .where(BackgroundJob.status.in_(("queued", "running")))
            .values(
                status="cancelled",
                completed_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
                last_error="Cancelled because connection was deleted",
            )
        )

        # Explicit child cleanup to avoid FK nullification issues.
        await session.execute(delete(OAuthToken).where(OAuthToken.connection_id == connection.id))
        await session.execute(delete(SyncState).where(SyncState.connection_id == connection.id))
        await session.execute(delete(SyncJobHistory).where(SyncJobHistory.connection_id == connection.id))
        await session.execute(
            delete(ConnectorWebhookInbox).where(ConnectorWebhookInbox.connection_id == connection.id)
        )
        await session.execute(delete(Connection).where(Connection.id == connection.id))

    logger.info("Connection deleted", connection_id=connection_id)

    return {"deleted": True, "connection_id": connection_id}


# =============================================================================
# OAUTH ENDPOINTS
# =============================================================================


@router.post("/oauth/initiate", response_model=OAuthInitResponse)
async def initiate_oauth(
    request: OAuthInitRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE_CONNECTIONS)),
):
    """
    Initiate OAuth flow for a connector.

    Returns an authorization URL to redirect the user to.

    Requires `write:connections` scope.
    """
    _validate_org_id(ctx, request.organization_id)
    from src.connectors.auth.oauth2 import configure_oauth

    provider, scopes = _resolve_oauth_provider_and_scopes(request.connector_type)
    state = request.state or secrets.token_urlsafe(32)
    settings = get_settings()

    oauth_manager = configure_oauth(
        google_client_id=settings.google_client_id,
        google_client_secret=settings.google_client_secret,
        microsoft_client_id=settings.microsoft_client_id,
        microsoft_client_secret=settings.microsoft_client_secret,
        slack_client_id=settings.slack_client_id,
        slack_client_secret=settings.slack_client_secret,
        notion_client_id=settings.notion_client_id,
        notion_client_secret=settings.notion_client_secret,
        hubspot_client_id=settings.hubspot_client_id,
        hubspot_client_secret=settings.hubspot_client_secret,
    )

    auth_url = oauth_manager.get_authorization_url(
        provider=provider,
        redirect_uri=request.redirect_uri,
        state=state,
        scopes=scopes,
    )

    return OAuthInitResponse(
        authorization_url=auth_url,
        auth_url=auth_url,
        state=state,
    )


@router.post("/oauth/callback/{connection_id}")
async def oauth_callback(
    connection_id: str,
    request: OAuthCallbackRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE_CONNECTIONS)),
):
    """
    Handle OAuth callback and exchange code for tokens.

    Requires `write:connections` scope.
    """
    from sqlalchemy import select
    from src.db.client import get_db_session
    from src.db.models.connections import Connection
    from src.connectors.auth.oauth2 import configure_oauth
    from src.connectors.auth.token_store import get_token_store

    # Get the connection
    async with get_db_session() as session:
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        _validate_org_id(ctx, str(connection.organization_id))
        provider, _scopes = _resolve_oauth_provider_and_scopes(connection.connector_type)
        settings = get_settings()
        oauth_manager = configure_oauth(
            google_client_id=settings.google_client_id,
            google_client_secret=settings.google_client_secret,
            microsoft_client_id=settings.microsoft_client_id,
            microsoft_client_secret=settings.microsoft_client_secret,
            slack_client_id=settings.slack_client_id,
            slack_client_secret=settings.slack_client_secret,
            notion_client_id=settings.notion_client_id,
            notion_client_secret=settings.notion_client_secret,
            hubspot_client_id=settings.hubspot_client_id,
            hubspot_client_secret=settings.hubspot_client_secret,
        )

        redirect_uri = str((connection.config or {}).get("redirect_uri") or "").strip()
        if not redirect_uri:
            raise HTTPException(
                status_code=400,
                detail="Connection is missing OAuth redirect_uri configuration",
            )

        # Exchange code for tokens
        token_data = await oauth_manager.exchange_code(
            provider=provider,
            code=request.code,
            redirect_uri=redirect_uri,
        )

        # Store tokens
        token_store = await get_token_store()
        await token_store.store_tokens(
            connection_id=connection_id,
            organization_id=str(connection.organization_id),
            provider=provider.value,
            tokens=token_data,
        )

        # Update connection status
        connection.status = "active"
        connection.updated_at = datetime.utcnow()
        await session.commit()

    logger.info(
        "OAuth tokens stored",
        connection_id=connection_id,
    )

    return {
        "success": True,
        "connection_id": connection_id,
        "status": "active",
    }


# =============================================================================
# SYNC ENDPOINTS
# =============================================================================


@router.post("/{connection_id}/sync")
async def trigger_sync(
    connection_id: str,
    request: SyncRequest | None = None,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Trigger a sync for a connection.

    Requires `write` scope.
    """
    from sqlalchemy import select
    from src.db.client import get_db_session
    from src.db.models.connections import Connection

    request = request or SyncRequest()

    # Get the connection
    async with get_db_session() as session:
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        if connection.status not in {"active", "connected", "error"}:
            if connection.status == "pending_auth":
                raise HTTPException(
                    status_code=400,
                    detail="Connection requires authentication. Reconnect the source first.",
                )
            raise HTTPException(
                status_code=400,
                detail=f"Connection is not ready for sync (status: {connection.status})",
            )

        # Save organization_id before exiting session context
        organization_id = connection.organization_id

    from src.jobs.queue import EnqueueJobRequest, enqueue_job

    job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=organization_id,
            job_type="connector.sync",
            payload={
                "connection_id": connection_id,
                "organization_id": organization_id,
                "streams": request.streams,
                "full_refresh": request.full_refresh,
                "scheduled": False,
            },
            priority=1,
            max_attempts=3,
            resource_key=f"connection:{connection_id}",
        )
    )

    return {
        "connection_id": connection_id,
        "sync_job_id": job_id,
        "status": "queued",
    }


@router.post("/{connection_id}/backfill")
async def trigger_backfill(
    connection_id: str,
    request: BackfillRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
):
    """
    Trigger a windowed backfill for a connection.

    Requires `write` scope.
    """
    from sqlalchemy import select
    from src.db.client import get_db_session
    from src.db.models.connections import Connection

    async with get_db_session() as session:
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        if connection.status not in {"active", "connected", "error"}:
            if connection.status == "pending_auth":
                raise HTTPException(
                    status_code=400,
                    detail="Connection requires authentication. Reconnect the source first.",
                )
            raise HTTPException(
                status_code=400,
                detail=f"Connection is not ready for backfill (status: {connection.status})",
            )

        organization_id = connection.organization_id

    _validate_org_id(ctx, organization_id)

    end_date = request.end_date
    if end_date and request.start_date >= end_date:
        raise HTTPException(
            status_code=400,
            detail="start_date must be before end_date",
        )

    window_days = request.window_days if "window_days" in request.model_fields_set else None
    throttle_seconds = request.throttle_seconds if "throttle_seconds" in request.model_fields_set else None

    from src.jobs.queue import EnqueueJobRequest, enqueue_job

    job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=organization_id,
            job_type="connector.backfill_plan",
            payload={
                "connection_id": connection_id,
                "organization_id": organization_id,
                "start_date": request.start_date.isoformat(),
                "end_date": end_date.isoformat() if end_date else None,
                "window_days": window_days,
                "streams": request.streams,
                "throttle_seconds": throttle_seconds,
            },
            priority=0,
            max_attempts=2,
            resource_key=f"connection:{connection_id}",
        )
    )

    return {
        "connection_id": connection_id,
        "backfill_jobs": [job_id],
        "status": "queued",
    }


@router.post("/{connection_id}/ingest/pause")
async def pause_ingest(
    connection_id: str,
    reason: str | None = Query(default=None, description="Optional operator reason"),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE_CONNECTIONS)),
):
    """Pause continuous ingest for a source connection."""
    from sqlalchemy import select

    from src.db.client import get_db_session
    from src.db.models.connections import Connection

    async with get_db_session() as session:
        connection = (
            await session.execute(select(Connection).where(Connection.id == connection_id))
        ).scalar_one_or_none()
        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")
        organization_id = str(connection.organization_id)
        _validate_org_id(ctx, organization_id)
        organization_id = str(connection.organization_id)

        config_payload = connection.config if isinstance(connection.config, dict) else {}
        ingest_control = config_payload.get("ingest_control")
        ingest_control = ingest_control if isinstance(ingest_control, dict) else {}
        config_payload["ingest_control"] = {
            **ingest_control,
            "manual_pause": True,
            "manual_pause_reason": reason or "Operator pause",
            "manual_pause_at": datetime.now(timezone.utc).isoformat(),
        }
        connection.config = config_payload
        connection.sync_enabled = False
        connection.status = "paused"
        connection.updated_at = datetime.utcnow()
        await session.commit()

    return {"connection_id": connection_id, "status": "paused"}


@router.post("/{connection_id}/ingest/resume")
async def resume_ingest(
    connection_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE_CONNECTIONS)),
):
    """Resume continuous ingest for a source connection."""
    from sqlalchemy import select

    from src.db.client import get_db_session
    from src.db.models.connections import Connection

    async with get_db_session() as session:
        connection = (
            await session.execute(select(Connection).where(Connection.id == connection_id))
        ).scalar_one_or_none()
        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")
        organization_id = str(connection.organization_id)
        _validate_org_id(ctx, organization_id)

        config_payload = connection.config if isinstance(connection.config, dict) else {}
        ingest_control = config_payload.get("ingest_control")
        ingest_control = ingest_control if isinstance(ingest_control, dict) else {}
        config_payload["ingest_control"] = {
            **ingest_control,
            "manual_pause": False,
            "manual_pause_reason": None,
            "quarantined_until": None,
            "failure_count": 0,
            "resumed_at": datetime.now(timezone.utc).isoformat(),
        }
        connection.config = config_payload
        connection.sync_enabled = True
        if connection.status == "paused":
            connection.status = "active"
        connection.updated_at = datetime.utcnow()
        await session.commit()

    return {"connection_id": connection_id, "status": "active"}


@router.post("/{connection_id}/ingest/replay")
async def replay_ingest(
    connection_id: str,
    request: ReplayRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE_CONNECTIONS)),
):
    """
    Replay source ingest from checkpoint.

    If `checkpoint_cursor` is supplied, it is persisted before enqueueing the replay sync.
    """
    from sqlalchemy import select

    from src.connectors.scheduling.checkpoints import apply_checkpoint_contract
    from src.db.client import get_db_session
    from src.db.models.connections import Connection, SyncState
    from src.jobs.queue import EnqueueJobRequest, enqueue_job

    async with get_db_session() as session:
        connection = (
            await session.execute(select(Connection).where(Connection.id == connection_id))
        ).scalar_one_or_none()
        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")
        organization_id = str(connection.organization_id)
        _validate_org_id(ctx, organization_id)

        if request.checkpoint_cursor is not None:
            target_streams = list(request.streams or connection.streams_config or [])
            if not target_streams:
                target_streams = ["events"]

            for stream_name in target_streams:
                checkpoint_cursor = apply_checkpoint_contract(
                    cursor_state=request.checkpoint_cursor,
                    run_id=f"operator-replay:{connection_id}",
                    run_kind="replay",
                    watermark=datetime.now(timezone.utc),
                    stream_name=str(stream_name),
                )
                sync_state = (
                    await session.execute(
                        select(SyncState).where(
                            SyncState.connection_id == connection.id,
                            SyncState.stream_name == str(stream_name),
                        )
                    )
                ).scalar_one_or_none()
                if sync_state:
                    sync_state.cursor_state = checkpoint_cursor
                    sync_state.status = "idle"
                    sync_state.error_message = None
                    sync_state.updated_at = datetime.utcnow()
                else:
                    session.add(
                        SyncState(
                            connection_id=connection.id,
                            stream_name=str(stream_name),
                            cursor_state=checkpoint_cursor,
                            status="idle",
                        )
                    )

        await session.commit()

    job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=organization_id,
            job_type="connector.sync",
            payload={
                "connection_id": connection_id,
                "organization_id": organization_id,
                "streams": request.streams,
                "full_refresh": bool(request.full_refresh),
                "scheduled": False,
                "sync_job_type": "replay",
                "sync_params": {
                    "operator_replay": True,
                    "checkpoint_override": request.checkpoint_cursor is not None,
                },
            },
            priority=2,
            max_attempts=3,
            resource_key=f"connection:{connection_id}",
        )
    )

    return {"connection_id": connection_id, "replay_job_id": job_id, "status": "queued"}


@router.get("/{connection_id}/ingest/runs")
async def list_ingest_runs(
    connection_id: str,
    limit: int = Query(50, ge=1, le=500),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """List source ingest run ledger entries for a connection."""
    from sqlalchemy import select

    from src.connectors.scheduling.run_ledger import list_source_sync_runs
    from src.db.client import get_db_session
    from src.db.models.connections import Connection

    async with get_db_session() as session:
        connection = (
            await session.execute(select(Connection).where(Connection.id == connection_id))
        ).scalar_one_or_none()
        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")
        _validate_org_id(ctx, str(connection.organization_id))

    runs = await list_source_sync_runs(connection_id=connection_id, limit=limit)
    return {"connection_id": connection_id, "runs": runs}


@router.get("/{connection_id}/sync/status", response_model=SyncStatusResponse)
async def get_sync_status(
    connection_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get current sync status for a connection.

    Requires `read` scope.
    """
    from sqlalchemy import select
    from src.db.client import get_db_session
    from src.db.models.connections import Connection, SyncJobHistory

    async with get_db_session() as session:
        # Get connection
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        # Get latest sync job
        result = await session.execute(
            select(SyncJobHistory)
            .where(SyncJobHistory.connection_id == connection_id)
            .order_by(SyncJobHistory.started_at.desc())
            .limit(1)
        )
        latest_job = result.scalar_one_or_none()

    status = "idle"
    current_sync_id = None
    progress = None

    if latest_job:
        if latest_job.status in ("pending", "running"):
            status = "running"
            current_sync_id = latest_job.id
        elif latest_job.status == "failed":
            status = "failed"

    return SyncStatusResponse(
        connection_id=connection_id,
        status=status,
        last_sync_at=connection.last_sync_at,
        current_sync_id=current_sync_id,
        progress=progress,
    )


@router.get("/{connection_id}/sync/history", response_model=list[SyncHistoryItem])
async def get_sync_history(
    connection_id: str,
    limit: int = Query(20, ge=1, le=100),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Get sync history for a connection.

    Requires `read` scope.
    """
    from sqlalchemy import select
    from src.db.client import get_db_session
    from src.db.models.connections import SyncJobHistory

    async with get_db_session() as session:
        result = await session.execute(
            select(SyncJobHistory)
            .where(SyncJobHistory.connection_id == connection_id)
            .order_by(SyncJobHistory.started_at.desc())
            .limit(limit)
        )
        jobs = result.scalars().all()

    return [
        SyncHistoryItem(
            id=job.id,
            status=job.status,
            started_at=job.started_at,
            completed_at=job.completed_at,
            records_synced=job.records_synced or 0,
            error_message=job.error_message,
        )
        for job in jobs
    ]


@router.get("/{connection_id}/health", response_model=ConnectionHealthResponse)
async def get_connection_health(
    connection_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """Return deterministic source health status and reasons."""
    from sqlalchemy import func, select

    from src.connectors.source_health import evaluate_source_health
    from src.db.client import get_db_session
    from src.db.models.background_jobs import BackgroundJob
    from src.db.models.connections import Connection, SyncJobHistory

    settings = get_settings()
    now = datetime.now(timezone.utc)
    # sync_job_history.started_at is currently queried as a naive timestamp in production.
    # Keep health window comparisons naive UTC to avoid asyncpg tz mismatch errors.
    failure_window_start = (
        now - timedelta(minutes=max(1, int(settings.connector_health_failure_window_minutes)))
    ).replace(tzinfo=None)

    async with get_db_session() as session:
        connection_result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = connection_result.scalar_one_or_none()
        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        _validate_org_id(ctx, str(connection.organization_id))

        failure_count = await session.scalar(
            select(func.count(SyncJobHistory.id))
            .where(SyncJobHistory.connection_id == connection.id)
            .where(SyncJobHistory.status == "failed")
            .where(SyncJobHistory.started_at >= failure_window_start)
        )

        recovering = await session.scalar(
            select(func.count(BackgroundJob.id))
            .where(BackgroundJob.job_type == "connector.sync")
            .where(BackgroundJob.status.in_(("queued", "running")))
            .where(BackgroundJob.idempotency_key.like("connector_auto_recovery:%"))
            .where(BackgroundJob.resource_key == f"connection:{connection_id}")
        )

    snapshot = evaluate_source_health(
        connection_id=str(connection.id),
        organization_id=str(connection.organization_id),
        connector_type=str(connection.connector_type),
        connection_status=str(connection.status),
        sync_enabled=bool(connection.sync_enabled),
        sync_frequency_minutes=int(connection.sync_frequency_minutes or 5),
        last_sync_at=connection.last_sync_at,
        last_sync_status=connection.last_sync_status,
        last_error=connection.last_sync_error,
        recent_failures=int(failure_count or 0),
        recovery_in_flight=bool(recovering),
        now=now,
        stale_multiplier=int(settings.connector_health_stale_multiplier),
        stale_floor_minutes=int(settings.connector_health_stale_floor_minutes),
        sync_slo_minutes=int(settings.connector_health_sync_slo_minutes),
        failure_threshold=int(settings.connector_health_error_failure_threshold),
    )
    return ConnectionHealthResponse(**snapshot.model_dump())


# =============================================================================
# STREAM CONFIGURATION
# =============================================================================


@router.get("/{connection_id}/streams")
async def discover_streams(
    connection_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Discover available streams for a connection.

    Requires `read` scope.
    """
    from sqlalchemy import select
    from src.db.client import get_db_session
    from src.db.models.connections import Connection
    from src.connectors.base.config import ConnectorConfig, AuthConfig

    async with get_db_session() as session:
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

    # Get connector instance
    connector_class = ConnectorRegistry._connectors.get(connection.connector_type)
    if not connector_class:
        raise HTTPException(status_code=400, detail="Unknown connector type")

    connector = connector_class()

    # Build config for discovery
    # Note: This would need to fetch actual tokens from token store
    config = ConnectorConfig(
        connection_id=connection_id,
        organization_id=connection.organization_id,
        connector_type=connection.connector_type,
        auth=AuthConfig(auth_type=AuthType.OAUTH2),
    )

    # Discover streams
    streams = await connector.discover_streams(config)

    return {
        "connection_id": connection_id,
        "streams": [
            {
                "name": s.stream_name,
                "enabled": s.enabled,
                "sync_mode": s.sync_mode.value,
                "cursor_field": s.cursor_field,
                "primary_key": s.primary_key,
            }
            for s in streams
        ],
    }


@router.put("/{connection_id}/streams/{stream_name}")
async def configure_stream(
    connection_id: str,
    stream_name: str,
    request: StreamConfigRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE_CONNECTIONS)),
):
    """
    Configure a specific stream for a connection.

    Requires `write:connections` scope.
    """
    from sqlalchemy import select
    from src.db.client import get_db_session
    from src.db.models.connections import Connection, SyncState

    async with get_db_session() as session:
        # Get connection
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        # Update enabled streams
        streams_config = set(connection.streams_config or [])
        if request.enabled:
            streams_config.add(stream_name)
        else:
            streams_config.discard(stream_name)
        connection.streams_config = list(streams_config)

        # Update or create sync state
        result = await session.execute(
            select(SyncState).where(
                SyncState.connection_id == connection_id,
                SyncState.stream_name == stream_name,
            )
        )
        sync_state = result.scalar_one_or_none()

        if sync_state:
            sync_state.state = {
                **sync_state.state,
                "sync_mode": request.sync_mode,
                "cursor_field": request.cursor_field,
            }
        else:
            sync_state = SyncState(
                connection_id=connection_id,
                stream_name=stream_name,
                state={
                    "sync_mode": request.sync_mode,
                    "cursor_field": request.cursor_field,
                },
            )
            session.add(sync_state)

        await session.commit()

    return {
        "connection_id": connection_id,
        "stream_name": stream_name,
        "enabled": request.enabled,
        "sync_mode": request.sync_mode,
    }


# =============================================================================
# CONNECTION HEALTH
# =============================================================================


@router.post("/{connection_id}/test")
async def test_connection(
    connection_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.READ)),
):
    """
    Test a connection to verify credentials are valid.

    Requires `read` scope.
    """
    from sqlalchemy import select
    from src.db.client import get_db_session
    from src.db.models.connections import Connection
    from src.connectors.base.config import ConnectorConfig, AuthConfig
    from src.connectors.auth.token_store import get_token_store

    async with get_db_session() as session:
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")
        _validate_org_id(ctx, str(connection.organization_id))

    # Get connector instance
    connector_class = ConnectorRegistry._connectors.get(connection.connector_type)
    if not connector_class:
        raise HTTPException(status_code=400, detail="Unknown connector type")

    connector = connector_class()

    # Get token
    token_store = await get_token_store()
    tokens = await token_store.get_tokens(
        connection_id=connection_id,
        organization_id=str(connection.organization_id),
    )

    if not tokens or tokens.is_expired:
        return {
            "connection_id": connection_id,
            "success": False,
            "error": "No valid token found. Please re-authenticate.",
        }

    # Build config
    config = ConnectorConfig(
        connection_id=connection_id,
        organization_id=str(connection.organization_id),
        connector_type=connection.connector_type,
        name=connection.name,
        auth=AuthConfig(
            auth_type=AuthType.OAUTH2,
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            token_expires_at=tokens.expires_at,
            scopes=tokens.scopes,
        ),
    )

    # Test connection
    success, error = await connector.check_connection(config)

    return {
        "connection_id": connection_id,
        "success": success,
        "error": error,
    }
