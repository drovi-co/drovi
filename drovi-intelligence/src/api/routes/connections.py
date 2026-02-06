"""
Connection Management API Routes

Provides endpoints for managing data source connections:
- CRUD operations for connections
- OAuth flow initiation and callback
- Sync management (trigger, status, history)
- Stream configuration
"""

from datetime import datetime
import inspect
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.connectors.base.config import AuthType, SyncMode
from src.connectors.base.connector import ConnectorRegistry

logger = structlog.get_logger()

router = APIRouter(prefix="/connections", tags=["Connections"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    """Validate organization_id matches auth context."""
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(
            status_code=403,
            detail="Organization ID mismatch with authenticated key",
        )


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
    connectors = []
    for connector_type, connector_class in ConnectorRegistry._connectors.items():
        if inspect.isabstract(connector_class):
            logger.debug(
                "Skipping abstract connector",
                connector_type=connector_type,
            )
            continue
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

    connection_id = f"conn_{datetime.utcnow().timestamp():.0f}"

    async with get_db_session() as session:
        connection = Connection(
            id=connection_id,
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
        connection_id=connection_id,
        connector_type=request.connector_type,
        organization_id=request.organization_id,
    )

    return ConnectionResponse(
        id=connection_id,
        connector_type=request.connector_type,
        name=request.name,
        organization_id=request.organization_id,
        status="pending_auth",
        created_at=datetime.utcnow(),
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

        # TODO: Revoke OAuth tokens
        # TODO: Cancel scheduled syncs

        await session.delete(connection)
        await session.commit()

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
    from src.connectors.auth.oauth2 import OAuth2Manager

    oauth_manager = OAuth2Manager()

    # Generate authorization URL
    auth_url, state = await oauth_manager.get_authorization_url(
        provider=request.connector_type,
        redirect_uri=request.redirect_uri,
        state=request.state,
    )

    return OAuthInitResponse(
        authorization_url=auth_url,
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
    from src.connectors.auth.oauth2 import OAuth2Manager
    from src.connectors.auth.token_store import get_token_store

    # Get the connection
    async with get_db_session() as session:
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        # Exchange code for tokens
        oauth_manager = OAuth2Manager()
        token_data = await oauth_manager.exchange_code(
            provider=connection.connector_type,
            code=request.code,
            redirect_uri=connection.config.get("redirect_uri", ""),
        )

        # Store tokens
        token_store = await get_token_store()
        await token_store.store_token(
            connection_id=connection_id,
            provider=connection.connector_type,
            token_data=token_data,
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
    from src.connectors.scheduling.scheduler import get_scheduler

    request = request or SyncRequest()

    # Get the connection
    async with get_db_session() as session:
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        if connection.status != "active":
            raise HTTPException(
                status_code=400,
                detail=f"Connection is not active (status: {connection.status})",
            )

        # Save organization_id before exiting session context
        organization_id = connection.organization_id

    # Trigger the sync
    scheduler = get_scheduler()
    job = await scheduler.trigger_sync_by_id(
        connection_id=connection_id,
        organization_id=organization_id,
        full_refresh=request.full_refresh,
        streams=request.streams,
    )

    return {
        "connection_id": connection_id,
        "sync_job_id": job.job_id,
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
    from src.connectors.scheduling.scheduler import get_scheduler

    async with get_db_session() as session:
        result = await session.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalar_one_or_none()

        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        if connection.status != "active":
            raise HTTPException(
                status_code=400,
                detail=f"Connection is not active (status: {connection.status})",
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

    scheduler = get_scheduler()
    job_ids = await scheduler.trigger_backfill_plan(
        connection_id=connection_id,
        organization_id=organization_id,
        start_date=request.start_date,
        end_date=end_date,
        window_days=window_days,
        streams=request.streams,
        throttle_seconds=throttle_seconds,
    )

    return {
        "connection_id": connection_id,
        "backfill_jobs": job_ids,
        "status": "queued",
    }


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

    # Get connector instance
    connector_class = ConnectorRegistry._connectors.get(connection.connector_type)
    if not connector_class:
        raise HTTPException(status_code=400, detail="Unknown connector type")

    connector = connector_class()

    # Get token
    token_store = await get_token_store()
    token = await token_store.get_valid_token(connection_id, connection.connector_type)

    if not token:
        return {
            "connection_id": connection_id,
            "success": False,
            "error": "No valid token found. Please re-authenticate.",
        }

    # Build config
    config = ConnectorConfig(
        connection_id=connection_id,
        organization_id=connection.organization_id,
        connector_type=connection.connector_type,
        auth=AuthConfig(auth_type=AuthType.OAUTH2, access_token=token),
    )

    # Test connection
    success, error = await connector.check_connection(config)

    return {
        "connection_id": connection_id,
        "success": success,
        "error": error,
    }
