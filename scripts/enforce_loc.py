#!/usr/bin/env python3
"""
Enforce a maximum LOC (lines of code) budget per file.

Goals:
- Prevent the repo from accumulating new "god files".
- Encourage splitting logic into smaller, testable modules.
- Allow temporary exemptions for legacy files via an allowlist with an expiry.

This script is intended to run in CI in "diff" mode (only changed files).
It can also run locally in "all" mode (scan all tracked files).

Allowlist format (JSON):
{
  "version": 1,
  "exemptions": [
    {
      "path": "drovi-intelligence/src/orchestrator/nodes/persist.py",
      "max_lines": 3500,
      "expires": "2026-05-01",
      "reason": "Split in Phase 6",
      "allow_touched": false
    }
  ]
}
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any


DEFAULT_MAX_LINES = 800
DEFAULT_ALLOWLIST_PATH = "scripts/loc_allowlist.json"
DEFAULT_EXTENSIONS = (".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go")
DEFAULT_EXCLUDE_GLOBS = (
    "**/node_modules/**",
    "**/dist/**",
    "**/.next/**",
    "**/.turbo/**",
    "**/target/**",
    "**/.venv/**",
    "**/__pycache__/**",
    "**/*.gen.ts",
)


def _run_git(args: list[str]) -> str:
    try:
        out = subprocess.check_output(["git", *args], text=True)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"git {' '.join(args)} failed with exit code {exc.returncode}") from exc
    return out


def _load_allowlist(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "exemptions": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError(f"Unexpected allowlist format in {path}")
    exemptions = data.get("exemptions")
    if not isinstance(exemptions, list):
        raise ValueError(f"Expected 'exemptions' list in {path}")
    return data


def _parse_iso_date(value: str) -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"Invalid ISO date: {value!r} (expected YYYY-MM-DD)") from exc


def _matches_any_glob(path: str, globs: tuple[str, ...]) -> bool:
    posix = PurePosixPath(path)
    return any(posix.match(pattern) for pattern in globs)


def _iter_candidate_files(mode: str, base_ref: str | None) -> list[str]:
    if mode == "all":
        out = _run_git(["ls-files"])
        return [line.strip() for line in out.splitlines() if line.strip()]

    if not base_ref:
        # Reasonable fallback for local runs.
        base_ref = "HEAD~1"

    out = _run_git(
        [
            "diff",
            "--name-only",
            "--diff-filter=ACMRTUXB",
            f"{base_ref}...HEAD",
        ]
    )
    return [line.strip() for line in out.splitlines() if line.strip()]


def _resolve_exemption(
    allowlist: dict[str, Any],
    file_path: str,
    *,
    touched: bool,
) -> tuple[int | None, str | None]:
    """
    Returns (max_lines_override, reason) for the file if exempted, otherwise (None, None).
    """
    for raw in allowlist.get("exemptions", []):
        if not isinstance(raw, dict):
            continue
        if raw.get("path") != file_path:
            continue

        expires_raw = raw.get("expires")
        if not isinstance(expires_raw, str) or not expires_raw:
            raise ValueError(f"Allowlist entry for {file_path} is missing 'expires'")
        expires = _parse_iso_date(expires_raw)
        today = dt.date.today()
        if today > expires:
            raise ValueError(
                f"Allowlist entry for {file_path} expired on {expires.isoformat()} (today is {today.isoformat()})"
            )

        allow_touched = bool(raw.get("allow_touched", False))
        if touched and not allow_touched:
            # Exemption exists for baseline scans, but touching requires splitting unless explicitly allowed.
            return None, None

        max_lines = raw.get("max_lines")
        if max_lines is None:
            return None, raw.get("reason") if isinstance(raw.get("reason"), str) else "allowlisted"
        if not isinstance(max_lines, int) or max_lines <= 0:
            raise ValueError(f"Allowlist entry for {file_path} has invalid 'max_lines': {max_lines!r}")
        reason = raw.get("reason") if isinstance(raw.get("reason"), str) else "allowlisted"
        return max_lines, reason

    return None, None


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=("diff", "all"),
        default="diff",
        help="diff: only check files changed vs base-ref; all: scan all tracked files",
    )
    parser.add_argument(
        "--base-ref",
        default=None,
        help="Git base ref for diff mode (e.g. origin/main). Defaults to HEAD~1 for local runs.",
    )
    parser.add_argument(
        "--max-lines",
        type=int,
        default=DEFAULT_MAX_LINES,
        help=f"Maximum allowed lines per file (default: {DEFAULT_MAX_LINES})",
    )
    parser.add_argument(
        "--allowlist",
        default=DEFAULT_ALLOWLIST_PATH,
        help=f"Path to allowlist JSON (default: {DEFAULT_ALLOWLIST_PATH})",
    )
    args = parser.parse_args(argv)

    repo_root = Path(__file__).resolve().parent.parent
    allowlist_path = (repo_root / args.allowlist).resolve()
    allowlist = _load_allowlist(allowlist_path)

    candidates = _iter_candidate_files(args.mode, args.base_ref)
    touched_set = set(candidates) if args.mode == "diff" else set()

    failures: list[str] = []
    for rel_path in candidates:
        if not rel_path.endswith(DEFAULT_EXTENSIONS):
            continue
        if _matches_any_glob(rel_path, DEFAULT_EXCLUDE_GLOBS):
            continue

        abs_path = repo_root / rel_path
        if not abs_path.exists():
            continue

        try:
            line_count = abs_path.read_text(encoding="utf-8", errors="replace").count("\n") + 1
        except OSError as exc:
            failures.append(f"{rel_path}: failed to read file: {exc}")
            continue

        max_lines_override, reason = _resolve_exemption(
            allowlist, rel_path, touched=(rel_path in touched_set)
        )
        effective_max = max_lines_override if max_lines_override is not None else args.max_lines

        if line_count > effective_max:
            if reason:
                failures.append(
                    f"{rel_path}: {line_count} lines > allowlisted max {effective_max} lines ({reason})"
                )
            else:
                failures.append(f"{rel_path}: {line_count} lines > {effective_max} lines")

    if failures:
        sys.stderr.write("LOC budget exceeded:\n")
        for item in failures:
            sys.stderr.write(f"- {item}\n")
        sys.stderr.write(
            "\nFix by splitting the file, or add a temporary allowlist exemption with an expiry.\n"
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

