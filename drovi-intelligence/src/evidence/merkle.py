"""Merkle tree helpers for chain-of-custody roots."""

from __future__ import annotations

import hashlib
import hmac
from datetime import date


EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()


def _hash_leaf(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _hash_pair(left: str, right: str) -> str:
    return hashlib.sha256(f"{left}:{right}".encode("utf-8")).hexdigest()


def merkle_root(leaves: list[str]) -> str:
    """
    Build a deterministic Merkle root from a list of leaf values.

    Leaves are normalized with SHA-256 and sorted for deterministic replay.
    """
    if not leaves:
        return EMPTY_SHA256

    level = [_hash_leaf(leaf) for leaf in sorted(leaves)]
    while len(level) > 1:
        next_level: list[str] = []
        for index in range(0, len(level), 2):
            left = level[index]
            right = level[index + 1] if index + 1 < len(level) else left
            next_level.append(_hash_pair(left, right))
        level = next_level
    return level[0]


def sign_merkle_root(
    *,
    organization_id: str,
    root_date: date,
    merkle_root_value: str,
    leaf_count: int,
    secret: str,
) -> str:
    """Produce a deterministic HMAC signature for the daily root payload."""
    payload = (
        f"{organization_id}:{root_date.isoformat()}:"
        f"{merkle_root_value}:{leaf_count}"
    )
    return hmac.new(
        secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
