from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class GraphQuery:
    cypher: str
    params: dict[str, Any]


@dataclass(slots=True)
class FakeGraphStore:
    """
    In-memory fake graph store for unit tests.

    This is intentionally small. It records Cypher queries and can return a
    predefined sequence of responses.
    """

    responses: list[Any] = field(default_factory=list)
    queries: list[GraphQuery] = field(default_factory=list)

    async def query(self, cypher: str, params: dict[str, Any] | None = None) -> Any:
        self.queries.append(GraphQuery(cypher=cypher, params=dict(params or {})))
        if self.responses:
            return self.responses.pop(0)
        return []

