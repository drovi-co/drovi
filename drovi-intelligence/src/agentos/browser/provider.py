from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from .models import BrowserProviderActionRequest, BrowserProviderActionResult, BrowserProviderSession, BrowserProviderType


class BrowserProvider(ABC):
    provider_type: BrowserProviderType

    @abstractmethod
    async def create_session(
        self,
        *,
        organization_id: str,
        session_id: str,
        initial_url: str | None,
        metadata: dict[str, Any],
    ) -> BrowserProviderSession:
        raise NotImplementedError

    @abstractmethod
    async def resume_session(
        self,
        *,
        organization_id: str,
        provider_session_id: str,
        metadata: dict[str, Any],
    ) -> BrowserProviderSession:
        raise NotImplementedError

    @abstractmethod
    async def execute_action(
        self,
        *,
        organization_id: str,
        provider_session_id: str,
        request: BrowserProviderActionRequest,
        metadata: dict[str, Any],
    ) -> BrowserProviderActionResult:
        raise NotImplementedError

    @abstractmethod
    async def close_session(
        self,
        *,
        organization_id: str,
        provider_session_id: str,
        metadata: dict[str, Any],
    ) -> None:
        raise NotImplementedError
