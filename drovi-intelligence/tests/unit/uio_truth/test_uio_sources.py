from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.uio_sources import insert_uio_source

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_insert_uio_source_coerces_offsets_to_text() -> None:
    session = AsyncMock()
    insert_result = MagicMock()
    insert_result.scalar_one_or_none.return_value = "evidence_1"
    session.execute = AsyncMock(return_value=insert_result)
    envelope = PersistEnvelope(
        organization_id="org_1",
        source_type="email",
        source_account_id="acct_1",
        conversation_id="thread_1",
        source_id="thread_1",
        analysis_id="analysis_1",
        messages=[],
        input_content="hello",
    )
    now = datetime(2026, 2, 16, 0, 0, 0)

    source_id = await insert_uio_source(
        session=session,
        envelope=envelope,
        uio_id="uio_1",
        role="origin",
        message_id="m1",
        quoted_text="quoted",
        quoted_text_start=9,
        quoted_text_end=41,
        confidence=0.95,
        now=now,
    )

    assert source_id == "evidence_1"
    session.execute.assert_awaited_once()
    _, params = session.execute.call_args.args

    assert params["id"] != source_id
    assert params["quoted_text_start"] == "9"
    assert params["quoted_text_end"] == "41"


@pytest.mark.asyncio
async def test_insert_uio_source_reuses_existing_id_on_conflict() -> None:
    session = AsyncMock()
    insert_result = MagicMock()
    insert_result.scalar_one_or_none.return_value = None
    existing_result = MagicMock()
    existing_result.scalar_one_or_none.return_value = "existing_evidence_id"
    session.execute = AsyncMock(side_effect=[insert_result, existing_result])

    envelope = PersistEnvelope(
        organization_id="org_1",
        source_type="email",
        source_account_id="acct_1",
        conversation_id="thread_1",
        source_id="thread_1",
        analysis_id="analysis_1",
        messages=[],
        input_content="hello",
    )
    now = datetime(2026, 2, 16, 0, 0, 0)

    source_id = await insert_uio_source(
        session=session,
        envelope=envelope,
        uio_id="uio_1",
        role="supporting",
        message_id="m1",
        quoted_text="quoted",
        quoted_text_start=9,
        quoted_text_end=41,
        confidence=0.95,
        now=now,
    )

    assert source_id == "existing_evidence_id"
    assert session.execute.await_count == 2
