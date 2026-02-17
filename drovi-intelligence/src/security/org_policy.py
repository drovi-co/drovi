"""Organization security policy helpers."""

from __future__ import annotations

from dataclasses import dataclass
from ipaddress import ip_address, ip_network
import time
from typing import Any

import structlog
from fastapi import HTTPException, Request
from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import rls_context

logger = structlog.get_logger()

_CACHE_TTL_SECONDS = 30
_policy_cache: dict[str, tuple[float, "OrgSecurityPolicy"]] = {}


@dataclass(frozen=True)
class OrgSecurityPolicy:
    """Resolved org security policy with safe defaults."""

    organization_id: str
    sso_enforced: bool = False
    password_fallback_enabled: bool = True
    password_fallback_environments: tuple[str, ...] = ("development", "test")
    ip_allowlist: tuple[str, ...] = ()
    evidence_masking_enabled: bool = True
    break_glass_enabled: bool = False
    break_glass_required_actions: tuple[str, ...] = ()

    def allows_password_auth(self, environment: str) -> bool:
        env = str(environment or "").strip().lower()
        if not self.sso_enforced:
            return True
        if not self.password_fallback_enabled:
            return False
        return env in self.password_fallback_environments

    def requires_break_glass(self, action: str) -> bool:
        if not self.break_glass_enabled:
            return False
        normalized = str(action or "").strip().lower()
        return normalized in {item.strip().lower() for item in self.break_glass_required_actions}

    def is_ip_allowed(self, candidate_ip: str | None) -> bool:
        # Empty allowlist means unrestricted.
        if not self.ip_allowlist:
            return True
        if not candidate_ip:
            return False

        try:
            parsed_ip = ip_address(candidate_ip.strip())
        except ValueError:
            return False

        for entry in self.ip_allowlist:
            value = str(entry or "").strip()
            if not value:
                continue
            try:
                if "/" in value:
                    if parsed_ip in ip_network(value, strict=False):
                        return True
                elif parsed_ip == ip_address(value):
                    return True
            except ValueError:
                logger.warning(
                    "Invalid org IP allowlist entry ignored",
                    organization_id=self.organization_id,
                    value=value,
                )
                continue
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "organization_id": self.organization_id,
            "sso_enforced": self.sso_enforced,
            "password_fallback_enabled": self.password_fallback_enabled,
            "password_fallback_environments": list(self.password_fallback_environments),
            "ip_allowlist": list(self.ip_allowlist),
            "evidence_masking_enabled": self.evidence_masking_enabled,
            "break_glass_enabled": self.break_glass_enabled,
            "break_glass_required_actions": list(self.break_glass_required_actions),
        }


def invalidate_org_security_policy_cache(organization_id: str | None = None) -> None:
    """Invalidate one policy entry or the entire cache."""
    if organization_id:
        _policy_cache.pop(organization_id, None)
        return
    _policy_cache.clear()


def _from_row(organization_id: str, row: Any | None) -> OrgSecurityPolicy:
    if not row:
        return OrgSecurityPolicy(organization_id=organization_id)

    password_envs = tuple(
        str(item).strip().lower()
        for item in (getattr(row, "password_fallback_environments", None) or [])
        if str(item).strip()
    ) or ("development", "test")

    ip_allowlist = tuple(
        str(item).strip()
        for item in (getattr(row, "ip_allowlist", None) or [])
        if str(item).strip()
    )
    break_glass_actions = tuple(
        str(item).strip()
        for item in (getattr(row, "break_glass_required_actions", None) or [])
        if str(item).strip()
    )

    return OrgSecurityPolicy(
        organization_id=organization_id,
        sso_enforced=bool(getattr(row, "sso_enforced", False)),
        password_fallback_enabled=bool(getattr(row, "password_fallback_enabled", True)),
        password_fallback_environments=password_envs,
        ip_allowlist=ip_allowlist,
        evidence_masking_enabled=bool(getattr(row, "evidence_masking_enabled", True)),
        break_glass_enabled=bool(getattr(row, "break_glass_enabled", True)),
        break_glass_required_actions=break_glass_actions,
    )


async def get_org_security_policy(
    organization_id: str,
    *,
    force_refresh: bool = False,
) -> OrgSecurityPolicy:
    """Load policy for an org, with short-lived in-memory cache."""
    org_id = str(organization_id or "").strip()
    if not org_id:
        return OrgSecurityPolicy(organization_id="")
    if org_id == "internal":
        return OrgSecurityPolicy(organization_id="internal", break_glass_enabled=False, evidence_masking_enabled=False)

    now = time.time()
    if not force_refresh:
        cached = _policy_cache.get(org_id)
        if cached and cached[0] > now:
            return cached[1]

    try:
        with rls_context(org_id, is_internal=True):
            async with get_db_session() as session:
                result = await session.execute(
                    text(
                        """
                        SELECT
                            organization_id,
                            sso_enforced,
                            password_fallback_enabled,
                            password_fallback_environments,
                            ip_allowlist,
                            evidence_masking_enabled,
                            break_glass_enabled,
                            break_glass_required_actions
                        FROM organization_security_policy
                        WHERE organization_id = :org_id
                        """
                    ),
                    {"org_id": org_id},
                )
                row = result.fetchone()
    except Exception as exc:
        logger.warning(
            "Falling back to default org security policy",
            organization_id=org_id,
            error=str(exc),
        )
        policy = OrgSecurityPolicy(organization_id=org_id)
        _policy_cache[org_id] = (now + _CACHE_TTL_SECONDS, policy)
        return policy

    policy = _from_row(org_id, row)
    _policy_cache[org_id] = (now + _CACHE_TTL_SECONDS, policy)
    return policy


