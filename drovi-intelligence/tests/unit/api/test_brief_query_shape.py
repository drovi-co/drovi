from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.api.routes import brief as brief_route

pytestmark = [pytest.mark.unit]


class _FakeSessionContext:
    def __init__(self, session: AsyncMock):
        self._session = session

    async def __aenter__(self) -> AsyncMock:
        return self._session

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


@pytest.mark.asyncio
async def test_compute_brief_uses_aggregated_summary_query() -> None:
    now = datetime.now(timezone.utc)

    summary_result = SimpleNamespace(
        fetchone=lambda: SimpleNamespace(
            open_commitments=3,
            overdue_commitments=1,
            decisions_made=2,
            people_involved=4,
            high_risks=1,
        )
    )
    overdue_result = SimpleNamespace(
        fetchall=lambda: [
            SimpleNamespace(
                id="uio_commitment_1",
                canonical_title="Deliver revised proposal",
                due_date=now.date(),
                overall_confidence=0.91,
                direction="owed_by_me",
                debtor_contact_id="contact_1",
                creditor_contact_id="contact_2",
                source_id="src_1",
            )
        ]
    )
    risk_result = SimpleNamespace(
        fetchall=lambda: [
            SimpleNamespace(
                id="uio_risk_1",
                canonical_title="Contract signature pending",
                overall_confidence=0.88,
                severity="high",
                suggested_action="Escalate follow-up",
                source_id="src_2",
            )
        ]
    )

    session = AsyncMock()
    session.execute = AsyncMock(side_effect=[summary_result, overdue_result, risk_result])

    fake_ctx = SimpleNamespace()

    with (
        patch("src.db.client.get_db_session", lambda: _FakeSessionContext(session)),
        patch("src.auth.private_sources.is_admin_or_internal", return_value=True),
        patch("src.auth.private_sources.get_session_user_id", return_value=None),
    ):
        response = await brief_route.compute_brief(
            organization_id="org_test",
            period=brief_route.BriefPeriod.LAST_7_DAYS,
            ctx=fake_ctx,
        )

    assert session.execute.await_count == 3
    first_stmt = str(session.execute.call_args_list[0].args[0])
    assert "COUNT(*) FILTER" in first_stmt
    assert response.summary.open_commitments == 3
    assert response.summary.high_risks == 1
    assert len(response.attention_items) == 2
