import pytest

from src.analytics import reporting
from src.uio.schemas import BriefPriority


def test_priority_from_risks():
    risks = [{"severity": "critical"}, {"severity": "low"}]
    assert reporting._derive_priority_from_risks(risks) == BriefPriority.URGENT


@pytest.mark.asyncio
async def test_generate_weekly_reports_empty(monkeypatch):
    async def fake_list_organizations(*args, **kwargs):
        return []

    monkeypatch.setattr(reporting, "_list_organizations", fake_list_organizations)

    result = await reporting.generate_weekly_reports()
    assert result["organizations"] == 0
    assert result["executive_briefs"] == 0
    assert result["blindspot_reports"] == 0


@pytest.mark.asyncio
async def test_generate_daily_reports_empty(monkeypatch):
    async def fake_list_organizations(*args, **kwargs):
        return []

    monkeypatch.setattr(reporting, "_list_organizations", fake_list_organizations)

    result = await reporting.generate_daily_reports()
    assert result["organizations"] == 0
    assert result["daily_briefs"] == 0
