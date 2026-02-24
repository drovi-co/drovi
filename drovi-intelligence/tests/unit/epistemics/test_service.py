from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.epistemics.service import BeliefIntelligenceService
from src.security.cognitive_payload_crypto import encode_reason_payload


class _Result:
    def __init__(self, *, one=None, all_rows=None):
        self._one = one
        self._all_rows = all_rows or []

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._all_rows


@pytest.mark.asyncio
async def test_revise_belief_applies_contradiction_override() -> None:
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            _Result(
                one=SimpleNamespace(
                    id="belief_1",
                    proposition="Revenue risk is elevated",
                    belief_state="corroborated",
                    probability=0.86,
                    contradiction_count=0,
                    supporting_evidence_count=2,
                    updated_at=datetime.now(UTC) - timedelta(days=5),
                )
            ),
            _Result(all_rows=[]),
            _Result(),
            _Result(),
            _Result(),
        ]
    )

    @asynccontextmanager
    async def fake_session():
        yield session

    service = BeliefIntelligenceService(organization_id="org_1")

    from unittest.mock import patch

    with patch("src.epistemics.service.get_db_session", fake_session):
        result = await service.revise_belief(
            belief_id="belief_1",
            signals=[
                {
                    "direction": "support",
                    "strength": 0.9,
                    "source_key": "worldnewsapi",
                    "freshness_hours": 2,
                    "evidence_link_id": "ev_link_1",
                }
            ],
            reason="new external contradiction",
            model_version="epistemic-v1",
            contradiction_ids=["contradiction_1"],
        )

    assert result.next_state == "contested"
    assert result.contradiction_count_increment == 1
    assert result.calibration_bucket


@pytest.mark.asyncio
async def test_replay_belief_is_deterministic() -> None:
    service = BeliefIntelligenceService(organization_id="org_1")

    trail = {
        "belief": {"id": "belief_1"},
        "revisions": [
            {
                "previous_state": "asserted",
                "next_state": "corroborated",
                "previous_probability": 0.5,
                "next_probability": 0.72,
                "reason": {"signal_hash": "abc"},
            },
            {
                "previous_state": "corroborated",
                "next_state": "contested",
                "previous_probability": 0.72,
                "next_probability": 0.44,
                "reason": {"signal_hash": "def"},
            },
        ],
    }

    service.get_belief_trail = AsyncMock(return_value=trail)

    replay_a = await service.replay_belief(belief_id="belief_1")
    replay_b = await service.replay_belief(belief_id="belief_1")

    assert replay_a is not None
    assert replay_b is not None
    assert replay_a["deterministic_hash"] == replay_b["deterministic_hash"]
    assert replay_a["valid_transitions"] is True


def test_apply_confidence_decay_moves_probability_towards_uncertain_center() -> None:
    recent = BeliefIntelligenceService.apply_confidence_decay(
        probability=0.85,
        last_updated_at=datetime.now(UTC) - timedelta(days=1),
        contradiction_count=0,
    )
    stale = BeliefIntelligenceService.apply_confidence_decay(
        probability=0.85,
        last_updated_at=datetime.now(UTC) - timedelta(days=240),
        contradiction_count=3,
    )

    assert stale < recent
    assert 0.01 <= stale <= 0.99


@pytest.mark.asyncio
async def test_get_belief_trail_decrypts_encrypted_reason_payload() -> None:
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            _Result(
                one=SimpleNamespace(
                    id="belief_1",
                    proposition="Revenue risk is elevated",
                    belief_state="contested",
                    probability=0.42,
                    calibration_bucket="0.4-0.5",
                    supporting_evidence_count=2,
                    contradiction_count=1,
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
            ),
            _Result(
                all_rows=[
                    SimpleNamespace(
                        id="rev_1",
                        previous_state="asserted",
                        next_state="contested",
                        previous_probability=0.7,
                        next_probability=0.42,
                        reason=encode_reason_payload(
                            {
                                "reason": "new contradiction from legal source",
                                "model_version": "epistemic-v2",
                                "signal_hash": "abc123",
                            }
                        ),
                        evidence_link_ids=["ev_1"],
                        revised_at=datetime.now(UTC),
                        created_at=datetime.now(UTC),
                    )
                ]
            ),
        ]
    )

    @asynccontextmanager
    async def fake_session():
        yield session

    service = BeliefIntelligenceService(organization_id="org_1")
    from unittest.mock import patch

    with patch("src.epistemics.service.get_db_session", fake_session):
        trail = await service.get_belief_trail("belief_1")

    assert trail is not None
    assert trail["revisions"][0]["reason"]["model_version"] == "epistemic-v2"
    assert trail["revisions"][0]["reason"]["signal_hash"] == "abc123"
