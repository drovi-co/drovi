#!/usr/bin/env python3
"""Generate a deterministic provenance manifest for World Brain artifacts."""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
from typing import Any


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _collect_hashes(root: Path, patterns: list[str]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for pattern in patterns:
        for path in sorted(root.glob(pattern)):
            if path.is_file():
                records.append(
                    {
                        "path": str(path.relative_to(root)),
                        "sha256": _sha256(path),
                        "bytes": path.stat().st_size,
                    }
                )
    return records


def build_manifest(*, repo_root: Path) -> dict[str, Any]:
    drovi_root = repo_root / "drovi-intelligence"
    included = _collect_hashes(
        drovi_root,
        patterns=[
            "contracts/events/world_brain/*.schema.json",
            "openapi/openapi.json",
            "alembic/versions/067_world_brain_phase1_foundation.py",
            "alembic/versions/068_source_sync_run_ledger.py",
            "alembic/versions/069_world_crawl_fabric.py",
            "alembic/versions/070_lakehouse_platform.py",
        ],
    )

    return {
        "schema_version": "1.0",
        "artifact_family": "world-brain",
        "generated_at": datetime.now(UTC).isoformat(),
        "git": {
            "sha": os.getenv("GITHUB_SHA") or os.getenv("CI_COMMIT_SHA") or "unknown",
            "ref": os.getenv("GITHUB_REF") or os.getenv("CI_COMMIT_REF_NAME") or "unknown",
            "workflow": os.getenv("GITHUB_WORKFLOW") or "local",
            "run_id": os.getenv("GITHUB_RUN_ID") or "local",
        },
        "artifacts": included,
    }


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    manifest = build_manifest(repo_root=repo_root)
    print(json.dumps(manifest, ensure_ascii=True, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
