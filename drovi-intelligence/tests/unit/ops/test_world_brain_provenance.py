from __future__ import annotations

from pathlib import Path

from scripts.generate_world_brain_provenance import build_manifest


def test_build_manifest_includes_world_brain_artifacts() -> None:
    repo_root = Path(__file__).resolve().parents[4]
    manifest = build_manifest(repo_root=repo_root)

    assert manifest["artifact_family"] == "world-brain"
    assert manifest["schema_version"] == "1.0"
    assert isinstance(manifest["artifacts"], list)
    assert any(item["path"].startswith("contracts/events/world_brain/") for item in manifest["artifacts"])
