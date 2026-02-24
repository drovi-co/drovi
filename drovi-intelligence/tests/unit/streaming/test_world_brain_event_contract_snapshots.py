from __future__ import annotations

import json
from pathlib import Path

from src.streaming.world_brain_event_contracts import all_world_brain_event_schemas


def test_world_brain_event_contract_snapshots_are_in_sync() -> None:
    root = Path(__file__).resolve().parents[3]
    contracts_dir = root / "contracts" / "events" / "world_brain"
    assert contracts_dir.exists(), "Run scripts/generate_world_brain_event_contracts.py"

    expected = all_world_brain_event_schemas()
    expected_files = {f"{event_type}.schema.json" for event_type in expected}
    actual_files = {path.name for path in contracts_dir.glob("*.schema.json")}

    assert actual_files == expected_files

    for event_type, schema in expected.items():
        path = contracts_dir / f"{event_type}.schema.json"
        stored = json.loads(path.read_text(encoding="utf-8"))
        assert stored == schema
