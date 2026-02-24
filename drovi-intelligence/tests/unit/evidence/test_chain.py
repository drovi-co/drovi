from datetime import datetime

import pytest

from src.evidence.chain import (
    build_cognitive_chain_metadata,
    calculate_chain_hash,
)


def test_calculate_chain_hash_is_deterministic():
    created_at = datetime(2026, 2, 4, 12, 0, 0)
    hash_a = calculate_chain_hash(
        prev_hash="prev",
        artifact_sha256="sha256",
        artifact_id="artifact",
        created_at=created_at,
        metadata_json='{"key": "value"}',
    )
    hash_b = calculate_chain_hash(
        prev_hash="prev",
        artifact_sha256="sha256",
        artifact_id="artifact",
        created_at=created_at,
        metadata_json='{"key": "value"}',
    )

    assert hash_a == hash_b


def test_calculate_chain_hash_changes_with_payload():
    created_at = datetime(2026, 2, 4, 12, 0, 0)
    hash_a = calculate_chain_hash(
        prev_hash="prev",
        artifact_sha256="sha256",
        artifact_id="artifact",
        created_at=created_at,
        metadata_json='{"key": "value"}',
    )
    hash_b = calculate_chain_hash(
        prev_hash="prev2",
        artifact_sha256="sha256",
        artifact_id="artifact",
        created_at=created_at,
        metadata_json='{"key": "value"}',
    )

    assert hash_a != hash_b


def test_build_cognitive_chain_metadata_includes_hash_and_extra():
    metadata = build_cognitive_chain_metadata(
        subject_type="belief",
        subject_id="belief-1",
        subject_hash="hash-1",
        extra={"origin": "test"},
    )

    assert metadata == {
        "subject_type": "belief",
        "subject_id": "belief-1",
        "subject_hash": "hash-1",
        "extra": {"origin": "test"},
    }


def test_build_cognitive_chain_metadata_rejects_unsupported_subject_type():
    with pytest.raises(ValueError):
        build_cognitive_chain_metadata(
            subject_type="unknown_subject",
            subject_id="obj-1",
        )
