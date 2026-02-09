from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.notifications import reports


@pytest.mark.asyncio
async def test_send_report_email_disabled(monkeypatch):
    class FakeSettings:
        reports_email_enabled = False
        reports_email_fallback_to_members = True
        reports_email_subject_prefix = ""

    monkeypatch.setattr(reports, "get_settings", lambda: FakeSettings())

    result = await reports.send_report_email(
        organization_id="org_test",
        report_title="Executive Daily Brief",
        summary="No activity.",
        report_type="daily_brief",
        organization_name="Test Org",
    )

    assert result is False


@pytest.mark.asyncio
async def test_send_report_email_localizes_title_for_french_org(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeSettings:
        reports_email_enabled = True
        reports_email_fallback_to_members = True
        reports_email_subject_prefix = ""

    monkeypatch.setattr(reports, "get_settings", lambda: FakeSettings())
    monkeypatch.setattr(reports, "resolve_report_recipients", AsyncMock(return_value=["ops@acme.com"]))

    # Organization metadata query: name + default_locale.
    session = AsyncMock()
    result = MagicMock()
    result.fetchone.return_value = SimpleNamespace(name="Acme", default_locale="fr")
    session.execute = AsyncMock(return_value=result)

    @asynccontextmanager
    async def fake_session():
        yield session

    monkeypatch.setattr(reports, "get_db_session", fake_session)

    send_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(reports, "send_resend_email", send_mock)

    ok = await reports.send_report_email(
        organization_id="org_test",
        report_title="Executive Weekly Memory Brief",
        summary="Hello",
        report_type="weekly_brief",
        organization_name=None,
    )

    assert ok is True
    assert send_mock.await_count == 1
    kwargs = send_mock.call_args.kwargs
    assert "Brief executif hebdomadaire" in kwargs["subject"]
    assert "Genere par Drovi Intelligence." in kwargs["html_body"]
