from datetime import datetime

from src.evidence.chain import calculate_chain_hash


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
