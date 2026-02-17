from __future__ import annotations

import pytest

from src.search import query_cache

pytestmark = [pytest.mark.unit]


class _FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self.store[key] = value
        self.ttls[key] = ttl


@pytest.fixture(autouse=True)
def _reset_cache_client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(query_cache, "_redis_client", None)


def test_build_search_cache_key_is_stable() -> None:
    key_a = query_cache.build_search_cache_key(
        organization_id="org_123",
        query="Find overdue commitments",
        types=["commitment", "risk"],
        source_types=["email"],
        time_range={"from": "2026-02-01", "to": "2026-02-17"},
        include_graph_context=False,
        limit=20,
        visibility_scope="user_1",
    )
    key_b = query_cache.build_search_cache_key(
        organization_id="org_123",
        query="find overdue commitments",
        types=["risk", "commitment"],
        source_types=["email"],
        time_range={"to": "2026-02-17", "from": "2026-02-01"},
        include_graph_context=False,
        limit=20,
        visibility_scope="user_1",
    )

    assert key_a == key_b
    assert key_a.startswith(query_cache.SEARCH_QUERY_CACHE_PREFIX)


def test_build_search_cache_key_respects_visibility_scope() -> None:
    key_user = query_cache.build_search_cache_key(
        organization_id="org_123",
        query="Find overdue commitments",
        types=None,
        source_types=None,
        time_range=None,
        include_graph_context=False,
        limit=20,
        visibility_scope="user_1",
    )
    key_admin = query_cache.build_search_cache_key(
        organization_id="org_123",
        query="Find overdue commitments",
        types=None,
        source_types=None,
        time_range=None,
        include_graph_context=False,
        limit=20,
        visibility_scope="admin",
    )

    assert key_user != key_admin


@pytest.mark.asyncio
async def test_cache_round_trip(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = _FakeRedis()
    monkeypatch.setattr(query_cache, "_redis_client", fake_redis)

    cache_key = "drovi:search:hybrid:v1:test"
    payload = {
        "success": True,
        "results": [{"id": "uio_1", "type": "commitment"}],
        "count": 1,
        "query_time_ms": 42,
    }

    await query_cache.cache_search_response(cache_key, payload)
    cached = await query_cache.get_cached_search_response(cache_key)

    assert cached == payload
    assert fake_redis.ttls[cache_key] == query_cache.SEARCH_QUERY_CACHE_TTL_SECONDS


@pytest.mark.asyncio
async def test_cache_write_skips_oversized_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_redis = _FakeRedis()
    monkeypatch.setattr(query_cache, "_redis_client", fake_redis)

    payload = {"blob": "x" * (query_cache.MAX_SEARCH_CACHE_BYTES + 100)}
    await query_cache.cache_search_response("drovi:search:hybrid:v1:large", payload)

    assert fake_redis.store == {}
