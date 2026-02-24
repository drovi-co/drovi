#!/usr/bin/env python3
"""Validate DR backup freshness (RPO) and restore timing (RTO)."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any


def _latest_glob(path: Path, pattern: str) -> Path | None:
    matches = sorted(path.glob(pattern), key=lambda item: item.stat().st_mtime, reverse=True)
    return matches[0] if matches else None


def _age_minutes(path: Path, now: datetime) -> float:
    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
    return max(0.0, (now - mtime).total_seconds() / 60.0)


def _record_layer(*, name: str, latest: Path | None, now: datetime) -> dict[str, Any]:
    if latest is None:
        return {"layer": name, "present": False, "latest_path": None, "age_minutes": None}
    return {
        "layer": name,
        "present": True,
        "latest_path": str(latest),
        "age_minutes": round(_age_minutes(latest, now), 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify DR RTO/RPO targets from backup artifacts.")
    parser.add_argument("--backup-dir", default="./backups")
    parser.add_argument("--rpo-target-minutes", type=float, default=1440.0)
    parser.add_argument("--rto-target-minutes", type=float, default=60.0)
    parser.add_argument("--observed-restore-minutes", type=float, default=0.0)
    args = parser.parse_args()

    now = datetime.now(UTC)
    backup_dir = Path(args.backup_dir).resolve()
    minio_dir = backup_dir / "minio"

    postgres_latest = _latest_glob(backup_dir, "postgres_*.sql.gz")
    falkor_latest = _latest_glob(backup_dir, "falkordb_*.rdb")
    minio_latest = _latest_glob(minio_dir, "**/*") if minio_dir.exists() else None
    if minio_latest is not None and minio_latest.is_dir():
        minio_latest = None

    layers = [
        _record_layer(name="postgres", latest=postgres_latest, now=now),
        _record_layer(name="falkordb", latest=falkor_latest, now=now),
        _record_layer(name="minio", latest=minio_latest, now=now),
    ]

    missing_layers = [layer["layer"] for layer in layers if not layer["present"]]
    max_age = max((float(layer["age_minutes"]) for layer in layers if layer["age_minutes"] is not None), default=0.0)
    rpo_ok = not missing_layers and max_age <= float(args.rpo_target_minutes)
    rto_ok = float(args.observed_restore_minutes) <= float(args.rto_target_minutes)

    report = {
        "schema_version": "1.0",
        "generated_at": now.isoformat(),
        "targets": {
            "rpo_target_minutes": float(args.rpo_target_minutes),
            "rto_target_minutes": float(args.rto_target_minutes),
        },
        "observed": {
            "observed_restore_minutes": float(args.observed_restore_minutes),
            "max_backup_age_minutes": round(max_age, 3),
        },
        "layers": layers,
        "checks": {
            "rpo_ok": rpo_ok,
            "rto_ok": rto_ok,
            "missing_layers": missing_layers,
            "passed": bool(rpo_ok and rto_ok),
        },
    }
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, indent=2))

    if not report["checks"]["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
