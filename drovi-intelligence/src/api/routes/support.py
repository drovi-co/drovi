"""Support tickets API (Phase 5).

This is operational support tooling:
- Pilot users can create tickets from the web app (with diagnostics attached).
- Drovi admins can triage and respond from the admin app.
- Inbound email can create/append tickets (support@drovi.co -> webhook).
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import structlog
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.audit.log import record_audit_event
from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.config import get_settings
from src.db.client import get_db_session
from src.db.rls import rls_context
from src.notifications.resend import send_resend_email
from src.notifications.support_tickets import (
    render_ticket_created_email,
    render_ticket_reply_email,
)

logger = structlog.get_logger()

router = APIRouter(prefix="/support", tags=["Support"])

TICKET_ID_RE = re.compile(r"\[(?P<ticket_id>tkt_[a-z0-9_-]{6,64})\]", re.IGNORECASE)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _new_ticket_id() -> str:
    return f"tkt_{uuid4().hex[:12]}"


def _parse_session_user_id(ctx: APIKeyContext) -> str | None:
    if not ctx.key_id:
        return None
    if ctx.key_id.startswith("session:"):
        return ctx.key_id.split("session:", 1)[1]
    return None


def _parse_admin_email(ctx: APIKeyContext) -> str | None:
    if not ctx.key_id:
        return None
    if ctx.key_id.startswith("admin:"):
        return ctx.key_id.split("admin:", 1)[1]
    return None


async def _get_user_email(user_id: str) -> str | None:
    async with get_db_session() as session:
        result = await session.execute(
            text("SELECT email FROM users WHERE id = :user_id LIMIT 1"),
            {"user_id": user_id},
        )
        row = result.fetchone()
        if not row:
            return None
        return str(getattr(row, "email", None) or row[0])


async def _get_org_for_domain(domain: str) -> str | None:
    async with get_db_session() as session:
        result = await session.execute(
            text(
                """
                SELECT id
                FROM organizations
                WHERE :domain = ANY(allowed_domains)
                ORDER BY created_at DESC NULLS LAST
                LIMIT 1
                """
            ),
            {"domain": domain},
        )
        row = result.fetchone()
        if not row:
            return None
        return str(getattr(row, "id", None) or row[0])


async def _get_ticket_org(ticket_id: str) -> str | None:
    async with get_db_session() as session:
        result = await session.execute(
            text("SELECT organization_id FROM support_ticket WHERE id = :id LIMIT 1"),
            {"id": ticket_id},
        )
        row = result.fetchone()
        if not row:
            return None
        return str(getattr(row, "organization_id", None) or row[0])


class CreateTicketRequest(BaseModel):
    subject: str = Field(..., min_length=3, max_length=200)
    message: str = Field(..., min_length=1, max_length=20000)
    message_html: str | None = Field(default=None, max_length=200000)
    route: str | None = Field(default=None, max_length=500)
    locale: str | None = Field(default=None, max_length=20)
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class CreateTicketResponse(BaseModel):
    ticket_id: str
    status: str
    created_at: datetime


class TicketListItem(BaseModel):
    id: str
    organization_id: str
    subject: str
    status: str
    priority: str
    created_by_email: str
    assignee_email: str | None = None
    created_via: str
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime

    message_count: int = 0
    last_message_preview: str | None = None


class ListTicketsResponse(BaseModel):
    tickets: list[TicketListItem]


class TicketMessageItem(BaseModel):
    id: str
    direction: str
    visibility: str
    author_type: str
    author_email: str | None = None
    body_text: str
    body_html: str | None = None
    created_at: datetime


class TicketDetailResponse(BaseModel):
    ticket: TicketListItem
    messages: list[TicketMessageItem]


class UpdateTicketRequest(BaseModel):
    status: str | None = Field(default=None, description="open|pending|closed")
    priority: str | None = Field(default=None, description="low|normal|high")
    assignee_email: str | None = Field(default=None)


class AddMessageRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=20000)
    message_html: str | None = Field(default=None, max_length=200000)
    visibility: str = Field(default="external", description="external|internal")
    locale: str | None = Field(default=None, max_length=20)


class InboundEmailRequest(BaseModel):
    from_email: str = Field(..., alias="from")
    to_emails: list[str] | None = Field(default=None, alias="to")
    subject: str = Field(default="", max_length=500)
    text: str | None = None
    html: str | None = None
    headers: dict[str, Any] | None = None
    raw: dict[str, Any] = Field(default_factory=dict)


@router.post("/tickets", response_model=CreateTicketResponse, status_code=201)
async def create_ticket(
    request: CreateTicketRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.WRITE)),
) -> CreateTicketResponse:
    """Create a support ticket (web app)."""
    if ctx.organization_id == "internal":
        raise HTTPException(status_code=403, detail="Tickets must be created from a pilot session")

    now = _utc_now()
    ticket_id = _new_ticket_id()

    user_id = _parse_session_user_id(ctx)
    created_by_email = None
    if user_id:
        created_by_email = await _get_user_email(user_id)

    if not created_by_email:
        # Fallback: not ideal, but keeps tickets usable for API key contexts.
        created_by_email = "unknown@unknown"

    diagnostics = dict(request.diagnostics or {})
    if request.route:
        diagnostics.setdefault("route", request.route)

    # Persist ticket + initial message.
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO support_ticket (
                    id, organization_id, created_by_user_id, created_by_email,
                    subject, status, priority, assignee_email, created_via,
                    metadata, created_at, updated_at, last_message_at, closed_at
                ) VALUES (
                    :id, :org_id, :user_id, :email,
                    :subject, 'open', 'normal', NULL, 'web',
                    CAST(:metadata AS JSONB), :created_at, :updated_at, :last_message_at, NULL
                )
                """
            ),
            {
                "id": ticket_id,
                "org_id": ctx.organization_id,
                "user_id": user_id,
                "email": created_by_email,
                "subject": request.subject.strip(),
                "metadata": json.dumps({"diagnostics": diagnostics}),
                "created_at": now,
                "updated_at": now,
                "last_message_at": now,
            },
        )

        message_id = uuid4()
        await session.execute(
            text(
                """
                INSERT INTO support_ticket_message (
                    id, ticket_id, organization_id,
                    direction, visibility,
                    author_type, author_email, author_user_id,
                    subject, body_text, body_html, raw_payload,
                    created_at
                ) VALUES (
                    :id, :ticket_id, :org_id,
                    'inbound', 'external',
                    'user', :author_email, :author_user_id,
                    :subject, :body_text, :body_html, CAST(:raw_payload AS JSONB),
                    :created_at
                )
                """
            ),
            {
                "id": message_id,
                "ticket_id": ticket_id,
                "org_id": ctx.organization_id,
                "author_email": created_by_email,
                "author_user_id": user_id,
                "subject": request.subject.strip(),
                "body_text": request.message.strip(),
                "body_html": request.message_html,
                "raw_payload": json.dumps({"diagnostics": diagnostics}),
                "created_at": now,
            },
        )

    await record_audit_event(
        organization_id=ctx.organization_id,
        action="support.ticket.created",
        actor_type="user",
        actor_id=user_id,
        resource_type="support_ticket",
        resource_id=ticket_id,
        metadata={"subject": request.subject.strip()},
    )

    # Outbound confirmation email (best-effort).
    try:
        rendered = render_ticket_created_email(
            ticket_id=ticket_id,
            title=request.subject.strip(),
            locale=request.locale,
        )
        await send_resend_email(
            to_emails=[created_by_email],
            subject=rendered.subject,
            html_body=rendered.html,
            text_body=rendered.text,
            tags={"type": "support_ticket_created", "ticket_id": ticket_id},
        )
    except Exception as exc:
        logger.warning("support_ticket_confirmation_email_failed", error=str(exc))

    return CreateTicketResponse(ticket_id=ticket_id, status="open", created_at=now)


