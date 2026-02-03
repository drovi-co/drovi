from datetime import datetime, timezone

from src.candidates.processor import _apply_cluster_confidence, _candidate_sort_key


def test_candidate_sort_prefers_evidence_strength():
    short = {
        "evidence_text": "short quote",
        "confidence": 0.9,
        "created_at": datetime.now(timezone.utc),
    }
    long = {
        "evidence_text": "long quote " * 40,
        "confidence": 0.6,
        "created_at": datetime.now(timezone.utc),
    }
    ranked = sorted([short, long], key=_candidate_sort_key, reverse=True)
    assert ranked[0] is long


def test_cluster_confidence_boosts_with_multiple_evidence():
    primary = {"evidence_text": "quote", "confidence": 0.5}
    cluster = [primary, {"evidence_text": "another quote", "confidence": 0.4}]
    _apply_cluster_confidence(primary, cluster)
    assert primary["confidence"] > 0.5
