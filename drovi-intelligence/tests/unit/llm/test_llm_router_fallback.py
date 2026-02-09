from __future__ import annotations

import pytest

from src.llm.providers import Provider
from src.llm.service import ProviderRouter


pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


class _AllowAllRateLimiter:
    async def wait_for_token(self, timeout: float = 5.0) -> bool:  # noqa: ARG002
        return True


class _NoopCircuitBreaker:
    def can_execute(self) -> bool:
        return True

    def record_success(self) -> None:
        return None

    def record_failure(self) -> None:
        return None


class _StubEmptyProvider:
    async def complete(self, **_kwargs):
        return "", 1, 1

    async def complete_json(self, **_kwargs):  # pragma: no cover
        raise AssertionError("complete_json not expected")


class _StubOkProvider:
    async def complete(self, **_kwargs):
        return "ok", 1, 1

    async def complete_json(self, **_kwargs):  # pragma: no cover
        raise AssertionError("complete_json not expected")


async def test_router_falls_back_when_provider_returns_empty_text(monkeypatch):
    router = ProviderRouter()

    # Force a deterministic provider order: Together (priority 1) then OpenAI (priority 10).
    router.providers = {
        Provider.TOGETHER: _StubEmptyProvider(),
        Provider.OPENAI: _StubOkProvider(),
    }
    router.rate_limiters = {
        Provider.TOGETHER: _AllowAllRateLimiter(),
        Provider.OPENAI: _AllowAllRateLimiter(),
    }
    router.circuit_breakers = {
        Provider.TOGETHER: _NoopCircuitBreaker(),
        Provider.OPENAI: _NoopCircuitBreaker(),
    }

    # Ensure we don't depend on real API keys in the test environment.
    monkeypatch.delenv("TOGETHER_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    result, call = await router.complete_with_fallback(
        messages=[{"role": "user", "content": "hello"}],
        model_tier="balanced",
        temperature=0.0,
        max_tokens=64,
        requires_json=False,
        node_name="test.empty-fallback",
    )

    assert result == "ok"
    assert call.provider == Provider.OPENAI.value