@router.get("/tickets", response_model=ListTicketsResponse)
async def list_tickets(
    q: str | None = Query(None, description="Search subject/email/org"),
    status: str | None = Query(None, description="open|pending|closed"),
    limit: int = Query(100, ge=1, le=500),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> ListTicketsResponse:
    """List tickets (admin app)."""
    if not ctx.is_internal and ctx.organization_id != "internal":
        raise HTTPException(status_code=403, detail="Admin access required")

    where = ["1=1"]
    params: dict[str, Any] = {"limit": int(limit)}
    if status:
        where.append("t.status = :status")
        params["status"] = status
    if q:
        where.append(
            "(t.subject ILIKE :q OR t.created_by_email ILIKE :q OR t.organization_id ILIKE :q)"
        )
        params["q"] = f"%{q}%"

    query = f"""
        SELECT
          t.id,
          t.organization_id,
          t.subject,
          t.status,
          t.priority,
          t.created_by_email,
          t.assignee_email,
          t.created_via,
          t.created_at,
          t.updated_at,
          t.last_message_at,
          (SELECT COUNT(*) FROM support_ticket_message m WHERE m.ticket_id = t.id) AS message_count,
          (
            SELECT LEFT(m2.body_text, 180)
            FROM support_ticket_message m2
            WHERE m2.ticket_id = t.id
            ORDER BY m2.created_at DESC
            LIMIT 1
          ) AS last_message_preview
        FROM support_ticket t
        WHERE {" AND ".join(where)}
        ORDER BY t.updated_at DESC
        LIMIT :limit
    """

    async with get_db_session() as session:
        result = await session.execute(text(query), params)
        rows = result.fetchall()

    tickets = [
        TicketListItem(
            id=str(r.id),
            organization_id=str(r.organization_id),
            subject=str(r.subject),
            status=str(r.status),
            priority=str(r.priority),
            created_by_email=str(r.created_by_email),
            assignee_email=str(r.assignee_email) if r.assignee_email is not None else None,
            created_via=str(r.created_via),
            created_at=r.created_at,
            updated_at=r.updated_at,
            last_message_at=r.last_message_at,
            message_count=int(r.message_count or 0),
            last_message_preview=str(r.last_message_preview) if r.last_message_preview is not None else None,
        )
        for r in rows
    ]
    return ListTicketsResponse(tickets=tickets)


@router.get("/tickets/{ticket_id}", response_model=TicketDetailResponse)
async def get_ticket(
    ticket_id: str,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> TicketDetailResponse:
    """Ticket detail (admin app)."""
    if not ctx.is_internal and ctx.organization_id != "internal":
        raise HTTPException(status_code=403, detail="Admin access required")

    async with get_db_session() as session:
        ticket_row = await session.execute(
            text(
                """
                SELECT
                  id,
                  organization_id,
                  subject,
                  status,
                  priority,
                  created_by_email,
                  assignee_email,
                  created_via,
                  created_at,
                  updated_at,
                  last_message_at,
                  (SELECT COUNT(*) FROM support_ticket_message m WHERE m.ticket_id = support_ticket.id) AS message_count,
                  NULL::text AS last_message_preview
                FROM support_ticket
                WHERE id = :id
                LIMIT 1
                """
            ),
            {"id": ticket_id},
        )
        ticket = ticket_row.fetchone()
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")

        messages_result = await session.execute(
            text(
                """
                SELECT
                  id::text AS id,
                  direction,
                  visibility,
                  author_type,
                  author_email,
                  body_text,
                  body_html,
                  created_at
                FROM support_ticket_message
                WHERE ticket_id = :id
                ORDER BY created_at ASC
                LIMIT 500
                """
            ),
            {"id": ticket_id},
        )
        messages_rows = messages_result.fetchall()

    ticket_item = TicketListItem(
        id=str(ticket.id),
        organization_id=str(ticket.organization_id),
        subject=str(ticket.subject),
        status=str(ticket.status),
        priority=str(ticket.priority),
        created_by_email=str(ticket.created_by_email),
        assignee_email=str(ticket.assignee_email) if ticket.assignee_email is not None else None,
        created_via=str(ticket.created_via),
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        last_message_at=ticket.last_message_at,
        message_count=int(ticket.message_count or 0),
        last_message_preview=None,
    )

    messages = [
        TicketMessageItem(
            id=str(m.id),
            direction=str(m.direction),
            visibility=str(m.visibility),
            author_type=str(m.author_type),
            author_email=str(m.author_email) if m.author_email is not None else None,
            body_text=str(m.body_text),
            body_html=str(m.body_html) if m.body_html is not None else None,
            created_at=m.created_at,
        )
        for m in messages_rows
    ]

    return TicketDetailResponse(ticket=ticket_item, messages=messages)


@router.patch("/tickets/{ticket_id}")
async def update_ticket(
    ticket_id: str,
    request: UpdateTicketRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> dict[str, Any]:
    """Update ticket fields (admin app)."""
    if not ctx.is_internal and ctx.organization_id != "internal":
        raise HTTPException(status_code=403, detail="Admin access required")

    now = _utc_now()
    fields: list[str] = []
    params: dict[str, Any] = {"id": ticket_id, "updated_at": now}

    if request.status:
        fields.append("status = :status")
        params["status"] = request.status
        if request.status == "closed":
            fields.append("closed_at = :closed_at")
            params["closed_at"] = now
        else:
            fields.append("closed_at = NULL")
    if request.priority:
        fields.append("priority = :priority")
        params["priority"] = request.priority
    if request.assignee_email is not None:
        fields.append("assignee_email = :assignee_email")
        params["assignee_email"] = request.assignee_email.strip() or None

    if not fields:
        return {"status": "no_changes"}

    fields.append("updated_at = :updated_at")
    query = f"UPDATE support_ticket SET {', '.join(fields)} WHERE id = :id"

    async with get_db_session() as session:
        result = await session.execute(text(query), params)
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Ticket not found")

    await record_audit_event(
        organization_id="internal",
        action="support.ticket.updated",
        actor_type="admin",
        actor_id=_parse_admin_email(ctx),
        resource_type="support_ticket",
        resource_id=ticket_id,
        metadata={"fields": {k: v for k, v in params.items() if k not in {"id", "updated_at"}}},
    )

    return {"status": "ok"}


@router.post("/tickets/{ticket_id}/messages")
async def add_message(
    ticket_id: str,
    request: AddMessageRequest,
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
) -> dict[str, Any]:
    """Add a message to a ticket (admin app)."""
    if not ctx.is_internal and ctx.organization_id != "internal":
        raise HTTPException(status_code=403, detail="Admin access required")

    ticket_org = await _get_ticket_org(ticket_id)
    if not ticket_org:
        raise HTTPException(status_code=404, detail="Ticket not found")

    now = _utc_now()
    message_id = uuid4()
    author_email = _parse_admin_email(ctx) or "admin"
    visibility = request.visibility if request.visibility in {"external", "internal"} else "external"

    with rls_context(ticket_org, is_internal=True):
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO support_ticket_message (
                        id, ticket_id, organization_id,
                        direction, visibility,
                        author_type, author_email, author_user_id,
                        subject, body_text, body_html, raw_payload,
                        created_at
                    ) VALUES (
                        :id, :ticket_id, :org_id,
                        'outbound', :visibility,
                        'admin', :author_email, NULL,
                        NULL, :body_text, :body_html, CAST(:raw_payload AS JSONB),
                        :created_at
                    )
                    """
                ),
                {
                    "id": message_id,
                    "ticket_id": ticket_id,
                    "org_id": ticket_org,
                    "visibility": visibility,
                    "author_email": author_email,
                    "body_text": request.message.strip(),
                    "body_html": request.message_html,
                    "raw_payload": json.dumps({}),
                    "created_at": now,
                },
            )
            await session.execute(
                text(
                    """
                    UPDATE support_ticket
                    SET updated_at = :updated_at,
                        last_message_at = :last_message_at,
                        status = CASE WHEN status = 'open' THEN 'pending' ELSE status END
                    WHERE id = :id
                    """
                ),
                {"id": ticket_id, "updated_at": now, "last_message_at": now},
            )

            created_by_email_row = await session.execute(
                text("SELECT created_by_email, subject FROM support_ticket WHERE id = :id LIMIT 1"),
                {"id": ticket_id},
            )
            row = created_by_email_row.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Ticket not found")
            recipient = str(getattr(row, "created_by_email", None) or row[0])
            ticket_subject = str(getattr(row, "subject", None) or row[1])

    await record_audit_event(
        organization_id=ticket_org,
        action="support.ticket.message_added",
        actor_type="admin",
        actor_id=author_email,
        resource_type="support_ticket",
        resource_id=ticket_id,
        metadata={"visibility": visibility},
    )

    # Only send email for external messages.
    if visibility == "external":
        try:
            rendered = render_ticket_reply_email(
                ticket_id=ticket_id,
                title=ticket_subject,
                message=request.message,
                locale=request.locale,
                from_support=True,
            )
            await send_resend_email(
                to_emails=[recipient],
                subject=rendered.subject,
                html_body=rendered.html,
                text_body=rendered.text,
                tags={"type": "support_ticket_reply", "ticket_id": ticket_id},
            )
        except Exception as exc:
            logger.warning("support_ticket_reply_email_failed", error=str(exc))

    return {"status": "ok", "message_id": str(message_id)}


@router.post("/inbound/email")
async def inbound_email(
    request: InboundEmailRequest,
    x_support_inbound_token: str | None = Header(default=None, alias="X-Support-Inbound-Token"),
) -> dict[str, Any]:
    """Inbound email webhook -> tickets.

    This endpoint is intended to be called by an email provider webhook.
    It is protected by a shared secret `SUPPORT_INBOUND_TOKEN`.
    """
    settings = get_settings()
    if not settings.support_inbound_token:
        raise HTTPException(status_code=503, detail="Inbound support email is not configured")
    if not x_support_inbound_token or x_support_inbound_token != settings.support_inbound_token:
        raise HTTPException(status_code=401, detail="Invalid inbound token")

    from_email = request.from_email.strip().lower()
    subject = (request.subject or "").strip()
    body_text = (request.text or "").strip() or "(no text body)"

    ticket_id = None
    m = TICKET_ID_RE.search(subject)
    if m:
        ticket_id = m.group("ticket_id")

    now = _utc_now()
    raw_payload = dict(request.raw or {})
    raw_payload.setdefault("headers", request.headers or {})

    if ticket_id:
        ticket_org = await _get_ticket_org(ticket_id)
        if not ticket_org:
            ticket_id = None
        else:
            async with rls_context(ticket_org, is_internal=True):
                async with get_db_session() as session:
                    message_id = uuid4()
                    await session.execute(
                        text(
                            """
                            INSERT INTO support_ticket_message (
                                id, ticket_id, organization_id,
                                direction, visibility,
                                author_type, author_email, author_user_id,
                                subject, body_text, body_html, raw_payload,
                                created_at
                            ) VALUES (
                                :id, :ticket_id, :org_id,
                                'inbound', 'external',
                                'email', :author_email, NULL,
                                :subject, :body_text, :body_html, CAST(:raw_payload AS JSONB),
                                :created_at
                            )
                            """
                        ),
                        {
                            "id": message_id,
                            "ticket_id": ticket_id,
                            "org_id": ticket_org,
                            "author_email": from_email,
                            "subject": subject,
                            "body_text": body_text,
                            "body_html": request.html,
                            "raw_payload": json.dumps(raw_payload),
                            "created_at": now,
                        },
                    )
                    await session.execute(
                        text(
                            """
                            UPDATE support_ticket
                            SET updated_at = :updated_at,
                                last_message_at = :last_message_at,
                                status = CASE WHEN status = 'closed' THEN 'open' ELSE status END
                            WHERE id = :id
                            """
                        ),
                        {"id": ticket_id, "updated_at": now, "last_message_at": now},
                    )

            await record_audit_event(
                organization_id=ticket_org,
                action="support.ticket.inbound_email_appended",
                actor_type="email",
                actor_id=from_email,
                resource_type="support_ticket",
                resource_id=ticket_id,
                metadata={},
            )

            return {"status": "ok", "ticket_id": ticket_id, "created": False}

    # Create a new ticket from inbound email.
    if "@" not in from_email:
        raise HTTPException(status_code=422, detail="Invalid sender email")
    sender_domain = from_email.split("@", 1)[1]
    org_id = await _get_org_for_domain(sender_domain)
    if not org_id:
        raise HTTPException(status_code=422, detail="No organization matches sender domain")

    ticket_id = _new_ticket_id()
    async with rls_context(org_id, is_internal=True):
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO support_ticket (
                        id, organization_id, created_by_user_id, created_by_email,
                        subject, status, priority, assignee_email, created_via,
                        metadata, created_at, updated_at, last_message_at, closed_at
                    ) VALUES (
                        :id, :org_id, NULL, :email,
                        :subject, 'open', 'normal', NULL, 'email',
                        CAST(:metadata AS JSONB), :created_at, :updated_at, :last_message_at, NULL
                    )
                    """
                ),
                {
                    "id": ticket_id,
                    "org_id": org_id,
                    "email": from_email,
                    "subject": subject or "(no subject)",
                    "metadata": json.dumps({"inbound": True}),
                    "created_at": now,
                    "updated_at": now,
                    "last_message_at": now,
                },
            )
            message_id = uuid4()
            await session.execute(
                text(
                    """
                    INSERT INTO support_ticket_message (
                        id, ticket_id, organization_id,
                        direction, visibility,
                        author_type, author_email, author_user_id,
                        subject, body_text, body_html, raw_payload,
                        created_at
                    ) VALUES (
                        :id, :ticket_id, :org_id,
                        'inbound', 'external',
                        'email', :author_email, NULL,
                        :subject, :body_text, :body_html, CAST(:raw_payload AS JSONB),
                        :created_at
                    )
                    """
                ),
                {
                    "id": message_id,
                    "ticket_id": ticket_id,
                    "org_id": org_id,
                    "author_email": from_email,
                    "subject": subject or "(no subject)",
                    "body_text": body_text,
                    "body_html": request.html,
                    "raw_payload": json.dumps(raw_payload),
                    "created_at": now,
                },
            )

    await record_audit_event(
        organization_id=org_id,
        action="support.ticket.inbound_email_created",
        actor_type="email",
        actor_id=from_email,
        resource_type="support_ticket",
        resource_id=ticket_id,
        metadata={"subject": subject},
    )

    # Best-effort auto-ack to sender (prevents "did you get this?" loops).
    try:
        rendered = render_ticket_created_email(
            ticket_id=ticket_id,
            title=subject or "(no subject)",
            locale=None,
        )
        await send_resend_email(
            to_emails=[from_email],
            subject=rendered.subject,
            html_body=rendered.html,
            text_body=rendered.text,
            tags={"type": "support_ticket_created_inbound", "ticket_id": ticket_id},
        )
    except Exception as exc:
        logger.warning("support_ticket_inbound_ack_email_failed", error=str(exc))

    return {"status": "ok", "ticket_id": ticket_id, "created": True}
