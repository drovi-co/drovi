from __future__ import annotations

from pathlib import Path


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_raw_pool_usage_goes_through_db_port() -> None:
    root = Path(__file__).resolve().parents[3] / "src"
    disallowed = [
        "from src.db.client import get_db_pool",
        "from src.db import get_db_pool",
        "get_db_pool(",
    ]

    checked_files: list[Path] = []
    offenders: list[str] = []

    for scope in ("api", "graph"):
        for path in (root / scope).rglob("*.py"):
            checked_files.append(path)
            content = _read(path)
            for pattern in disallowed:
                if pattern in content:
                    offenders.append(f"{path}: contains `{pattern}`")

    assert checked_files, "Expected to scan API/graph source files"
    assert not offenders, "\n".join(offenders)
