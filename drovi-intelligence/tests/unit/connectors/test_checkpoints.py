from __future__ import annotations

from datetime import datetime, timezone

from src.connectors.scheduling.checkpoints import (
    apply_checkpoint_contract,
    extract_checkpoint_watermark,
)


def test_apply_checkpoint_contract_embeds_run_metadata() -> None:
    now = datetime(2026, 2, 22, 12, 0, tzinfo=timezone.utc)
    cursor = apply_checkpoint_contract(
        cursor_state={"offset_by_shard": {"q_1": 20}},
        run_id="run_1",
        run_kind="continuous",
        watermark=now,
        stream_name="events",
    )
    contract = cursor["_checkpoint_contract"]
    assert contract["version"] == 1
    assert contract["run_id"] == "run_1"
    assert contract["run_kind"] == "continuous"
    assert contract["stream"] == "events"
    assert contract["resume_token"]


def test_extract_checkpoint_watermark_handles_iso_z() -> None:
    cursor = {
        "_checkpoint_contract": {
            "watermark": "2026-02-22T12:00:00Z",
        }
    }
    watermark = extract_checkpoint_watermark(cursor)
    assert watermark is not None
    assert watermark.tzinfo is not None
    assert watermark.year == 2026
