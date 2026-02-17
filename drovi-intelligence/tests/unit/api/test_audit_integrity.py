from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.api.routes.audit import verify_audit_ledger
from src.auth.context import AuthMetadata, AuthType
from src.auth.middleware import APIKeyContext


def _build_entry_hash(
    *,
    organization_id: str,
    sequence: int,
    action: str,
    actor_type: str,
    actor_id: str | None,
    resource_type: str,
    resource_id: str,
    metadata: dict,
    created_at: datetime,
    prev_hash: str | None,
) -> str:
    payload = {
        "organization_id": organization_id,
        "sequence": sequence,
        "action": action,
        "actor_type": actor_type,
        "actor_id": actor_id,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "metadata": metadata,
        "created_at": created_at.isoformat(),
        "prev_hash": prev_hash,
    }
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _ctx() -> APIKeyContext:
    return APIKeyContext(
        organization_id="org_1",
        auth_subject_id="key_admin",
        scopes=["admin"],
        metadata=AuthMetadata(auth_type=AuthType.API_KEY, key_id="key_admin"),
    )


@pytest.mark.asyncio
async def test_verify_audit_ledger_detects_tampering():
    created_at = datetime(2026, 2, 16, 12, 0, tzinfo=timezone.utc)

    row1_hash = _build_entry_hash(
        organization_id="org_1",
        sequence=1,
        action="created",
        actor_type="user",
        actor_id="usr_1",
        resource_type="uio",
        resource_id="uio_1",
        metadata={},
        created_at=created_at,
        prev_hash=None,
    )
    row2_hash = _build_entry_hash(
        organization_id="org_1",
        sequence=2,
        action="updated",
        actor_type="user",
        actor_id="usr_1",
        resource_type="uio",
        resource_id="uio_1",
        metadata={"field": "status"},
        created_at=created_at,
        prev_hash=row1_hash,
    )

    logs_result = MagicMock()
    logs_result.fetchall.return_value = [
        SimpleNamespace(
            sequence=1,
            prev_hash=None,
            entry_hash=row1_hash,
            action="created",
            actor_type="user",
            actor_id="usr_1",
            resource_type="uio",
            resource_id="uio_1",
            metadata={},
            created_at=created_at,
        ),
        SimpleNamespace(
            sequence=2,
            prev_hash=row1_hash,
            entry_hash="tampered_hash",
            action="updated",
            actor_type="user",
            actor_id="usr_1",
            resource_type="uio",
            resource_id="uio_1",
            metadata={"field": "status"},
            created_at=created_at,
        ),
    ]

    head_result = MagicMock()
    head_result.fetchone.return_value = SimpleNamespace(
        last_sequence=2,
        last_hash="tampered_hash",
    )

    session = AsyncMock()
    session.execute.side_effect = [logs_result, head_result]

    @asynccontextmanager
    async def fake_session():
        yield session

    with patch("src.api.routes.audit.get_db_session", fake_session), patch(
        "src.api.routes.audit.set_rls_context",
        lambda *_args, **_kwargs: None,
    ):
        result = await verify_audit_ledger(organization_id="org_1", ctx=_ctx())

    assert result["valid"] is False
    assert any(entry["reason"] == "hash_mismatch" for entry in result["invalid_entries"])


@pytest.mark.asyncio
async def test_verify_audit_ledger_accepts_valid_chain():
    created_at = datetime(2026, 2, 16, 12, 0, tzinfo=timezone.utc)

    row1_hash = _build_entry_hash(
        organization_id="org_1",
        sequence=1,
        action="created",
        actor_type="user",
        actor_id="usr_1",
        resource_type="uio",
        resource_id="uio_1",
        metadata={},
        created_at=created_at,
        prev_hash=None,
    )

    logs_result = MagicMock()
    logs_result.fetchall.return_value = [
        SimpleNamespace(
            sequence=1,
            prev_hash=None,
            entry_hash=row1_hash,
            action="created",
            actor_type="user",
            actor_id="usr_1",
            resource_type="uio",
            resource_id="uio_1",
            metadata={},
            created_at=created_at,
        ),
    ]

    head_result = MagicMock()
    head_result.fetchone.return_value = SimpleNamespace(
        last_sequence=1,
        last_hash=row1_hash,
    )

    session = AsyncMock()
    session.execute.side_effect = [logs_result, head_result]

    @asynccontextmanager
    async def fake_session():
        yield session

    with patch("src.api.routes.audit.get_db_session", fake_session), patch(
        "src.api.routes.audit.set_rls_context",
        lambda *_args, **_kwargs: None,
    ):
        result = await verify_audit_ledger(organization_id="org_1", ctx=_ctx())

    assert result["valid"] is True
    assert result["invalid_entries"] == []
