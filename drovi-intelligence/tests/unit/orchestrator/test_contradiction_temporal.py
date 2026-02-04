from datetime import datetime, timedelta

from src.orchestrator.nodes.detect_contradictions import _is_temporally_active


def test_temporal_active_with_no_bounds():
    node = {}
    assert _is_temporally_active(node, datetime.utcnow()) is True


def test_temporal_inactive_when_valid_to_passed():
    now = datetime.utcnow()
    node = {
        "validFrom": (now - timedelta(days=5)).isoformat(),
        "validTo": (now - timedelta(days=1)).isoformat(),
    }
    assert _is_temporally_active(node, now) is False


def test_temporal_inactive_when_valid_from_future():
    now = datetime.utcnow()
    node = {
        "validFrom": (now + timedelta(days=1)).isoformat(),
    }
    assert _is_temporally_active(node, now) is False
