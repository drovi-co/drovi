"""
Internal Service JWT (service-to-service auth).

Why this exists:
- The old "X-Internal-Service-Token" static secret was easy to leak and hard to reason about.
- We now require a short-lived JWT with explicit org binding in the claims.

Header:
- The token is passed via `X-Internal-Service-Token` (kept for backward compatibility).

Claims:
- kind: "drovi_internal"
- sub: stable service identifier (e.g. "web", "worker", "seed")
- org_id: organization binding (no org_id from body/query)
- scopes: optional; defaults to INTERNAL+ADMIN when absent
- iat/exp: issued/expiry (short-lived)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
import structlog
from pydantic import BaseModel

from src.auth.scopes import Scope
from src.config import get_settings

logger = structlog.get_logger()

JWT_ALGORITHM = "HS256"


class InternalServiceToken(BaseModel):
    """JWT claims for internal service calls."""

    kind: Literal["drovi_internal"]
    sub: str
    org_id: str
    scopes: list[str]
    exp: datetime
    iat: datetime


def _get_internal_jwt_secret() -> str | None:
    settings = get_settings()
    if settings.internal_jwt_secret:
        return settings.internal_jwt_secret

    # Dev fallback: derive from API_KEY_SALT so local stacks work without extra env.
    # In production, you MUST set INTERNAL_JWT_SECRET.
    if settings.environment in ("development", "test"):
        base = settings.api_key_salt or "insecure-default-secret-change-me"
        logger.warning("INTERNAL_JWT_SECRET not configured, using derived secret (dev only)")
        return f"{base}::internal"

    logger.error("INTERNAL_JWT_SECRET not configured in production")
    return None


def create_internal_jwt(
    *,
    org_id: str,
    service: str,
    scopes: list[str] | None = None,
) -> str:
    settings = get_settings()
    secret = _get_internal_jwt_secret()
    if not secret:
        raise RuntimeError("INTERNAL_JWT_SECRET is required to create internal JWTs")

    now = datetime.now(timezone.utc)
    expiry = now + timedelta(minutes=int(settings.internal_jwt_expiry_minutes or 15))

    payload = {
        "kind": "drovi_internal",
        "sub": service,
        "org_id": org_id,
        "scopes": scopes or [Scope.ADMIN.value, Scope.INTERNAL.value],
        "iss": settings.internal_jwt_issuer,
        "iat": int(now.timestamp()),
        "exp": int(expiry.timestamp()),
    }
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def verify_internal_jwt(token: str) -> InternalServiceToken | None:
    settings = get_settings()
    secret = _get_internal_jwt_secret()
    if not secret:
        return None

    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "iat"]},
        )
        if payload.get("kind") != "drovi_internal":
            return None

        # issuer is best-effort: we accept missing issuer for backwards compatibility,
        # but validate it if present.
        iss = payload.get("iss")
        if iss is not None and iss != settings.internal_jwt_issuer:
            return None

        return InternalServiceToken(
            kind="drovi_internal",
            sub=str(payload.get("sub") or ""),
            org_id=str(payload.get("org_id") or ""),
            scopes=list(payload.get("scopes") or []),
            exp=datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc),
            iat=datetime.fromtimestamp(int(payload["iat"]), tz=timezone.utc),
        )
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception as exc:
        logger.debug("Failed to verify internal JWT", error=str(exc))
        return None

