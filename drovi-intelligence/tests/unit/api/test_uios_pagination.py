from __future__ import annotations

from datetime import datetime, timezone

from src.api.routes.uios import decode_uios_cursor, encode_keyset_cursor


def test_keyset_cursor_round_trip() -> None:
    created_at = datetime(2026, 2, 9, 12, 0, 0, tzinfo=timezone.utc)
    cursor = encode_keyset_cursor(created_at, "uio_123")

    decoded_created_at, decoded_id = decode_uios_cursor(cursor)

    assert decoded_created_at == created_at
    assert decoded_id == "uio_123"


def test_legacy_offset_cursor_gracefully_resets() -> None:
    # eyJvZmZzZXQiOiA1fQ== -> {"offset": 5}
    decoded_created_at, decoded_id = decode_uios_cursor("eyJvZmZzZXQiOiA1fQ==")

    assert decoded_created_at is None
    assert decoded_id is None


def test_invalid_cursor_gracefully_resets() -> None:
    decoded_created_at, decoded_id = decode_uios_cursor("not-a-valid-cursor")

    assert decoded_created_at is None
    assert decoded_id is None
