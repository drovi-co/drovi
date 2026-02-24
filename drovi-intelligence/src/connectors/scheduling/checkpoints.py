"""Checkpoint and watermark contract helpers for continuous ingest."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from typing import Any


CHECKPOINT_CONTRACT_VERSION = 1


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    normalized = _as_utc(dt)
    return normalized.isoformat() if normalized else None


def extract_checkpoint_watermark(cursor_state: dict[str, Any] | None) -> datetime | None:
    if not isinstance(cursor_state, dict):
        return None
    contract = cursor_state.get("_checkpoint_contract")
    if not isinstance(contract, dict):
        return None
    watermark_raw = contract.get("watermark")
    if not watermark_raw:
        return None
    try:
        text = str(watermark_raw)
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        return _as_utc(parsed)
    except Exception:
        return None


def apply_checkpoint_contract(
    *,
    cursor_state: dict[str, Any] | None,
    run_id: str,
    run_kind: str,
    watermark: datetime | None,
    stream_name: str,
) -> dict[str, Any]:
    cursor = dict(cursor_state or {})
    watermark_iso = _iso(watermark)
    resume_material = f"{run_id}:{stream_name}:{watermark_iso or 'none'}"
    resume_token = hashlib.sha256(resume_material.encode("utf-8")).hexdigest()
    cursor["_checkpoint_contract"] = {
        "version": CHECKPOINT_CONTRACT_VERSION,
        "run_id": str(run_id),
        "run_kind": str(run_kind),
        "stream": str(stream_name),
        "watermark": watermark_iso,
        "resume_token": resume_token,
        "updated_at": _iso(datetime.now(timezone.utc)),
    }
    return cursor
