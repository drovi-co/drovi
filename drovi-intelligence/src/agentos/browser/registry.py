from __future__ import annotations

from typing import Iterable

from src.config import get_settings
from src.kernel.errors import UpstreamError, ValidationError

from .models import BrowserProviderActionRequest, BrowserProviderActionResult, BrowserProviderSession, BrowserProviderType
from .provider import BrowserProvider
from .providers import LocalPlaywrightProvider, ManagedBrowserProvider, ParallelBrowserProvider


class BrowserProviderRegistry:
    """Provider registry + fallback policy router."""

    def __init__(self) -> None:
        self._providers: dict[BrowserProviderType, BrowserProvider] = {
            "local": LocalPlaywrightProvider(),
            "managed": ManagedBrowserProvider(),
            "parallel": ParallelBrowserProvider(),
        }

    def get(self, provider: BrowserProviderType) -> BrowserProvider:
        resolved = self._providers.get(provider)
        if resolved is None:
            raise ValidationError(
                code="agentos.browser.provider_unknown",
                message=f"Unknown browser provider: {provider}",
                meta={"provider": provider},
            )
        return resolved

    def build_provider_chain(
        self,
        *,
        primary: BrowserProviderType,
        fallback_providers: Iterable[BrowserProviderType] | None,
    ) -> list[BrowserProviderType]:
        settings = get_settings()
        configured = [primary]
        configured.extend(list(fallback_providers or []))
        configured.extend(list(settings.browser_provider_fallback_order or []))
        chain: list[BrowserProviderType] = []
        for item in configured:
            if item not in self._providers:
                continue
            if item in chain:
                continue
            chain.append(item)
        return chain

    async def close_session(
        self,
        *,
        provider: BrowserProviderType,
        organization_id: str,
        provider_session_id: str,
        metadata: dict[str, object],
    ) -> None:
        await self.get(provider).close_session(
            organization_id=organization_id,
            provider_session_id=provider_session_id,
            metadata=metadata,
        )

    async def create_session(
        self,
        *,
        provider: BrowserProviderType,
        organization_id: str,
        session_id: str,
        initial_url: str | None,
        metadata: dict[str, object],
        fallback_providers: Iterable[BrowserProviderType] | None,
    ) -> BrowserProviderSession:
        errors: list[UpstreamError] = []
        for candidate in self.build_provider_chain(primary=provider, fallback_providers=fallback_providers):
            try:
                session = await self.get(candidate).create_session(
                    organization_id=organization_id,
                    session_id=session_id,
                    initial_url=initial_url,
                    metadata=dict(metadata),
                )
                if candidate != provider:
                    session.metadata = {**session.metadata, "fallback_from": provider}
                return session
            except UpstreamError as exc:
                errors.append(exc)
                if not _should_fallback(exc):
                    raise
        if errors:
            raise errors[-1]
        raise ValidationError(
            code="agentos.browser.provider_chain_empty",
            message="No browser providers are configured",
        )

    async def execute_action(
        self,
        *,
        provider: BrowserProviderType,
        organization_id: str,
        provider_session_id: str,
        request: BrowserProviderActionRequest,
        metadata: dict[str, object],
        fallback_providers: Iterable[BrowserProviderType] | None,
    ) -> tuple[BrowserProviderType, BrowserProviderActionResult]:
        errors: list[UpstreamError] = []
        for candidate in self.build_provider_chain(primary=provider, fallback_providers=fallback_providers):
            try:
                result = await self.get(candidate).execute_action(
                    organization_id=organization_id,
                    provider_session_id=provider_session_id,
                    request=request,
                    metadata=dict(metadata),
                )
                if candidate != provider:
                    result.status = "fallback"
                    result.fallback_from = provider
                return candidate, result
            except UpstreamError as exc:
                errors.append(exc)
                if not _should_fallback(exc):
                    raise
        if errors:
            raise errors[-1]
        raise ValidationError(
            code="agentos.browser.provider_chain_empty",
            message="No browser providers are configured",
        )


def _should_fallback(error: UpstreamError) -> bool:
    status = int(getattr(error, "status_code", 500))
    if status >= 500:
        return True
    transient_codes = {
        "agentos.browser.managed_unavailable",
        "agentos.browser.parallel_unavailable",
        "agentos.browser.playwright_action_failed",
    }
    return str(getattr(error, "code", "")) in transient_codes
