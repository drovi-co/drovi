"""
Organization Management API Routes (Enterprise Trust)

Provides org-level data management for enterprise pilots:
- GET /org/connections - Pilot-friendly connection listing
- POST /org/connections/{provider}/connect - Initiate OAuth with scoping
- DELETE /org/data - Full data deletion
- GET /org/export - Full data export
"""

import asyncio
import json
import secrets
from datetime import datetime, timezone
from typing import Any, Literal

import structlog
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse
from prometheus_client import Counter
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, text, or_

from sse_starlette.sse import EventSourceResponse

from src.auth.pilot_accounts import PilotToken, verify_jwt
from src.api.routes.auth import require_pilot_auth
from src.config import get_settings
from src.db.client import get_db_session
from src.connectors.sync_events import get_broadcaster, SyncEvent
from src.auth.pilot_accounts import (
    create_invite,
    get_invite,
    get_org_by_id,
    update_membership_role,
)
from src.db.models.pilot import Organization

logger = structlog.get_logger()

router = APIRouter(prefix="/org", tags=["Organization Management"])

# Prometheus metrics
data_deletion_total = Counter(
    "drovi_org_data_deletions_total",
    "Total org data deletion requests",
    ["organization_id", "status"],
)

data_export_total = Counter(
    "drovi_org_data_exports_total",
    "Total org data export requests",
    ["organization_id", "format"],
)


# =============================================================================
# AUTH HELPER
# =============================================================================


async def require_pilot_admin(session: str | None = Cookie(default=None)) -> PilotToken:
    """Require pilot admin authentication."""
    if not session:
        raise HTTPException(401, "Not authenticated")

    token = verify_jwt(session)
    if not token:
        raise HTTPException(401, "Invalid or expired session")

    if token.role not in ("pilot_owner", "pilot_admin"):
        raise HTTPException(403, "Admin access required")

    from src.db.rls import rls_context

    with rls_context(token.org_id, is_internal=False):
        yield token


# =============================================================================
# ORGANIZATION INFO
# =============================================================================


class OrgInfoResponse(BaseModel):
    """Organization information response."""

    id: str
    name: str
    status: str
    region: str | None = None
    allowed_domains: list[str] = []
    notification_emails: list[str] = []
    expires_at: datetime | None = None
    created_at: datetime | None = None
    member_count: int = 0
    connection_count: int = 0


class OrgUpdateRequest(BaseModel):
    """Update organization metadata."""

    name: str | None = None
    allowed_domains: list[str] | None = None
    notification_emails: list[str] | None = None
    region: str | None = None


class MemberInfo(BaseModel):
    id: str
    role: str
    name: str | None = None
    email: str
    created_at: datetime | None = None


class MembersResponse(BaseModel):
    members: list[MemberInfo]


class InviteCreateRequest(BaseModel):
    role: Literal["pilot_admin", "pilot_member", "pilot_viewer"] = "pilot_member"
    expires_in_days: int = Field(default=7, ge=1, le=30)
    email: str | None = None


class InviteInfo(BaseModel):
    token: str
    org_id: str
    role: str
    expires_at: datetime
    used_at: datetime | None = None
    created_at: datetime | None = None
    email: str | None = None


class InvitesResponse(BaseModel):
    invites: list[InviteInfo]


