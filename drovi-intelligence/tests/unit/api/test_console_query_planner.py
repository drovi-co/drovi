from __future__ import annotations

from types import SimpleNamespace

from src.api.routes.console_query_planner import plan_console_joins, render_console_joins


def test_plan_console_joins_for_priority_filter() -> None:
    joins = plan_console_joins(
        filters=[SimpleNamespace(entity="priority")],
        group_by=None,
        include_projection=False,
    )
    assert "cd" in joins
    assert "td" in joins


def test_plan_console_joins_for_any_contact_filter() -> None:
    joins = plan_console_joins(
        filters=[SimpleNamespace(entity="contact")],
        group_by=None,
        include_projection=False,
    )
    for required in ("oc", "cd", "dc", "cc", "dd", "dmc", "td", "ac"):
        assert required in joins


def test_plan_console_projection_with_source_sender_dependencies() -> None:
    joins = plan_console_joins(
        filters=[],
        group_by=None,
        include_projection=True,
        include_source_sender=True,
    )
    assert "uos" in joins
    assert "conv" in joins
    assert "m" in joins
    sql = render_console_joins(joins)
    assert "LEFT JOIN unified_object_source" in sql
    assert "LEFT JOIN conversation conv" in sql
    assert "LEFT JOIN message m" in sql
