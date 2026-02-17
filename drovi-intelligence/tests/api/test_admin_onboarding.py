from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.config import get_settings

pytestmark = [pytest.mark.api, pytest.mark.asyncio]


def _set_admin_env(monkeypatch: pytest.MonkeyPatch, *, password: str = "test-admin-pass") -> None:
    monkeypatch.setenv("ADMIN_PASSWORD", password)
    get_settings.cache_clear()


class _FakeResult:
    def __init__(self, *, rows=None):
        self._rows = rows or []

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return self._rows


async def _admin_token(async_client_no_auth) -> str:
    login = await async_client_no_auth.post(
        "/api/v1/admin/login",
        json={"email": "founder@drovi.co", "password": "test-admin-pass"},
    )
    assert login.status_code == 200
    return str(login.json()["session_token"])


async def test_list_onboarding_runbooks_smoke(monkeypatch, async_client_no_auth):
    _set_admin_env(monkeypatch)
    token = await _admin_token(async_client_no_auth)

    fake_session = AsyncMock()
    fake_session.execute = AsyncMock(
        return_value=_FakeResult(
            rows=[
                SimpleNamespace(
                    organization_id="org_1",
                    organization_name="Org One",
                    security_review_complete=True,
                    data_custody_mapped=False,
                    pilot_mandate_set=True,
                    go_live_ready=False,
                    owner_email="ops@drovi.co",
                    target_go_live_at=None,
                    notes="Security review in progress",
                    updated_by="admin:founder@drovi.co",
                    updated_at=None,
                    open_ticket_count=2,
                )
            ]
        )
    )

    @asynccontextmanager
    async def fake_get_db_session():
        yield fake_session

    with patch("src.api.routes.admin_onboarding.get_db_session", fake_get_db_session):
        response = await async_client_no_auth.get(
            "/api/v1/admin/onboarding/runbooks",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["runbooks"]) == 1
    runbook = payload["runbooks"][0]
    assert runbook["organization_id"] == "org_1"
    assert runbook["checklist"]["security_review_complete"] is True
    assert runbook["open_ticket_count"] == 2


async def test_upsert_onboarding_runbook_smoke(monkeypatch, async_client_no_auth):
    _set_admin_env(monkeypatch)
    token = await _admin_token(async_client_no_auth)

    fake_session = AsyncMock()
    fake_session.execute = AsyncMock(
        side_effect=[
            _FakeResult(rows=[SimpleNamespace(id="org_1", name="Org One")]),
            _FakeResult(rows=[]),
            _FakeResult(
                rows=[
                    SimpleNamespace(
                        organization_id="org_1",
                        security_review_complete=True,
                        data_custody_mapped=True,
                        pilot_mandate_set=False,
                        go_live_ready=False,
                        owner_email="owner@drovi.co",
                        target_go_live_at=None,
                        notes="Custody mapping complete",
                        updated_by="admin:founder@drovi.co",
                        updated_at=None,
                    )
                ]
            ),
            _FakeResult(rows=[SimpleNamespace(open_ticket_count=1)]),
        ]
    )

    @asynccontextmanager
    async def fake_get_db_session():
        yield fake_session

    with patch("src.api.routes.admin_onboarding.get_db_session", fake_get_db_session), patch(
        "src.api.routes.admin_onboarding.record_audit_event",
        AsyncMock(),
    ) as audit_mock:
        response = await async_client_no_auth.put(
            "/api/v1/admin/onboarding/runbooks/org_1",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "security_review_complete": True,
                "data_custody_mapped": True,
                "owner_email": "owner@drovi.co",
                "notes": "Custody mapping complete",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["organization_id"] == "org_1"
    assert payload["checklist"]["security_review_complete"] is True
    assert payload["checklist"]["data_custody_mapped"] is True
    assert payload["open_ticket_count"] == 1
    audit_mock.assert_awaited_once()


async def test_automation_status_and_trigger(monkeypatch, async_client_no_auth):
    _set_admin_env(monkeypatch)
    token = await _admin_token(async_client_no_auth)

    fake_session = AsyncMock()
    fake_session.execute = AsyncMock(
        return_value=_FakeResult(
            rows=[
                SimpleNamespace(
                    id="job_weekly_1",
                    job_type="reports.weekly_operations",
                    status="succeeded",
                    updated_at=None,
                ),
                SimpleNamespace(
                    id="job_monthly_1",
                    job_type="trust.integrity_monthly",
                    status="queued",
                    updated_at=None,
                ),
            ]
        )
    )

    @asynccontextmanager
    async def fake_get_db_session():
        yield fake_session

    with patch("src.api.routes.admin_onboarding.get_db_session", fake_get_db_session):
        status_response = await async_client_no_auth.get(
            "/api/v1/admin/onboarding/automations",
            headers={"Authorization": f"Bearer {token}"},
        )

    assert status_response.status_code == 200
    automations = status_response.json()["automations"]
    assert any(item["key"] == "weekly_operations_brief" for item in automations)
    assert any(item["key"] == "monthly_integrity_report" for item in automations)

    with patch(
        "src.api.routes.admin_onboarding.enqueue_job",
        AsyncMock(return_value="job_manual_1"),
    ) as enqueue_mock, patch(
        "src.api.routes.admin_onboarding.record_audit_event",
        AsyncMock(),
    ) as audit_mock:
        trigger_response = await async_client_no_auth.post(
            "/api/v1/admin/onboarding/automations/weekly_operations_brief/run",
            headers={"Authorization": f"Bearer {token}"},
            json={},
        )

    assert trigger_response.status_code == 200
    payload = trigger_response.json()
    assert payload["job_id"] == "job_manual_1"
    assert payload["job_type"] == "reports.weekly_operations"
    enqueue_mock.assert_awaited_once()
    audit_mock.assert_awaited_once()
