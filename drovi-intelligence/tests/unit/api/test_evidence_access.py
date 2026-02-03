from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.api.routes.evidence import get_evidence_artifact
from src.auth.middleware import APIKeyContext


@pytest.mark.asyncio
async def test_evidence_artifact_access_denied_for_wrong_org():
    ctx = APIKeyContext(organization_id="org_a", scopes=["read"])

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
    ctx = APIKeyContext(organization_id="org_1", scopes=["read"])
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
