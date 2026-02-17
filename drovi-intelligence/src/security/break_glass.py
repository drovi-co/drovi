"""Break-glass grant workflow for privileged evidence access."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import rls_context


@dataclass(frozen=True)
class BreakGlassGrant:
    """Active break-glass grant record."""

    id: str
    organization_id: str
    scope: str
    justification: str
    created_by_subject: str | None
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None
    revoked_by_subject: str | None = None
    use_count: int = 0

    def is_active(self, now: datetime | None = None) -> bool:
        current = now or datetime.now(timezone.utc)
        return self.revoked_at is None and self.expires_at > current

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "organization_id": self.organization_id,
            "scope": self.scope,
            "justification": self.justification,
            "created_by_subject": self.created_by_subject,
            "created_at": self.created_at.isoformat(),
            "expires_at": self.expires_at.isoformat(),
            "revoked_at": self.revoked_at.isoformat() if self.revoked_at else None,
            "revoked_by_subject": self.revoked_by_subject,
            "use_count": self.use_count,
        }


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _to_grant(row: Any) -> BreakGlassGrant:
    return BreakGlassGrant(
        id=str(row.id),
        organization_id=str(row.organization_id),
        scope=str(row.scope or "*"),
        justification=str(row.justification or ""),
        created_by_subject=getattr(row, "created_by_subject", None),
        created_at=row.created_at,
        expires_at=row.expires_at,
        revoked_at=getattr(row, "revoked_at", None),
        revoked_by_subject=getattr(row, "revoked_by_subject", None),
        use_count=int(getattr(row, "use_count", 0) or 0),
    )


async def create_break_glass_grant(
    *,
    organization_id: str,
    scope: str,
    justification: str,
    created_by_subject: str | None,
    ttl_minutes: int = 30,
) -> tuple[BreakGlassGrant, str]:
    """
    Create a short-lived grant and return (grant, plain_token).

    The plain token is only available at creation time; only its hash is stored.
    """
    grant_token = f"bg_{secrets.token_urlsafe(32)}"
    token_hash = _hash_token(grant_token)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=max(1, int(ttl_minutes)))

    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    INSERT INTO security_break_glass_grant (
                        organization_id,
                        scope,
                        justification,
                        token_hash,
                        created_by_subject,
                        created_at,
                        expires_at,
                        use_count
                    ) VALUES (
                        :organization_id,
                        :scope,
                        :justification,
                        :token_hash,
                        :created_by_subject,
                        :created_at,
                        :expires_at,
                        0
                    )
                    RETURNING
                        id,
                        organization_id,
                        scope,
                        justification,
                        created_by_subject,
                        created_at,
                        expires_at,
                        revoked_at,
                        revoked_by_subject,
                        use_count
                    """
                ),
                {
                    "organization_id": organization_id,
                    "scope": scope or "*",
                    "justification": justification,
                    "token_hash": token_hash,
                    "created_by_subject": created_by_subject,
                    "created_at": now,
                    "expires_at": expires_at,
                },
            )
            row = result.fetchone()

    return _to_grant(row), grant_token


async def validate_break_glass_token(
    *,
    organization_id: str,
    token: str | None,
    scope: str,
    consume: bool = True,
) -> BreakGlassGrant | None:
    """Validate token for org/scope and optionally record usage."""
    if not isinstance(token, str):
        return None
    raw = str(token or "").strip()
    if not raw:
        return None

    token_hash = _hash_token(raw)
    now = datetime.now(timezone.utc)

    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT
                        id,
                        organization_id,
                        scope,
                        justification,
                        created_by_subject,
                        created_at,
                        expires_at,
                        revoked_at,
                        revoked_by_subject,
                        use_count
                    FROM security_break_glass_grant
                    WHERE organization_id = :organization_id
                      AND token_hash = :token_hash
                      AND revoked_at IS NULL
                      AND expires_at > :now
                      AND (scope = :scope OR scope = '*')
                    LIMIT 1
                    """
                ),
                {
                    "organization_id": organization_id,
                    "token_hash": token_hash,
                    "scope": scope,
                    "now": now,
                },
            )
            row = result.fetchone()
            if not row:
                return None

            if consume:
                await session.execute(
                    text(
                        """
                        UPDATE security_break_glass_grant
                        SET
                            use_count = COALESCE(use_count, 0) + 1,
                            last_used_at = :now
                        WHERE id = :id
                        """
                    ),
                    {"id": row.id, "now": now},
                )

    return _to_grant(row)


async def revoke_break_glass_grant(
    *,
    organization_id: str,
    grant_id: str,
    revoked_by_subject: str | None,
) -> bool:
    """Revoke an active grant."""
    now = datetime.now(timezone.utc)
    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    UPDATE security_break_glass_grant
                    SET
                        revoked_at = :now,
                        revoked_by_subject = :revoked_by_subject
                    WHERE id = :grant_id
                      AND organization_id = :organization_id
                      AND revoked_at IS NULL
                    """
                ),
                {
                    "grant_id": grant_id,
                    "organization_id": organization_id,
                    "revoked_by_subject": revoked_by_subject,
                    "now": now,
                },
            )
            return bool(result.rowcount)
