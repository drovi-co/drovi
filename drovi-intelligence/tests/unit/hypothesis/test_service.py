from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.hypothesis.service import HypothesisService


@pytest.mark.asyncio
async def test_generate_for_belief_enforces_top_k_and_retains_rejected() -> None:
    service = HypothesisService(organization_id="org_1")
    service._get_belief_row = AsyncMock(
        return_value={
            "id": "belief_1",
            "proposition": "Revenue decline is seasonal",
            "probability": 0.44,
            "belief_state": "asserted",
            "derived_from_observation_id": None,
        }
    )
    service._collect_observations_for_belief = AsyncMock(
        return_value=[
            "Large account churn increased abruptly",
            "Discount pressure from competitors intensified",
        ]
    )

    captured: dict[str, list] = {}

    async def _fake_persist(*, accepted, rejected, **_kwargs):
        captured["accepted"] = accepted
        captured["rejected"] = rejected
        persisted = []
        for status, bucket in (("accepted", accepted), ("rejected", rejected)):
            for idx, (candidate, _breakdown) in enumerate(bucket):
                persisted.append(
                    {
                        "id": f"{status}_{idx}",
                        "status": status,
                        "hypothesis_text": candidate.hypothesis_text,
                    }
                )
        return persisted

    service._persist_candidates = _fake_persist  # type: ignore[assignment]

    result = await service.generate_for_belief(
        belief_id="belief_1",
        top_k=2,
        min_score=0.95,
        force_credible=True,
    )

    assert len(captured["accepted"]) == 1
    assert len(captured["rejected"]) >= 1
    assert result["accepted"] == 1
    assert result["rejected"] == len(captured["rejected"])


def test_score_breakdown_weights_include_evidence_consistency_and_prior() -> None:
    breakdown = HypothesisService._build_score_breakdown(
        evidence_fit=0.8,
        consistency=0.7,
        prior_probability=0.6,
        posterior_probability=0.4,
        novelty=0.5,
        model_confidence=0.9,
    )
    expected = (
        (0.40 * 0.8)
        + (0.25 * 0.7)
        + (0.20 * 0.6)
        + (0.10 * 0.4)
        + (0.03 * 0.5)
        + (0.02 * 0.9)
    )
    assert abs(breakdown.overall_score - expected) < 1e-9


@pytest.mark.asyncio
async def test_rescore_marks_low_quality_as_rejected_and_tracks_rescore_score_type() -> None:
    session = AsyncMock()
    session.execute = AsyncMock(return_value=None)

    @asynccontextmanager
    async def fake_session():
        yield session

    service = HypothesisService(organization_id="org_1")
    service._load_hypotheses_for_rescore = AsyncMock(
        return_value=[
            SimpleNamespace(
                id="hyp_1",
                status="accepted",
                prior_probability=0.5,
                posterior_probability=0.45,
                novelty_score=0.6,
                model_confidence=0.5,
            )
        ]
    )
    service._insert_score_rows = AsyncMock()
    service._publish_rejected_event = AsyncMock()

    from unittest.mock import patch

    with patch("src.hypothesis.service.get_db_session", fake_session):
        result = await service.rescore_hypotheses(
            belief_id="belief_1",
            evidence_signals=[{"direction": "contradict", "strength": 0.7}],
            rejection_threshold=0.9,
        )

    assert result["updated"] == 1
    assert result["rejected"] == 1
    assert service._publish_rejected_event.await_count == 1
    assert service._insert_score_rows.await_args.kwargs["overall_score_type"] == "overall_score_rescore"
