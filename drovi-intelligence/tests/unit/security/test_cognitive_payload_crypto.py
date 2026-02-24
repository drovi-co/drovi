from __future__ import annotations

import pytest

from src.security.cognitive_payload_crypto import (
    decode_reason_payload,
    decrypt_payload_envelope,
    encode_reason_payload,
    encrypt_payload_envelope,
)

pytestmark = [pytest.mark.unit]


def test_encrypt_decrypt_payload_envelope_roundtrip() -> None:
    payload = {
        "reason": "contradiction from finance source",
        "signal_hash": "abc123",
        "support_increment": 1,
    }
    encrypted = encrypt_payload_envelope(payload)
    assert "_enc" in encrypted

    decrypted = decrypt_payload_envelope(encrypted)
    assert decrypted == payload


def test_encode_decode_reason_payload_roundtrip() -> None:
    reason_payload = {
        "reason": "new external contradiction",
        "model_version": "epistemic-v1",
        "signal_hash": "deadbeef",
    }
    encoded = encode_reason_payload(reason_payload)
    decoded = decode_reason_payload(encoded)
    assert decoded == reason_payload
