from __future__ import annotations

import pytest

from src.kernel.hashing import (
    build_content_hash,
    build_segment_hash,
    build_source_fingerprint,
)


@pytest.mark.unit
def test_build_source_fingerprint_is_stable():
    assert build_source_fingerprint("a", None, "b") == "a||b"


@pytest.mark.unit
def test_build_segment_hash_strips_whitespace():
    assert build_segment_hash("hello") == build_segment_hash("  hello  ")


@pytest.mark.unit
def test_build_segment_hash_nfkc_normalizes_unicode_ligatures():
    # "ﬁ" (U+FB01) NFKC-normalizes to "fi"
    assert build_segment_hash("fi") == build_segment_hash("ﬁ")


@pytest.mark.unit
def test_build_segment_hash_whitespace_only_is_empty_sha256():
    assert build_segment_hash("   ") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


@pytest.mark.unit
def test_build_content_hash_is_hex_sha256():
    fp = build_source_fingerprint("gmail", "thread:123")
    h = build_content_hash("hello", fp)
    assert len(h) == 64