@router.get("/info", response_model=OrgInfoResponse)
async def get_org_info(
    token: PilotToken = Depends(require_pilot_auth),
) -> OrgInfoResponse:
    """
    Get organization information.

    Returns the organization metadata including name, status, and usage stats.

    **Requires**: Any pilot member
    """
    from src.auth.pilot_accounts import get_org_by_id

    org = await get_org_by_id(token.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Get member and connection counts
    async with get_db_session() as session:
        member_result = await session.execute(
            text("SELECT COUNT(*) FROM memberships WHERE org_id = :org_id"),
            {"org_id": token.org_id},
        )
        member_count = member_result.scalar() or 0

        connection_result = await session.execute(
            text("SELECT COUNT(*) FROM connections WHERE organization_id = :org_id"),
            {"org_id": token.org_id},
        )
        connection_count = connection_result.scalar() or 0

    return OrgInfoResponse(
        id=org["id"],
        name=org["name"],
        status=org.get("pilot_status", "active"),
        region=org.get("region"),
        allowed_domains=org.get("allowed_domains", []),
        notification_emails=org.get("notification_emails", []),
        expires_at=org.get("expires_at"),
        created_at=org.get("created_at"),
        member_count=member_count,
        connection_count=connection_count,
    )


@router.patch("/info", response_model=OrgInfoResponse)
async def update_org_info(
    request: OrgUpdateRequest,
    token: PilotToken = Depends(require_pilot_auth),
) -> OrgInfoResponse:
    """Update organization metadata (admin-only)."""
    if token.role not in ("pilot_owner", "pilot_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    async with get_db_session() as session:
        updates = {}
        if request.name is not None:
            updates["name"] = request.name
        if request.allowed_domains is not None:
            updates["allowed_domains"] = request.allowed_domains
        if request.notification_emails is not None:
            updates["notification_emails"] = request.notification_emails
        if request.region is not None:
            updates["region"] = request.region

        if updates:
            set_clause = ", ".join([f"{key} = :{key}" for key in updates])
            await session.execute(
                text(f"""
                    UPDATE organizations
                    SET {set_clause}, updated_at = NOW()
                    WHERE id = :org_id
                """),
                {"org_id": token.org_id, **updates},
            )
            await session.commit()

    org = await get_org_by_id(token.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    async with get_db_session() as session:
        member_result = await session.execute(
            text("SELECT COUNT(*) FROM memberships WHERE org_id = :org_id"),
            {"org_id": token.org_id},
        )
        member_count = member_result.scalar() or 0
        connection_result = await session.execute(
            text("SELECT COUNT(*) FROM connections WHERE organization_id = :org_id"),
            {"org_id": token.org_id},
        )
        connection_count = connection_result.scalar() or 0

    return OrgInfoResponse(
        id=org["id"],
        name=org["name"],
        status=org.get("pilot_status", "active"),
        region=org.get("region"),
        allowed_domains=org.get("allowed_domains", []),
        notification_emails=org.get("notification_emails", []),
        expires_at=org.get("expires_at"),
        created_at=org.get("created_at"),
        member_count=member_count,
        connection_count=connection_count,
    )


@router.get("/members", response_model=MembersResponse)
async def list_members(
    token: PilotToken = Depends(require_pilot_auth),
) -> MembersResponse:
    """List organization members."""
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT m.user_id, m.role, m.created_at, u.email, u.name
                FROM memberships m
                JOIN users u ON u.id = m.user_id
                WHERE m.org_id = :org_id
                ORDER BY m.created_at ASC
                """
            ),
            {"org_id": token.org_id},
        )
        rows = result.fetchall()

    members = [
        MemberInfo(
            id=row.user_id,
            role=row.role,
            name=row.name,
            email=row.email,
            created_at=row.created_at,
        )
        for row in rows
    ]
    return MembersResponse(members=members)


@router.patch("/members/{user_id}")
async def update_member_role(
    user_id: str,
    request: dict,
    token: PilotToken = Depends(require_pilot_auth),
) -> dict:
    """Update member role (admin-only)."""
    if token.role not in ("pilot_owner", "pilot_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    role = request.get("role")
    if role not in ("pilot_admin", "pilot_member", "pilot_viewer"):
        raise HTTPException(status_code=400, detail="Invalid role")

    updated = await update_membership_role(user_id, token.org_id, role)
    if not updated:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"updated": True}


@router.delete("/members/{user_id}")
async def remove_member(
    user_id: str,
    token: PilotToken = Depends(require_pilot_auth),
) -> dict:
    """Remove member from organization (admin-only)."""
    if token.role not in ("pilot_owner", "pilot_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                DELETE FROM memberships
                WHERE user_id = :user_id AND org_id = :org_id
                """
            ),
            {"user_id": user_id, "org_id": token.org_id},
        )
        await session.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Member not found")

    return {"removed": True}


@router.get("/invites", response_model=InvitesResponse)
async def list_invites(
    token: PilotToken = Depends(require_pilot_auth),
) -> InvitesResponse:
    """List active invites for the organization."""
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT token, org_id, role, expires_at, used_at, created_at, email
                FROM invites
                WHERE org_id = :org_id
                ORDER BY created_at DESC
                """
            ),
            {"org_id": token.org_id},
        )
        rows = result.fetchall()

    invites = [
        InviteInfo(
            token=row.token,
            org_id=row.org_id,
            role=row.role,
            expires_at=row.expires_at,
            used_at=row.used_at,
            created_at=row.created_at,
            email=getattr(row, "email", None),
        )
        for row in rows
    ]
    return InvitesResponse(invites=invites)


@router.post("/invites", response_model=InviteInfo)
async def create_invite_endpoint(
    request: InviteCreateRequest,
    token: PilotToken = Depends(require_pilot_auth),
) -> InviteInfo:
    """Create an invite token (admin-only)."""
    if token.role not in ("pilot_owner", "pilot_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    invite_token = await create_invite(
        org_id=token.org_id,
        role=request.role,
        expires_in_days=request.expires_in_days,
    )

    invite = await get_invite(invite_token)
    if not invite:
        raise HTTPException(status_code=500, detail="Failed to create invite")

    # Store email if column exists
    if request.email:
        async with get_db_session() as session:
            try:
                await session.execute(
                    text(
                        """
                        UPDATE invites
                        SET email = :email
                        WHERE token = :token
                        """
                    ),
                    {"email": request.email, "token": invite_token},
                )
                await session.commit()
            except Exception:
                # Column may not exist in older schemas; ignore
                await session.rollback()

    return InviteInfo(
        token=invite["token"],
        org_id=invite["org_id"],
        role=invite["role"],
        expires_at=invite["expires_at"],
        used_at=invite["used_at"],
        created_at=invite["created_at"],
        email=request.email,
    )


@router.delete("/invites/{invite_token}")
async def revoke_invite(
    invite_token: str,
    token: PilotToken = Depends(require_pilot_auth),
) -> dict:
    """Revoke an invite (admin-only)."""
    if token.role not in ("pilot_owner", "pilot_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                DELETE FROM invites
                WHERE token = :token AND org_id = :org_id
                """
            ),
            {"token": invite_token, "org_id": token.org_id},
        )
        await session.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Invite not found")

    return {"revoked": True}


# =============================================================================
# CONNECTIONS (Pilot-Friendly)
# =============================================================================


class PilotConnection(BaseModel):
    """Pilot-friendly connection response."""

    id: str
    provider: str
    email: str | None = None
    workspace: str | None = None
    status: str
    visibility: Literal["org_shared", "private"] = "org_shared"
    created_by_user_id: str | None = None
    created_by_email: str | None = None
    created_by_name: str | None = None
    live_status: str | None = None  # running | paused | error
    backfill_status: str | None = None  # not_started | running | paused | done | error
    scopes: list[str] = []
    last_sync: datetime | None = None
    last_error: str | None = None
    messages_synced: int = 0
    restricted_labels: list[str] = []
    restricted_channels: list[str] = []
    progress: float | None = None


class PilotConnectionsResponse(BaseModel):
    """List of pilot connections."""

    connections: list[PilotConnection]


class ConnectRequest(BaseModel):
    """Request to initiate connection OAuth."""

    redirect_uri: str
    visibility: Literal["org_shared", "private"] = Field(
        default="org_shared",
        description="Whether this source is shared across the org or private to the connector owner.",
    )
    restricted_labels: list[str] = Field(default_factory=list, description="Gmail: labels to exclude")
    restricted_channels: list[str] = Field(default_factory=list, description="Slack: channels to exclude")
    return_to: str | None = Field(
        default=None,
        description="Frontend path to redirect after successful connection",
    )


class ConnectResponse(BaseModel):
    """OAuth initiation response."""

    auth_url: str
    state: str
    code_verifier: str  # For PKCE, store client-side


