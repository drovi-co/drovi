"""Persistence helpers for world crawl fabric tables."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import re
from typing import Any
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode
from uuid import uuid4

from src.db.client import get_db_pool
from src.db.rls import rls_context


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_url(url: str) -> str:
    """Normalize URL for deterministic dedupe and policy matching."""
    parsed = urlparse((url or "").strip())
    if not parsed.scheme:
        parsed = parsed._replace(scheme="https")
    scheme = (parsed.scheme or "https").lower()
    netloc = (parsed.netloc or "").lower()

    # Strip common tracking params and sort query params for stable identity.
    filtered_query = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=True)
        if not k.lower().startswith("utm_")
        and k.lower() not in {"fbclid", "gclid", "mc_cid", "mc_eid"}
    ]
    query = urlencode(sorted(filtered_query), doseq=True)

    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]

    return urlunparse((scheme, netloc, path, "", query, ""))


def domain_for_url(url: str) -> str:
    parsed = urlparse(url)
    return (parsed.hostname or "").lower()


@dataclass(frozen=True)
class FrontierSeedRequest:
    organization_id: str
    source_key: str
    url: str
    seed_type: str = "manual"
    priority: int = 0
    freshness_policy_minutes: int = 60
    next_fetch_at: datetime | None = None
    metadata: dict[str, Any] | None = None


async def upsert_frontier_seed(request: FrontierSeedRequest) -> dict[str, Any]:
    normalized = normalize_url(request.url)
    domain = domain_for_url(normalized)
    now = utc_now()
    next_fetch_at = request.next_fetch_at or now

    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO crawl_frontier_entry (
                    id,
                    organization_id,
                    source_key,
                    seed_type,
                    url,
                    normalized_url,
                    domain,
                    priority,
                    freshness_policy_minutes,
                    next_fetch_at,
                    status,
                    policy_state,
                    metadata,
                    created_at,
                    updated_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    $8, $9, $10::timestamptz, 'queued', 'allowed',
                    $11::jsonb, $12::timestamptz, $12::timestamptz
                )
                ON CONFLICT (organization_id, normalized_url)
                DO UPDATE SET
                    source_key = EXCLUDED.source_key,
                    seed_type = EXCLUDED.seed_type,
                    url = EXCLUDED.url,
                    domain = EXCLUDED.domain,
                    priority = GREATEST(crawl_frontier_entry.priority, EXCLUDED.priority),
                    freshness_policy_minutes = LEAST(
                        crawl_frontier_entry.freshness_policy_minutes,
                        EXCLUDED.freshness_policy_minutes
                    ),
                    next_fetch_at = LEAST(crawl_frontier_entry.next_fetch_at, EXCLUDED.next_fetch_at),
                    status = CASE
                        WHEN crawl_frontier_entry.status IN ('blocked', 'on_hold')
                            THEN crawl_frontier_entry.status
                        ELSE 'queued'
                    END,
                    metadata = COALESCE(crawl_frontier_entry.metadata, '{}'::jsonb) || EXCLUDED.metadata,
                    updated_at = EXCLUDED.updated_at
                RETURNING
                    id::text,
                    organization_id,
                    source_key,
                    url,
                    normalized_url,
                    domain,
                    priority,
                    freshness_policy_minutes,
                    next_fetch_at,
                    status,
                    policy_state
                """,
                str(uuid4()),
                request.organization_id,
                request.source_key,
                request.seed_type,
                request.url,
                normalized,
                domain,
                int(request.priority),
                max(1, int(request.freshness_policy_minutes)),
                next_fetch_at,
                request.metadata or {},
                now,
            )

    return dict(row) if row else {}


