from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class FakeLLMService:
    """
    Simple deterministic fake for LLM service calls.

    Many tests use monkeypatch + local fakes already; this provides a reusable
    option for application-level tests.
    """

    structured_responses: list[Any] = field(default_factory=list)
    text_responses: list[str] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def complete_structured(self, *args: Any, **kwargs: Any) -> Any:
        self.calls.append({"method": "complete_structured", "args": args, "kwargs": kwargs})
        if not self.structured_responses:
            raise AssertionError("FakeLLMService: no structured_responses remaining")
        return self.structured_responses.pop(0)

    async def complete(self, *args: Any, **kwargs: Any) -> str:
        self.calls.append({"method": "complete", "args": args, "kwargs": kwargs})
        if not self.text_responses:
            raise AssertionError("FakeLLMService: no text_responses remaining")
        return self.text_responses.pop(0)

