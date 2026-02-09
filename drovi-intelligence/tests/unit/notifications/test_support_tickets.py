from types import SimpleNamespace

import pytest

from src.notifications.support_tickets import (
    render_ticket_created_email,
    render_ticket_reply_email,
)


pytestmark = [pytest.mark.unit]


def test_render_ticket_created_email_en_includes_portal_link(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.notifications.support_tickets.get_settings",
        lambda: SimpleNamespace(support_portal_url="http://localhost:3001"),
    )

    rendered = render_ticket_created_email(
        ticket_id="tkt_123",
        title="Login issue",
        locale="en",
    )

    assert rendered.subject == "[tkt_123] Support ticket received"
    assert "Open:" in rendered.text
    assert "Open in Drovi" in rendered.html


def test_render_ticket_created_email_fr_is_localized(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.notifications.support_tickets.get_settings",
        lambda: SimpleNamespace(support_portal_url="http://localhost:3001"),
    )

    rendered = render_ticket_created_email(
        ticket_id="tkt_123",
        title="Probleme de connexion",
        locale="fr",
    )

    assert "Ticket support" in rendered.subject
    assert "Equipe Drovi Support" in rendered.text
    assert "Ouvrir dans Drovi" in rendered.html


def test_render_ticket_reply_email_en_support_vs_customer(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.notifications.support_tickets.get_settings",
        lambda: SimpleNamespace(support_portal_url=None),
    )

    support = render_ticket_reply_email(
        ticket_id="tkt_123",
        title="Login issue",
        message="We are investigating.",
        locale="en",
        from_support=True,
    )
    customer = render_ticket_reply_email(
        ticket_id="tkt_123",
        title="Login issue",
        message="Any update?",
        locale="en",
        from_support=False,
    )

    assert support.subject == "[tkt_123] Support reply"
    assert customer.subject == "[tkt_123] New customer message"