async def get_frontier_entry(entry_id: str) -> dict[str, Any] | None:
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    id::text,
                    organization_id,
                    source_key,
                    seed_type,
                    url,
                    normalized_url,
                    domain,
                    priority,
                    freshness_policy_minutes,
                    next_fetch_at,
                    last_fetch_at,
                    status,
                    fetch_count,
                    failure_count,
                    last_http_status,
                    last_error,
                    policy_state,
                    legal_hold,
                    takedown,
                    metadata
                FROM crawl_frontier_entry
                WHERE id = $1
                """,
                entry_id,
            )
    return dict(row) if row else None


def _entry_score(entry: dict[str, Any], now: datetime) -> tuple[float, datetime]:
    priority = float(entry.get("priority") or 0)
    freshness_minutes = max(1, int(entry.get("freshness_policy_minutes") or 60))
    reference = entry.get("last_fetch_at") or entry.get("next_fetch_at") or now
    if isinstance(reference, str):
        reference = datetime.fromisoformat(reference.replace("Z", "+00:00"))
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    age_minutes = max(0.0, (now - reference).total_seconds() / 60.0)
    freshness_ratio = min(5.0, age_minutes / freshness_minutes)
    return priority + freshness_ratio, entry.get("next_fetch_at") or now


async def claim_due_frontier_entries(
    *,
    limit: int,
    per_domain_limit: int,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """
    Claim due frontier entries with fairness controls.

    Selection is lock-safe (`FOR UPDATE SKIP LOCKED`) and balances by:
    - configured per-domain running limit
    - priority + staleness score (freshness policy aware)
    """
    now = now or utc_now()
    safe_limit = max(1, min(int(limit), 500))
    domain_limit = max(1, min(int(per_domain_limit), 64))

    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                candidates = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        organization_id,
                        source_key,
                        seed_type,
                        url,
                        normalized_url,
                        domain,
                        priority,
                        freshness_policy_minutes,
                        next_fetch_at,
                        last_fetch_at,
                        status,
                        fetch_count,
                        failure_count,
                        policy_state,
                        legal_hold,
                        takedown,
                        metadata
                    FROM crawl_frontier_entry
                    WHERE status IN ('queued', 'failed', 'fetched')
                      AND next_fetch_at <= $1::timestamptz
                      AND policy_state = 'allowed'
                      AND legal_hold = false
                      AND takedown = false
                    ORDER BY priority DESC, next_fetch_at ASC
                    LIMIT $2
                    FOR UPDATE SKIP LOCKED
                    """,
                    now,
                    safe_limit * 4,
                )

                if not candidates:
                    return []

                running_rows = await conn.fetch(
                    """
                    SELECT domain, COUNT(1)::int AS running_count
                    FROM crawl_frontier_entry
                    WHERE status = 'fetching'
                    GROUP BY domain
                    """
                )
                running_by_domain = {str(row["domain"]): int(row["running_count"]) for row in running_rows}

                enriched = [dict(row) for row in candidates]
                enriched.sort(key=lambda item: _entry_score(item, now), reverse=True)

                selected: list[dict[str, Any]] = []
                for item in enriched:
                    domain = str(item.get("domain") or "")
                    running = running_by_domain.get(domain, 0)
                    if running >= domain_limit:
                        continue
                    selected.append(item)
                    running_by_domain[domain] = running + 1
                    if len(selected) >= safe_limit:
                        break

                if not selected:
                    return []

                selected_ids = [item["id"] for item in selected]
                await conn.execute(
                    """
                    UPDATE crawl_frontier_entry
                    SET status = 'fetching',
                        fetch_count = fetch_count + 1,
                        updated_at = $2::timestamptz
                    WHERE id = ANY($1::text[])
                    """,
                    selected_ids,
                    now,
                )

                for item in selected:
                    item["status"] = "fetching"
                return selected


