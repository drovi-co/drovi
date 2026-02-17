"""Audit ledger verification endpoints."""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.db.client import get_db_session
from src.db.rls import set_rls_context
from src.jobs.queue import EnqueueJobRequest, enqueue_job

router = APIRouter(prefix="/audit", tags=["Audit"])


def _validate_org_id(ctx: APIKeyContext, organization_id: str) -> None:
    if ctx.organization_id != "internal" and organization_id != ctx.organization_id:
        raise HTTPException(status_code=403, detail="Access denied")


@router.get("/verify")
async def verify_audit_ledger(
    organization_id: str = Query(...),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
):
    _validate_org_id(ctx, organization_id)
    set_rls_context(organization_id, is_internal=True)
    try:
        async with get_db_session() as session:
            logs = await session.execute(
                text(
                    """
                    SELECT sequence, prev_hash, entry_hash, action, actor_type, actor_id,
                           resource_type, resource_id, metadata, created_at
                    FROM audit_log
                    WHERE organization_id = :org_id
                    ORDER BY sequence ASC NULLS LAST, created_at ASC
                    """
                ),
                {"org_id": organization_id},
            )
            rows = logs.fetchall()

            head_result = await session.execute(
                text(
                    """
                    SELECT last_sequence, last_hash
                    FROM audit_ledger_head
                    WHERE organization_id = :org_id
                    """
                ),
                {"org_id": organization_id},
            )
            head = head_result.fetchone()
    finally:
        set_rls_context(None, is_internal=False)

    invalid_entries = []
    legacy_entries = 0
    previous_hash = None

    for row in rows:
        if row.sequence is None or row.entry_hash is None:
            legacy_entries += 1
            continue

        if row.prev_hash != previous_hash:
            invalid_entries.append(
                {
                    "sequence": row.sequence,
                    "reason": "prev_hash_mismatch",
                }
            )
            previous_hash = row.entry_hash
            continue

        payload = {
            "organization_id": organization_id,
            "sequence": row.sequence,
            "action": row.action,
            "actor_type": row.actor_type,
            "actor_id": row.actor_id,
            "resource_type": row.resource_type,
            "resource_id": row.resource_id,
            "metadata": row.metadata or {},
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "prev_hash": row.prev_hash,
        }
        serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        expected_hash = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        if expected_hash != row.entry_hash:
            invalid_entries.append(
                {
                    "sequence": row.sequence,
                    "reason": "hash_mismatch",
                }
            )
        previous_hash = row.entry_hash

    is_valid = len(invalid_entries) == 0
    head_ok = True
    if head and previous_hash:
        head_ok = int(head.last_sequence or 0) == int(rows[-1].sequence or 0) and head.last_hash == previous_hash

    return {
        "organization_id": organization_id,
        "total_entries": len(rows),
        "legacy_entries": legacy_entries,
        "valid": is_valid and head_ok,
        "head_ok": head_ok,
        "invalid_entries": invalid_entries,
    }


@router.get("/integrity-snapshot")
async def get_integrity_snapshot(
    organization_id: str = Query(...),
    root_date: str | None = Query(
        default=None,
        description="UTC day in YYYY-MM-DD format. Defaults to previous UTC day.",
    ),
    compute_if_missing: bool = Query(
        default=True,
        description="Compute and persist the daily root if absent.",
    ),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
):
    _validate_org_id(ctx, organization_id)

    try:
        target_date = date.fromisoformat(root_date) if root_date else (datetime.utcnow().date() - timedelta(days=1))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid root_date format; expected YYYY-MM-DD") from exc

    async def _fetch_snapshot() -> Any | None:
        set_rls_context(organization_id, is_internal=True)
        try:
            async with get_db_session() as session:
                result = await session.execute(
                    text(
                        """
                        SELECT organization_id, root_date, artifact_count, event_count, leaf_count,
                               merkle_root, signed_root, signature_alg, signature_key_id, metadata, created_at
                        FROM custody_daily_root
                        WHERE organization_id = :org_id
                          AND root_date = :root_date
                        """
                    ),
                    {"org_id": organization_id, "root_date": target_date},
                )
                return result.fetchone()
        finally:
            set_rls_context(None, is_internal=False)

    row = await _fetch_snapshot()
    if not row and compute_if_missing:
        from src.jobs.custody_integrity import get_custody_integrity_job

        job = get_custody_integrity_job()
        await job.run(organization_id=organization_id, root_date=target_date)
        row = await _fetch_snapshot()

    if not row:
        raise HTTPException(status_code=404, detail="Integrity snapshot not found")

    metadata = row.metadata if isinstance(row.metadata, dict) else {}
    export_payload = {
        "organization_id": row.organization_id,
        "root_date": row.root_date.isoformat() if row.root_date else None,
        "artifact_count": int(row.artifact_count or 0),
        "event_count": int(row.event_count or 0),
        "leaf_count": int(row.leaf_count or 0),
        "merkle_root": row.merkle_root,
        "signed_root": row.signed_root,
        "signature_alg": row.signature_alg,
        "signature_key_id": row.signature_key_id,
        "metadata": metadata,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }

    return {
        **export_payload,
        "export_json": json.dumps(export_payload, sort_keys=True),
    }


@router.post("/integrity-snapshot/refresh")
async def refresh_integrity_snapshot(
    organization_id: str = Query(...),
    root_date: str | None = Query(default=None),
    async_mode: bool = Query(default=True),
    ctx: APIKeyContext = Depends(require_scope_with_rate_limit(Scope.ADMIN)),
):
    _validate_org_id(ctx, organization_id)

    target_date = None
    if root_date:
        try:
            target_date = date.fromisoformat(root_date)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid root_date format; expected YYYY-MM-DD") from exc

    if async_mode:
        bucket = int(datetime.utcnow().timestamp()) // 60
        idempotency_key = f"custody_daily_root:{organization_id}:{(target_date.isoformat() if target_date else 'auto')}:{bucket}"
        job_id = await enqueue_job(
            EnqueueJobRequest(
                organization_id=organization_id,
                job_type="custody.daily_root",
                payload={
                    "organization_id": organization_id,
                    "root_date": target_date.isoformat() if target_date else None,
                },
                priority=0,
                max_attempts=2,
                idempotency_key=idempotency_key,
                resource_key=f"org:{organization_id}:custody_daily_root",
            )
        )
        return {"status": "queued", "job_id": job_id, "idempotency_key": idempotency_key}

    from src.jobs.custody_integrity import get_custody_integrity_job

    job = get_custody_integrity_job()
    result = await job.run(organization_id=organization_id, root_date=target_date)
    return {"status": "completed", "result": result}