async def upsert_org_security_policy(
    organization_id: str,
    *,
    sso_enforced: bool | None = None,
    password_fallback_enabled: bool | None = None,
    password_fallback_environments: list[str] | None = None,
    ip_allowlist: list[str] | None = None,
    evidence_masking_enabled: bool | None = None,
    break_glass_enabled: bool | None = None,
    break_glass_required_actions: list[str] | None = None,
) -> OrgSecurityPolicy:
    """Create/update policy row and return resolved policy."""
    current = await get_org_security_policy(organization_id, force_refresh=True)

    payload = {
        "organization_id": organization_id,
        "sso_enforced": current.sso_enforced if sso_enforced is None else bool(sso_enforced),
        "password_fallback_enabled": (
            current.password_fallback_enabled
            if password_fallback_enabled is None
            else bool(password_fallback_enabled)
        ),
        "password_fallback_environments": (
            list(current.password_fallback_environments)
            if password_fallback_environments is None
            else [
                str(env).strip().lower()
                for env in password_fallback_environments
                if str(env).strip()
            ]
        ),
        "ip_allowlist": (
            list(current.ip_allowlist)
            if ip_allowlist is None
            else [str(entry).strip() for entry in ip_allowlist if str(entry).strip()]
        ),
        "evidence_masking_enabled": (
            current.evidence_masking_enabled
            if evidence_masking_enabled is None
            else bool(evidence_masking_enabled)
        ),
        "break_glass_enabled": (
            current.break_glass_enabled if break_glass_enabled is None else bool(break_glass_enabled)
        ),
        "break_glass_required_actions": (
            list(current.break_glass_required_actions)
            if break_glass_required_actions is None
            else [
                str(action).strip().lower()
                for action in break_glass_required_actions
                if str(action).strip()
            ]
        ),
    }

    if not payload["password_fallback_environments"]:
        payload["password_fallback_environments"] = ["development", "test"]
    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO organization_security_policy (
                        organization_id,
                        sso_enforced,
                        password_fallback_enabled,
                        password_fallback_environments,
                        ip_allowlist,
                        evidence_masking_enabled,
                        break_glass_enabled,
                        break_glass_required_actions,
                        created_at,
                        updated_at
                    ) VALUES (
                        :organization_id,
                        :sso_enforced,
                        :password_fallback_enabled,
                        :password_fallback_environments,
                        :ip_allowlist,
                        :evidence_masking_enabled,
                        :break_glass_enabled,
                        :break_glass_required_actions,
                        NOW(),
                        NOW()
                    )
                    ON CONFLICT (organization_id) DO UPDATE SET
                        sso_enforced = EXCLUDED.sso_enforced,
                        password_fallback_enabled = EXCLUDED.password_fallback_enabled,
                        password_fallback_environments = EXCLUDED.password_fallback_environments,
                        ip_allowlist = EXCLUDED.ip_allowlist,
                        evidence_masking_enabled = EXCLUDED.evidence_masking_enabled,
                        break_glass_enabled = EXCLUDED.break_glass_enabled,
                        break_glass_required_actions = EXCLUDED.break_glass_required_actions,
                        updated_at = NOW()
                    """
                ),
                payload,
            )

    invalidate_org_security_policy_cache(organization_id)
    return await get_org_security_policy(organization_id, force_refresh=True)


def get_client_ip(request: Request) -> str | None:
    """
    Resolve client IP from proxy headers or socket metadata.

    Priority:
    1. X-Forwarded-For (first address)
    2. X-Real-IP
    3. request.client.host
    """
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        value = forwarded_for.split(",")[0].strip()
        if value:
            return value
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        value = real_ip.strip()
        if value:
            return value
    if request.client and request.client.host:
        return request.client.host
    return None


async def enforce_org_ip_allowlist(request: Request, policy: OrgSecurityPolicy) -> None:
    """Deny request when org allowlist exists and caller IP is outside it."""
    if not policy.ip_allowlist:
        return

    caller_ip = get_client_ip(request)
    if policy.is_ip_allowed(caller_ip):
        return

    logger.warning(
        "Organization IP allowlist denied request",
        organization_id=policy.organization_id,
        caller_ip=caller_ip,
        path=request.url.path,
    )
    raise HTTPException(
        status_code=403,
        detail="Access denied by organization IP allowlist policy",
    )
