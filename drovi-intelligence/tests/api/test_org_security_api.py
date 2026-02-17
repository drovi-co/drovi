from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from src.auth.pilot_accounts import PilotToken
from src.security.break_glass import BreakGlassGrant
from src.security.org_policy import OrgSecurityPolicy


pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def _pilot_token(*, role: str) -> PilotToken:
    now = datetime.now(timezone.utc)
    return PilotToken(
        sub="user_1",
        org_id="org_1",
        role=role,  # type: ignore[arg-type]
        email="pilot@example.com",
        auth_method="sso",
        iat=now,
        exp=now,
    )


@pytest.fixture
def override_pilot_auth():
    from src.api.main import app
    from src.api.routes.auth import require_pilot_auth

    def _set(role: str):
        async def _fake_auth():
            return _pilot_token(role=role)

        app.dependency_overrides[require_pilot_auth] = _fake_auth

    yield _set
    app.dependency_overrides.pop(require_pilot_auth, None)


async def test_get_security_policy(async_client_no_auth, override_pilot_auth):
    override_pilot_auth("pilot_member")
    policy = OrgSecurityPolicy(
        organization_id="org_1",
        sso_enforced=True,
        password_fallback_enabled=False,
        password_fallback_environments=("development",),
        ip_allowlist=("10.0.0.0/8",),
        evidence_masking_enabled=True,
        break_glass_enabled=True,
        break_glass_required_actions=("evidence.full", "evidence.presign"),
    )

    with patch(
        "src.api.routes.org_security.get_org_security_policy",
        new_callable=AsyncMock,
        return_value=policy,
    ):
        res = await async_client_no_auth.get("/api/v1/org/security/policy")

    assert res.status_code == 200
    payload = res.json()
    assert payload["sso_enforced"] is True
    assert payload["password_fallback_enabled"] is False
    assert payload["ip_allowlist"] == ["10.0.0.0/8"]


async def test_update_security_policy_requires_admin(async_client_no_auth, override_pilot_auth):
    override_pilot_auth("pilot_member")
    res = await async_client_no_auth.patch(
        "/api/v1/org/security/policy",
        json={"sso_enforced": True},
    )
    assert res.status_code == 403


async def test_update_security_policy_succeeds_for_admin(async_client_no_auth, override_pilot_auth):
    override_pilot_auth("pilot_admin")
    updated = OrgSecurityPolicy(
        organization_id="org_1",
        sso_enforced=True,
        password_fallback_enabled=True,
        password_fallback_environments=("test",),
        ip_allowlist=("203.0.113.5",),
        evidence_masking_enabled=True,
        break_glass_enabled=True,
        break_glass_required_actions=("evidence.full",),
    )

    with patch(
        "src.api.routes.org_security.upsert_org_security_policy",
        new_callable=AsyncMock,
        return_value=updated,
    ), patch(
        "src.api.routes.org_security.record_audit_event",
        new_callable=AsyncMock,
    ) as audit_mock:
        res = await async_client_no_auth.patch(
            "/api/v1/org/security/policy",
            json={
                "sso_enforced": True,
                "password_fallback_enabled": True,
                "password_fallback_environments": ["test"],
                "ip_allowlist": ["203.0.113.5"],
                "break_glass_required_actions": ["evidence.full"],
            },
        )

    assert res.status_code == 200
    assert res.json()["sso_enforced"] is True
    assert audit_mock.await_count == 1


async def test_create_break_glass_grant(async_client_no_auth, override_pilot_auth):
    override_pilot_auth("pilot_owner")
    policy = OrgSecurityPolicy(
        organization_id="org_1",
        break_glass_enabled=True,
    )
    now = datetime.now(timezone.utc)
    grant = BreakGlassGrant(
        id="03f8d5a0-0ef2-4d84-88b9-9a6e20f1f1a4",
        organization_id="org_1",
        scope="evidence.full",
        justification="Urgent legal review of audit evidence",
        created_by_subject="user_1",
        created_at=now,
        expires_at=now,
        use_count=0,
    )

    with patch(
        "src.api.routes.org_security.get_org_security_policy",
        new_callable=AsyncMock,
        return_value=policy,
    ), patch(
        "src.api.routes.org_security.create_break_glass_grant",
        new_callable=AsyncMock,
        return_value=(grant, "bg_plain_token"),
    ), patch(
        "src.api.routes.org_security.record_audit_event",
        new_callable=AsyncMock,
    ) as audit_mock:
        res = await async_client_no_auth.post(
            "/api/v1/org/security/break-glass/grants",
            json={
                "scope": "evidence.full",
                "justification": "Urgent legal review of audit evidence",
                "ttl_minutes": 30,
            },
        )

    assert res.status_code == 200
    payload = res.json()
    assert payload["token"] == "bg_plain_token"
    assert payload["scope"] == "evidence.full"
    assert audit_mock.await_count == 1
