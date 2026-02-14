#!/usr/bin/env python3
"""
Generate a deterministic OpenAPI snapshot for the FastAPI app.

Usage (inside repo root):
  docker compose run --no-deps --rm drovi-intelligence python scripts/generate_openapi.py > openapi/openapi.json
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
from pathlib import Path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default=None,
        help="Optional file path to write the snapshot instead of printing to stdout",
    )
    args = parser.parse_args(argv)

    # Ensure we do not accidentally enable production-only middleware.
    os.environ.setdefault("ENVIRONMENT", "test")
    os.environ.setdefault("LOG_LEVEL", "WARNING")

    # Importing the full app may trigger module-level logs (connector registry,
    # etc). We want a pure JSON snapshot, so silence stdout/stderr during import.
    with open(os.devnull, "w", encoding="utf-8") as devnull, contextlib.redirect_stdout(
        devnull
    ), contextlib.redirect_stderr(devnull):
        from src.api.main import app  # noqa: WPS433 (runtime import for env control)

        payload = app.openapi()
    rendered = json.dumps(payload, sort_keys=True, indent=2, ensure_ascii=True) + "\n"

    if args.output:
        Path(args.output).write_text(rendered, encoding="utf-8")
        return
    print(rendered, end="")


if __name__ == "__main__":
    main()
