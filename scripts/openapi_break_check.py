#!/usr/bin/env python3
"""
Minimal OpenAPI breaking-change detector.

We intentionally start conservative and expand later (Phase 7).

Currently detects removals:
- HTTP operations removed (path+method)
- component schemas removed
- object properties removed from component schemas

Intentional breaks can be allowlisted in openapi/breaking_allowlist.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_allowlist(path: Path) -> dict[str, set[str]]:
    if not path.exists():
        return {"operations_removed": set(), "schemas_removed": set(), "properties_removed": set()}
    data = _load_json(path)
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError(f"Unexpected allowlist format in {path}")

    def as_set(key: str) -> set[str]:
        raw = data.get(key, [])
        if not isinstance(raw, list):
            return set()
        return {str(x) for x in raw}

    return {
        "operations_removed": as_set("operations_removed"),
        "schemas_removed": as_set("schemas_removed"),
        "properties_removed": as_set("properties_removed"),
    }


def _iter_operations(spec: dict[str, Any]) -> set[str]:
    paths = spec.get("paths")
    if not isinstance(paths, dict):
        return set()
    out: set[str] = set()
    for path, ops in paths.items():
        if not isinstance(path, str) or not isinstance(ops, dict):
            continue
        for method, payload in ops.items():
            if method.lower() not in {"get", "post", "put", "patch", "delete", "options", "head"}:
                continue
            if not isinstance(payload, dict):
                continue
            out.add(f"{method.lower()} {path}")
    return out


def _iter_schema_names(spec: dict[str, Any]) -> set[str]:
    schemas = (
        spec.get("components", {})
        if isinstance(spec.get("components"), dict)
        else {}
    ).get("schemas", {})
    if not isinstance(schemas, dict):
        return set()
    return {name for name in schemas.keys() if isinstance(name, str)}


def _iter_removed_properties(baseline: dict[str, Any], current: dict[str, Any]) -> set[str]:
    base_schemas = (
        baseline.get("components", {})
        if isinstance(baseline.get("components"), dict)
        else {}
    ).get("schemas", {})
    cur_schemas = (
        current.get("components", {})
        if isinstance(current.get("components"), dict)
        else {}
    ).get("schemas", {})

    removed: set[str] = set()
    if not isinstance(base_schemas, dict) or not isinstance(cur_schemas, dict):
        return removed

    for schema_name, base_schema in base_schemas.items():
        if not isinstance(schema_name, str) or not isinstance(base_schema, dict):
            continue
        cur_schema = cur_schemas.get(schema_name)
        if not isinstance(cur_schema, dict):
            continue
        base_props = base_schema.get("properties")
        cur_props = cur_schema.get("properties")
        if not isinstance(base_props, dict) or not isinstance(cur_props, dict):
            continue
        for prop in base_props.keys():
            if prop not in cur_props:
                removed.add(f"{schema_name}.{prop}")
    return removed


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True, help="Path to baseline OpenAPI JSON")
    parser.add_argument("--current", required=True, help="Path to current OpenAPI JSON")
    parser.add_argument(
        "--allowlist",
        default="openapi/breaking_allowlist.json",
        help="Allowlist JSON for intentional breaks",
    )
    args = parser.parse_args(argv)

    repo_root = Path(__file__).resolve().parent.parent
    baseline_path = (repo_root / args.baseline).resolve()
    current_path = (repo_root / args.current).resolve()
    allowlist_path = (repo_root / args.allowlist).resolve()

    baseline = _load_json(baseline_path)
    current = _load_json(current_path)
    allow = _load_allowlist(allowlist_path)

    removed_ops = _iter_operations(baseline) - _iter_operations(current)
    removed_schemas = _iter_schema_names(baseline) - _iter_schema_names(current)
    removed_props = _iter_removed_properties(baseline, current)

    removed_ops = {x for x in removed_ops if x not in allow["operations_removed"]}
    removed_schemas = {x for x in removed_schemas if x not in allow["schemas_removed"]}
    removed_props = {x for x in removed_props if x not in allow["properties_removed"]}

    failures: list[str] = []
    for op in sorted(removed_ops):
        failures.append(f"operation removed: {op}")
    for s in sorted(removed_schemas):
        failures.append(f"schema removed: {s}")
    for p in sorted(removed_props):
        failures.append(f"property removed: {p}")

    if failures:
        sys.stderr.write("OpenAPI breaking changes detected (removals):\n")
        for f in failures:
            sys.stderr.write(f"- {f}\n")
        sys.stderr.write(
            "\nIf this is intentional, add an explicit entry to openapi/breaking_allowlist.json.\n"
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

