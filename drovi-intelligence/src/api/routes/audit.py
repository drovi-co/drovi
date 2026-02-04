"""Audit ledger verification endpoints."""

from __future__ import annotations

import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from src.auth.middleware import APIKeyContext, require_scope_with_rate_limit
from src.auth.scopes import Scope
from src.db.client import get_db_session
from src.db.rls import set_rls_context

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
