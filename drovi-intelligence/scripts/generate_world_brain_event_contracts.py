"""Generate World Brain event contract JSON schemas."""

from __future__ import annotations

import json
from pathlib import Path

from src.streaming.world_brain_event_contracts import all_world_brain_event_schemas


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "contracts" / "events" / "world_brain"
    out_dir.mkdir(parents=True, exist_ok=True)

    schemas = all_world_brain_event_schemas()
    for event_type, schema in schemas.items():
        filename = f"{event_type}.schema.json"
        path = out_dir / filename
        path.write_text(
            json.dumps(schema, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