@router.get("/connections", response_model=PilotConnectionsResponse)
async def get_pilot_connections(
    token: PilotToken = Depends(require_pilot_auth),
) -> PilotConnectionsResponse:
    """
    Get all connections for the pilot organization.

    Returns a pilot-friendly format with sync status.

    **Requires**: Any pilot member
    """
    from src.db.models.background_jobs import BackgroundJob
    from src.db.models.connections import Connection, SyncJobHistory, SyncState
    from src.db.models.pilot import User

    async with get_db_session() as session:
        is_admin = token.role in ("pilot_owner", "pilot_admin")
        query = (
            select(
                Connection,
                User.email,
                User.name,
            )
            .outerjoin(User, User.id == Connection.created_by_user_id)
            .where(Connection.organization_id == token.org_id)
        )
        if not is_admin:
            query = query.where(
                or_(
                    Connection.visibility != "private",
                    Connection.created_by_user_id == token.sub,
                )
            )

        result = await session.execute(query)
        rows = result.all()
        connections = [row[0] for row in rows]
        owners_by_connection_id: dict[str, dict[str, str | None]] = {}
        for conn, owner_email, owner_name in rows:
            owners_by_connection_id[str(conn.id)] = {
                "email": owner_email,
                "name": owner_name,
            }

        # Compute total records synced per connection by summing sync_state counters.
        # This avoids expensive evidence row counts and works even when evidence retention
        # policies prune raw items over time.
        messages_by_connection: dict[str, int] = {}
        if connections:
            sync_result = await session.execute(
                select(
                    SyncState.connection_id,
                    func.sum(SyncState.records_synced),
                )
                .where(SyncState.connection_id.in_([c.id for c in connections]))
                .group_by(SyncState.connection_id)
            )
            for connection_id, records_synced in sync_result.all():
                messages_by_connection[str(connection_id)] = int(records_synced or 0)

        # Latest backfill execution per connection (if any).
        backfill_last_status: dict[str, str] = {}
        if connections:
            history_result = await session.execute(
                select(
                    SyncJobHistory.connection_id,
                    SyncJobHistory.status,
                    SyncJobHistory.started_at,
                )
                .where(SyncJobHistory.connection_id.in_([c.id for c in connections]))
                .where(SyncJobHistory.job_type == "backfill")
                .order_by(SyncJobHistory.connection_id, SyncJobHistory.started_at.desc())
            )
            for connection_id, status, _started_at in history_result.all():
                key = str(connection_id)
                if key in backfill_last_status:
                    continue
                backfill_last_status[key] = status

        # Running/queued backfill plans in the durable job queue.
        backfill_running: set[str] = set()
        jobs_result = await session.execute(
            select(BackgroundJob.resource_key)
            .where(BackgroundJob.organization_id == token.org_id)
            .where(BackgroundJob.job_type == "connector.backfill_plan")
            .where(BackgroundJob.status.in_(["queued", "running"]))
        )
        for (resource_key,) in jobs_result.all():
            if not resource_key:
                continue
            if not str(resource_key).startswith("connection:"):
                continue
            backfill_running.add(str(resource_key).split("connection:", 1)[1])

        pilot_connections: list[PilotConnection] = []
        for conn in connections:
            config = conn.config or {}
            owner = owners_by_connection_id.get(str(conn.id), {})

            # Determine provider-specific fields
            email = None
            workspace = None
            restricted_labels: list[str] = []
            restricted_channels: list[str] = []

            if conn.connector_type == "gmail":
                email = config.get("email")
                restricted_labels = config.get("restricted_labels", [])
            elif conn.connector_type == "slack":
                workspace = config.get("workspace")
                restricted_channels = config.get("restricted_channels", [])

            messages_synced = messages_by_connection.get(str(conn.id), 0)

            # Map status
            status = "connected" if conn.status == "active" else conn.status
            live_status = (
                "paused"
                if not conn.sync_enabled
                else ("error" if conn.status == "error" else "running")
            )

            backfill_status = "not_started"
            if not conn.backfill_enabled:
                backfill_status = "paused"
            elif str(conn.id) in backfill_running:
                backfill_status = "running"
            else:
                last_backfill = backfill_last_status.get(str(conn.id))
                if last_backfill == "failed":
                    backfill_status = "error"
                elif last_backfill == "completed":
                    backfill_status = "done"

            pilot_connections.append(
                PilotConnection(
                    id=str(conn.id),
                    provider=conn.connector_type,
                    email=email,
                    workspace=workspace,
                    status=status,
                    visibility=(conn.visibility or "org_shared"),
                    created_by_user_id=conn.created_by_user_id,
                    created_by_email=owner.get("email"),
                    created_by_name=owner.get("name"),
                    live_status=live_status,
                    backfill_status=backfill_status,
                    scopes=config.get("scopes", []),
                    last_sync=conn.last_sync_at,
                    last_error=conn.last_sync_error,
                    messages_synced=messages_synced,
                    restricted_labels=restricted_labels,
                    restricted_channels=restricted_channels,
                    progress=config.get("sync_progress"),
                )
            )

        return PilotConnectionsResponse(connections=pilot_connections)


async def _require_connection_access(
    session,
    connection_id: str,
    token: PilotToken,
    action: str,
):
    """
    Enforce source visibility boundaries for connection-scoped actions.

    - Admins can access all sources.
    - Members/viewers can access org-shared sources.
    - Members/viewers can access private sources only if they connected them.
    """
    from src.db.models.connections import Connection

    conn_result = await session.execute(
        select(Connection).where(
            Connection.id == connection_id,
            Connection.organization_id == token.org_id,
        )
    )
    connection = conn_result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    if token.role in ("pilot_owner", "pilot_admin"):
        return connection

    if connection.visibility != "private":
        return connection

    if connection.created_by_user_id == token.sub:
        return connection

    raise HTTPException(
        status_code=403,
        detail=f"Access denied: this source is private (action={action})",
    )


class PilotConnectionStreamState(BaseModel):
    """Per-stream cursor/state for a connection."""

    stream_name: str
    status: str
    cursor_state: dict[str, Any]
    records_synced: int
    bytes_synced: int
    last_sync_started_at: datetime | None = None
    last_sync_completed_at: datetime | None = None
    updated_at: datetime | None = None
    error_message: str | None = None


class PilotConnectionStateResponse(BaseModel):
    connection_id: str
    streams: list[PilotConnectionStreamState]


@router.get("/connections/{connection_id}/state", response_model=PilotConnectionStateResponse)
async def get_connection_state(
    connection_id: str,
    token: PilotToken = Depends(require_pilot_auth),
) -> PilotConnectionStateResponse:
    """
    Get per-stream cursor/watermark state for a connection.

    **Requires**: Any pilot member
    """
    from src.db.models.connections import Connection, SyncState

    async with get_db_session() as session:
        connection = await _require_connection_access(
            session,
            connection_id,
            token,
            action="view_state",
        )

        state_result = await session.execute(
            select(SyncState)
            .where(SyncState.connection_id == connection.id)
            .order_by(SyncState.stream_name.asc())
        )
        states = state_result.scalars().all()

    streams = [
        PilotConnectionStreamState(
            stream_name=s.stream_name,
            status=s.status,
            cursor_state=s.cursor_state or {},
            records_synced=int(s.records_synced or 0),
            bytes_synced=int(s.bytes_synced or 0),
            last_sync_started_at=s.last_sync_started_at,
            last_sync_completed_at=s.last_sync_completed_at,
            updated_at=s.updated_at,
            error_message=s.error_message,
        )
        for s in states
    ]

    return PilotConnectionStateResponse(
        connection_id=str(connection.id),
        streams=streams,
    )


