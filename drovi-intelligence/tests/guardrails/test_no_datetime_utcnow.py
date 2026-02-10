from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

import pytest


@dataclass(frozen=True)
class Offense:
    path: str
    line: int
    col: int
    snippet: str


def _iter_python_files(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return [p for p in root.rglob("*.py") if p.is_file()]


def _find_datetime_utcnow_calls(source: str) -> list[tuple[int, int]]:
    """
    Detect `datetime.utcnow()` calls via AST.
    Intended for new domain/application code where time must be injected.
    """
    tree = ast.parse(source)
    offenses: list[tuple[int, int]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Attribute):
            continue
        if func.attr != "utcnow":
            continue
        value = func.value
        # Covers both:
        # - from datetime import datetime; datetime.utcnow()
        # - import datetime; datetime.datetime.utcnow() (handled below)
        if isinstance(value, ast.Name) and value.id == "datetime":
            offenses.append((node.lineno, node.col_offset))
            continue
        if (
            isinstance(value, ast.Attribute)
            and isinstance(value.value, ast.Name)
            and value.value.id == "datetime"
            and value.attr == "datetime"
        ):
            offenses.append((node.lineno, node.col_offset))
            continue
    return offenses


@pytest.mark.unit
def test_domain_application_code_does_not_call_datetime_utcnow_directly():
    """
    Guardrail: new domain/application code must not call datetime.utcnow().

    Rationale:
    - Makes tests nondeterministic.
    - Breaks bi-temporal reasoning when mixed with tz-aware timestamps.
    - Prevents consistent injection of time for workflows/replay.

    Scope (Phase 0):
    - Only enforce for the new architecture directories:
      - src/kernel
      - src/contexts/**/domain
      - src/contexts/**/application
    """
    repo_root = Path(__file__).resolve().parents[2]
    targets: list[Path] = []
    targets.append(repo_root / "src" / "kernel")

    contexts = repo_root / "src" / "contexts"
    if contexts.exists():
        for ctx in contexts.iterdir():
            if not ctx.is_dir():
                continue
            targets.append(ctx / "domain")
            targets.append(ctx / "application")

    offenses: list[Offense] = []
    for target in targets:
        for file_path in _iter_python_files(target):
            rel = file_path.relative_to(repo_root).as_posix()
            source = file_path.read_text(encoding="utf-8", errors="replace")
            for (line, col) in _find_datetime_utcnow_calls(source):
                # Best-effort snippet
                snippet = ""
                try:
                    snippet = source.splitlines()[line - 1].strip()
                except Exception:
                    snippet = "datetime.utcnow()"
                offenses.append(Offense(path=rel, line=line, col=col, snippet=snippet))

    if offenses:
        formatted = "\n".join(
            f"- {o.path}:{o.line}:{o.col} {o.snippet}" for o in sorted(offenses, key=lambda o: (o.path, o.line, o.col))
        )
        raise AssertionError(
            "datetime.utcnow() is forbidden in domain/application code. Use kernel time instead.\n"
            + formatted
        )

