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
