import pytest

from tests.support.graph_store import FakeGraphStore
from tests.support.object_store import FakeEvidenceStorage
from tests.support.vector_index import FakeVectorIndex

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_fake_graph_store_records_queries_and_returns_responses():
    graph = FakeGraphStore(responses=[[{"ok": True}], []])

    r1 = await graph.query("MATCH (n) RETURN n", {"a": 1})
    r2 = await graph.query("RETURN 1", None)

    assert r1 == [{"ok": True}]
    assert r2 == []
    assert len(graph.queries) == 2
    assert graph.queries[0].params == {"a": 1}
    assert "MATCH" in graph.queries[0].cypher


@pytest.mark.asyncio
async def test_fake_evidence_storage_write_read_delete_roundtrip():
    store = FakeEvidenceStorage()

    stored = await store.write_bytes(
        artifact_id="evh_123",
        data=b"hello",
        extension=".txt",
        organization_id="org_1",
    )
    assert stored.storage_backend == "fake"

    data = await store.read_bytes(stored.storage_path)
    assert data == b"hello"

    url = await store.create_presigned_url(stored.storage_path)
    assert url and stored.storage_path in url

    deleted = await store.delete(stored.storage_path)
    assert deleted is True


@pytest.mark.asyncio
async def test_fake_vector_index_cosine_similarity_ranks_higher_dot_product():
    index = FakeVectorIndex()
    await index.upsert(item_id="a", embedding=[1.0, 0.0], metadata={"kind": "a"})
    await index.upsert(item_id="b", embedding=[0.0, 1.0], metadata={"kind": "b"})

    results = await index.query(embedding=[0.9, 0.1], k=2)
    assert [r["id"] for r in results] == ["a", "b"]
    assert results[0]["score"] > results[1]["score"]

