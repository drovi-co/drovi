"""Tests for extraction utility helpers."""

import pytest

from src.orchestrator.state import ParsedMessage
from src.orchestrator.utils.extraction import (
    build_extraction_chunks,
    find_quote_span,
    merge_by_key,
    normalize_key,
    build_supporting_evidence,
)


@pytest.mark.unit
def test_build_extraction_chunks_splits_long_message():
    message = ParsedMessage(id="msg_1", content="A" * 5000)
    chunks = build_extraction_chunks([message], max_chunk_chars=2000, overlap=100)
    assert len(chunks) >= 3
    assert all(chunk.message_id == "msg_1" for chunk in chunks)
    assert chunks[0].chunk_start == 0
    assert chunks[0].chunk_end > chunks[0].chunk_start


@pytest.mark.unit
def test_find_quote_span_handles_whitespace_and_case():
    text = "We will deliver the proposal by Friday."
    quote = "deliver the   proposal BY Friday"
    start, end = find_quote_span(text, quote)
    assert start is not None
    assert text[start:end].lower().startswith("deliver")


@pytest.mark.unit
def test_merge_by_key_prefers_primary_and_merges():
    items = [
        {"title": "Do thing", "confidence": 0.6},
        {"title": "do thing", "confidence": 0.9},
    ]

    def key_fn(item):
        return normalize_key(item["title"])

    def merge_fn(left, right):
        return right if right["confidence"] > left["confidence"] else left

    merged = merge_by_key(items, key_fn=key_fn, merge_fn=merge_fn)
    assert len(merged) == 1
    assert merged[0]["confidence"] == 0.9


@pytest.mark.unit
def test_build_supporting_evidence_finds_other_messages():
    messages = [
        ParsedMessage(id="msg_a", content="We agreed to ship by Friday."),
        ParsedMessage(id="msg_b", content="Reminder: ship by Friday."),
    ]
    evidence = build_supporting_evidence(messages, "ship by Friday", "msg_a")
    assert len(evidence) == 1
    assert evidence[0].source_message_id == "msg_b"
