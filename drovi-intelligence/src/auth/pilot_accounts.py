"""
Pilot Account Service

Handles OAuth authentication and pilot account lifecycle:
- Domain-based organization lookup
- User creation on first OAuth login
- Membership management
- JWT token issuance

This is NOT a SaaS authentication system.
Pilots are provisioned by Drovi, not self-served.
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
import structlog
from pydantic import BaseModel
from sqlalchemy import text

from src.config import get_settings
from src.db.client import get_db_session

logger = structlog.get_logger()


# =============================================================================
# Models
# =============================================================================


class OAuthUserInfo(BaseModel):
    """User info from OAuth provider."""

    email: str
    name: str | None = None
    picture: str | None = None
    provider: str = "google"


class PilotToken(BaseModel):
    """JWT claims for pilot access."""

    sub: str  # user_id
    org_id: str
    role: Literal["pilot_admin", "pilot_member"]
    email: str
    exp: datetime
    iat: datetime


class AuthResult(BaseModel):
    """Result of authentication."""

    token: str
    user_id: str
    org_id: str
    role: str
    email: str
    name: str | None = None
    is_new_user: bool = False


# =============================================================================
# JWT Configuration
# =============================================================================

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 7


def _get_jwt_secret() -> str:
    """Get JWT signing secret from settings."""
    settings = get_settings()
    secret = settings.api_key_salt
    if not secret:
        logger.warning("No JWT secret configured, using insecure default")
        return "insecure-default-secret-change-me"
    return secret


def create_jwt(
    user_id: str,
    org_id: str,
    role: str,
    email: str,
) -> str:
    """Create a JWT token for authenticated user."""
    now = datetime.now(timezone.utc)
    expiry = now + timedelta(days=JWT_EXPIRY_DAYS)

    payload = {
        "sub": user_id,
        "org_id": org_id,
        "role": role,
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int(expiry.timestamp()),
    }

    return jwt.encode(payload, _get_jwt_secret(), algorithm=JWT_ALGORITHM)


def verify_jwt(token: str) -> PilotToken | None:
    """Verify and decode a JWT token."""
    try:
        payload = jwt.decode(token, _get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        return PilotToken(
            sub=payload["sub"],
            org_id=payload["org_id"],
            role=payload["role"],
            email=payload["email"],
            exp=datetime.fromtimestamp(payload["exp"], tz=timezone.utc),
            iat=datetime.fromtimestamp(payload["iat"], tz=timezone.utc),
        )
    except jwt.ExpiredSignatureError:
        logger.debug("JWT expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.debug("Invalid JWT", error=str(e))
        return None


# =============================================================================
# Organization Management
# =============================================================================


async def get_org_by_domain(email_domain: str) -> dict | None:
    """
    Find organization by email domain.

    Organizations have allowed_domains that permit auto-join.
    """
    async with get_db_session() as session:
        result = await session.execute(
            text("""
                SELECT id, name, pilot_status, region, allowed_domains, expires_at
                FROM organizations
                WHERE :domain = ANY(allowed_domains)
                AND pilot_status = 'active'
                LIMIT 1
            """),
            {"domain": email_domain},
        )
        row = result.fetchone()

        if row:
            return {
                "id": row.id,
                "name": row.name,
                "pilot_status": row.pilot_status,
                "region": row.region,
                "allowed_domains": row.allowed_domains,
                "expires_at": row.expires_at,
            }
        return None


async def get_org_by_id(org_id: str) -> dict | None:
    """Get organization by ID."""
    async with get_db_session() as session:
        result = await session.execute(
            text("""
                SELECT id, name, pilot_status, region, allowed_domains, expires_at
                FROM organizations
                WHERE id = :org_id
            """),
            {"org_id": org_id},
        )
        row = result.fetchone()

        if row:
            return {
                "id": row.id,
                "name": row.name,
                "pilot_status": row.pilot_status,
                "region": row.region,
                "allowed_domains": row.allowed_domains,
                "expires_at": row.expires_at,
            }
        return None


async def create_organization(
    org_id: str,
    name: str,
    allowed_domains: list[str],
    region: str = "us-west",
    expires_at: datetime | None = None,
) -> dict:
    """
    Create a new pilot organization.

    This should be called from CLI/script, not through API.
    """
    async with get_db_session() as session:
        await session.execute(
            text("""
                INSERT INTO organizations (id, name, pilot_status, region, allowed_domains, expires_at, created_at)
                VALUES (:id, :name, 'active', :region, :allowed_domains, :expires_at, NOW())
            """),
            {
                "id": org_id,
                "name": name,
                "region": region,
                "allowed_domains": allowed_domains,
                "expires_at": expires_at,
            },
        )

    logger.info("Organization created", org_id=org_id, name=name)

    return {
        "id": org_id,
        "name": name,
        "pilot_status": "active",
        "region": region,
        "allowed_domains": allowed_domains,
        "expires_at": expires_at,
    }


# =============================================================================
# User Management
# =============================================================================


async def get_user_by_email(email: str) -> dict | None:
    """Get user by email."""
    async with get_db_session() as session:
        result = await session.execute(
            text("""
                SELECT id, email, name, created_at, last_login_at
                FROM users
                WHERE email = :email
            """),
            {"email": email},
        )
        row = result.fetchone()

        if row:
            return {
                "id": row.id,
                "email": row.email,
                "name": row.name,
                "created_at": row.created_at,
                "last_login_at": row.last_login_at,
            }
        return None


async def get_or_create_user(email: str, name: str | None = None) -> tuple[dict, bool]:
    """
    Get or create a user by email.

    Returns:
        Tuple of (user_dict, is_new)
    """
    existing = await get_user_by_email(email)
    if existing:
        # Update last login
        async with get_db_session() as session:
            await session.execute(
                text("UPDATE users SET last_login_at = NOW() WHERE email = :email"),
                {"email": email},
            )
        return existing, False

    # Create new user
    user_id = f"user_{secrets.token_hex(8)}"
    async with get_db_session() as session:
        await session.execute(
            text("""
                INSERT INTO users (id, email, name, created_at, last_login_at)
                VALUES (:id, :email, :name, NOW(), NOW())
            """),
            {"id": user_id, "email": email, "name": name},
        )

    logger.info("User created", user_id=user_id, email=email)

    return {
        "id": user_id,
        "email": email,
        "name": name,
        "created_at": datetime.now(timezone.utc),
        "last_login_at": datetime.now(timezone.utc),
    }, True


# =============================================================================
# Membership Management
# =============================================================================


async def get_membership(user_id: str, org_id: str) -> dict | None:
    """Get membership for user in organization."""
    async with get_db_session() as session:
        result = await session.execute(
            text("""
                SELECT user_id, org_id, role, created_at
                FROM memberships
                WHERE user_id = :user_id AND org_id = :org_id
            """),
            {"user_id": user_id, "org_id": org_id},
        )
        row = result.fetchone()

        if row:
            return {
                "user_id": row.user_id,
                "org_id": row.org_id,
                "role": row.role,
                "created_at": row.created_at,
            }
        return None


async def get_or_create_membership(
    user_id: str,
    org_id: str,
    role: str = "pilot_member",
) -> tuple[dict, bool]:
    """
    Get or create membership for user in organization.

    Returns:
        Tuple of (membership_dict, is_new)
    """
    existing = await get_membership(user_id, org_id)
    if existing:
        return existing, False

    async with get_db_session() as session:
        await session.execute(
            text("""
                INSERT INTO memberships (user_id, org_id, role, created_at)
                VALUES (:user_id, :org_id, :role, NOW())
            """),
            {"user_id": user_id, "org_id": org_id, "role": role},
        )

    logger.info("Membership created", user_id=user_id, org_id=org_id, role=role)

    return {
        "user_id": user_id,
        "org_id": org_id,
        "role": role,
        "created_at": datetime.now(timezone.utc),
    }, True


async def update_membership_role(user_id: str, org_id: str, role: str) -> bool:
    """Update user's role in organization."""
    async with get_db_session() as session:
        result = await session.execute(
            text("""
                UPDATE memberships
                SET role = :role
                WHERE user_id = :user_id AND org_id = :org_id
            """),
            {"user_id": user_id, "org_id": org_id, "role": role},
        )
        return result.rowcount > 0


