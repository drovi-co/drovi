from src.ingestion.event_types import normalize_event_type, UnifiedEventType
from src.ingestion.unified_event import build_event_hash, build_source_fingerprint


def test_normalize_event_type():
    assert normalize_event_type("decision") == UnifiedEventType.DECISION.value
    assert normalize_event_type("UNKNOWN") == UnifiedEventType.OTHER.value
    assert normalize_event_type(None) == UnifiedEventType.OTHER.value


def test_build_event_hash_stable():
    fingerprint = build_source_fingerprint("source", "id", "conv", "msg", "decision")
    hash_a = build_event_hash("hello", None, fingerprint)
    hash_b = build_event_hash("hello", None, fingerprint)
    assert hash_a == hash_b

    hash_c = build_event_hash(None, {"a": 1, "b": 2}, fingerprint)
    hash_d = build_event_hash(None, {"b": 2, "a": 1}, fingerprint)
    assert hash_c == hash_d