class PilotConnectionJobHistoryItem(BaseModel):
    id: str
    job_type: str
    status: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_seconds: int | None = None
    records_synced: int = 0
    bytes_synced: int = 0
    streams: list[str] = []
    streams_completed: list[str] = []
    streams_failed: list[str] = []
    error_message: str | None = None
    extra_data: dict[str, Any] = Field(default_factory=dict)


class PilotConnectionHistoryResponse(BaseModel):
    connection_id: str
    jobs: list[PilotConnectionJobHistoryItem]


@router.get("/connections/{connection_id}/history", response_model=PilotConnectionHistoryResponse)
async def get_connection_history(
    connection_id: str,
    limit: int = Query(50, ge=1, le=200),
    job_type: str | None = Query(None, description="Filter by job type (scheduled|on_demand|backfill|webhook)"),
    token: PilotToken = Depends(require_pilot_auth),
) -> PilotConnectionHistoryResponse:
    """
    Get sync job history for a connection (most recent first).

    **Requires**: Any pilot member
    """
    from src.db.models.connections import Connection, SyncJobHistory

    async with get_db_session() as session:
        connection = await _require_connection_access(
            session,
            connection_id,
            token,
            action="view_history",
        )

        query = (
            select(SyncJobHistory)
            .where(SyncJobHistory.connection_id == connection.id)
            .order_by(SyncJobHistory.started_at.desc().nullslast(), SyncJobHistory.created_at.desc())
            .limit(limit)
        )
        if job_type:
            query = query.where(SyncJobHistory.job_type == job_type)

        result = await session.execute(query)
        rows = result.scalars().all()

    jobs = [
        PilotConnectionJobHistoryItem(
            id=str(row.id),
            job_type=row.job_type,
            status=row.status,
            started_at=row.started_at,
            completed_at=row.completed_at,
            duration_seconds=row.duration_seconds,
            records_synced=int(row.records_synced or 0),
            bytes_synced=int(row.bytes_synced or 0),
            streams=list(row.streams or []),
            streams_completed=list(row.streams_completed or []),
            streams_failed=list(row.streams_failed or []),
            error_message=row.error_message,
            extra_data=row.extra_data or {},
        )
        for row in rows
    ]

    return PilotConnectionHistoryResponse(
        connection_id=str(connection.id),
        jobs=jobs,
    )


@router.get("/connections/events")
async def stream_sync_events(
    token: PilotToken = Depends(require_pilot_auth),
):
    """
    Stream real-time sync events via Server-Sent Events (SSE).

    Events include:
    - started: Sync job started
    - progress: Sync progress update (records synced)
    - completed: Sync finished successfully
    - failed: Sync failed with error

    **Requires**: Any pilot member
    """
    async def event_generator():
        broadcaster = get_broadcaster()
        is_admin = token.role in ("pilot_owner", "pilot_admin")

        # Privacy boundary: do not leak sync events for private sources to other users.
        allowed_connection_ids: set[str] = set()
        if not is_admin:
            from src.db.models.connections import Connection

            async with get_db_session() as session:
                result = await session.execute(
                    select(Connection.id).where(
                        Connection.organization_id == token.org_id,
                        or_(
                            Connection.visibility != "private",
                            Connection.created_by_user_id == token.sub,
                        ),
                    )
                )
                allowed_connection_ids = {str(row[0]) for row in result.all()}

        # Send initial connection event
        yield {
            "event": "connected",
            "data": json.dumps({"organization_id": token.org_id}),
        }

        # Subscribe to sync events
        async for event in broadcaster.subscribe(token.org_id):
            if not is_admin and event.connection_id not in allowed_connection_ids:
                # Connection might have been created while SSE is open. Resolve once.
                from src.db.models.connections import Connection

                async with get_db_session() as session:
                    res = await session.execute(
                        select(Connection).where(
                            Connection.id == event.connection_id,
                            Connection.organization_id == token.org_id,
                        )
                    )
                    connection = res.scalar_one_or_none()
                    if not connection:
                        continue
                    if connection.visibility == "private" and connection.created_by_user_id != token.sub:
                        continue
                    allowed_connection_ids.add(str(connection.id))

            yield {
                "event": event.event_type,
                "data": event.model_dump_json(),
            }

    return EventSourceResponse(event_generator())


# All supported OAuth providers
SUPPORTED_PROVIDERS = Literal[
    "gmail", "slack", "outlook", "teams", "notion",
    "whatsapp", "google_docs", "hubspot", "google_calendar"
]


@router.post("/connections/{provider}/connect", response_model=ConnectResponse)
async def connect_provider(
    provider: SUPPORTED_PROVIDERS,
    request: ConnectRequest,
    token: PilotToken = Depends(require_pilot_auth),
) -> ConnectResponse:
    """
    Initiate OAuth flow for a data source with PKCE.

    **Supported Providers:**
    - gmail: Google Workspace email
    - slack: Slack workspace
    - outlook: Microsoft Outlook email
    - teams: Microsoft Teams messages
    - notion: Notion pages and databases
    - whatsapp: WhatsApp Business messages
    - google_docs: Google Docs and Drive files
    - hubspot: HubSpot CRM contacts and deals
    - google_calendar: Google Calendar events

    **PKCE Flow:**
    1. Store the returned code_verifier client-side
    2. Redirect user to auth_url
    3. On callback, exchange code with code_verifier

    **Requires**: Any pilot member
    """
    if token.role == "pilot_viewer":
        raise HTTPException(status_code=403, detail="Viewer role cannot connect sources")

    import hashlib
    from base64 import urlsafe_b64encode
    from urllib.parse import urlencode

    settings = get_settings()
    from src.connectors.connector_requirements import get_missing_env_for_connector

    missing_env = get_missing_env_for_connector(provider, settings)
    if missing_env:
        raise HTTPException(
            status_code=400,
            detail=f"Connector '{provider}' is not configured. Missing: {', '.join(missing_env)}",
        )

    # Generate PKCE parameters
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).decode().rstrip("=")
    state = secrets.token_urlsafe(32)

    # Store state in Redis for validation
    import redis.asyncio as redis

    redis_client = redis.from_url(str(settings.redis_url))
    await redis_client.setex(
        f"oauth_state:{state}",
        600,  # 10 minute expiry
        json.dumps({
            "code_verifier": code_verifier,
            "redirect_uri": request.redirect_uri,
            "provider": provider,
            "org_id": token.org_id,
            "created_by_user_id": token.sub,
            "visibility": request.visibility,
            "restricted_labels": request.restricted_labels,
            "restricted_channels": request.restricted_channels,
            "return_to": request.return_to,
        }),
    )
    await redis_client.aclose()

    # Build authorization URL based on provider
    auth_url = _build_oauth_url(provider, settings, request.redirect_uri, state, code_challenge)

    logger.info(
        "OAuth flow initiated",
        provider=provider,
        org_id=token.org_id,
        state=state[:8] + "...",
        redirect_uri=request.redirect_uri,
    )

    return ConnectResponse(
        auth_url=auth_url,
        state=state,
        code_verifier=code_verifier,
    )