# =============================================================================
# Invite Management
# =============================================================================


async def create_invite(
    org_id: str,
    role: str = "pilot_member",
    expires_in_days: int = 7,
) -> str:
    """
    Create an invite token for an organization.

    Returns:
        The invite token
    """
    token = f"inv_{secrets.token_hex(16)}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=expires_in_days)

    async with get_db_session() as session:
        await session.execute(
            text("""
                INSERT INTO invites (token, org_id, role, expires_at, created_at)
                VALUES (:token, :org_id, :role, :expires_at, NOW())
            """),
            {
                "token": token,
                "org_id": org_id,
                "role": role,
                "expires_at": expires_at,
            },
        )

    logger.info("Invite created", org_id=org_id, token=token[:12] + "...")

    return token


async def get_invite(token: str) -> dict | None:
    """Get invite by token."""
    async with get_db_session() as session:
        result = await session.execute(
            text("""
                SELECT token, org_id, role, expires_at, used_at, created_at
                FROM invites
                WHERE token = :token
            """),
            {"token": token},
        )
        row = result.fetchone()

        if row:
            return {
                "token": row.token,
                "org_id": row.org_id,
                "role": row.role,
                "expires_at": row.expires_at,
                "used_at": row.used_at,
                "created_at": row.created_at,
            }
        return None


