from __future__ import annotations

import ipaddress
from typing import Any

from src.config import get_settings
from src.kernel.errors import ValidationError

from .common import extract_domain, normalize_domain
from .models import BrowserActionRequest


class BrowserSafetyPolicy:
    """Safe-browsing checks before browser side effects execute."""

    def enforce(
        self,
        *,
        request: BrowserActionRequest,
        current_url: str | None,
        session_metadata: dict[str, Any],
    ) -> None:
        settings = get_settings()
        blocked = _merge_domain_lists(settings.browser_blocked_domains, session_metadata.get("blocked_domains"))
        allowed = _merge_domain_lists(settings.browser_allowed_domains, session_metadata.get("allowed_domains"))

        target_url = request.url or current_url
        domain = extract_domain(target_url)
        if domain:
            self._validate_domain(domain=domain, blocked=blocked, allowed=allowed)
            if settings.browser_block_private_network and _is_private_domain_or_ip(domain):
                raise ValidationError(
                    code="agentos.browser.private_network_blocked",
                    message="Private network browsing is blocked by policy",
                    meta={"domain": domain},
                    status_code=403,
                )

        if request.action == "upload":
            if not bool(settings.browser_uploads_enabled):
                raise ValidationError(
                    code="agentos.browser.uploads_disabled",
                    message="Browser uploads are disabled by policy",
                    status_code=403,
                )
            if not request.content_base64:
                raise ValidationError(
                    code="agentos.browser.upload_content_missing",
                    message="Upload action requires content_base64",
                )
        if request.action == "download" and not bool(settings.browser_downloads_enabled):
            raise ValidationError(
                code="agentos.browser.downloads_disabled",
                message="Browser downloads are disabled by policy",
                status_code=403,
            )
        if request.action == "click" and not request.selector:
            raise ValidationError(
                code="agentos.browser.selector_required",
                message="click action requires selector",
            )
        if request.action == "type":
            if not request.selector:
                raise ValidationError(
                    code="agentos.browser.selector_required",
                    message="type action requires selector",
                )
            if request.text is None:
                raise ValidationError(
                    code="agentos.browser.text_required",
                    message="type action requires text",
                )
        if request.action == "navigate" and not request.url:
            raise ValidationError(
                code="agentos.browser.url_required",
                message="navigate action requires url",
            )

    def _validate_domain(self, *, domain: str, blocked: set[str], allowed: set[str]) -> None:
        normalized = normalize_domain(domain)
        if normalized in blocked:
            raise ValidationError(
                code="agentos.browser.domain_blocked",
                message=f"Domain is blocked by browser policy: {normalized}",
                status_code=403,
                meta={"domain": normalized},
            )
        if allowed and normalized not in allowed:
            raise ValidationError(
                code="agentos.browser.domain_not_allowed",
                message=f"Domain is not in browser allowlist: {normalized}",
                status_code=403,
                meta={"domain": normalized},
            )


def _merge_domain_lists(*values: Any) -> set[str]:
    merged: set[str] = set()
    for value in values:
        if isinstance(value, (list, tuple, set)):
            for item in value:
                if not isinstance(item, str):
                    continue
                normalized = normalize_domain(item)
                if normalized:
                    merged.add(normalized)
    return merged


def _is_private_domain_or_ip(domain: str) -> bool:
    candidate = domain.strip().lower()
    if candidate in {"localhost", "host.docker.internal"}:
        return True
    if candidate.endswith(".local") or candidate.endswith(".internal"):
        return True
    try:
        ip = ipaddress.ip_address(candidate)
        return bool(ip.is_private or ip.is_loopback or ip.is_link_local)
    except Exception:
        return False
