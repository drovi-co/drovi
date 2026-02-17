from datetime import date

from src.evidence.merkle import merkle_root, sign_merkle_root


def test_merkle_root_is_deterministic_for_same_leaves():
    leaves = ["artifact:a", "event:b", "artifact:c"]
    root_a = merkle_root(leaves)
    root_b = merkle_root(list(reversed(leaves)))
    assert root_a == root_b


def test_merkle_root_changes_when_leaf_changes():
    root_a = merkle_root(["artifact:a", "event:b"])
    root_b = merkle_root(["artifact:a", "event:c"])
    assert root_a != root_b


def test_sign_merkle_root_is_stable():
    signature_a = sign_merkle_root(
        organization_id="org_1",
        root_date=date(2026, 2, 16),
        merkle_root_value="abc123",
        leaf_count=42,
        secret="test-secret",
    )
    signature_b = sign_merkle_root(
        organization_id="org_1",
        root_date=date(2026, 2, 16),
        merkle_root_value="abc123",
        leaf_count=42,
        secret="test-secret",
    )
    assert signature_a == signature_b
