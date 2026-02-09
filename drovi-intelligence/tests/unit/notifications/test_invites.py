from types import SimpleNamespace

import pytest

from src.notifications.invites import render_org_invite_email


def test_render_org_invite_email_en_includes_link_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.notifications.invites.get_settings",
        lambda: SimpleNamespace(web_app_url="http://localhost:3001"),
    )

    rendered = render_org_invite_email(
        invite_token="inv_test_123",
        organization_name="Acme",
        locale="en",
    )

    assert "Invitation to join" in rendered.subject
    assert "http://localhost:3001/login?invite=inv_test_123&mode=sign-up" in rendered.text
    assert "Accept invite" in rendered.html


def test_render_org_invite_email_fr_has_clean_apostrophe(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.notifications.invites.get_settings",
        lambda: SimpleNamespace(web_app_url="http://localhost:3001"),
    )

    rendered = render_org_invite_email(
        invite_token="inv_test_123",
        organization_name="Acme",
        locale="fr",
    )

    assert "Invitation" in rendered.subject
    # Ensure we did not accidentally include a backslash in the link text.
    assert "Accepter l'invitation" in rendered.html


def test_render_org_invite_email_omits_link_when_web_app_url_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.notifications.invites.get_settings",
        lambda: SimpleNamespace(web_app_url=None),
    )

    rendered = render_org_invite_email(
        invite_token="inv_test_123",
        organization_name="Acme",
        locale="en",
    )

    assert "Accept invite:" not in rendered.text
    assert "Accept invite" not in rendered.html