def _build_oauth_url(
    provider: str,
    settings: Any,
    redirect_uri: str,
    state: str,
    code_challenge: str,
) -> str:
    """Build OAuth authorization URL for the given provider."""
    from urllib.parse import urlencode

    def _require(value: str | None, label: str) -> None:
        if not value:
            raise HTTPException(
                status_code=400,
                detail=f"OAuth not configured for {provider}. Missing {label}.",
            )

    # Google-based providers (Gmail, Docs, Calendar)
    if provider == "gmail":
        _require(settings.google_client_id, "GOOGLE_CLIENT_ID")
        _require(settings.google_client_secret, "GOOGLE_CLIENT_SECRET")
        params = {
            "client_id": settings.google_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "access_type": "offline",
            "prompt": "consent",
        }
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"

    if provider == "google_docs":
        _require(settings.google_client_id, "GOOGLE_CLIENT_ID")
        _require(settings.google_client_secret, "GOOGLE_CLIENT_SECRET")
        params = {
            "client_id": settings.google_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join([
                "https://www.googleapis.com/auth/drive.readonly",
                "https://www.googleapis.com/auth/documents.readonly",
                "https://www.googleapis.com/auth/userinfo.email",
            ]),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "access_type": "offline",
            "prompt": "consent",
        }
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"

    if provider == "google_calendar":
        _require(settings.google_client_id, "GOOGLE_CLIENT_ID")
        _require(settings.google_client_secret, "GOOGLE_CLIENT_SECRET")
        params = {
            "client_id": settings.google_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join([
                "https://www.googleapis.com/auth/calendar.readonly",
                "https://www.googleapis.com/auth/userinfo.email",
            ]),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "access_type": "offline",
            "prompt": "consent",
        }
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"

    # Slack
    if provider == "slack":
        _require(settings.slack_client_id, "SLACK_CLIENT_ID")
        _require(settings.slack_client_secret, "SLACK_CLIENT_SECRET")
        params = {
            "client_id": settings.slack_client_id,
            "redirect_uri": redirect_uri,
            "scope": "channels:history,channels:read,users:read,groups:history,groups:read,im:history,mpim:history",
            "state": state,
        }
        return f"https://slack.com/oauth/v2/authorize?{urlencode(params)}"

    # Microsoft-based providers (Outlook, Teams)
    if provider in ("outlook", "teams"):
        _require(settings.microsoft_client_id, "MICROSOFT_CLIENT_ID")
        _require(settings.microsoft_client_secret, "MICROSOFT_CLIENT_SECRET")
        scopes = {
            "outlook": "offline_access User.Read Mail.Read",
            "teams": "offline_access User.Read ChannelMessage.Read.All Chat.Read",
        }
        params = {
            "client_id": settings.microsoft_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": scopes[provider],
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        tenant = settings.microsoft_tenant_id or "common"
        return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?{urlencode(params)}"

    # Notion
    if provider == "notion":
        _require(settings.notion_client_id, "NOTION_CLIENT_ID")
        _require(settings.notion_client_secret, "NOTION_CLIENT_SECRET")
        params = {
            "client_id": settings.notion_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": state,
            "owner": "user",
        }
        return f"https://api.notion.com/v1/oauth/authorize?{urlencode(params)}"

    # HubSpot
    if provider == "hubspot":
        _require(settings.hubspot_client_id, "HUBSPOT_CLIENT_ID")
        _require(settings.hubspot_client_secret, "HUBSPOT_CLIENT_SECRET")
        params = {
            "client_id": settings.hubspot_client_id,
            "redirect_uri": redirect_uri,
            "scope": "crm.objects.contacts.read crm.objects.companies.read crm.objects.deals.read",
            "state": state,
        }
        return f"https://app.hubspot.com/oauth/authorize?{urlencode(params)}"

    # WhatsApp Business (via Meta)
    if provider == "whatsapp":
        _require(settings.meta_app_id, "META_APP_ID")
        _require(settings.meta_app_secret, "META_APP_SECRET")
        params = {
            "client_id": settings.meta_app_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "whatsapp_business_messaging,whatsapp_business_management",
            "state": state,
        }
        return f"https://www.facebook.com/v18.0/dialog/oauth?{urlencode(params)}"

    raise HTTPException(400, f"Unsupported provider: {provider}")


class SyncTriggerRequest(BaseModel):
    """Request to trigger a sync."""

    full_refresh: bool = False
    streams: list[str] = Field(default_factory=list)


class BackfillRequest(BaseModel):
    """Request to trigger a backfill."""

    start_date: datetime = Field(..., description="Backfill start date (ISO 8601)")
    end_date: datetime | None = Field(
        default=None,
        description="Backfill end date (ISO 8601). Defaults to now.",
    )
    window_days: int = Field(default=7, ge=1, le=90, description="Window size in days")
    streams: list[str] = Field(
        default_factory=list,
        description="Specific streams to backfill. If empty, backfill all enabled streams.",
    )
    throttle_seconds: float = Field(
        default=1.0,
        ge=0.0,
        le=30.0,
        description="Delay between backfill windows to respect rate limits",
    )


class SyncTriggerResponse(BaseModel):
    """Sync trigger response."""

    connection_id: str
    status: str
    message: str


class BackfillResponse(BaseModel):
    """Backfill trigger response."""

    connection_id: str
    status: str
    backfill_jobs: list[str]


@router.post("/connections/{connection_id}/sync", response_model=SyncTriggerResponse)
async def trigger_connection_sync(
    connection_id: str,
    request: SyncTriggerRequest | None = None,
    token: PilotToken = Depends(require_pilot_auth),
) -> SyncTriggerResponse:
    """
    Trigger a sync for a connection.

    **Requires**: Any pilot member
    """
    from src.db.models.connections import Connection

    request = request or SyncTriggerRequest()

    # Verify connection belongs to org
    async with get_db_session() as session:
        if token.role == "pilot_viewer":
            raise HTTPException(status_code=403, detail="Viewer role cannot trigger sync")

        connection = await _require_connection_access(
            session,
            connection_id,
            token,
            action="sync",
        )

        if connection.status not in ("active", "connected"):
            raise HTTPException(
                status_code=400,
                detail=f"Connection is not ready for sync (status: {connection.status})",
            )

    # Enqueue durable sync job (executed by jobs worker)
    try:
        from src.jobs.queue import EnqueueJobRequest, enqueue_job

        job_id = await enqueue_job(
            EnqueueJobRequest(
                organization_id=token.org_id,
                job_type="connector.sync",
                payload={
                    "connection_id": str(connection.id),
                    "organization_id": token.org_id,
                    "streams": request.streams if request.streams else None,
                    "full_refresh": request.full_refresh,
                    "scheduled": False,
                },
                priority=1,
                max_attempts=3,
                resource_key=f"connection:{connection_id}",
            )
        )

        logger.info(
            "Sync enqueued",
            job_id=job_id,
            connection_id=connection_id,
            org_id=token.org_id,
            full_refresh=request.full_refresh,
        )

        return SyncTriggerResponse(
            connection_id=str(connection.id),
            status="queued",
            message=f"Sync job {job_id} queued",
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Failed to trigger sync", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to trigger sync: {str(e)}")


@router.post("/connections/{connection_id}/backfill", response_model=BackfillResponse)
async def trigger_connection_backfill(
    connection_id: str,
    request: BackfillRequest,
    token: PilotToken = Depends(require_pilot_auth),
) -> BackfillResponse:
    """
    Trigger a windowed backfill for a connection.

    **Requires**: Any pilot member
    """
    from src.db.models.connections import Connection

    async with get_db_session() as session:
        if token.role == "pilot_viewer":
            raise HTTPException(status_code=403, detail="Viewer role cannot trigger backfill")

        connection = await _require_connection_access(
            session,
            connection_id,
            token,
            action="backfill",
        )

        if connection.status not in ("active", "connected"):
            raise HTTPException(
                status_code=400,
                detail=f"Connection is not ready for backfill (status: {connection.status})",
            )

    end_date = request.end_date
    if end_date and request.start_date >= end_date:
        raise HTTPException(
            status_code=400,
            detail="start_date must be before end_date",
        )

    from src.jobs.queue import EnqueueJobRequest, enqueue_job

    job_id = await enqueue_job(
        EnqueueJobRequest(
            organization_id=token.org_id,
            job_type="connector.backfill_plan",
            payload={
                "connection_id": str(connection.id),
                "organization_id": token.org_id,
                "start_date": request.start_date.isoformat(),
                "end_date": end_date.isoformat() if end_date else None,
                "window_days": request.window_days,
                "streams": request.streams if request.streams else None,
                "throttle_seconds": request.throttle_seconds,
            },
            priority=0,
            max_attempts=2,
            resource_key=f"connection:{connection_id}",
        )
    )

    return BackfillResponse(
        connection_id=connection_id,
        status="queued",
        backfill_jobs=[job_id],
    )


@router.delete("/connections/{connection_id}")
async def delete_connection(
    connection_id: str,
    token: PilotToken = Depends(require_pilot_auth),
) -> dict:
    """
    Delete a connection.

    Removes the connection and revokes any OAuth tokens.

    **Requires**: Any pilot member
    """
    from src.db.models.connections import Connection

    async with get_db_session() as session:
        if token.role == "pilot_viewer":
            raise HTTPException(status_code=403, detail="Viewer role cannot delete connections")

        connection = await _require_connection_access(
            session,
            connection_id,
            token,
            action="delete",
        )

        # Delete the connection
        await session.delete(connection)
        await session.commit()

    logger.info(
        "Connection deleted",
        connection_id=connection_id,
        org_id=token.org_id,
    )

    try:
        from src.audit.log import record_audit_event

        await record_audit_event(
            organization_id=token.org_id,
            action="connection.deleted",
            actor_type="user",
            actor_id=token.sub,
            resource_type="connection",
            resource_id=str(connection_id),
            metadata={},
        )
    except Exception as audit_error:
        logger.warning(
            "Failed to record audit event for connection deletion",
            connection_id=connection_id,
            error=str(audit_error),
        )

    return {"deleted": True, "connection_id": connection_id}


class ConnectionVisibilityRequest(BaseModel):
    visibility: Literal["org_shared", "private"]


@router.patch("/connections/{connection_id}/visibility")
async def update_connection_visibility(
    connection_id: str,
    request: ConnectionVisibilityRequest,
    token: PilotToken = Depends(require_pilot_auth),
) -> dict:
    """
    Update a connection's visibility (org_shared vs private).

    Rules:
    - OWNER/ADMIN can change any connection.
    - MEMBER can only change connections they created.
    - VIEWER cannot change visibility.
    """
    if token.role == "pilot_viewer":
        raise HTTPException(status_code=403, detail="Viewer role cannot change source visibility")

    from src.audit.log import record_audit_event
    from src.db.models.connections import Connection

    async with get_db_session() as session:
        result = await session.execute(
            select(Connection).where(
                Connection.id == connection_id,
                Connection.organization_id == token.org_id,
            )
        )
        connection = result.scalar_one_or_none()
        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        is_admin = token.role in ("pilot_owner", "pilot_admin")
        is_owner = connection.created_by_user_id == token.sub
        if not is_admin and not is_owner:
            raise HTTPException(status_code=403, detail="Only the connector owner can change this source")

        previous = connection.visibility
        connection.visibility = request.visibility
        await session.commit()

    await record_audit_event(
        organization_id=token.org_id,
        action="connection.visibility_changed",
        actor_type="user",
        actor_id=token.sub,
        resource_type="connection",
        resource_id=str(connection_id),
        metadata={
            "previous_visibility": previous,
            "new_visibility": request.visibility,
        },
    )

    return {"updated": True, "connection_id": connection_id, "visibility": request.visibility}


# =============================================================================
# DATA DELETION (Enterprise Trust)
# =============================================================================


class DeleteDataRequest(BaseModel):
    """Request to delete all org data."""

    confirm: str = Field(
        ...,
        description="Must be 'DELETE ALL DATA FOR {org_id}' to confirm",
    )
    reason: str = Field(..., description="Reason for deletion")


class DeleteDataResponse(BaseModel):
    """Data deletion response."""

    status: Literal["scheduled", "completed", "failed"]
    deletion_job_id: str
    estimated_completion: datetime
    items_to_delete: dict[str, int]


async def _delete_org_data_background(org_id: str, job_id: str) -> None:
    """Background task to delete all org data."""
    logger.info("Starting org data deletion", org_id=org_id, job_id=job_id)

    try:
        async with get_db_session() as session:
            # Delete UIOs
            await session.execute(
                text("DELETE FROM uios WHERE organization_id = :org_id"),
                {"org_id": org_id},
            )

            # Delete evidence
            await session.execute(
                text("DELETE FROM evidence WHERE organization_id = :org_id"),
                {"org_id": org_id},
            )

            # Delete connections (and revoke tokens)
            await session.execute(
                text("DELETE FROM connections WHERE organization_id = :org_id"),
                {"org_id": org_id},
            )

            # Delete sync state
            await session.execute(
                text("""
                    DELETE FROM sync_state
                    WHERE connection_id IN (
                        SELECT id FROM connections WHERE organization_id = :org_id
                    )
                """),
                {"org_id": org_id},
            )

            # Mark org as ended
            await session.execute(
                text("""
                    UPDATE organizations
                    SET pilot_status = 'ended', updated_at = NOW()
                    WHERE id = :org_id
                """),
                {"org_id": org_id},
            )

            await session.commit()

        # Delete graph nodes
        try:
            from src.graph.client import get_graph_client

            graph = await get_graph_client()
            await graph.query(
                f"MATCH (n {{organizationId: '{org_id}'}}) DETACH DELETE n"
            )
        except Exception as e:
            logger.warning("Graph deletion failed", org_id=org_id, error=str(e))

        # Update job status in Redis
        settings = get_settings()
        import redis.asyncio as redis

        redis_client = redis.from_url(str(settings.redis_url))
        await redis_client.setex(
            f"deletion_job:{job_id}",
            86400,  # 24 hour expiry
            json.dumps({"status": "completed", "completed_at": datetime.now(timezone.utc).isoformat()}),
        )
        await redis_client.aclose()

        data_deletion_total.labels(organization_id=org_id, status="completed").inc()
        logger.info("Org data deletion completed", org_id=org_id, job_id=job_id)

    except Exception as e:
        data_deletion_total.labels(organization_id=org_id, status="failed").inc()
        logger.error("Org data deletion failed", org_id=org_id, job_id=job_id, error=str(e))


@router.delete("/data", response_model=DeleteDataResponse)
async def delete_org_data(
    request: DeleteDataRequest,
    background_tasks: BackgroundTasks,
    token: PilotToken = Depends(require_pilot_admin),
) -> DeleteDataResponse:
    """
    Delete all data for the pilot organization.

    **Required for enterprise pilots.** This endpoint:
    1. Revokes all OAuth tokens
    2. Deletes all UIOs, evidence, and connections
    3. Removes all graph nodes for the org
    4. Marks the pilot as ended

    **Confirmation Required:**
    The `confirm` field must be exactly: `DELETE ALL DATA FOR {org_id}`

    **Requires**: pilot_admin role
    """
    expected_confirm = f"DELETE ALL DATA FOR {token.org_id}"
    if request.confirm != expected_confirm:
        raise HTTPException(
            400,
            f"Confirmation text must be exactly: '{expected_confirm}'",
        )

    # Count items to delete
    async with get_db_session() as session:
        uio_count = await session.execute(
            text("SELECT COUNT(*) FROM uios WHERE organization_id = :org_id"),
            {"org_id": token.org_id},
        )
        evidence_count = await session.execute(
            text("SELECT COUNT(*) FROM evidence WHERE organization_id = :org_id"),
            {"org_id": token.org_id},
        )
        connections_count = await session.execute(
            text("SELECT COUNT(*) FROM connections WHERE organization_id = :org_id"),
            {"org_id": token.org_id},
        )

        items_to_delete = {
            "uios": uio_count.scalar() or 0,
            "evidence": evidence_count.scalar() or 0,
            "connections": connections_count.scalar() or 0,
        }

    # Create deletion job
    job_id = f"del_{secrets.token_hex(8)}"
    estimated_completion = datetime.now(timezone.utc)

    # Store job status in Redis
    settings = get_settings()
    import redis.asyncio as redis

    redis_client = redis.from_url(str(settings.redis_url))
    await redis_client.setex(
        f"deletion_job:{job_id}",
        86400,  # 24 hour expiry
        json.dumps({
            "status": "scheduled",
            "org_id": token.org_id,
            "reason": request.reason,
            "items_to_delete": items_to_delete,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }),
    )
    await redis_client.aclose()

    # Schedule background deletion
    background_tasks.add_task(_delete_org_data_background, token.org_id, job_id)

    logger.info(
        "Org data deletion scheduled",
        org_id=token.org_id,
        job_id=job_id,
        items=items_to_delete,
        reason=request.reason,
    )

    return DeleteDataResponse(
        status="scheduled",
        deletion_job_id=job_id,
        estimated_completion=estimated_completion,
        items_to_delete=items_to_delete,
    )


# =============================================================================
# DATA EXPORT (Enterprise Trust)
# =============================================================================


class ExportRequest(BaseModel):
    """Export request parameters."""

    format: Literal["json", "csv", "neo4j"] = Field(default="json")
    include: list[str] = Field(
        default=["uios", "evidence", "graph", "connections"],
        description="What to include in export",
    )


class ExportResponse(BaseModel):
    """Export job response."""

    export_job_id: str
    status: Literal["processing", "completed", "failed"]
    progress: float
    download_url: str | None = None
    expires_at: datetime


@router.post("/export", response_model=ExportResponse)
async def export_org_data(
    request: ExportRequest,
    background_tasks: BackgroundTasks,
    token: PilotToken = Depends(require_pilot_admin),
) -> ExportResponse:
    """
    Export all data for the pilot organization.

    **Export Formats:**
    - json: Full JSON export of all data
    - csv: CSV files for each data type
    - neo4j: Cypher dump for graph data

    **Include Options:**
    - uios: Commitments, decisions, risks, tasks
    - evidence: Source evidence and citations
    - graph: Knowledge graph nodes and relationships
    - connections: Connection configurations (tokens excluded)
    - audit_log: Activity audit log

    The export is processed asynchronously. Poll the job status
    to get the download URL when complete.

    **Requires**: pilot_admin role
    """
    job_id = f"exp_{secrets.token_hex(8)}"
    expires_at = datetime.now(timezone.utc)

    # Store job status
    settings = get_settings()
    import redis.asyncio as redis

    redis_client = redis.from_url(str(settings.redis_url))
    await redis_client.setex(
        f"export_job:{job_id}",
        86400,  # 24 hour expiry
        json.dumps({
            "status": "processing",
            "org_id": token.org_id,
            "format": request.format,
            "include": request.include,
            "progress": 0.0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }),
    )
    await redis_client.aclose()

    # Schedule background export
    background_tasks.add_task(
        _export_org_data_background,
        token.org_id,
        job_id,
        request.format,
        request.include,
    )

    data_export_total.labels(organization_id=token.org_id, format=request.format).inc()

    logger.info(
        "Org data export started",
        org_id=token.org_id,
        job_id=job_id,
        format=request.format,
        include=request.include,
    )

    return ExportResponse(
        export_job_id=job_id,
        status="processing",
        progress=0.0,
        download_url=None,
        expires_at=expires_at,
    )


@router.get("/export/{job_id}", response_model=ExportResponse)
async def get_export_status(
    job_id: str,
    token: PilotToken = Depends(require_pilot_admin),
) -> ExportResponse:
    """
    Get export job status.

    **Requires**: pilot_admin role
    """
    settings = get_settings()
    import redis.asyncio as redis

    redis_client = redis.from_url(str(settings.redis_url))
    job_data = await redis_client.get(f"export_job:{job_id}")
    await redis_client.aclose()

    if not job_data:
        raise HTTPException(404, "Export job not found")

    job = json.loads(job_data)

    if job.get("org_id") != token.org_id:
        raise HTTPException(403, "Access denied")

    return ExportResponse(
        export_job_id=job_id,
        status=job.get("status", "processing"),
        progress=job.get("progress", 0.0),
        download_url=job.get("download_url"),
        expires_at=datetime.fromisoformat(job.get("expires_at", datetime.now(timezone.utc).isoformat())),
    )


async def _export_org_data_background(
    org_id: str,
    job_id: str,
    export_format: str,
    include: list[str],
) -> None:
    """Background task to export org data."""
    logger.info("Starting org data export", org_id=org_id, job_id=job_id)
    settings = get_settings()

    try:
        import redis.asyncio as redis

        redis_client = redis.from_url(str(settings.redis_url))

        export_data: dict[str, Any] = {
            "organization_id": org_id,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "format": export_format,
        }

        progress = 0.0
        step = 1.0 / len(include)

        async with get_db_session() as session:
            # Export UIOs
            if "uios" in include:
                result = await session.execute(
                    text("SELECT * FROM uios WHERE organization_id = :org_id"),
                    {"org_id": org_id},
                )
                rows = result.fetchall()
                export_data["uios"] = [dict(row._mapping) for row in rows]
                progress += step
                await _update_export_progress(redis_client, job_id, progress)

            # Export evidence
            if "evidence" in include:
                result = await session.execute(
                    text("SELECT * FROM evidence WHERE organization_id = :org_id"),
                    {"org_id": org_id},
                )
                rows = result.fetchall()
                export_data["evidence"] = [dict(row._mapping) for row in rows]
                progress += step
                await _update_export_progress(redis_client, job_id, progress)

            # Export connections (excluding tokens)
            if "connections" in include:
                result = await session.execute(
                    text("""
                        SELECT id, connector_type, name, organization_id, status,
                               created_at, last_sync_at, config
                        FROM connections WHERE organization_id = :org_id
                    """),
                    {"org_id": org_id},
                )
                rows = result.fetchall()
                export_data["connections"] = [dict(row._mapping) for row in rows]
                progress += step
                await _update_export_progress(redis_client, job_id, progress)

            # Export graph
            if "graph" in include:
                try:
                    from src.graph.client import get_graph_client

                    graph = await get_graph_client()

                    if export_format == "neo4j":
                        # Return Cypher dump
                        nodes_result = await graph.query(
                            f"MATCH (n {{organizationId: '{org_id}'}}) RETURN n"
                        )
                        edges_result = await graph.query(
                            f"MATCH (a {{organizationId: '{org_id}'}})-[r]->(b) RETURN a, r, b"
                        )
                        export_data["graph"] = {
                            "nodes": [r[0] for r in nodes_result.result_set] if nodes_result.result_set else [],
                            "relationships": [
                                {"from": r[0], "rel": r[1], "to": r[2]}
                                for r in (edges_result.result_set or [])
                            ],
                        }
                    else:
                        # Return JSON representation
                        nodes_result = await graph.query(
                            f"MATCH (n {{organizationId: '{org_id}'}}) RETURN n"
                        )
                        export_data["graph"] = {
                            "nodes": [r[0] for r in nodes_result.result_set] if nodes_result.result_set else [],
                        }
                except Exception as e:
                    logger.warning("Graph export failed", error=str(e))
                    export_data["graph"] = {"error": str(e)}

                progress += step
                await _update_export_progress(redis_client, job_id, progress)

        # Generate download URL (in production, upload to S3/GCS)
        # For now, store in Redis with expiry
        export_json = json.dumps(export_data, default=str)
        export_key = f"export_data:{job_id}"
        await redis_client.setex(export_key, 86400, export_json)

        # Update job as completed
        download_url = f"/api/v1/org/export/{job_id}/download"
        expires_at = datetime.now(timezone.utc)

        await redis_client.setex(
            f"export_job:{job_id}",
            86400,
            json.dumps({
                "status": "completed",
                "org_id": org_id,
                "format": export_format,
                "include": include,
                "progress": 1.0,
                "download_url": download_url,
                "expires_at": expires_at.isoformat(),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }),
        )

        await redis_client.aclose()
        logger.info("Org data export completed", org_id=org_id, job_id=job_id)

    except Exception as e:
        logger.error("Org data export failed", org_id=org_id, job_id=job_id, error=str(e))


async def _update_export_progress(redis_client: Any, job_id: str, progress: float) -> None:
    """Update export job progress."""
    job_data = await redis_client.get(f"export_job:{job_id}")
    if job_data:
        job = json.loads(job_data)
        job["progress"] = progress
        await redis_client.setex(f"export_job:{job_id}", 86400, json.dumps(job))


@router.get("/export/{job_id}/download")
async def download_export(
    job_id: str,
    token: PilotToken = Depends(require_pilot_admin),
) -> StreamingResponse:
    """
    Download completed export.

    **Requires**: pilot_admin role
    """
    settings = get_settings()
    import redis.asyncio as redis

    redis_client = redis.from_url(str(settings.redis_url))

    # Verify job exists and is complete
    job_data = await redis_client.get(f"export_job:{job_id}")
    if not job_data:
        await redis_client.aclose()
        raise HTTPException(404, "Export job not found")

    job = json.loads(job_data)
    if job.get("org_id") != token.org_id:
        await redis_client.aclose()
        raise HTTPException(403, "Access denied")

    if job.get("status") != "completed":
        await redis_client.aclose()
        raise HTTPException(400, "Export not yet complete")

    # Get export data
    export_data = await redis_client.get(f"export_data:{job_id}")
    await redis_client.aclose()

    if not export_data:
        raise HTTPException(404, "Export data expired or not found")

    # Return as downloadable JSON
    return StreamingResponse(
        iter([export_data]),
        media_type="application/json",
        headers={
            "Content-Disposition": f"attachment; filename=drovi_export_{job_id}.json",
        },
    )
