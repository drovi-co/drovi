from __future__ import annotations

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from src.api.routes.agents_roles_profiles import PermissionScope


class _RecordingOp:
    def __init__(self) -> None:
        self.created_tables: list[str] = []
        self.dropped_tables: list[str] = []
        self.created_indexes: list[str] = []
        self.dropped_indexes: list[str] = []
        self.added_columns: list[tuple[str, str]] = []
        self.dropped_columns: list[tuple[str, str]] = []
        self.created_constraints: list[tuple[str, str]] = []
        self.dropped_constraints: list[tuple[str, str]] = []

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

    def create_check_constraint(
        self,
        constraint_name: str,
        table_name: str,
        sqltext: str,
        *args,
        **kwargs,
    ) -> None:
        del sqltext
        self.created_constraints.append((table_name, constraint_name))

    def drop_constraint(
        self,
        constraint_name: str,
        table_name: str,
        *args,
        **kwargs,
    ) -> None:
        self.dropped_constraints.append((table_name, constraint_name))


def _load_migration_module(*, filename: str, module_name: str, op_stub: object):
    migration_path = Path(__file__).resolve().parents[2] / "alembic" / "versions" / filename
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


def test_permission_scope_rejects_invalid_channel_value() -> None:
    with pytest.raises(ValidationError):
        PermissionScope.model_validate({"channels": ["sms"]})


def test_agentos_migration_upgrade_and_downgrade_are_table_symmetric() -> None:
    recorder = _RecordingOp()
    migration = _load_migration_module(
        filename="051_agentos_core_tables.py",
        module_name="agentos_migration_051",
        op_stub=recorder,
    )

    migration.upgrade()
    migration.downgrade()

    assert set(recorder.created_tables) == set(recorder.dropped_tables)
    assert set(recorder.created_indexes) == set(recorder.dropped_indexes)


def test_agentos_tool_policy_migration_upgrade_and_downgrade_are_table_symmetric() -> None:
    recorder = _RecordingOp()
    migration = _load_migration_module(
        filename="052_agentos_tool_policy_plane.py",
        module_name="agentos_migration_052",
        op_stub=recorder,
    )

    migration.upgrade()
    migration.downgrade()

    assert set(recorder.created_tables) == set(recorder.dropped_tables)
    assert set(recorder.created_indexes) == set(recorder.dropped_indexes)


def test_agentos_identity_presence_migration_upgrade_and_downgrade_are_table_symmetric() -> None:
    recorder = _RecordingOp()
    migration = _load_migration_module(
        filename="053_agentos_identity_presence.py",
        module_name="agentos_migration_053",
        op_stub=recorder,
    )

    migration.upgrade()
    migration.downgrade()

    assert set(recorder.created_tables) == set(recorder.dropped_tables)
    assert set(recorder.created_indexes) == set(recorder.dropped_indexes)


def test_agentos_browser_automation_migration_upgrade_and_downgrade_are_table_symmetric() -> None:
    recorder = _RecordingOp()
    migration = _load_migration_module(
        filename="054_agentos_browser_automation.py",
        module_name="agentos_migration_054",
        op_stub=recorder,
    )

    migration.upgrade()
    migration.downgrade()

    assert set(recorder.created_tables) == set(recorder.dropped_tables)
    assert set(recorder.created_indexes) == set(recorder.dropped_indexes)


def test_agentos_governance_security_migration_upgrade_and_downgrade_are_table_symmetric() -> None:
    recorder = _RecordingOp()
    migration = _load_migration_module(
        filename="055_agentos_governance_security.py",
        module_name="agentos_migration_055",
        op_stub=recorder,
    )

    migration.upgrade()
    migration.downgrade()

    assert set(recorder.created_tables) == set(recorder.dropped_tables)
    assert set(recorder.created_indexes) == set(recorder.dropped_indexes)
    assert set(recorder.added_columns) == set(recorder.dropped_columns)
    assert set(recorder.created_constraints) == set(recorder.dropped_constraints)


def test_agentos_quality_optimization_migration_upgrade_and_downgrade_are_table_symmetric() -> None:
    recorder = _RecordingOp()
    migration = _load_migration_module(
        filename="056_agentos_quality_optimization.py",
        module_name="agentos_migration_056",
        op_stub=recorder,
    )

    migration.upgrade()
    migration.downgrade()

    assert set(recorder.created_tables) == set(recorder.dropped_tables)
    assert set(recorder.created_indexes) == set(recorder.dropped_indexes)
    assert set(recorder.created_constraints) == set(recorder.dropped_constraints)


def test_continuum_migration_decommission_migration_upgrade_and_downgrade_are_table_symmetric() -> None:
    recorder = _RecordingOp()
    migration = _load_migration_module(
        filename="057_continuum_migration_decommission.py",
        module_name="agentos_migration_057",
        op_stub=recorder,
    )

    migration.upgrade()
    migration.downgrade()

    assert set(recorder.created_tables) == set(recorder.dropped_tables)
    assert set(recorder.created_indexes) == set(recorder.dropped_indexes)
    assert set(recorder.created_constraints) == set(recorder.dropped_constraints)