async def mark_frontier_blocked(
    *,
    entry_id: str,
    policy_state: str,
    reason: str,
) -> None:
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE crawl_frontier_entry
                SET status = CASE
                        WHEN $2 IN ('legal_hold', 'takedown') THEN 'on_hold'
                        ELSE 'blocked'
                    END,
                    policy_state = $2,
                    last_error = $3,
                    updated_at = $4::timestamptz
                WHERE id = $1
                """,
                entry_id,
                policy_state,
                reason[:2000],
                utc_now(),
            )


async def mark_frontier_fetch_succeeded(
    *,
    entry_id: str,
    http_status: int,
    next_fetch_in_minutes: int,
    metadata_patch: dict[str, Any] | None = None,
) -> None:
    now = utc_now()
    next_fetch_at = now + timedelta(minutes=max(1, int(next_fetch_in_minutes)))
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE crawl_frontier_entry
                SET status = 'fetched',
                    last_fetch_at = $2::timestamptz,
                    next_fetch_at = $3::timestamptz,
                    last_http_status = $4,
                    last_error = NULL,
                    failure_count = 0,
                    metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
                    updated_at = $2::timestamptz
                WHERE id = $1
                """,
                entry_id,
                now,
                next_fetch_at,
                int(http_status),
                metadata_patch or {},
            )


async def mark_frontier_fetch_failed(
    *,
    entry_id: str,
    error_message: str,
    http_status: int | None,
    retry_delay_seconds: int,
) -> None:
    now = utc_now()
    next_fetch_at = now + timedelta(seconds=max(30, int(retry_delay_seconds)))
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE crawl_frontier_entry
                SET status = 'failed',
                    failure_count = failure_count + 1,
                    last_error = $2,
                    last_http_status = $3,
                    next_fetch_at = $4::timestamptz,
                    updated_at = $1::timestamptz
                WHERE id = $5
                """,
                now,
                error_message[:2000],
                int(http_status) if http_status is not None else None,
                next_fetch_at,
                entry_id,
            )


async def create_crawl_snapshot(
    *,
    snapshot_id: str | None = None,
    organization_id: str,
    frontier_entry_id: str,
    url: str,
    content_type: str | None,
    http_status: int | None,
    rendered: bool,
    payload_hash: str,
    payload_size_bytes: int,
    storage_ref: str | None,
) -> str:
    snapshot_id = str(snapshot_id or uuid4())
    now = utc_now()
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO crawl_snapshot (
                    id,
                    organization_id,
                    frontier_entry_id,
                    url,
                    content_type,
                    http_status,
                    fetched_at,
                    rendered,
                    payload_hash,
                    payload_size_bytes,
                    storage_ref,
                    parsed_metadata,
                    created_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, $10, $11, '{}'::jsonb, $7::timestamptz
                )
                """,
                snapshot_id,
                organization_id,
                frontier_entry_id,
                url,
                content_type,
                int(http_status) if http_status is not None else None,
                now,
                bool(rendered),
                payload_hash,
                max(0, int(payload_size_bytes)),
                storage_ref,
            )
    return snapshot_id


async def get_snapshot(snapshot_id: str) -> dict[str, Any] | None:
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    id::text,
                    organization_id,
                    frontier_entry_id,
                    url,
                    content_type,
                    http_status,
                    fetched_at,
                    rendered,
                    payload_hash,
                    payload_size_bytes,
                    storage_ref,
                    parsed_text,
                    parsed_metadata,
                    diff_from_snapshot_id,
                    significance_score,
                    is_meaningful_delta
                FROM crawl_snapshot
                WHERE id = $1
                """,
                snapshot_id,
            )
    return dict(row) if row else None


async def get_latest_snapshot_for_entry(
    *,
    frontier_entry_id: str,
    exclude_snapshot_id: str | None = None,
) -> dict[str, Any] | None:
    query = """
        SELECT
            id::text,
            organization_id,
            frontier_entry_id,
            parsed_text,
            parsed_metadata,
            fetched_at
        FROM crawl_snapshot
        WHERE frontier_entry_id = $1
    """
    params: list[Any] = [frontier_entry_id]
    if exclude_snapshot_id:
        query += " AND id <> $2"
        params.append(exclude_snapshot_id)
    query += " ORDER BY fetched_at DESC LIMIT 1"

    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(query, *params)
    return dict(row) if row else None


async def update_snapshot_parse(
    *,
    snapshot_id: str,
    parsed_text: str,
    parsed_metadata: dict[str, Any],
) -> None:
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE crawl_snapshot
                SET parsed_text = $2,
                    parsed_metadata = $3::jsonb
                WHERE id = $1
                """,
                snapshot_id,
                parsed_text,
                parsed_metadata or {},
            )


