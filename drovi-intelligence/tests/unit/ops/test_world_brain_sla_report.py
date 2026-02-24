from __future__ import annotations

from scripts.world_brain_sla_report import _normalize_database_url, compute_sla_report


def test_normalize_database_url_removes_asyncpg_driver_suffix() -> None:
    raw = "postgresql+asyncpg://drovi:secret@db.internal:5432/drovi"
    assert _normalize_database_url(raw) == "postgresql://drovi:secret@db.internal:5432/drovi"


def test_compute_sla_report_aggregates_connector_metrics() -> None:
    report = compute_sla_report(
        runs=[
            {
                "connector_type": "worldnewsapi",
                "status": "succeeded",
                "freshness_lag_minutes": 4,
                "duration_seconds": 12,
            },
            {
                "connector_type": "worldnewsapi",
                "status": "failed",
                "freshness_lag_minutes": 18,
                "duration_seconds": 33,
            },
            {
                "connector_type": "federal_register",
                "status": "succeeded",
                "freshness_lag_minutes": 8,
                "duration_seconds": 9,
            },
        ],
        failed_jobs=[
            {"job_type": "connector.sync"},
            {"job_type": "connector.sync"},
            {"job_type": "world_twin.snapshot"},
        ],
        lookback_hours=24,
    )

    assert report["overall"]["runs_total"] == 3
    assert report["overall"]["runs_failed"] == 1
    assert report["overall"]["status"] in {"warning", "elevated", "critical"}
    assert report["failures_by_job_type"]["connector.sync"] == 2

    connectors = {row["connector_type"]: row for row in report["connectors"]}
    assert connectors["worldnewsapi"]["runs_total"] == 2
    assert connectors["worldnewsapi"]["runs_failed"] == 1
    assert connectors["federal_register"]["runs_success"] == 1
