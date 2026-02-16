from __future__ import annotations

from datetime import UTC, datetime

import pytest

from src.graph.changes.tracker import ChangeTracker


class _AcquireContext:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return None


class _FakePool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return _AcquireContext(self._conn)


class _FakeConn:
    def __init__(self, *, timeline_rows=None, legacy_rows=None, changed_rows=None):
        self.timeline_rows = timeline_rows or []
        self.legacy_rows = legacy_rows or []
        self.changed_rows = changed_rows or []

    async def fetch(self, query: str, *_args):
        if "WITH ranked AS (" in query:
            return self.timeline_rows
        if "FROM entity_versions ev1" in query:
            return self.legacy_rows
        if "FROM unified_object_timeline t" in query and "SELECT DISTINCT" in query:
            return self.changed_rows
        raise AssertionError(f"Unexpected query executed: {query}")


@pytest.mark.asyncio
async def test_get_changes_since_prefers_timeline_rows(monkeypatch):
    now = datetime(2026, 2, 16, 10, 0, tzinfo=UTC)
    conn = _FakeConn(
        timeline_rows=[
            {
                "entity_id": "uio_1",
                "entity_type": "commitment",
                "event_type": "created",
                "event_description": "Commitment extracted",
                "triggered_by": "system",
                "created_at": now,
                "old_data": None,
                "new_data": {"title": "Ship launch memo"},
                "version": 1,
            }
        ]
    )

    async def _get_pool():
        return _FakePool(conn)

    monkeypatch.setattr("src.db.get_raw_query_pool", _get_pool)

    tracker = ChangeTracker()
    records = await tracker.get_changes_since(
        organization_id="org_1",
        since=datetime(2026, 2, 15, 0, 0, tzinfo=UTC),
        entity_types=["commitment"],
        limit=10,
    )

    assert len(records) == 1
    assert records[0].entity_id == "uio_1"
    assert records[0].entity_type == "commitment"
    assert records[0].change_type == "created"
    assert records[0].version == 1


@pytest.mark.asyncio
async def test_get_changed_entities_reads_org_scoped_timeline(monkeypatch):
    conn = _FakeConn(
        changed_rows=[
            {"entity_id": "uio_a", "entity_type": "commitment"},
            {"entity_id": "uio_b", "entity_type": "task"},
            {"entity_id": "uio_c", "entity_type": "task"},
        ]
    )

    async def _get_pool():
        return _FakePool(conn)

    monkeypatch.setattr("src.db.get_raw_query_pool", _get_pool)

    tracker = ChangeTracker()
    result = await tracker.get_changed_entities(
        organization_id="org_1",
        since=datetime(2026, 2, 15, 0, 0, tzinfo=UTC),
        entity_types=None,
    )

    assert result == {
        "commitment": ["uio_a"],
        "task": ["uio_b", "uio_c"],
    }