async def update_snapshot_diff(
    *,
    snapshot_id: str,
    diff_from_snapshot_id: str | None,
    significance_score: float,
    is_meaningful_delta: bool,
) -> None:
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE crawl_snapshot
                SET diff_from_snapshot_id = $2,
                    significance_score = $3,
                    is_meaningful_delta = $4
                WHERE id = $1
                """,
                snapshot_id,
                diff_from_snapshot_id,
                float(max(0.0, min(significance_score, 1.0))),
                bool(is_meaningful_delta),
            )


async def write_audit_log(
    *,
    organization_id: str,
    event_type: str,
    frontier_entry_id: str | None = None,
    snapshot_id: str | None = None,
    severity: str = "info",
    decision: str | None = None,
    reason: str | None = None,
    actor: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> str:
    audit_id = str(uuid4())
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO crawl_audit_log (
                    id,
                    organization_id,
                    frontier_entry_id,
                    snapshot_id,
                    event_type,
                    severity,
                    decision,
                    reason,
                    actor,
                    metadata,
                    occurred_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz
                )
                """,
                audit_id,
                organization_id,
                frontier_entry_id,
                snapshot_id,
                event_type,
                severity,
                decision,
                reason,
                actor,
                metadata or {},
                utc_now(),
            )
    return audit_id


async def list_frontier_entries(
    *,
    organization_id: str,
    limit: int = 50,
    status: str | None = None,
) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit), 500))
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            if status:
                rows = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        source_key,
                        seed_type,
                        url,
                        domain,
                        priority,
                        freshness_policy_minutes,
                        next_fetch_at,
                        last_fetch_at,
                        status,
                        failure_count,
                        policy_state
                    FROM crawl_frontier_entry
                    WHERE organization_id = $1
                      AND status = $2
                    ORDER BY next_fetch_at ASC
                    LIMIT $3
                    """,
                    organization_id,
                    status,
                    safe_limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        source_key,
                        seed_type,
                        url,
                        domain,
                        priority,
                        freshness_policy_minutes,
                        next_fetch_at,
                        last_fetch_at,
                        status,
                        failure_count,
                        policy_state
                    FROM crawl_frontier_entry
                    WHERE organization_id = $1
                    ORDER BY next_fetch_at ASC
                    LIMIT $2
                    """,
                    organization_id,
                    safe_limit,
                )
    return [dict(row) for row in rows]


async def list_audit_logs(
    *,
    organization_id: str,
    limit: int = 100,
    event_type: str | None = None,
) -> list[dict[str, Any]]:
    safe_limit = max(1, min(int(limit), 1000))
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            if event_type:
                rows = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        frontier_entry_id,
                        snapshot_id,
                        event_type,
                        severity,
                        decision,
                        reason,
                        actor,
                        metadata,
                        occurred_at
                    FROM crawl_audit_log
                    WHERE organization_id = $1
                      AND event_type = $2
                    ORDER BY occurred_at DESC
                    LIMIT $3
                    """,
                    organization_id,
                    event_type,
                    safe_limit,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        frontier_entry_id,
                        snapshot_id,
                        event_type,
                        severity,
                        decision,
                        reason,
                        actor,
                        metadata,
                        occurred_at
                    FROM crawl_audit_log
                    WHERE organization_id = $1
                    ORDER BY occurred_at DESC
                    LIMIT $2
                    """,
                    organization_id,
                    safe_limit,
                )
    return [dict(row) for row in rows]


