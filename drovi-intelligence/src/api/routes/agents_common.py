from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import HTTPException

from src.auth.context import AuthContext
from src.kernel.serialization import json_dumps_canonical


def resolve_org_id(auth: AuthContext, organization_id: str | None) -> str:
    if auth.organization_id == "internal":
        if not organization_id:
            raise HTTPException(status_code=400, detail="organization_id is required for internal requests")
        return organization_id
    if organization_id and organization_id != auth.organization_id:
        raise HTTPException(status_code=403, detail="Organization ID mismatch with authenticated context")
    return auth.organization_id


def assert_org_access(auth: AuthContext, row_org_id: str) -> None:
    if auth.organization_id != "internal" and auth.organization_id != row_org_id:
        raise HTTPException(status_code=403, detail="Access denied")


def as_json(value: Any) -> str:
    return json_dumps_canonical(value)


def row_dict(row: Any, *, json_fields: set[str] | None = None) -> dict[str, Any]:
    payload = dict(row._mapping if hasattr(row, "_mapping") else row)
    if not json_fields:
        return payload
    for field in json_fields:
        value = payload.get(field)
        if isinstance(value, str):
            try:
                payload[field] = json.loads(value)
            except Exception:
                pass
    return payload


def build_snapshot_hash(*, role_id: str, profile_id: str, playbook_id: str, rollout_strategy: dict[str, Any]) -> str:
    payload = {
        "role_id": role_id,
        "profile_id": profile_id,
        "playbook_id": playbook_id,
        "rollout_strategy": rollout_strategy,
    }
    return hashlib.sha256(json_dumps_canonical(payload).encode("utf-8")).hexdigest()
