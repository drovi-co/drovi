"""
Admin App API Routes (admin.drovi.co)

This router is the operational surface for Drovi founders/operators. It is
intentionally separate from the pilot user surface:
- Email/password only
- Only allowed domains (default: @drovi.co)
- Admin tokens use a distinct JWT secret (cannot be replayed as pilot sessions)

The admin app can also call other existing admin-scoped endpoints (e.g. /jobs)
using the admin JWT via Authorization: Bearer <token>.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.auth.admin_accounts import (
    create_admin_jwt,
    validate_admin_email,
    validate_admin_password,
)
from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.db.client import get_db_session

logger = structlog.get_logger()

router = APIRouter(prefix="/admin", tags=["Admin"])

# Keep admin sessions shorter than pilot sessions.
ADMIN_COOKIE_NAME = "admin_session"
ADMIN_COOKIE_MAX_AGE = 60 * 60 * 12  # 12 hours
ADMIN_COOKIE_PATH = "/api/v1/admin"


def _set_admin_cookie(response: Response, token: str) -> None:
    """
    Set admin session cookie.

    NOTE: In production, this cookie should be scoped to `admin.drovi.co`.
    In local dev, different ports share cookies (localhost), so the admin app
    should primarily rely on Authorization headers (token returned in body).
    """
    # We keep the cookie present for convenience, but admin clients should also
    # store the token and send it via Authorization to avoid localhost port
    # collisions with the pilot app session cookie.
    #
    # IMPORTANT (localhost):
    # Cookies do not have a port concept. To allow being logged into the pilot
    # web app and the admin app simultaneously on localhost (different ports),
    # we scope the admin cookie to the admin API path and delete any legacy
    # cookie that was set with a wide "/" path.
    response.delete_cookie(key=ADMIN_COOKIE_NAME, path="/")
    response.set_cookie(
        key=ADMIN_COOKIE_NAME,
        value=token,
        max_age=ADMIN_COOKIE_MAX_AGE,
        httponly=True,
        secure=False,  # dev default; behind TLS in prod
        samesite="lax",
        path=ADMIN_COOKIE_PATH,
    )


def _clear_admin_cookie(response: Response) -> None:
    # Delete both the current scoped cookie and any legacy wide-path cookie.
    response.delete_cookie(key=ADMIN_COOKIE_NAME, path=ADMIN_COOKIE_PATH)
    response.delete_cookie(key=ADMIN_COOKIE_NAME, path="/")


class AdminLoginRequest(BaseModel):
    email: str
    password: str


class AdminLoginResponse(BaseModel):
    admin: dict[str, str]
    session_token: str
    expires_at: datetime


class AdminMeResponse(BaseModel):
    email: str
    subject: str
    scopes: list[str]
    expires_at: datetime | None = None


class KPIBlock(BaseModel):
    key: str
    label: str
    value: float
    unit: str | None = None
    delta_5m: float | None = None


class KPIsResponse(BaseModel):
    generated_at: datetime
    blocks: list[KPIBlock]
    breakdowns: dict[str, Any] = Field(default_factory=dict)


_KPI_CACHE_TTL_SECONDS = 30
_kpi_cache: dict[str, tuple[datetime, KPIsResponse]] = {}


@router.post("/login", response_model=AdminLoginResponse)
async def admin_login(request: AdminLoginRequest, response: Response) -> AdminLoginResponse:
    """
    Admin login (email/password).

    Only allowed domains (default: @drovi.co) may login.
    Returns an admin JWT; clients should store and use it as Bearer token.
    """
    email = request.email.strip().lower()
    if not validate_admin_email(email):
        raise HTTPException(status_code=403, detail="Admin access denied")

    if not validate_admin_password(request.password):
        # Avoid leaking whether the email is allowed.
        raise HTTPException(status_code=401, detail="Invalid credentials")

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=ADMIN_COOKIE_MAX_AGE)
    token = create_admin_jwt(email=email)

    _set_admin_cookie(response, token)

    return AdminLoginResponse(
        admin={"email": email},
        session_token=token,
        expires_at=expires_at,
    )


@router.post("/logout")
async def admin_logout(response: Response) -> dict[str, str]:
    _clear_admin_cookie(response)
    return {"status": "ok"}


@router.get("/me", response_model=AdminMeResponse)
async def admin_me(
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> AdminMeResponse:
    """
    Return admin identity.

    Requires admin scope via:
    - admin JWT (Authorization Bearer) OR
    - internal service token OR
    - API key with admin scope
    """
    # SECURITY: The admin app is for operators only. Pilot sessions may carry an
    # "admin" scope (org-level), but must never be treated as platform admin.
    if not ctx.is_internal and ctx.organization_id != "internal":
        raise HTTPException(status_code=403, detail="Admin access required")

    # ctx.key_id for admin JWT is "admin:<email>" (see auth middleware)
    email = None
    if ctx.key_id and ctx.key_id.startswith("admin:"):
        email = ctx.key_id.split("admin:", 1)[1]
    return AdminMeResponse(
        email=email or "admin",
        subject=ctx.key_id or "admin",
        scopes=ctx.scopes,
        expires_at=None,
    )


@router.get("/kpis", response_model=KPIsResponse)
async def admin_kpis(
    use_cache: bool = True,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> KPIsResponse:
    """
    KPI summary for the admin dashboard.

    This endpoint is intentionally "read-only" and safe to poll frequently.
    """
    # Enforce internal context for DB reads. Admin scope implies internal.
    if not ctx.is_internal and ctx.organization_id != "internal":
        raise HTTPException(status_code=403, detail="Admin access required")

    now = datetime.now(timezone.utc)
    cache_key = "global"
    if use_cache:
        cached = _kpi_cache.get(cache_key)
        if cached:
            cached_at, payload = cached
            if (now - cached_at).total_seconds() <= _KPI_CACHE_TTL_SECONDS:
                return payload

    since_24h = now - timedelta(hours=24)
    since_7d = now - timedelta(days=7)

    async with get_db_session() as session:
        org_count = int(
            (await session.execute(text("SELECT COUNT(*) FROM organizations"))).scalar()
            or 0
        )
        user_count = int(
            (await session.execute(text("SELECT COUNT(*) FROM users"))).scalar() or 0
        )
        active_users_7d = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM users
                        WHERE last_login_at IS NOT NULL
                          AND last_login_at >= :since
                        """
                    ),
                    {"since": since_7d},
                )
            ).scalar()
            or 0
        )
        connection_count = int(
            (await session.execute(text("SELECT COUNT(*) FROM connections"))).scalar()
            or 0
        )
        connections_by_type = await session.execute(
            text(
                """
                SELECT connector_type, COUNT(*) AS count
                FROM connections
                GROUP BY connector_type
                ORDER BY count DESC
                """
            )
        )
        connections_by_status = await session.execute(
            text(
                """
                SELECT status, COUNT(*) AS count
                FROM connections
                GROUP BY status
                ORDER BY count DESC
                """
            )
        )
        jobs_by_status = await session.execute(
            text(
                """
                SELECT status, COUNT(*) AS count
                FROM background_job
                GROUP BY status
                ORDER BY count DESC
                """
            )
        )
        queued_job_lag = float(
            (
                await session.execute(
                    text(
                        """
                        SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(run_at))), 0)
                        FROM background_job
                        WHERE status = 'queued'
                          AND run_at <= NOW()
                        """
                    )
                )
            ).scalar()
            or 0.0
        )
        ingested_24h = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM unified_event
                        WHERE received_at >= :since
                        """
                    ),
                    {"since": since_24h},
                )
            ).scalar()
            or 0
        )
        ingestion_freshness_s = float(
            (
                await session.execute(
                    text(
                        """
                        SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MAX(received_at))), 0)
                        FROM unified_event
                        """
                    )
                )
            ).scalar()
            or 0.0
        )
        backfill_total_7d = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM sync_job_history
                        WHERE created_at >= :since
                          AND job_type = 'backfill'
                          AND status IN ('completed', 'failed')
                        """
                    ),
                    {"since": since_7d},
                )
            ).scalar()
            or 0
        )
        backfill_completed_7d = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM sync_job_history
                        WHERE created_at >= :since
                          AND job_type = 'backfill'
                          AND status = 'completed'
                        """
                    ),
                    {"since": since_7d},
                )
            ).scalar()
            or 0
        )

    backfill_success_rate = (
        (backfill_completed_7d / backfill_total_7d) if backfill_total_7d else 1.0
    )

    # Prometheus HTTP request summary (since process start).
    http_total = 0.0
    http_5xx = 0.0
    top_5xx: dict[str, float] = {}
    try:
        from prometheus_client import REGISTRY

        for metric in REGISTRY.collect():
            if metric.name != "drovi_http_requests_total":
                continue
            for sample in metric.samples:
                labels = sample.labels or {}
                endpoint = labels.get("endpoint") or labels.get("path") or "unknown"
                status_code = labels.get("status_code") or "0"
                value = float(sample.value or 0)
                http_total += value
                try:
                    sc = int(status_code)
                except Exception:
                    sc = 0
                if sc >= 500:
                    http_5xx += value
                    top_5xx[endpoint] = top_5xx.get(endpoint, 0.0) + value
    except Exception as exc:
        logger.debug("Failed to collect Prometheus HTTP counters", error=str(exc))

    error_rate = (http_5xx / http_total) if http_total else 0.0
    top_5xx_sorted = sorted(top_5xx.items(), key=lambda kv: kv[1], reverse=True)[:10]

    blocks = [
        KPIBlock(key="orgs", label="Organizations", value=float(org_count)),
        KPIBlock(key="users", label="Users", value=float(user_count)),
        KPIBlock(key="active_7d", label="Active Users (7d)", value=float(active_users_7d)),
        KPIBlock(key="connections", label="Connections", value=float(connection_count)),
        KPIBlock(
            key="ingested_24h",
            label="Ingested Events (24h)",
            value=float(ingested_24h),
        ),
        KPIBlock(
            key="ingestion_freshness_s",
            label="Ingestion Freshness",
            value=float(ingestion_freshness_s),
            unit="seconds",
        ),
        KPIBlock(
            key="queued_job_lag_s",
            label="Job Queue Lag",
            value=float(queued_job_lag),
            unit="seconds",
        ),
        KPIBlock(
            key="backfill_success_7d",
            label="Backfill Success (7d)",
            value=float(backfill_success_rate),
            unit="ratio",
        ),
        KPIBlock(
            key="api_error_rate",
            label="API 5xx Rate (since start)",
            value=float(error_rate),
            unit="ratio",
        ),
    ]

    response_payload = KPIsResponse(
        generated_at=now,
        blocks=blocks,
        breakdowns={
            "connections_by_type": [
                {"connector_type": str(r.connector_type), "count": int(r.count)}
                for r in connections_by_type
            ],
            "connections_by_status": [
                {"status": str(r.status), "count": int(r.count)}
                for r in connections_by_status
            ],
            "jobs_by_status": [
                {"status": str(r.status), "count": int(r.count)} for r in jobs_by_status
            ],
            "top_5xx_endpoints": [
                {"endpoint": endpoint, "count": count} for endpoint, count in top_5xx_sorted
            ],
        },
    )
    if use_cache:
        _kpi_cache[cache_key] = (now, response_payload)
    return response_payload


class AdminOrgListItem(BaseModel):
    id: str
    name: str
    status: str
    region: str | None = None
    created_at: datetime | None = None
    expires_at: datetime | None = None
    member_count: int = 0
    connection_count: int = 0


class AdminOrgListResponse(BaseModel):
    organizations: list[AdminOrgListItem]


@router.get("/orgs", response_model=AdminOrgListResponse)
async def admin_list_orgs(
    q: str | None = None,
    limit: int = 100,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> AdminOrgListResponse:
    if not ctx.is_internal and ctx.organization_id != "internal":
        raise HTTPException(status_code=403, detail="Admin access required")

    limit = max(1, min(500, int(limit)))
    query = """
        SELECT
          o.id,
          o.name,
          o.pilot_status AS status,
          o.region,
          o.created_at,
          o.expires_at,
          (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) AS member_count,
          (SELECT COUNT(*) FROM connections c WHERE c.organization_id = o.id) AS connection_count
        FROM organizations o
        WHERE 1=1
    """
    params: dict[str, Any] = {"limit": limit}
    if q:
        query += " AND (o.id ILIKE :q OR o.name ILIKE :q)"
        params["q"] = f"%{q}%"
    query += " ORDER BY o.created_at DESC NULLS LAST LIMIT :limit"

    async with get_db_session() as session:
        result = await session.execute(text(query), params)
        items = [
            AdminOrgListItem(
                id=str(row.id),
                name=str(row.name),
                status=str(row.status),
                region=str(row.region) if row.region is not None else None,
                created_at=row.created_at,
                expires_at=row.expires_at,
                member_count=int(row.member_count or 0),
                connection_count=int(row.connection_count or 0),
            )
            for row in result.fetchall()
        ]

    return AdminOrgListResponse(organizations=items)


class AdminOrgMember(BaseModel):
    user_id: str
    email: str
    name: str | None = None
    role: str
    created_at: datetime | None = None


class AdminOrgConnection(BaseModel):
    id: str
    connector_type: str
    name: str
    status: str
    sync_enabled: bool
    last_sync_at: datetime | None = None
    created_at: datetime | None = None
    created_by_user_id: str | None = None
    visibility: str


class AdminOrgDetailResponse(BaseModel):
    id: str
    name: str
    status: str
    region: str | None = None
    allowed_domains: list[str] = Field(default_factory=list)
    notification_emails: list[str] = Field(default_factory=list)
    allowed_connectors: list[str] | None = None
    default_connection_visibility: str = "org_shared"
    created_at: datetime | None = None
    updated_at: datetime | None = None
    expires_at: datetime | None = None
    members: list[AdminOrgMember] = Field(default_factory=list)
    connections: list[AdminOrgConnection] = Field(default_factory=list)


@router.get("/orgs/{org_id}", response_model=AdminOrgDetailResponse)
async def admin_get_org(
    org_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> AdminOrgDetailResponse:
    if not ctx.is_internal and ctx.organization_id != "internal":
        raise HTTPException(status_code=403, detail="Admin access required")

    async with get_db_session() as session:
        org_result = await session.execute(
            text(
                """
                SELECT
                  id,
                  name,
                  pilot_status AS status,
                  region,
                  allowed_domains,
                  notification_emails,
                  allowed_connectors,
                  default_connection_visibility,
                  created_at,
                  updated_at,
                  expires_at
                FROM organizations
                WHERE id = :org_id
                """
            ),
            {"org_id": org_id},
        )
        org_row = org_result.fetchone()
        if not org_row:
            raise HTTPException(status_code=404, detail="Organization not found")

        members_result = await session.execute(
            text(
                """
                SELECT
                  m.user_id,
                  u.email,
                  u.name,
                  m.role,
                  m.created_at
                FROM memberships m
                JOIN users u ON u.id = m.user_id
                WHERE m.org_id = :org_id
                ORDER BY m.created_at DESC
                """
            ),
            {"org_id": org_id},
        )
        connections_result = await session.execute(
            text(
                """
                SELECT
                  id::text AS id,
                  connector_type,
                  name,
                  status,
                  sync_enabled,
                  last_sync_at,
                  created_at,
                  created_by_user_id,
                  visibility
                FROM connections
                WHERE organization_id = :org_id
                ORDER BY created_at DESC
                """
            ),
            {"org_id": org_id},
        )

        members = [
            AdminOrgMember(
                user_id=str(r.user_id),
                email=str(r.email),
                name=str(r.name) if r.name is not None else None,
                role=str(r.role),
                created_at=r.created_at,
            )
            for r in members_result.fetchall()
        ]
        connections = [
            AdminOrgConnection(
                id=str(r.id),
                connector_type=str(r.connector_type),
                name=str(r.name),
                status=str(r.status),
                sync_enabled=bool(r.sync_enabled),
                last_sync_at=r.last_sync_at,
                created_at=r.created_at,
                created_by_user_id=str(r.created_by_user_id)
                if r.created_by_user_id is not None
                else None,
                visibility=str(r.visibility or "org_shared"),
            )
            for r in connections_result.fetchall()
        ]

    return AdminOrgDetailResponse(
        id=str(org_row.id),
        name=str(org_row.name),
        status=str(org_row.status),
        region=str(org_row.region) if org_row.region is not None else None,
        allowed_domains=list(org_row.allowed_domains or []),
        notification_emails=list(org_row.notification_emails or []),
        allowed_connectors=list(org_row.allowed_connectors)
        if org_row.allowed_connectors is not None
        else None,
        default_connection_visibility=str(org_row.default_connection_visibility or "org_shared"),
        created_at=org_row.created_at,
        updated_at=getattr(org_row, "updated_at", None),
        expires_at=org_row.expires_at,
        members=members,
        connections=connections,
    )


class AdminUserListItem(BaseModel):
    id: str
    email: str
    name: str | None = None
    created_at: datetime | None = None
    last_login_at: datetime | None = None
    org_count: int = 0


class AdminUserListResponse(BaseModel):
    users: list[AdminUserListItem]


@router.get("/users", response_model=AdminUserListResponse)
async def admin_list_users(
    q: str | None = None,
    limit: int = 100,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> AdminUserListResponse:
    if not ctx.is_internal and ctx.organization_id != "internal":
        raise HTTPException(status_code=403, detail="Admin access required")

    limit = max(1, min(500, int(limit)))
    query = """
        SELECT
          u.id,
          u.email,
          u.name,
          u.created_at,
          u.last_login_at,
          (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) AS org_count
        FROM users u
        WHERE 1=1
    """
    params: dict[str, Any] = {"limit": limit}
    if q:
        query += " AND (u.email ILIKE :q OR u.id ILIKE :q)"
        params["q"] = f"%{q}%"
    query += " ORDER BY u.created_at DESC NULLS LAST LIMIT :limit"

    async with get_db_session() as session:
        result = await session.execute(text(query), params)
        items = [
            AdminUserListItem(
                id=str(row.id),
                email=str(row.email),
                name=str(row.name) if row.name is not None else None,
                created_at=row.created_at,
                last_login_at=row.last_login_at,
                org_count=int(row.org_count or 0),
            )
            for row in result.fetchall()
        ]

    return AdminUserListResponse(users=items)


class AdminUserMembership(BaseModel):
    org_id: str
    org_name: str
    role: str
    created_at: datetime | None = None


class AdminUserDetailResponse(BaseModel):
    id: str
    email: str
    name: str | None = None
    created_at: datetime | None = None
    last_login_at: datetime | None = None
    memberships: list[AdminUserMembership] = Field(default_factory=list)


@router.get("/users/{user_id}", response_model=AdminUserDetailResponse)
async def admin_get_user(
    user_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> AdminUserDetailResponse:
    if not ctx.is_internal and ctx.organization_id != "internal":
        raise HTTPException(status_code=403, detail="Admin access required")

    async with get_db_session() as session:
        user_result = await session.execute(
            text(
                """
                SELECT id, email, name, created_at, last_login_at
                FROM users
                WHERE id = :user_id
                """
            ),
            {"user_id": user_id},
        )
        user_row = user_result.fetchone()
        if not user_row:
            raise HTTPException(status_code=404, detail="User not found")

        memberships_result = await session.execute(
            text(
                """
                SELECT
                  m.org_id,
                  o.name AS org_name,
                  m.role,
                  m.created_at
                FROM memberships m
                JOIN organizations o ON o.id = m.org_id
                WHERE m.user_id = :user_id
                ORDER BY m.created_at DESC
                """
            ),
            {"user_id": user_id},
        )
        memberships = [
            AdminUserMembership(
                org_id=str(r.org_id),
                org_name=str(r.org_name),
                role=str(r.role),
                created_at=r.created_at,
            )
            for r in memberships_result.fetchall()
        ]

    return AdminUserDetailResponse(
        id=str(user_row.id),
        email=str(user_row.email),
        name=str(user_row.name) if user_row.name is not None else None,
        created_at=user_row.created_at,
        last_login_at=user_row.last_login_at,
        memberships=memberships,
    )


class GovernanceSignal(BaseModel):
    label: str
    value: str
    severity: str = "info"
    metadata: dict[str, Any] = Field(default_factory=dict)


class GovernanceOverviewResponse(BaseModel):
    generated_at: datetime
    blocks: list[KPIBlock]
    approvals_by_status: list[dict[str, Any]] = Field(default_factory=list)
    recent_signals: list[GovernanceSignal] = Field(default_factory=list)


@router.get("/governance/overview", response_model=GovernanceOverviewResponse)
async def admin_governance_overview(
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> GovernanceOverviewResponse:
    if not ctx.is_internal and ctx.organization_id != "internal":
        raise HTTPException(status_code=403, detail="Admin access required")

    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)
    since_1h = now - timedelta(hours=1)

    async with get_db_session() as session:
        principals_count = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM agent_service_principal
                        WHERE status = 'active'
                        """
                    )
                )
            ).scalar()
            or 0
        )
        authorities_count = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM agent_delegated_authority
                        WHERE revoked_at IS NULL
                          AND valid_from <= NOW()
                          AND (valid_to IS NULL OR valid_to > NOW())
                        """
                    )
                )
            ).scalar()
            or 0
        )
        kill_switch_orgs = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM agent_org_governance_policy
                        WHERE kill_switch_enabled = TRUE
                        """
                    )
                )
            ).scalar()
            or 0
        )
        pending_approvals = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM agent_action_approval
                        WHERE status = 'pending'
                        """
                    )
                )
            ).scalar()
            or 0
        )
        escalated_approvals = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM agent_action_approval
                        WHERE status = 'escalated'
                        """
                    )
                )
            ).scalar()
            or 0
        )
        denied_policy_decisions_24h = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM audit_log
                        WHERE action = 'agentos.policy.decision'
                          AND created_at >= :since_24h
                          AND COALESCE(metadata->>'action', '') = 'deny'
                        """
                    ),
                    {"since_24h": since_24h},
                )
            ).scalar()
            or 0
        )
        red_team_failures_24h = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM audit_log
                        WHERE action = 'agentos.policy.red_team_ran'
                          AND created_at >= :since_24h
                          AND COALESCE(metadata->>'passed', 'true') = 'false'
                        """
                    ),
                    {"since_24h": since_24h},
                )
            ).scalar()
            or 0
        )
        approvals_by_status_result = await session.execute(
            text(
                """
                SELECT status, COUNT(*) AS count
                FROM agent_action_approval
                GROUP BY status
                ORDER BY count DESC
                """
            )
        )
        approvals_by_status = [
            {"status": str(row.status), "count": int(row.count or 0)}
            for row in approvals_by_status_result.fetchall()
        ]
        recent_escalations = int(
            (
                await session.execute(
                    text(
                        """
                        SELECT COUNT(*)
                        FROM agent_action_approval_decision
                        WHERE decision = 'escalated'
                          AND decided_at >= :since_1h
                        """
                    ),
                    {"since_1h": since_1h},
                )
            ).scalar()
            or 0
        )

    blocks = [
        KPIBlock(
            key="service_principals",
            label="Active Service Principals",
            value=float(principals_count),
        ),
        KPIBlock(
            key="delegated_authorities",
            label="Active Delegated Authorities",
            value=float(authorities_count),
        ),
        KPIBlock(
            key="pending_approvals",
            label="Pending Approvals",
            value=float(pending_approvals),
        ),
        KPIBlock(
            key="escalated_approvals",
            label="Escalated Approvals",
            value=float(escalated_approvals),
        ),
        KPIBlock(
            key="kill_switch_orgs",
            label="Kill-Switch Orgs",
            value=float(kill_switch_orgs),
        ),
        KPIBlock(
            key="denied_decisions_24h",
            label="Denied Policy Decisions (24h)",
            value=float(denied_policy_decisions_24h),
        ),
    ]
    signals: list[GovernanceSignal] = []
    if kill_switch_orgs > 0:
        signals.append(
            GovernanceSignal(
                label="Kill switch active",
                value=f"{kill_switch_orgs} org(s)",
                severity="critical",
            )
        )
    if escalated_approvals > 0:
        signals.append(
            GovernanceSignal(
                label="Escalated approvals open",
                value=str(escalated_approvals),
                severity="warning",
            )
        )
    if red_team_failures_24h > 0:
        signals.append(
            GovernanceSignal(
                label="Red-team failures (24h)",
                value=str(red_team_failures_24h),
                severity="critical",
            )
        )
    signals.append(
        GovernanceSignal(
            label="Escalations in last hour",
            value=str(recent_escalations),
            severity="info" if recent_escalations == 0 else "warning",
        )
    )
    return GovernanceOverviewResponse(
        generated_at=now,
        blocks=blocks,
        approvals_by_status=approvals_by_status,
        recent_signals=signals,
    )