async def list_policy_rules(*, organization_id: str, only_active: bool = True) -> list[dict[str, Any]]:
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            if only_active:
                rows = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        organization_id,
                        rule_type,
                        scope,
                        action,
                        reason,
                        active,
                        created_by,
                        expires_at,
                        metadata
                    FROM crawl_policy_rule
                    WHERE organization_id = $1
                      AND active = true
                      AND (expires_at IS NULL OR expires_at > $2::timestamptz)
                    ORDER BY created_at DESC
                    """,
                    organization_id,
                    utc_now(),
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT
                        id::text,
                        organization_id,
                        rule_type,
                        scope,
                        action,
                        reason,
                        active,
                        created_by,
                        expires_at,
                        metadata
                    FROM crawl_policy_rule
                    WHERE organization_id = $1
                    ORDER BY created_at DESC
                    """,
                    organization_id,
                )
    return [dict(row) for row in rows]


async def upsert_policy_rule(
    *,
    organization_id: str,
    rule_type: str,
    scope: str,
    action: str,
    reason: str | None,
    created_by: str | None,
    expires_at: datetime | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = utc_now()
    row_id = str(uuid4())
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO crawl_policy_rule (
                    id,
                    organization_id,
                    rule_type,
                    scope,
                    action,
                    reason,
                    active,
                    created_by,
                    expires_at,
                    metadata,
                    created_at,
                    updated_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, true, $7, $8::timestamptz, $9::jsonb, $10::timestamptz, $10::timestamptz
                )
                ON CONFLICT (organization_id, rule_type, scope)
                DO UPDATE SET
                    action = EXCLUDED.action,
                    reason = EXCLUDED.reason,
                    active = true,
                    created_by = EXCLUDED.created_by,
                    expires_at = EXCLUDED.expires_at,
                    metadata = COALESCE(crawl_policy_rule.metadata, '{}'::jsonb) || EXCLUDED.metadata,
                    updated_at = EXCLUDED.updated_at
                RETURNING
                    id::text,
                    organization_id,
                    rule_type,
                    scope,
                    action,
                    reason,
                    active,
                    created_by,
                    expires_at,
                    metadata
                """,
                row_id,
                organization_id,
                rule_type,
                scope,
                action,
                reason,
                created_by,
                expires_at,
                metadata or {},
                now,
            )
    return dict(row) if row else {}


async def apply_policy_to_frontier(
    *,
    organization_id: str,
    scope: str,
    policy_state: str,
) -> int:
    """
    Apply policy to matching frontier entries.

    Scope handling:
    - URL scope (http/https): match normalized URL prefix.
    - Domain scope: match exact domain or subdomain suffix.
    """
    normalized_scope = normalize_url(scope) if scope.startswith(("http://", "https://")) else scope.lower()
    with rls_context(None, is_internal=True):
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            if normalized_scope.startswith(("http://", "https://")):
                result = await conn.execute(
                    """
                    UPDATE crawl_frontier_entry
                    SET policy_state = $3,
                        status = CASE
                            WHEN $3 IN ('legal_hold', 'takedown') THEN 'on_hold'
                            ELSE 'blocked'
                        END,
                        legal_hold = CASE WHEN $3 = 'legal_hold' THEN true ELSE legal_hold END,
                        takedown = CASE WHEN $3 = 'takedown' THEN true ELSE takedown END,
                        updated_at = $4::timestamptz
                    WHERE organization_id = $1
                      AND normalized_url LIKE ($2 || '%')
                    """,
                    organization_id,
                    normalized_scope,
                    policy_state,
                    utc_now(),
                )
            else:
                result = await conn.execute(
                    """
                    UPDATE crawl_frontier_entry
                    SET policy_state = $3,
                        status = CASE
                            WHEN $3 IN ('legal_hold', 'takedown') THEN 'on_hold'
                            ELSE 'blocked'
                        END,
                        legal_hold = CASE WHEN $3 = 'legal_hold' THEN true ELSE legal_hold END,
                        takedown = CASE WHEN $3 = 'takedown' THEN true ELSE takedown END,
                        updated_at = $4::timestamptz
                    WHERE organization_id = $1
                      AND (
                        domain = $2
                        OR domain LIKE ('%.' || $2)
                      )
                    """,
                    organization_id,
                    normalized_scope,
                    policy_state,
                    utc_now(),
                )
    # asyncpg result format: "UPDATE <n>"
    try:
        return int(str(result).split(" ")[1])
    except Exception:
        return 0
