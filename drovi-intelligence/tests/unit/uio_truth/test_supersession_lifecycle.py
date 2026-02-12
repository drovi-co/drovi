from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.contexts.uio_truth.application.supersession import (
    apply_supersession,
    find_existing_uio,
)


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_find_existing_uio_returns_id_when_match_exists() -> None:
    session = AsyncMock()
    result = MagicMock()
    result.fetchone.return_value = ("uio_existing",)
    session.execute = AsyncMock(return_value=result)

    existing = await find_existing_uio(
        session,
        org_id="org_test",
        uio_type="commitment",
        title="Send report",
    )

    assert existing == "uio_existing"


async def test_apply_supersession_closes_previous_and_links_new(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = AsyncMock()
    session.execute = AsyncMock(return_value=MagicMock())

    timeline_events: list[dict[str, object]] = []

    async def _record_timeline(**kwargs):
        timeline_events.append(kwargs)

    monkeypatch.setattr(
        "src.contexts.uio_truth.application.supersession.create_timeline_event",
        _record_timeline,
    )

    now = datetime(2026, 2, 12, 10, 0, tzinfo=timezone.utc)
    await apply_supersession(
        session,
        now=now,
        organization_id="org_test",
        existing_uio_id="uio_old",
        new_uio_id="uio_new",
        uio_type="commitment",
        evidence_id="ev_1",
        source_type="email",
        conversation_id="thread_1",
        message_id="msg_1",
    )

    assert session.execute.await_count == 3
    assert len(timeline_events) == 2
    assert {event["event_type"] for event in timeline_events} == {"superseded", "supersedes"}
