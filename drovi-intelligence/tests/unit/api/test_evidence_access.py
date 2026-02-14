from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.api.routes.evidence import (
    get_evidence_artifact,
    presign_evidence_artifact_url,
)
from src.auth.context import AuthMetadata, AuthType
from src.auth.middleware import APIKeyContext


@pytest.mark.asyncio
async def test_evidence_artifact_access_denied_for_wrong_org():
    ctx = APIKeyContext(
        organization_id="org_a",
        auth_subject_id="key_test",
        scopes=["read"],
        metadata=AuthMetadata(auth_type=AuthType.API_KEY, key_id="key_test"),
    )

    with pytest.raises(HTTPException) as exc:
        await get_evidence_artifact(
            artifact_id="artifact_1",
            organization_id="org_b",
            include_url=False,
            ctx=ctx,
        )

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_evidence_artifact_presigned_url_scoped():
    ctx = APIKeyContext(
        organization_id="org_1",
        auth_subject_id="key_test",
        scopes=["read"],
        metadata=AuthMetadata(auth_type=AuthType.API_KEY, key_id="key_test"),
    )
    session = AsyncMock()
    rows = MagicMock()
    from datetime import datetime

    rows.fetchone.return_value = SimpleNamespace(
        id="artifact_1",
        artifact_type="audio_chunk",
        mime_type="audio/wav",
        storage_backend="local",
        storage_path="/tmp/artifact.wav",
        byte_size=123,
        sha256="hash",
        metadata={},
        created_at=datetime(2024, 1, 1),
        retention_until=None,
        immutable=False,
        legal_hold=False,
    )
    session.execute.return_value = rows

    @asynccontextmanager
    async def fake_session():
        yield session

    storage = AsyncMock()
    storage.create_presigned_url.return_value = "https://signed.example"

    with patch("src.db.client.get_db_session", fake_session), patch(
        "src.api.routes.evidence.get_evidence_storage",
        return_value=storage,
    ), patch(
        "src.api.routes.evidence.record_evidence_audit",
        AsyncMock(),
    ):
        response = await get_evidence_artifact(
            artifact_id="artifact_1",
            organization_id="org_1",
            include_url=True,
            ctx=ctx,
        )

    assert response.presigned_url == "https://signed.example"


@pytest.mark.asyncio
async def test_evidence_artifact_default_does_not_presign():
    ctx = APIKeyContext(
        organization_id="org_1",
        auth_subject_id="key_test",
        scopes=["read"],
        metadata=AuthMetadata(auth_type=AuthType.API_KEY, key_id="key_test"),
    )
    session = AsyncMock()
    rows = MagicMock()
    from datetime import datetime

    rows.fetchone.return_value = SimpleNamespace(
        id="artifact_1",
        artifact_type="audio_chunk",
        mime_type="audio/wav",
        storage_backend="local",
        storage_path="/tmp/artifact.wav",
        byte_size=123,
        sha256="hash",
        metadata={},
        created_at=datetime(2024, 1, 1),
        retention_until=None,
        immutable=False,
        legal_hold=False,
    )
    session.execute.return_value = rows

    @asynccontextmanager
    async def fake_session():
        yield session

    storage = AsyncMock()
    storage.create_presigned_url.return_value = "https://signed.example"

    with patch("src.db.client.get_db_session", fake_session), patch(
        "src.api.routes.evidence.get_evidence_storage",
        return_value=storage,
    ), patch(
        "src.api.routes.evidence.record_evidence_audit",
        AsyncMock(),
    ):
        response = await get_evidence_artifact(
            artifact_id="artifact_1",
            organization_id="org_1",
            include_url=False,
            ctx=ctx,
        )

    assert response.presigned_url is None
    storage.create_presigned_url.assert_not_called()


@pytest.mark.asyncio
async def test_presign_endpoint_records_access_audit():
    ctx = APIKeyContext(
        organization_id="org_1",
        auth_subject_id="key_test",
        scopes=["read"],
        metadata=AuthMetadata(auth_type=AuthType.API_KEY, key_id="key_test"),
    )
    session = AsyncMock()
    rows = MagicMock()

    rows.fetchone.return_value = SimpleNamespace(
        id="artifact_1",
        storage_path="/tmp/artifact.wav",
    )
    session.execute.return_value = rows

    @asynccontextmanager
    async def fake_session():
        yield session

    storage = AsyncMock()
    storage.create_presigned_url.return_value = "https://signed.example"
    audit_mock = AsyncMock()

    with patch("src.db.client.get_db_session", fake_session), patch(
        "src.api.routes.evidence.get_evidence_storage",
        return_value=storage,
    ), patch("src.api.routes.evidence.record_evidence_audit", audit_mock):
        response = await presign_evidence_artifact_url(
            artifact_id="artifact_1",
            organization_id="org_1",
            ctx=ctx,
        )

    assert response.artifact_id == "artifact_1"
    assert response.presigned_url == "https://signed.example"
    audit_mock.assert_awaited_once()
    kwargs = audit_mock.await_args.kwargs
    assert kwargs["action"] == "access_requested"
    assert kwargs["artifact_id"] == "artifact_1"
