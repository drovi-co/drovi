import pytest

from src.auth.context import AuthContext, AuthMetadata, AuthType
from src.contexts.auth.application.policies import require_admin, require_internal, require_org_access
from src.kernel.errors import ForbiddenError


pytestmark = pytest.mark.unit


def _ctx(
    *,
    org_id: str = "org_1",
    scopes: list[str] | None = None,
    is_internal: bool = False,
) -> AuthContext:
    return AuthContext(
        organization_id=org_id,
        auth_subject_id="test_subject",
        scopes=scopes or ["read"],
        metadata=AuthMetadata(
            auth_type=AuthType.INTERNAL_SERVICE if is_internal else AuthType.API_KEY,
            key_id="key_test",
        ),
        is_internal=is_internal,
    )


def test_require_org_access_allows_internal():
    require_org_access(_ctx(org_id="internal", is_internal=True), "org_other")


def test_require_org_access_allows_match():
    require_org_access(_ctx(org_id="org_1"), "org_1")


def test_require_org_access_denies_mismatch():
    with pytest.raises(ForbiddenError):
        require_org_access(_ctx(org_id="org_1"), "org_2")


def test_require_admin_allows_internal():
    require_admin(_ctx(org_id="internal", is_internal=True))


def test_require_admin_allows_admin_scope():
    require_admin(_ctx(scopes=["admin"]))


def test_require_admin_denies_non_admin():
    with pytest.raises(ForbiddenError):
        require_admin(_ctx(scopes=["read"]))


def test_require_internal_allows_internal():
    require_internal(_ctx(org_id="internal", is_internal=True))


def test_require_internal_denies_non_internal():
    with pytest.raises(ForbiddenError):
        require_internal(_ctx(is_internal=False))

