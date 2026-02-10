#!/usr/bin/env python3
"""
Coverage ratchet for drovi-intelligence.

Enforces:
- Overall coverage must not decrease vs a committed baseline.
- Any *changed* Python source file under drovi-intelligence/src must meet a
  minimum per-file coverage threshold (default: 80%).

This is intentionally conservative: it prevents "tests later" regressions while
allowing phased refactors of legacy low-coverage areas.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


def _run_git(args: list[str]) -> list[str]:
    out = subprocess.check_output(["git", *args], text=True)
    return [line.strip() for line in out.splitlines() if line.strip()]


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _as_float(value: object) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return 0.0
    return 0.0


def _get_overall_percent(data: dict) -> float:
    totals = data.get("totals") or {}
    if isinstance(totals, dict):
        for key in ("percent_covered", "percent_covered_display", "percent_covered_total"):
            if key in totals:
                return _as_float(totals.get(key))
    # Fallback: older formats may store "percent_covered" at top-level.
    if "percent_covered" in data:
        return _as_float(data.get("percent_covered"))
    return 0.0


def _get_files_block(data: dict) -> dict:
    files = data.get("files")
    return files if isinstance(files, dict) else {}


def _get_file_percent(file_payload: object) -> float:
    if not isinstance(file_payload, dict):
        return 0.0
    summary = file_payload.get("summary")
    if isinstance(summary, dict):
        if "percent_covered" in summary:
            return _as_float(summary.get("percent_covered"))
        if "percent_covered_display" in summary:
            return _as_float(summary.get("percent_covered_display"))
    if "percent_covered" in file_payload:
        return _as_float(file_payload.get("percent_covered"))
    return 0.0


@dataclass(frozen=True)
class CoverageIndex:
    by_path: dict[str, float]

    @classmethod
    def from_cov_json(cls, data: dict) -> "CoverageIndex":
        out: dict[str, float] = {}
        for raw_path, payload in _get_files_block(data).items():
            if not isinstance(raw_path, str):
                continue
            norm = str(PurePosixPath(raw_path))
            out[norm] = _get_file_percent(payload)
        return cls(by_path=out)

    def lookup_percent(self, path: str) -> float | None:
        norm = str(PurePosixPath(path))
        if norm in self.by_path:
            return self.by_path[norm]

        # Coverage sometimes stores absolute paths; try suffix match.
        candidates = [
            (k, v) for k, v in self.by_path.items() if k.endswith(f"/{norm}") or k.endswith(norm)
        ]
        if len(candidates) == 1:
            return candidates[0][1]
        return None


def _changed_source_files(base_ref: str, *, repo_root: Path) -> list[str]:
    changed = _run_git(
        [
            "diff",
            "--name-only",
            "--diff-filter=ACMRTUXB",
            f"{base_ref}...HEAD",
        ]
    )
    out: list[str] = []
    for rel in changed:
        if not rel.startswith("drovi-intelligence/src/"):
            continue
        if not rel.endswith(".py"):
            continue
        abs_path = repo_root / rel
        if abs_path.exists():
            out.append(rel)
    return out


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True, help="Path to committed baseline coverage JSON")
    parser.add_argument("--current", required=True, help="Path to current coverage JSON")
    parser.add_argument(
        "--base-ref",
        required=True,
        help="Git base ref/sha used to compute changed files (e.g. origin/main or $GITHUB_EVENT_BEFORE)",
    )
    parser.add_argument(
        "--min-changed-file-percent",
        type=float,
        default=80.0,
        help="Minimum per-file percent for changed files under drovi-intelligence/src (default: 80)",
    )
    args = parser.parse_args(argv)

    repo_root = Path(__file__).resolve().parent.parent.parent
    baseline_path = (repo_root / args.baseline).resolve()
    current_path = (repo_root / args.current).resolve()

    baseline = _load_json(baseline_path)
    current = _load_json(current_path)

    baseline_overall = _get_overall_percent(baseline)
    current_overall = _get_overall_percent(current)

    if current_overall + 1e-9 < baseline_overall:
        sys.stderr.write(
            f"Coverage decreased: baseline={baseline_overall:.2f}% current={current_overall:.2f}%\n"
        )
        return 1

    index = CoverageIndex.from_cov_json(current)
    changed = _changed_source_files(args.base_ref, repo_root=repo_root)

    failures: list[str] = []
    for rel in changed:
        cov_key = rel.replace("drovi-intelligence/", "", 1)
        percent = index.lookup_percent(cov_key)
        if percent is None:
            failures.append(f"{rel}: missing coverage entry (treated as 0%)")
            continue
        if percent + 1e-9 < args.min_changed_file_percent:
            failures.append(f"{rel}: {percent:.2f}% < {args.min_changed_file_percent:.2f}%")

    if failures:
        sys.stderr.write("Changed-file coverage gate failed:\n")
        for line in failures:
            sys.stderr.write(f"- {line}\n")
        sys.stderr.write(
            "\nAdd/strengthen tests for the changed files, or split logic behind ports/fakes to test deterministically.\n"
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

