from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.api.routes.auth import require_pilot_auth
from src.auth.pilot_accounts import PilotToken


@pytest.mark.api
def test_org_manifest_includes_etag_and_is_cacheable(client, app):
    async def _mock_pilot_auth():
        now = datetime.now(timezone.utc)
        return PilotToken(
            sub="user_test",
            org_id="org_test",
            role="pilot_owner",
            email="test@drovi.co",
            iat=now,
            exp=now,
        )

    app.dependency_overrides[require_pilot_auth] = _mock_pilot_auth
    try:
        resp = client.get("/api/v1/org/manifest", headers={"X-Request-ID": "req_manifest_1"})
        assert resp.status_code == 200
        assert resp.headers.get("ETag")
        assert "max-age=" in (resp.headers.get("Cache-Control") or "")
        payload = resp.json()
        assert payload["plugins"] == ["core"]
        assert isinstance(payload["uio_types"], list)
        assert isinstance(payload["capabilities"], dict)
        assert isinstance(payload["ui_hints"], dict)

        etag = resp.headers["ETag"]
        resp2 = client.get("/api/v1/org/manifest", headers={"If-None-Match": etag, "X-Request-ID": "req_manifest_2"})
        assert resp2.status_code == 304
        assert resp2.headers.get("ETag") == etag
    finally:
        app.dependency_overrides.pop(require_pilot_auth, None)

