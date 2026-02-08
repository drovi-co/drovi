"""
Admin Auth (admin.drovi.co)

The admin surface is intentionally separate from pilot sessions:
- Admin users authenticate with email + a single rotateable password.
- Tokens are signed with a distinct secret (`ADMIN_JWT_SECRET`) so they cannot be
  replayed as pilot session tokens.
- Admin auth yields INTERNAL + ADMIN scopes and bypasses org RLS (internal mode).
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
import structlog
from pydantic import BaseModel

from src.auth.scopes import Scope
from src.config import get_settings

logger = structlog.get_logger()

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 12


class AdminToken(BaseModel):
    """JWT claims for Drovi admin sessions."""

    kind: Literal["drovi_admin"]
    sub: str  # Stable subject identifier (email for now).
    email: str
    scopes: list[str]
    exp: datetime
    iat: datetime


def _get_admin_jwt_secret() -> str:
    settings = get_settings()
    if settings.admin_jwt_secret:
        return settings.admin_jwt_secret

    # Dev fallback: derive from API_KEY_SALT so local stacks work without extra env.
    # In production, you MUST set ADMIN_JWT_SECRET.
    base = settings.api_key_salt or "insecure-default-secret-change-me"
    logger.warning("ADMIN_JWT_SECRET not configured, using derived secret (dev only)")
    return f"{base}::admin"


def _hash_password(password: str) -> str:
    """Hash a password using PBKDF2-SHA256."""
    salt = secrets.token_hex(16)
    iterations = 150_000
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), iterations)
    return f"pbkdf2:sha256:{iterations}${salt}${dk.hex()}"


def _verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against a PBKDF2 hash."""
    try:
        if not password_hash.startswith("pbkdf2:sha256:"):
            return False
        parts = password_hash.split("$")
        if len(parts) != 3:
            return False
        header, salt, stored_hash = parts
        iterations = int(header.split(":")[2])
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), iterations)
        return dk.hex() == stored_hash
    except Exception:
        return False


def validate_admin_email(email: str) -> bool:
    """True if the email domain is allowed to authenticate as admin."""
    settings = get_settings()
    if "@" not in email:
        return False
    domain = email.split("@", 1)[1].lower().strip()
    allowed = {d.lower().strip() for d in (settings.admin_allowed_domains or [])}
    return domain in allowed


def validate_admin_password(password: str) -> bool:
    """
    Validate the admin password against configured policy.

    Order:
    1) ADMIN_PASSWORD_HASH (preferred)
    2) ADMIN_PASSWORD (dev only)
    """
    settings = get_settings()
    if settings.admin_password_hash:
        return _verify_password(password, settings.admin_password_hash)
    if settings.admin_password:
        return secrets.compare_digest(password, settings.admin_password)
    return False


def create_admin_jwt(email: str) -> str:
    now = datetime.now(timezone.utc)
    expiry = now + timedelta(hours=JWT_EXPIRY_HOURS)

    payload = {
        "kind": "drovi_admin",
        "sub": email.lower(),
        "email": email.lower(),
        "scopes": [Scope.ADMIN.value, Scope.INTERNAL.value],
        "iat": int(now.timestamp()),
        "exp": int(expiry.timestamp()),
    }
    return jwt.encode(payload, _get_admin_jwt_secret(), algorithm=JWT_ALGORITHM)


def verify_admin_jwt(token: str) -> AdminToken | None:
    try:
        payload = jwt.decode(token, _get_admin_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("kind") != "drovi_admin":
            return None
        return AdminToken(
            kind="drovi_admin",
            sub=str(payload.get("sub") or ""),
            email=str(payload.get("email") or ""),
            scopes=list(payload.get("scopes") or []),
            exp=datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc),
            iat=datetime.fromtimestamp(int(payload["iat"]), tz=timezone.utc),
        )
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception as exc:
        logger.debug("Failed to verify admin JWT", error=str(exc))
        return None

