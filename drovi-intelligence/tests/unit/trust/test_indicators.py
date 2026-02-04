from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.trust.indicators import get_trust_indicators


@pytest.mark.asyncio
async def test_trust_indicators_include_evidence_and_reasoning():
    session = AsyncMock()
    rows = MagicMock()
    rows.fetchall.return_value = [
        SimpleNamespace(
            id="uio_1",
            overall_confidence=0.6,
            belief_state="active",
            truth_state="candidate",
            last_update_reason="source_event",
            last_updated_at=datetime.utcnow() - timedelta(days=5),
            contradicts_existing=False,
        )
    ]
    session.execute.return_value = rows

    @asynccontextmanager
    async def fake_session():
        yield session

    memory = AsyncMock()
    memory.get_uio_evidence.return_value = {
        "uio_1": [
            {"evidence_id": "ev_1", "quoted_text": "proof"},
            {"evidence_id": "ev_2", "quoted_text": "more proof"},
        ]
    }

    with patch("src.trust.indicators.get_db_session", fake_session), patch(
        "src.trust.indicators.get_memory_service",
        return_value=memory,
    ):
        indicators = await get_trust_indicators(organization_id="org_1", uio_ids=["uio_1"])

    assert len(indicators) == 1
    indicator = indicators[0]
    assert indicator["evidence_count"] == 2
    assert indicator["trust_score"] >= 0.6
    assert any("evidence" in reason for reason in indicator["confidence_reasoning"])
