from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from scripts.verify_dr_targets import _record_layer


def test_record_layer_marks_missing_layer() -> None:
    layer = _record_layer(name="postgres", latest=None, now=datetime.now(UTC))
    assert layer["present"] is False
    assert layer["age_minutes"] is None


def test_record_layer_marks_present_layer(tmp_path: Path) -> None:
    artifact = tmp_path / "postgres_20260224_060000.sql.gz"
    artifact.write_text("backup", encoding="utf-8")

    layer = _record_layer(name="postgres", latest=artifact, now=datetime.now(UTC))
    assert layer["present"] is True
    assert layer["age_minutes"] is not None
