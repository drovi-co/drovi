from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.api.routes import search as search_route

pytestmark = [pytest.mark.unit]


class _FakeCtx:
    def __init__(
        self,
        *,
        organization_id: str = "org_test",
        key_id: str = "session:user_test",
        is_internal: bool = False,
        is_admin: bool = False,
    ) -> None:
        self.organization_id = organization_id
        self.key_id = key_id
        self.is_internal = is_internal
        self._is_admin = is_admin

    def has_scope(self, _scope) -> bool:
        return self._is_admin


@pytest.mark.asyncio
async def test_hybrid_search_uses_cache_hit() -> None:
    cached_payload = {
        "success": True,
        "results": [
            {
                "id": "uio_1",
                "type": "commitment",
                "title": "Cached commitment",
                "properties": {},
                "score": 0.97,
                "scores": {"vector": 0.97},
                "match_source": "vector",
                "connections": [],
            }
        ],
        "count": 1,
        "query_time_ms": 8,
    }
    get_hybrid = AsyncMock()

    with (
        patch("src.api.routes.search.build_search_cache_key", return_value="cache:key"),
        patch("src.api.routes.search.get_cached_search_response", AsyncMock(return_value=cached_payload)),
        patch("src.api.routes.search.get_hybrid_search", get_hybrid),
    ):
        response = await search_route.hybrid_search(
            request=search_route.SearchRequest(
                query="What is due next week?",
                organization_id="org_test",
            ),
            ctx=_FakeCtx(),
        )

    assert response.count == 1
    assert response.results[0].title == "Cached commitment"
    get_hybrid.assert_not_awaited()


@pytest.mark.asyncio
async def test_hybrid_search_populates_cache_on_miss() -> None:
    search_impl = SimpleNamespace(
        search=AsyncMock(
            return_value=[
                {
                    "id": "contact_1",
                    "type": "contact",
                    "title": "Ariane Dubois",
                    "properties": {"role": "Partner"},
                    "score": 0.81,
                    "scores": {"vector": 0.81},
                    "match_source": "vector",
                    "connections": [],
                }
            ]
        )
    )
    cache_write = AsyncMock()

    with (
        patch("src.api.routes.search.build_search_cache_key", return_value="cache:key"),
        patch("src.api.routes.search.get_cached_search_response", AsyncMock(return_value=None)),
        patch("src.api.routes.search.get_hybrid_search", AsyncMock(return_value=search_impl)),
        patch("src.api.routes.search.cache_search_response", cache_write),
    ):
        response = await search_route.hybrid_search(
            request=search_route.SearchRequest(
                query="Who owns this mandate?",
                organization_id="org_test",
            ),
            ctx=_FakeCtx(),
        )

    assert response.success is True
    assert response.count == 1
    assert response.results[0].id == "contact_1"
    assert search_impl.search.await_count == 1
    cache_write.assert_awaited_once()
