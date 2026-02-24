from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys
from types import SimpleNamespace


class _RecordingOp:
    def __init__(self) -> None:
        self.created_tables: list[str] = []
        self.dropped_tables: list[str] = []
        self.created_indexes: list[str] = []
        self.dropped_indexes: list[str] = []
        self.added_columns: list[tuple[str, str]] = []
        self.dropped_columns: list[tuple[str, str]] = []
        self.executed_sql: list[str] = []

    def create_table(self, name: str, *args, **kwargs) -> None:
        self.created_tables.append(name)

    def drop_table(self, name: str, *args, **kwargs) -> None:
        self.dropped_tables.append(name)

    def create_index(self, name: str, *args, **kwargs) -> None:
        self.created_indexes.append(name)

    def drop_index(self, name: str, *args, **kwargs) -> None:
        self.dropped_indexes.append(name)

    def add_column(self, table_name: str, column, *args, **kwargs) -> None:
        self.added_columns.append((table_name, str(column.name)))

    def drop_column(self, table_name: str, column_name: str, *args, **kwargs) -> None:
        self.dropped_columns.append((table_name, str(column_name)))

    def execute(self, statement, *args, **kwargs) -> None:
        self.executed_sql.append(str(statement))


def _load_migration_module(*, filename: str, module_name: str, op_stub: object):
    migration_path = Path(__file__).resolve().parents[3] / "alembic" / "versions" / filename
    spec = spec_from_file_location(module_name, migration_path)
    assert spec is not None and spec.loader is not None
    module = module_from_spec(spec)
    previous_alembic = sys.modules.get("alembic")
    sys.modules["alembic"] = SimpleNamespace(op=op_stub)
    try:
        spec.loader.exec_module(module)
    finally:
        if previous_alembic is not None:
            sys.modules["alembic"] = previous_alembic
        else:
            sys.modules.pop("alembic", None)
    return module


def test_world_brain_phase1_migration_upgrade_downgrade_are_symmetric() -> None:
    recorder = _RecordingOp()
    migration = _load_migration_module(
        filename="067_world_brain_phase1_foundation.py",
        module_name="world_brain_migration_067",
        op_stub=recorder,
    )

    migration.upgrade()
    migration.downgrade()

    assert set(recorder.created_tables) == set(recorder.dropped_tables)
    assert set(recorder.created_indexes) == set(recorder.dropped_indexes)
    assert set(recorder.added_columns) == set(recorder.dropped_columns)
    assert any("ENABLE ROW LEVEL SECURITY" in statement for statement in recorder.executed_sql)
