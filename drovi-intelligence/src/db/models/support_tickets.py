"""Support ticketing models (internal tooling + pilot support)."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from src.db.models.connections import Base


def _ticket_id() -> str:
    # Short, copyable ids that are easy to embed in email subjects.
    return f"tkt_{uuid4().hex[:12]}"


class SupportTicket(Base):
    __tablename__ = "support_ticket"

    id = Column(Text, primary_key=True, default=_ticket_id)
    organization_id = Column(Text, nullable=False, index=True)

    created_by_user_id = Column(Text, nullable=True, index=True)
    created_by_email = Column(Text, nullable=False, index=True)

    subject = Column(Text, nullable=False)
    status = Column(Text, nullable=False, default="open", index=True)  # open, pending, closed
    priority = Column(Text, nullable=False, default="normal", index=True)  # low, normal, high
    assignee_email = Column(Text, nullable=True, index=True)
    created_via = Column(Text, nullable=False, default="web")  # web, email, system

    # NOTE: "metadata" is reserved by SQLAlchemy's Declarative API.
    ticket_metadata = Column("metadata", JSONB, nullable=False, default=dict)

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True)
    last_message_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)


class SupportTicketMessage(Base):
    __tablename__ = "support_ticket_message"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    ticket_id = Column(Text, ForeignKey("support_ticket.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(Text, nullable=False, index=True)

    direction = Column(Text, nullable=False)  # inbound, outbound
    visibility = Column(Text, nullable=False, default="external")  # external, internal

    author_type = Column(Text, nullable=False)  # user, admin, email, system
    author_email = Column(Text, nullable=True)
    author_user_id = Column(Text, nullable=True)

    subject = Column(Text, nullable=True)
    body_text = Column(Text, nullable=False)
    body_html = Column(Text, nullable=True)
    raw_payload = Column(JSONB, nullable=False, default=dict)

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True)


class SupportTicketAttachment(Base):
    __tablename__ = "support_ticket_attachment"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    message_id = Column(UUID(as_uuid=True), ForeignKey("support_ticket_message.id", ondelete="CASCADE"), nullable=False)
    organization_id = Column(Text, nullable=False, index=True)

    storage_key = Column(Text, nullable=False)
    filename = Column(Text, nullable=False)
    content_type = Column(String(255), nullable=True)
    size_bytes = Column(Integer, nullable=True)
    is_inline = Column(Boolean, nullable=False, default=False)

    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