async def use_invite(token: str, user_id: str) -> bool:
    """Mark invite as used."""
    async with get_db_session() as session:
        result = await session.execute(
            text("""
                UPDATE invites
                SET used_at = NOW(), used_by_user_id = :user_id
                WHERE token = :token AND used_at IS NULL
            """),
            {"token": token, "user_id": user_id},
        )
        return result.rowcount > 0


# =============================================================================
# OAuth Callback Handler
# =============================================================================


class AuthError(Exception):
    """Authentication error with user-facing message."""

    def __init__(self, message: str, status_code: int = 403):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


async def handle_oauth_callback(oauth_user: OAuthUserInfo) -> AuthResult:
    """
    Handle OAuth callback and authenticate user.

    Flow:
    1. Extract email domain
    2. Find organization by domain
    3. Validate org is active and not expired
    4. Get or create user
    5. Get or create membership
    6. Issue JWT

    Args:
        oauth_user: User info from OAuth provider

    Returns:
        AuthResult with JWT and user info

    Raises:
        AuthError: If authentication fails
    """
    email_domain = oauth_user.email.split("@")[1].lower()

    # Find org by domain
    org = await get_org_by_domain(email_domain)
    if not org:
        logger.warning("Domain not authorized", domain=email_domain, email=oauth_user.email)
        raise AuthError("Your email domain is not authorized for any pilot.")

    # Check org status
    if org["pilot_status"] != "active":
        logger.warning("Pilot has ended", org_id=org["id"], email=oauth_user.email)
        raise AuthError("This pilot has ended.")

    # Check expiration (handle both timezone-aware and naive datetimes from DB)
    if org["expires_at"]:
        expires_at = org["expires_at"]
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            logger.warning("Pilot has expired", org_id=org["id"], expires_at=org["expires_at"])
            raise AuthError("This pilot has expired.")

    # Get or create user
    user, is_new_user = await get_or_create_user(oauth_user.email, oauth_user.name)

    # Get or create membership (default: pilot_member)
    membership, _ = await get_or_create_membership(
        user_id=user["id"],
        org_id=org["id"],
        role="pilot_member",
    )

    # Issue JWT
    token = create_jwt(
        user_id=user["id"],
        org_id=org["id"],
        role=membership["role"],
        email=oauth_user.email,
    )

    logger.info(
        "User authenticated",
        user_id=user["id"],
        org_id=org["id"],
        role=membership["role"],
        is_new_user=is_new_user,
    )

    return AuthResult(
        token=token,
        user_id=user["id"],
        org_id=org["id"],
        role=membership["role"],
        email=oauth_user.email,
        name=oauth_user.name,
        is_new_user=is_new_user,
    )


async def handle_invite_callback(
    token: str,
    oauth_user: OAuthUserInfo,
) -> AuthResult:
    """
    Handle invite-based authentication.

    For stricter pilots that require explicit invitations.
    """
    invite = await get_invite(token)

    if not invite:
        raise AuthError("Invalid invite token.", status_code=400)

    if invite["used_at"]:
        raise AuthError("This invite has already been used.", status_code=400)

    invite_expires = invite["expires_at"]
    if invite_expires.tzinfo is None:
        invite_expires = invite_expires.replace(tzinfo=timezone.utc)
    if invite_expires < datetime.now(timezone.utc):
        raise AuthError("This invite has expired.", status_code=400)

    # Get org
    org = await get_org_by_id(invite["org_id"])
    if not org or org["pilot_status"] != "active":
        raise AuthError("This pilot is no longer active.")

    # Get or create user
    user, is_new_user = await get_or_create_user(oauth_user.email, oauth_user.name)

    # Create membership with invite's role
    await get_or_create_membership(
        user_id=user["id"],
        org_id=invite["org_id"],
        role=invite["role"],
    )

    # Mark invite as used
    await use_invite(token, user["id"])

    # Issue JWT
    jwt_token = create_jwt(
        user_id=user["id"],
        org_id=invite["org_id"],
        role=invite["role"],
        email=oauth_user.email,
    )

    logger.info(
        "User authenticated via invite",
        user_id=user["id"],
        org_id=invite["org_id"],
        role=invite["role"],
        invite_token=token[:12] + "...",
    )

    return AuthResult(
        token=jwt_token,
        user_id=user["id"],
        org_id=invite["org_id"],
        role=invite["role"],
        email=oauth_user.email,
        name=oauth_user.name,
        is_new_user=is_new_user,
    )
