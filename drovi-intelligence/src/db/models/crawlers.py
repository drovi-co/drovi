"""World crawl fabric persistence models."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from src.db.models.connections import Base


class CrawlFrontierEntry(Base):
    __tablename__ = "crawl_frontier_entry"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    source_key = Column(Text, nullable=False)
    seed_type = Column(Text, nullable=False, default="manual")
    url = Column(Text, nullable=False)
    normalized_url = Column(Text, nullable=False)
    domain = Column(Text, nullable=False, index=True)
    priority = Column(Integer, nullable=False, default=0)
    freshness_policy_minutes = Column(Integer, nullable=False, default=60)
    next_fetch_at = Column(DateTime(timezone=True), nullable=False, index=True)
    last_fetch_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(Text, nullable=False, default="queued", index=True)
    fetch_count = Column(Integer, nullable=False, default=0)
    failure_count = Column(Integer, nullable=False, default=0)
    last_http_status = Column(Integer, nullable=True)
    last_error = Column(Text, nullable=True)
    policy_state = Column(Text, nullable=False, default="allowed")
    legal_hold = Column(Boolean, nullable=False, default=False, index=True)
    takedown = Column(Boolean, nullable=False, default=False, index=True)
    crawl_metadata = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("organization_id", "normalized_url", name="crawl_frontier_org_url_unique"),
    )


class CrawlPolicyRule(Base):
    __tablename__ = "crawl_policy_rule"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    rule_type = Column(Text, nullable=False)
    scope = Column(Text, nullable=False, index=True)
    action = Column(Text, nullable=False)
    reason = Column(Text, nullable=True)
    active = Column(Boolean, nullable=False, default=True, index=True)
    created_by = Column(Text, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    rule_metadata = Column("metadata", JSONB, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "rule_type",
            "scope",
            name="crawl_policy_rule_org_type_scope_unique",
        ),
    )


class CrawlSnapshot(Base):
    __tablename__ = "crawl_snapshot"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    frontier_entry_id = Column(
        Text,
        ForeignKey("crawl_frontier_entry.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    url = Column(Text, nullable=False)
    content_type = Column(Text, nullable=True)
    http_status = Column(Integer, nullable=True)
    fetched_at = Column(DateTime(timezone=True), nullable=False, index=True)
    rendered = Column(Boolean, nullable=False, default=False)
    payload_hash = Column(Text, nullable=False, index=True)
    payload_size_bytes = Column(Integer, nullable=False, default=0)
    storage_ref = Column(Text, nullable=True)
    parsed_text = Column(Text, nullable=True)
    parsed_metadata = Column(JSONB, nullable=False, default=dict)
    diff_from_snapshot_id = Column(Text, ForeignKey("crawl_snapshot.id", ondelete="SET NULL"), nullable=True)
    significance_score = Column(Float, nullable=True)
    is_meaningful_delta = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class CrawlAuditLog(Base):
    __tablename__ = "crawl_audit_log"

    id = Column(Text, primary_key=True)
    organization_id = Column(Text, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    frontier_entry_id = Column(Text, ForeignKey("crawl_frontier_entry.id", ondelete="SET NULL"), nullable=True)
    snapshot_id = Column(Text, ForeignKey("crawl_snapshot.id", ondelete="SET NULL"), nullable=True)
    event_type = Column(Text, nullable=False, index=True)
    severity = Column(Text, nullable=False, default="info")
    decision = Column(Text, nullable=True)
    reason = Column(Text, nullable=True)
    actor = Column(Text, nullable=True)
    audit_metadata = Column("metadata", JSONB, nullable=False, default=dict)
    occurred_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, index=True)
