from __future__ import annotations

from dataclasses import dataclass, field
from math import sqrt
from typing import Any


@dataclass(frozen=True, slots=True)
class VectorItem:
    id: str
    embedding: list[float]
    metadata: dict[str, Any]


@dataclass(slots=True)
class FakeVectorIndex:
    """In-memory cosine-similarity vector index for unit tests."""

    items: dict[str, VectorItem] = field(default_factory=dict)

    async def upsert(self, *, item_id: str, embedding: list[float], metadata: dict[str, Any] | None = None) -> None:
        self.items[item_id] = VectorItem(id=item_id, embedding=list(embedding), metadata=dict(metadata or {}))

    async def query(self, *, embedding: list[float], k: int = 10) -> list[dict[str, Any]]:
        query_vec = list(embedding)

        def _dot(a: list[float], b: list[float]) -> float:
            return sum(x * y for x, y in zip(a, b))

        def _norm(a: list[float]) -> float:
            return sqrt(sum(x * x for x in a)) or 1.0

        qn = _norm(query_vec)
        scored: list[tuple[float, VectorItem]] = []
        for item in self.items.values():
            # If dimensions mismatch, skip; this matches "graceful degradation" semantics.
            if len(item.embedding) != len(query_vec):
                continue
            score = _dot(query_vec, item.embedding) / (qn * _norm(item.embedding))
            scored.append((score, item))

        scored.sort(key=lambda t: t[0], reverse=True)
        out: list[dict[str, Any]] = []
        for score, item in scored[: max(0, int(k))]:
            out.append({"id": item.id, "score": float(score), "metadata": dict(item.metadata)})
        return out

