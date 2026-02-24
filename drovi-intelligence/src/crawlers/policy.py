"""Crawl compliance policy engine (robots/ToS + allow/deny + legal workflows)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re
from typing import Any, Callable
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx

from src.config import get_settings
from src.crawlers.repository import (
    apply_policy_to_frontier,
    domain_for_url,
    list_policy_rules,
    normalize_url,
    upsert_policy_rule,
    write_audit_log,
)


@dataclass(frozen=True)
class CrawlPolicyDecision:
    allowed: bool
    policy_state: str
    reason: str
    matched_rule_id: str | None = None


def _str_list(values: list[str] | tuple[str, ...] | None) -> list[str]:
    return [str(value).strip().lower() for value in (values or []) if str(value).strip()]


def _domain_matches(scope: str, domain: str) -> bool:
    normalized_scope = scope.lower().strip()
    normalized_domain = domain.lower().strip()
    if not normalized_scope or not normalized_domain:
        return False
    return normalized_domain == normalized_scope or normalized_domain.endswith(f".{normalized_scope}")


def _scope_matches_url(scope: str, url: str, domain: str) -> bool:
    normalized_scope = scope.strip()
    if not normalized_scope:
        return False
    if normalized_scope.startswith(("http://", "https://")):
        return normalize_url(url).startswith(normalize_url(normalized_scope))
    return _domain_matches(normalized_scope, domain)


def _is_expired(rule: dict[str, Any], now: datetime) -> bool:
    expires_at = rule.get("expires_at")
    if not expires_at:
        return False
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except Exception:
            return False
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return expires_at <= now
    return False


async def _default_robots_fetcher(url: str, timeout_seconds: float) -> str | None:
    robots_url = urljoin(url, "/robots.txt")
    async with httpx.AsyncClient(timeout=max(1.0, timeout_seconds)) as client:
        response = await client.get(
            robots_url,
            headers={"User-Agent": get_settings().crawl_user_agent},
            follow_redirects=True,
        )
        if response.status_code >= 400:
            return None
        return response.text


def _robots_allows(*, user_agent: str, url: str, robots_txt: str) -> bool:
    parser = RobotFileParser()
    parser.parse((robots_txt or "").splitlines())
    return bool(parser.can_fetch(user_agent, url))


async def evaluate_crawl_policy(
    *,
    organization_id: str,
    url: str,
    robots_fetcher: Callable[[str, float], Any] | None = None,
) -> CrawlPolicyDecision:
    settings = get_settings()
    normalized_url = normalize_url(url)
    domain = domain_for_url(normalized_url)
    now = datetime.now(timezone.utc)

    denylist = _str_list(settings.crawl_domain_denylist)
    allowlist = _str_list(settings.crawl_domain_allowlist)

    if any(_domain_matches(scope, domain) for scope in denylist):
        return CrawlPolicyDecision(
            allowed=False,
            policy_state="denylist_blocked",
            reason=f"Domain denied by global denylist: {domain}",
        )

    if allowlist and not any(_domain_matches(scope, domain) for scope in allowlist):
        return CrawlPolicyDecision(
            allowed=False,
            policy_state="allowlist_blocked",
            reason=f"Domain not in global allowlist: {domain}",
        )

    rules = await list_policy_rules(organization_id=organization_id, only_active=True)
    for rule in rules:
        if _is_expired(rule, now):
            continue
        if not _scope_matches_url(str(rule.get("scope") or ""), normalized_url, domain):
            continue

        rule_type = str(rule.get("rule_type") or "").strip().lower()
        action = str(rule.get("action") or "").strip().lower()

        if rule_type in {"legal_hold_url", "legal_hold_domain"} or action == "hold":
            return CrawlPolicyDecision(
                allowed=False,
                policy_state="legal_hold",
                reason=rule.get("reason") or "Legal hold policy matched",
                matched_rule_id=rule.get("id"),
            )
        if rule_type in {"takedown_url", "takedown_domain"}:
            return CrawlPolicyDecision(
                allowed=False,
                policy_state="takedown",
                reason=rule.get("reason") or "Takedown policy matched",
                matched_rule_id=rule.get("id"),
            )
        if action == "deny":
            return CrawlPolicyDecision(
                allowed=False,
                policy_state="policy_denied",
                reason=rule.get("reason") or "Denied by crawl policy rule",
                matched_rule_id=rule.get("id"),
            )
        if action == "allow":
            break

    if settings.crawl_robots_enforced:
        fetcher = robots_fetcher or _default_robots_fetcher
        try:
            robots_txt = await fetcher(normalized_url, float(settings.crawl_robots_timeout_seconds))
        except Exception:
            robots_txt = None
        if robots_txt:
            allowed = _robots_allows(
                user_agent=settings.crawl_user_agent,
                url=normalized_url,
                robots_txt=str(robots_txt),
            )
            if not allowed:
                return CrawlPolicyDecision(
                    allowed=False,
                    policy_state="robots_blocked",
                    reason="robots.txt disallows crawl path for configured user-agent",
                )

    return CrawlPolicyDecision(allowed=True, policy_state="allowed", reason="Crawl permitted")


def _normalize_policy_scope(scope: str) -> str:
    raw = (scope or "").strip()
    if raw.startswith(("http://", "https://")):
        return normalize_url(raw)
    parsed = urlparse(raw if re.match(r"^[a-z][a-z0-9+.-]*://", raw, flags=re.I) else f"https://{raw}")
    return (parsed.hostname or raw).lower().strip()


async def request_takedown(
    *,
    organization_id: str,
    scope: str,
    reason: str,
    actor: str | None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_scope = _normalize_policy_scope(scope)
    rule_type = "takedown_url" if normalized_scope.startswith(("http://", "https://")) else "takedown_domain"
    rule = await upsert_policy_rule(
        organization_id=organization_id,
        rule_type=rule_type,
        scope=normalized_scope,
        action="deny",
        reason=reason,
        created_by=actor,
        metadata=metadata or {},
    )
    affected = await apply_policy_to_frontier(
        organization_id=organization_id,
        scope=normalized_scope,
        policy_state="takedown",
    )
    await write_audit_log(
        organization_id=organization_id,
        event_type="crawl.policy.takedown",
        severity="warning",
        decision="deny",
        reason=reason,
        actor=actor,
        metadata={
            "scope": normalized_scope,
            "affected_frontier_entries": affected,
            "rule_id": rule.get("id"),
            **(metadata or {}),
        },
    )
    return {"rule": rule, "affected_frontier_entries": affected}


async def request_legal_hold(
    *,
    organization_id: str,
    scope: str,
    reason: str,
    actor: str | None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_scope = _normalize_policy_scope(scope)
    rule_type = "legal_hold_url" if normalized_scope.startswith(("http://", "https://")) else "legal_hold_domain"
    rule = await upsert_policy_rule(
        organization_id=organization_id,
        rule_type=rule_type,
        scope=normalized_scope,
        action="hold",
        reason=reason,
        created_by=actor,
        metadata=metadata or {},
    )
    affected = await apply_policy_to_frontier(
        organization_id=organization_id,
        scope=normalized_scope,
        policy_state="legal_hold",
    )
    await write_audit_log(
        organization_id=organization_id,
        event_type="crawl.policy.legal_hold",
        severity="warning",
        decision="hold",
        reason=reason,
        actor=actor,
        metadata={
            "scope": normalized_scope,
            "affected_frontier_entries": affected,
            "rule_id": rule.get("id"),
            **(metadata or {}),
        },
    )
    return {"rule": rule, "affected_frontier_entries": affected}
