#!/usr/bin/env python3
"""
Generate TypeScript schema types from the committed OpenAPI snapshot.

Why:
- Phase 7 requires a contract-of-record OpenAPI snapshot (`openapi/openapi.json`)
  and generated TS types for app clients to consume.
- Network access is restricted, so we can't rely on external generators.
- We keep per-file LOC small by generating one TS file per schema.

Usage:
  python3 scripts/generate_api_types.py

Outputs:
  packages/api-types/src/generated/schemas/*.ts
  packages/api-types/src/generated/schemas/index.ts
  packages/api-types/src/generated/index.ts
  packages/api-types/src/index.ts
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parent.parent
OPENAPI_SNAPSHOT = REPO_ROOT / "openapi" / "openapi.json"
OUT_DIR = REPO_ROOT / "packages" / "api-types" / "src" / "generated" / "schemas"

_VALID_TS_IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


@dataclass(frozen=True)
class RenderedType:
    ts: str
    refs: set[str]


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _ref_name(ref: str) -> str:
    # Only support local component schema refs.
    prefix = "#/components/schemas/"
    if not ref.startswith(prefix):
        raise ValueError(f"Unsupported $ref: {ref!r}")
    return ref[len(prefix) :]


def _ts_string_literal(value: str) -> str:
    # JSON-ish string escaping. Keep it simple and deterministic.
    escaped = (
        value.replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    return f"'{escaped}'"


def _maybe_parenthesize(ts: str) -> str:
    # Parenthesize unions/intersections when used as array item types, etc.
    if " | " in ts or " & " in ts:
        return f"({ts})"
    return ts


def _merge_rendered(items: Iterable[RenderedType], *, joiner: str) -> RenderedType:
    parts: list[str] = []
    refs: set[str] = set()
    for it in items:
        parts.append(it.ts)
        refs |= it.refs
    # De-dupe common union members like `string | string`.
    # Preserve stable ordering by first appearance.
    if joiner == " | ":
        seen: set[str] = set()
        deduped: list[str] = []
        for p in parts:
            if p in seen:
                continue
            seen.add(p)
            deduped.append(p)
        parts = deduped
    return RenderedType(joiner.join(parts) if parts else "unknown", refs)


def _schema_to_ts(schema: Any) -> RenderedType:
    if schema is None:
        return RenderedType("unknown", set())
    if not isinstance(schema, dict):
        return RenderedType("unknown", set())

    if "$ref" in schema:
        name = _ref_name(str(schema["$ref"]))
        return RenderedType(name, {name})

    # OpenAPI 3.1 favors `anyOf: [T, null]` instead of `nullable: true`,
    # but we support `nullable` too.
    nullable = bool(schema.get("nullable", False))

    if "const" in schema:
        const = schema["const"]
        if const is None:
            base = RenderedType("null", set())
        elif isinstance(const, bool):
            base = RenderedType("true" if const else "false", set())
        elif isinstance(const, (int, float)):
            base = RenderedType(str(const), set())
        elif isinstance(const, str):
            base = RenderedType(_ts_string_literal(const), set())
        else:
            base = RenderedType("unknown", set())
        if nullable and base.ts != "null":
            return RenderedType(f"{base.ts} | null", base.refs)
        return base

    if "enum" in schema and isinstance(schema["enum"], list):
        values = schema["enum"]
        rendered: list[str] = []
        for v in values:
            if v is None:
                rendered.append("null")
            elif isinstance(v, bool):
                rendered.append("true" if v else "false")
            elif isinstance(v, (int, float)):
                rendered.append(str(v))
            else:
                rendered.append(_ts_string_literal(str(v)))
        base = RenderedType(" | ".join(rendered) if rendered else "never", set())
        if nullable and "null" not in base.ts:
            return RenderedType(f"{base.ts} | null", base.refs)
        return base

    if "anyOf" in schema and isinstance(schema["anyOf"], list):
        items = [_schema_to_ts(x) for x in schema["anyOf"]]
        base = _merge_rendered(items, joiner=" | ")
        if nullable and "null" not in base.ts:
            return RenderedType(f"{base.ts} | null", base.refs)
        return base

    if "oneOf" in schema and isinstance(schema["oneOf"], list):
        items = [_schema_to_ts(x) for x in schema["oneOf"]]
        base = _merge_rendered(items, joiner=" | ")
        if nullable and "null" not in base.ts:
            return RenderedType(f"{base.ts} | null", base.refs)
        return base

    if "allOf" in schema and isinstance(schema["allOf"], list):
        items = [_schema_to_ts(x) for x in schema["allOf"]]
        base = _merge_rendered(items, joiner=" & ")
        if nullable and "null" not in base.ts:
            return RenderedType(f"{base.ts} | null", base.refs)
        return base

    ty = schema.get("type")

    if ty == "string":
        base = RenderedType("string", set())
        if nullable:
            return RenderedType("string | null", set())
        return base
    if ty in {"number", "integer"}:
        base = RenderedType("number", set())
        if nullable:
            return RenderedType("number | null", set())
        return base
    if ty == "boolean":
        base = RenderedType("boolean", set())
        if nullable:
            return RenderedType("boolean | null", set())
        return base
    if ty == "null":
        return RenderedType("null", set())

    if ty == "array":
        items_schema = schema.get("items")
        item = _schema_to_ts(items_schema)
        base = RenderedType(f"Array<{_maybe_parenthesize(item.ts)}>", set(item.refs))
        if nullable:
            return RenderedType(f"{base.ts} | null", base.refs)
        return base

    # Objects: treat missing `type` but present `properties` as object too.
    if ty == "object" or "properties" in schema or "additionalProperties" in schema:
        props = schema.get("properties")
        required = schema.get("required")
        required_set = set(required) if isinstance(required, list) else set()

        prop_lines: list[str] = []
        refs: set[str] = set()

        if isinstance(props, dict):
            for name in sorted(props.keys(), key=lambda x: str(x)):
                prop_schema = props.get(name)
                rendered = _schema_to_ts(prop_schema)
                refs |= rendered.refs

                key = str(name)
                ts_key = key if _VALID_TS_IDENTIFIER.fullmatch(key) else _ts_string_literal(key)
                optional = key not in required_set
                suffix = "?" if optional else ""
                prop_lines.append(f"  {ts_key}{suffix}: {rendered.ts};")

        additional = schema.get("additionalProperties", None)
        # `additionalProperties: true` means free-form object.
        if additional is True:
            base = RenderedType("{\n" + "\n".join(prop_lines) + "\n} & Record<string, unknown>", refs)
        elif isinstance(additional, dict):
            add = _schema_to_ts(additional)
            refs |= add.refs
            base = RenderedType("{\n" + "\n".join(prop_lines) + "\n} & Record<string, " + add.ts + ">", refs)
        elif prop_lines:
            base = RenderedType("{\n" + "\n".join(prop_lines) + "\n}", refs)
        else:
            base = RenderedType("Record<string, unknown>", refs)

        if nullable and "null" not in base.ts:
            return RenderedType(f"{base.ts} | null", base.refs)
        return base

    # Fallback for unhandled schema shapes.
    return RenderedType("unknown", set())


def _write_if_changed(path: Path, content: str) -> None:
    if path.exists():
        old = path.read_text(encoding="utf-8")
        if old == content:
            return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _format_file(schema_name: str, rendered: RenderedType) -> str:
    refs = sorted(x for x in rendered.refs if x != schema_name)
    imports = ""
    if refs:
        # Keep imports explicit to satisfy `verbatimModuleSyntax`.
        lines = [f'import type {{ {name} }} from \"./{name}\";' for name in refs]
        imports = "\n".join(lines) + "\n\n"
    return (
        "// This file is auto-generated by scripts/generate_api_types.py.\n"
        "// Do not edit manually.\n\n"
        + imports
        + f"export type {schema_name} = {rendered.ts};\n"
    )


def _format_schemas_index(schema_names: list[str]) -> str:
    lines = [
        "// This file is auto-generated by scripts/generate_api_types.py.\n"
        "// Do not edit manually.\n\n"
    ]
    for name in schema_names:
        lines.append(f'export type {{ {name} }} from "./{name}";')
    lines.append("")
    return "\n".join(lines)


def _format_generated_index() -> str:
    return (
        "// This file is auto-generated by scripts/generate_api_types.py.\n"
        "// Do not edit manually.\n\n"
        "export * from \"./schemas\";\n"
    )


def _format_root_index() -> str:
    return (
        "// This file is auto-generated by scripts/generate_api_types.py.\n"
        "// Do not edit manually.\n\n"
        "export * from \"./generated\";\n"
    )


def main(argv: list[str]) -> int:
    if not OPENAPI_SNAPSHOT.exists():
        sys.stderr.write(f"Missing OpenAPI snapshot: {OPENAPI_SNAPSHOT}\n")
        return 2

    spec = _load_json(OPENAPI_SNAPSHOT)
    schemas = (
        spec.get("components", {})
        if isinstance(spec.get("components"), dict)
        else {}
    ).get("schemas", {})

    if not isinstance(schemas, dict) or not schemas:
        sys.stderr.write("OpenAPI snapshot has no components.schemas\n")
        return 2

    schema_names = sorted(str(k) for k in schemas.keys())

    # Generate per-schema files.
    for name in schema_names:
        schema = schemas.get(name)
        rendered = _schema_to_ts(schema)
        content = _format_file(name, rendered)
        _write_if_changed(OUT_DIR / f"{name}.ts", content)

    # Generate barrel exports.
    _write_if_changed(OUT_DIR / "index.ts", _format_schemas_index(schema_names))

    gen_dir = OUT_DIR.parent
    _write_if_changed(gen_dir / "index.ts", _format_generated_index())

    root_index = REPO_ROOT / "packages" / "api-types" / "src" / "index.ts"
    _write_if_changed(root_index, _format_root_index())

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

