import pytest
from fastapi import Request

from src.security.org_policy import OrgSecurityPolicy, get_client_ip


pytestmark = pytest.mark.unit


def _request(headers: dict[str, str] | None = None, client_host: str | None = "127.0.0.1") -> Request:
    scope = {
        "type": "http",
        "headers": [
            (key.lower().encode("latin-1"), value.encode("latin-1"))
            for key, value in (headers or {}).items()
        ],
        "client": (client_host, 12345) if client_host else None,
        "path": "/api/v1/test",
        "method": "GET",
    }
    return Request(scope)


def test_password_auth_allowed_when_sso_not_enforced():
    policy = OrgSecurityPolicy(organization_id="org_1", sso_enforced=False)
    assert policy.allows_password_auth("production") is True


def test_password_auth_fallback_respects_environment():
    policy = OrgSecurityPolicy(
        organization_id="org_1",
        sso_enforced=True,
        password_fallback_enabled=True,
        password_fallback_environments=("development", "test"),
    )
    assert policy.allows_password_auth("development") is True
    assert policy.allows_password_auth("production") is False


def test_password_auth_denied_when_fallback_disabled():
    policy = OrgSecurityPolicy(
        organization_id="org_1",
        sso_enforced=True,
        password_fallback_enabled=False,
    )
    assert policy.allows_password_auth("development") is False


def test_ip_allowlist_accepts_exact_and_cidr():
    policy = OrgSecurityPolicy(
        organization_id="org_1",
        ip_allowlist=("203.0.113.7", "10.0.0.0/8"),
    )
    assert policy.is_ip_allowed("203.0.113.7") is True
    assert policy.is_ip_allowed("10.1.2.3") is True
    assert policy.is_ip_allowed("198.51.100.2") is False


def test_get_client_ip_prefers_forwarded_for():
    request = _request(headers={"X-Forwarded-For": "198.51.100.9, 10.0.0.4"}, client_host="127.0.0.1")
    assert get_client_ip(request) == "198.51.100.9"


def test_get_client_ip_falls_back_to_socket():
    request = _request(headers={}, client_host="192.0.2.3")
    assert get_client_ip(request) == "192.0.2.3"
