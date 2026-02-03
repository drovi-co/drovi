"""Tests for unified event helpers."""

from datetime import datetime, timezone

from src.ingestion.unified_event import (
    build_content_hash,
    build_source_fingerprint,
    build_uem_metadata,
)


def test_build_source_fingerprint_includes_empty_parts():
    fingerprint = build_source_fingerprint("email", None, "thread_1", "")
    assert fingerprint == "email||thread_1|"


def test_build_content_hash_is_stable():
    fingerprint = build_source_fingerprint("email", "src_1", "conv_1", "msg_1")
    first = build_content_hash("hello", fingerprint)
    second = build_content_hash("hello", fingerprint)
    assert first == second


def test_build_uem_metadata_attaches_defaults():
    captured_at = datetime(2025, 1, 1, tzinfo=timezone.utc)
    received_at = datetime(2025, 1, 2, tzinfo=timezone.utc)
    metadata = build_uem_metadata(
        {"subject": "Test"},
        source_fingerprint="email|src|conv|msg",
        content_hash="abc123",
        captured_at=captured_at,
        received_at=received_at,
    )

    assert metadata["subject"] == "Test"
    assert metadata["source_fingerprint"] == "email|src|conv|msg"
    assert metadata["content_hash"] == "abc123"
    assert metadata["captured_at"].startswith("2025-01-01")
    assert metadata["received_at"].startswith("2025-01-02")
