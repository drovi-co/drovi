"""
Pilot Account Database Models

SQLAlchemy models for pilot account management:
- Organization: One per pilot
- User: Created on first OAuth login
- Membership: Org-scoped access with roles
- Invite: Optional invite tokens for stricter control

This is NOT a SaaS user management system.
Pilots are provisioned by Drovi, not self-served.
"""

from datetime import datetime
from typing import Literal
from uuid import uuid4

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import relationship

from src.db.models.connections import Base


class Organization(Base):
    """
    Represents a pilot organization.

    One organization per pilot. Created via CLI/script,
    not through self-service signup.

    Attributes:
        id: Unique identifier (e.g., "org_acme_001")
        name: Display name (e.g., "Acme Corp")
        pilot_status: "active" or "ended"
        region: Deployment region (e.g., "us-west")
        allowed_domains: Email domains allowed to join
        notification_emails: Report recipients for briefs
        expires_at: Pilot expiration date
    """

    __tablename__ = "organizations"

    # Identity - use string ID for human-readable pilot IDs
    id = Column(String(100), primary_key=True)

    # Basic info
    name = Column(String(255), nullable=False)
    pilot_status = Column(
        String(20),
        nullable=False,
        default="active",
        index=True,
    )  # active, ended

    # Deployment
    region = Column(String(50), nullable=False, default="us-west")

    # Domain allow-listing for auto-join
    allowed_domains = Column(ARRAY(String), nullable=False, default=list)

    # Notification emails for briefs/reports
    notification_emails = Column(ARRAY(String), nullable=False, default=list)

    # Org policy: restrict which connectors can be connected (NULL means "allow all").
    allowed_connectors = Column(ARRAY(String), nullable=True)

    # Org policy: default visibility for new connections.
    default_connection_visibility = Column(
        String(20),
        nullable=False,
        default="org_shared",
    )

    # Locale defaults for the org (user can override).
    default_locale = Column(String(10), nullable=False, default="en")

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=True, index=True)

    # Relationships
    memberships = relationship("Membership", back_populates="organization")
    invites = relationship("Invite", back_populates="organization")

    def __repr__(self) -> str:
        return f"<Organization {self.id} ({self.pilot_status})>"


class User(Base):
    """
    Represents a user account.

    Created automatically on first OAuth login if the user's
    email domain matches an organization's allowed_domains.

    Attributes:
        id: Unique identifier (e.g., "user_abc123")
        email: User's email (unique across all users)
        name: Display name from OAuth profile
    """

    __tablename__ = "users"

    # Identity
    id = Column(String(100), primary_key=True)
    email = Column(String(255), unique=True, nullable=False, index=True)

    # Profile
    name = Column(String(255), nullable=True)

    # User-preferred locale (overrides org default).
    locale = Column(String(10), nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_login_at = Column(DateTime, nullable=True)

    # Relationships
    memberships = relationship("Membership", back_populates="user")

    def __repr__(self) -> str:
        return f"<User {self.email}>"


class Membership(Base):
    """
    Links a user to an organization with a specific role.

    Roles:
        - pilot_admin: Can manage connections, view all data
        - pilot_member: Can view data, use Ask

    Attributes:
        user_id: User reference
        org_id: Organization reference
        role: "pilot_admin" or "pilot_member"
    """

    __tablename__ = "memberships"

    # Composite primary key
    user_id = Column(
        String(100),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    org_id = Column(
        String(100),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        primary_key=True,
    )

    # Role
    role = Column(
        String(50),
        nullable=False,
        default="pilot_member",
    )  # pilot_admin, pilot_member

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="memberships")
    organization = relationship("Organization", back_populates="memberships")

    def __repr__(self) -> str:
        return f"<Membership {self.user_id}@{self.org_id} ({self.role})>"


class Invite(Base):
    """
    Optional invite tokens for stricter pilot control.

    Use this when you need explicit invitations instead of
    domain-based auto-join.

    Attributes:
        token: Unique invite token (e.g., "inv_abc123")
        org_id: Target organization
        role: Role to assign on acceptance
        expires_at: Token expiration
        used_at: When token was used (null if unused)
    """

    __tablename__ = "invites"

    # Identity
    token = Column(String(100), primary_key=True)

    # Target
    org_id = Column(
        String(100),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Role to assign
    role = Column(String(50), nullable=False, default="pilot_member")

    # Lifecycle
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    used_by_user_id = Column(String(100), nullable=True)

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    organization = relationship("Organization", back_populates="invites")

    def __repr__(self) -> str:
        status = "used" if self.used_at else "pending"
        return f"<Invite {self.token[:8]}... ({status})>"


# =============================================================================
# Migration SQL
# =============================================================================

"""
-- Pilot Account Tables

-- Organizations (one per pilot)
CREATE TABLE organizations (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    pilot_status VARCHAR(20) NOT NULL DEFAULT 'active',
    region VARCHAR(50) NOT NULL DEFAULT 'us-west',
    allowed_domains TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX idx_orgs_status ON organizations(pilot_status);
CREATE INDEX idx_orgs_expires ON organizations(expires_at);

-- Users (created on first OAuth login)
CREATE TABLE users (
    id VARCHAR(100) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email);

-- Memberships (org-scoped access)
CREATE TABLE memberships (
    user_id VARCHAR(100) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'pilot_member',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, org_id)
);

-- Invites (optional, for stricter control)
CREATE TABLE invites (
    token VARCHAR(100) PRIMARY KEY,
    org_id VARCHAR(100) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'pilot_member',
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    used_by_user_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invites_org ON invites(org_id);
"""
