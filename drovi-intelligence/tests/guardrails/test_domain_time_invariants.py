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


def _find_utc_now_naive_usage(source: str) -> list[tuple[int, int]]:
    """Detect direct `utc_now_naive(...)` calls via AST."""
    tree = ast.parse(source)
    offenses: list[tuple[int, int]] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if isinstance(func, ast.Name) and func.id == "utc_now_naive":
            offenses.append((node.lineno, node.col_offset))
    return offenses


@pytest.mark.unit
def test_domain_application_code_does_not_use_utc_now_naive():
    """
    Guardrail: domain/application code must be tz-aware.

    Enforce by forbidding `utc_now_naive()` usage inside:
    - src/contexts/**/domain
    - src/contexts/**/application
    """
    repo_root = Path(__file__).resolve().parents[2]
    contexts = repo_root / "src" / "contexts"
    if not contexts.exists():
        return

    offenses: list[Offense] = []
    for ctx in contexts.iterdir():
        if not ctx.is_dir():
            continue
        for layer in ("domain", "application"):
            target = ctx / layer
            for file_path in _iter_python_files(target):
                rel = file_path.relative_to(repo_root).as_posix()
                source = file_path.read_text(encoding="utf-8", errors="replace")
                for (line, col) in _find_utc_now_naive_usage(source):
                    snippet = ""
                    try:
                        snippet = source.splitlines()[line - 1].strip()
                    except Exception:
                        snippet = "utc_now_naive()"
                    offenses.append(Offense(path=rel, line=line, col=col, snippet=snippet))

    if offenses:
        formatted = "\n".join(
            f"- {o.path}:{o.line}:{o.col} {o.snippet}" for o in sorted(offenses, key=lambda o: (o.path, o.line, o.col))
        )
        raise AssertionError(
            "utc_now_naive() is forbidden in domain/application code. Use kernel utc_now() and coerce at boundaries.\n"
            + formatted
        )

