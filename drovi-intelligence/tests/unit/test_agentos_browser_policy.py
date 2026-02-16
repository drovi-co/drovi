from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.agentos.browser.models import BrowserActionRequest
from src.agentos.browser.policy import BrowserSafetyPolicy
from src.kernel.errors import ValidationError


def _settings(**overrides):
    defaults = {
        "browser_allowed_domains": [],
        "browser_blocked_domains": [],
        "browser_block_private_network": True,
        "browser_uploads_enabled": True,
        "browser_downloads_enabled": True,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_browser_policy_blocks_blocked_domain(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.agentos.browser.policy.get_settings",
        lambda: _settings(browser_blocked_domains=["blocked.example.com"]),
    )
    policy = BrowserSafetyPolicy()
    request = BrowserActionRequest(
        organization_id="org_test",
        action="navigate",
        url="https://blocked.example.com/path",
    )
    with pytest.raises(ValidationError) as exc:
        policy.enforce(request=request, current_url=None, session_metadata={})
    assert exc.value.code == "agentos.browser.domain_blocked"


def test_browser_policy_blocks_domain_not_in_allowlist(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.agentos.browser.policy.get_settings",
        lambda: _settings(browser_allowed_domains=["allowed.example.com"]),
    )
    policy = BrowserSafetyPolicy()
    request = BrowserActionRequest(
        organization_id="org_test",
        action="navigate",
        url="https://other.example.com/path",
    )
    with pytest.raises(ValidationError) as exc:
        policy.enforce(request=request, current_url=None, session_metadata={})
    assert exc.value.code == "agentos.browser.domain_not_allowed"


def test_browser_policy_allows_action_with_valid_allowlist_domain(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.agentos.browser.policy.get_settings",
        lambda: _settings(browser_allowed_domains=["allowed.example.com"]),
    )
    policy = BrowserSafetyPolicy()
    request = BrowserActionRequest(
        organization_id="org_test",
        action="navigate",
        url="https://allowed.example.com/path",
    )
    policy.enforce(request=request, current_url=None, session_metadata={})


def test_browser_policy_blocks_private_network_when_enabled(monkeypatch) -> None:
    monkeypatch.setattr(
        "src.agentos.browser.policy.get_settings",
        lambda: _settings(browser_allowed_domains=[], browser_block_private_network=True),
    )
    policy = BrowserSafetyPolicy()
    request = BrowserActionRequest(
        organization_id="org_test",
        action="navigate",
        url="http://127.0.0.1:8080",
    )
    with pytest.raises(ValidationError) as exc:
        policy.enforce(request=request, current_url=None, session_metadata={})
    assert exc.value.code == "agentos.browser.private_network_blocked"


def test_browser_policy_requires_upload_payload(monkeypatch) -> None:
    monkeypatch.setattr("src.agentos.browser.policy.get_settings", lambda: _settings())
    policy = BrowserSafetyPolicy()
    request = BrowserActionRequest(
        organization_id="org_test",
        action="upload",
        selector="#file-input",
        file_name="test.txt",
        content_base64=None,
    )
    with pytest.raises(ValidationError) as exc:
        policy.enforce(request=request, current_url="https://allowed.example.com", session_metadata={})
    assert exc.value.code == "agentos.browser.upload_content_missing"
