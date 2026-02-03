from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.api.routes.live_sessions import start_live_session, LiveSessionStartRequest
from src.auth.middleware import APIKeyContext


@pytest.mark.asyncio
async def test_live_session_requires_consent():
    ctx = APIKeyContext(organization_id="org_1", scopes=["write"])
    request = LiveSessionStartRequest(
        organization_id="org_1",
        session_type="meeting",
        title="Weekly Standup",
        consent_provided=False,
        region="US",
    )

    settings = SimpleNamespace(
        compliance_recording_consent_required=True,
        compliance_default_region="US",
        compliance_blocked_regions=[],
    )

    with patch("src.config.get_settings", return_value=settings), patch(
        "src.api.routes.live_sessions.create_live_session",
        AsyncMock(),
    ), patch(
        "src.api.routes.live_sessions.record_audit_event",
        AsyncMock(),
    ):
        with pytest.raises(HTTPException) as exc:
            await start_live_session(request, ctx=ctx)

    assert exc.value.status_code == 400
    assert "consent" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_live_session_blocks_region():
    ctx = APIKeyContext(organization_id="org_1", scopes=["write"])
    request = LiveSessionStartRequest(
        organization_id="org_1",
        session_type="meeting",
        title="Board Meeting",
        consent_provided=True,
        region="EU",
    )

    settings = SimpleNamespace(
        compliance_recording_consent_required=True,
        compliance_default_region="US",
        compliance_blocked_regions=["EU"],
    )

    with patch("src.config.get_settings", return_value=settings), patch(
        "src.api.routes.live_sessions.create_live_session",
        AsyncMock(),
    ), patch(
        "src.api.routes.live_sessions.record_audit_event",
        AsyncMock(),
    ):
        with pytest.raises(HTTPException) as exc:
            await start_live_session(request, ctx=ctx)

    assert exc.value.status_code == 400
    assert "not allowed" in exc.value.detail.lower()
