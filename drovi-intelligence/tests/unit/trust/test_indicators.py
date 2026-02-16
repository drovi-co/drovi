"""
Unit tests for trust indicator scoring.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.trust import indicators

pytestmark = pytest.mark.unit


def test_compute_trust_score_handles_offset_aware_last_updated_at(monkeypatch: pytest.MonkeyPatch) -> None:
    fixed_now = datetime(2026, 2, 9, 12, 0, 0)  # naive
    monkeypatch.setattr(indicators, "utc_now_naive", lambda: fixed_now)

    last_updated_at = datetime(2026, 2, 8, 12, 0, 0, tzinfo=timezone.utc)
    score = indicators._compute_trust_score(
        confidence=0.55,
        evidence_count=2,
        is_contradicted=False,
        last_updated_at=last_updated_at,
    )

    assert 0.0 <= score <= 1.0


def test_compute_trust_score_handles_naive_last_updated_at(monkeypatch: pytest.MonkeyPatch) -> None:
    fixed_now = datetime(2026, 2, 9, 12, 0, 0)  # naive
    monkeypatch.setattr(indicators, "utc_now_naive", lambda: fixed_now)

    last_updated_at = datetime(2026, 2, 8, 12, 0, 0)  # naive
    score = indicators._compute_trust_score(
        confidence=0.55,
        evidence_count=0,
        is_contradicted=True,
        last_updated_at=last_updated_at,
    )

    assert 0.0 <= score <= 1.0
