from __future__ import annotations

from types import SimpleNamespace

from src.lakehouse.quality import evaluate_partition_quality


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        lakehouse_quality_max_staleness_seconds=3600,
        lakehouse_quality_min_completeness=0.95,
        lakehouse_quality_min_uniqueness=0.95,
        lakehouse_quality_min_freshness=0.5,
    )


def test_quality_passes_with_good_partition(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("src.lakehouse.quality.get_settings", _settings)
    file_path = tmp_path / "records.jsonl"
    file_path.write_text(
        "\n".join(
            [
                '{"observation_id":"o1","organization_id":"org_test","source_key":"x","observed_at":"2099-01-01T00:00:00+00:00","normalized_text":"a"}',
                '{"observation_id":"o2","organization_id":"org_test","source_key":"x","observed_at":"2099-01-01T00:00:00+00:00","normalized_text":"b"}',
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    report = evaluate_partition_quality(
        table_name="silver.observations",
        file_path=str(file_path),
    )
    assert report["status"] == "passed"


def test_quality_blocks_partition_on_missing_required_fields(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr("src.lakehouse.quality.get_settings", _settings)
    file_path = tmp_path / "records.jsonl"
    file_path.write_text(
        '{"observation_id":"o1","organization_id":"org_test","source_key":"x"}\n',
        encoding="utf-8",
    )
    report = evaluate_partition_quality(
        table_name="silver.observations",
        file_path=str(file_path),
    )
    assert report["status"] == "failed"
