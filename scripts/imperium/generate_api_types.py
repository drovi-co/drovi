#!/usr/bin/env python3
"""Generate Imperium TypeScript API types from openapi/imperium-openapi.json."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
OPENAPI_PATH = REPO_ROOT / "openapi" / "imperium-openapi.json"
OUT_FILE = REPO_ROOT / "packages" / "imperium-api-types" / "src" / "generated.ts"

_VALID_IDENTIFIER = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")


def load_openapi() -> dict[str, Any]:
    if not OPENAPI_PATH.exists():
        raise SystemExit(f"OpenAPI snapshot not found: {OPENAPI_PATH}")

    raw = OPENAPI_PATH.read_text(encoding="utf-8").strip()
    if not raw:
        raise SystemExit(
            f"OpenAPI snapshot is empty: {OPENAPI_PATH}. Run `bun run imperium:openapi:generate` first."
        )

    return json.loads(raw)


def ref_name(ref: str) -> str:
    prefix = "#/components/schemas/"
    if ref.startswith(prefix):
        return ref[len(prefix) :]
    return "unknown"


def quote_string(value: str) -> str:
    escaped = (
        value.replace("\\", "\\\\")
        .replace("'", "\\'")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    return f"'{escaped}'"


def maybe_parenthesize(value: str) -> str:
    if " | " in value or " & " in value:
        return f"({value})"
    return value


def dedupe_union(parts: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for part in parts:
        if part in seen:
            continue
        seen.add(part)
        deduped.append(part)
    return deduped


def schema_to_ts(schema: Any) -> str:
    if not isinstance(schema, dict):
        return "unknown"

    if "$ref" in schema:
        return ref_name(str(schema["$ref"]))

    nullable = bool(schema.get("nullable", False))

    if "enum" in schema and isinstance(schema["enum"], list):
        variants: list[str] = []
        for value in schema["enum"]:
            if value is None:
                variants.append("null")
            elif isinstance(value, bool):
                variants.append("true" if value else "false")
            elif isinstance(value, (int, float)):
                variants.append(str(value))
            else:
                variants.append(quote_string(str(value)))

        rendered = " | ".join(dedupe_union(variants)) if variants else "never"
        if nullable and "null" not in rendered:
            return f"{rendered} | null"
        return rendered

    for key, joiner in (("oneOf", " | "), ("anyOf", " | "), ("allOf", " & ")):
        values = schema.get(key)
        if isinstance(values, list):
            rendered = [schema_to_ts(item) for item in values]
            if joiner == " | ":
                rendered = dedupe_union(rendered)
            merged = joiner.join(rendered) if rendered else "unknown"
            if nullable and "null" not in merged:
                return f"{merged} | null"
            return merged

    schema_type = schema.get("type")
    if isinstance(schema_type, list):
        normalized = [str(value) for value in schema_type]
        nullable = nullable or "null" in normalized
        non_null = [value for value in normalized if value != "null"]
        schema_type = non_null[0] if len(non_null) == 1 else None

    if schema_type == "string":
        return "string | null" if nullable else "string"
    if schema_type in {"number", "integer"}:
        return "number | null" if nullable else "number"
    if schema_type == "boolean":
        return "boolean | null" if nullable else "boolean"
    if schema_type == "null":
        return "null"

    if schema_type == "array":
        item_type = schema_to_ts(schema.get("items"))
        rendered = f"Array<{maybe_parenthesize(item_type)}>"
        if nullable:
            return f"{rendered} | null"
        return rendered

    if schema_type == "object" or "properties" in schema or "additionalProperties" in schema:
        properties = schema.get("properties") or {}
        required = set(schema.get("required") or [])

        lines: list[str] = []
        if isinstance(properties, dict):
            for raw_key in sorted(properties.keys(), key=lambda value: str(value)):
                key = str(raw_key)
                property_schema = properties.get(raw_key)
                ts_key = key if _VALID_IDENTIFIER.match(key) else quote_string(key)
                optional = "" if key in required else "?"
                lines.append(f"  {ts_key}{optional}: {schema_to_ts(property_schema)};")

        additional = schema.get("additionalProperties")
        if additional is True:
            lines.append("  [key: string]: unknown;")
        elif isinstance(additional, dict):
            lines.append(f"  [key: string]: {schema_to_ts(additional)};")

        if lines:
            body = "{\n" + "\n".join(lines) + "\n}"
        else:
            body = "Record<string, unknown>"

        if nullable:
            return f"{body} | null"
        return body

    return "unknown"


def render_types(spec: dict[str, Any]) -> str:
    schemas = spec.get("components", {}).get("schemas", {})
    if not isinstance(schemas, dict) or not schemas:
        raise SystemExit("No component schemas found in Imperium OpenAPI snapshot.")

    lines: list[str] = [
        "// This file is auto-generated by scripts/imperium/generate_api_types.py.",
        "// Do not edit manually.",
        "",
    ]

    for name in sorted(schemas.keys()):
        schema = schemas[name]
        rendered = schema_to_ts(schema)
        lines.append(f"export type {name} = {rendered};")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def write_if_changed(path: Path, content: str) -> None:
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def main() -> None:
    spec = load_openapi()
    content = render_types(spec)
    write_if_changed(OUT_FILE, content)
    print(f"Generated Imperium API types: {OUT_FILE}")


if __name__ == "__main__":
    main()
