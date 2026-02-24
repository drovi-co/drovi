from __future__ import annotations

import json
from pathlib import Path


def test_world_brain_api_contract_files_exist_and_are_valid_json() -> None:
    root = Path(__file__).resolve().parents[3]
    contracts_dir = root / "contracts" / "api"
    assert contracts_dir.exists()

    required = {
        "world_brain_tape.v1.json",
        "world_brain_counterfactual_lab.v1.json",
        "world_brain_obligation_sentinel.v1.json",
    }
    actual = {path.name for path in contracts_dir.glob("*.json")}
    assert required.issubset(actual)

    for name in required:
        payload = json.loads((contracts_dir / name).read_text(encoding="utf-8"))
        assert payload["version"] == "1.0"
        assert payload["domain"] == "world_brain"
        assert isinstance(payload.get("endpoints"), list)
        assert payload["endpoints"], f"{name} has no endpoints"


def test_world_brain_tape_contract_declares_expected_endpoints() -> None:
    root = Path(__file__).resolve().parents[3]
    contract_path = root / "contracts" / "api" / "world_brain_tape.v1.json"
    payload = json.loads(contract_path.read_text(encoding="utf-8"))
    endpoint_paths = {str(item.get("path")) for item in payload.get("endpoints", [])}
    assert "/api/v1/brain/tape" in endpoint_paths
    assert "/api/v1/brain/tape/live-contract" in endpoint_paths
    assert "/api/v1/brain/tape/{event_id}" in endpoint_paths


def test_openapi_snapshot_contains_world_brain_routes() -> None:
    root = Path(__file__).resolve().parents[3]
    snapshot_path = root / "openapi" / "openapi.json"
    assert snapshot_path.exists(), "OpenAPI snapshot missing; run scripts/generate_openapi.py"

    payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    paths = payload.get("paths", {})

    required_paths = {
        "/api/v1/brain/tape",
        "/api/v1/brain/tape/live-contract",
        "/api/v1/brain/tape/{event_id}",
        "/api/v1/brain/counterfactual-lab/compare",
        "/api/v1/brain/obligation-sentinel/dashboard",
        "/api/v1/brain/obligation-sentinel/triage",
    }
    assert required_paths.issubset(set(paths))
