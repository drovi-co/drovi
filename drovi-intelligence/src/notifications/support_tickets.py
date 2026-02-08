"""Support ticket email templates (Resend-backed)."""

from __future__ import annotations

from dataclasses import dataclass

from src.config import get_settings


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str


def _portal_link(ticket_id: str) -> str | None:
    settings = get_settings()
    if not settings.support_portal_url:
        return None
    base = settings.support_portal_url.rstrip("/")
    return f"{base}/dashboard/settings?ticket={ticket_id}"


def render_ticket_created_email(*, ticket_id: str, title: str, locale: str | None) -> RenderedEmail:
    link = _portal_link(ticket_id)
    normalized = (locale or "en").lower()
    is_fr = normalized.startswith("fr")

    if is_fr:
        subject = f"[{ticket_id}] Ticket support recu"
        text_lines = [
            "Nous avons bien recu votre demande support.",
            "",
            f"Ticket: {ticket_id}",
            f"Sujet: {title}",
        ]
        if link:
            text_lines += ["", f"Ouvrir: {link}"]
        text_lines += ["", "Equipe Drovi Support"]
        html = f"""
        <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5;">
          <h2 style="margin:0 0 12px 0;">Ticket support recu</h2>
          <p style="margin:0 0 12px 0;">Nous avons bien recu votre demande. Nous revenons vers vous rapidement.</p>
          <div style="border:1px solid #e5e7eb; border-radius:12px; padding:12px; background:#fafafa;">
            <div><strong>Ticket</strong>: {ticket_id}</div>
            <div><strong>Sujet</strong>: {title}</div>
          </div>
          {f'<p style="margin:12px 0 0 0;"><a href="{link}">Ouvrir dans Drovi</a></p>' if link else ''}
          <p style="margin:16px 0 0 0; color:#6b7280; font-size:12px;">Equipe Drovi Support</p>
        </div>
        """.strip()
        return RenderedEmail(subject=subject, html=html, text="\n".join(text_lines))

    subject = f"[{ticket_id}] Support ticket received"
    text_lines = [
        "We received your support request.",
        "",
        f"Ticket: {ticket_id}",
        f"Subject: {title}",
    ]
    if link:
        text_lines += ["", f"Open: {link}"]
    text_lines += ["", "Drovi Support"]
    html = f"""
    <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5;">
      <h2 style="margin:0 0 12px 0;">Support ticket received</h2>
      <p style="margin:0 0 12px 0;">We received your request. We'll follow up shortly.</p>
      <div style="border:1px solid #e5e7eb; border-radius:12px; padding:12px; background:#fafafa;">
        <div><strong>Ticket</strong>: {ticket_id}</div>
        <div><strong>Subject</strong>: {title}</div>
      </div>
      {f'<p style="margin:12px 0 0 0;"><a href="{link}">Open in Drovi</a></p>' if link else ''}
      <p style="margin:16px 0 0 0; color:#6b7280; font-size:12px;">Drovi Support</p>
    </div>
    """.strip()
    return RenderedEmail(subject=subject, html=html, text="\n".join(text_lines))


def render_ticket_reply_email(
    *,
    ticket_id: str,
    title: str,
    message: str,
    locale: str | None,
    from_support: bool,
) -> RenderedEmail:
    link = _portal_link(ticket_id)
    normalized = (locale or "en").lower()
    is_fr = normalized.startswith("fr")

    if is_fr:
        subject = f"[{ticket_id}] Reponse support" if from_support else f"[{ticket_id}] Nouveau message"
        intro = "Nouveau message de l'equipe support:" if from_support else "Nouveau message du client:"
        text_lines = [
            intro,
            "",
            f"Ticket: {ticket_id}",
            f"Sujet: {title}",
            "",
            message.strip(),
        ]
        if link:
            text_lines += ["", f"Ouvrir: {link}"]
        html = f"""
        <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5;">
          <h2 style="margin:0 0 12px 0;">{intro}</h2>
          <div style="margin:0 0 12px 0; color:#111827;">
            <div><strong>Ticket</strong>: {ticket_id}</div>
            <div><strong>Sujet</strong>: {title}</div>
          </div>
          <div style="border:1px solid #e5e7eb; border-radius:12px; padding:12px; background:#ffffff; white-space: pre-wrap;">
            {message.strip()}
          </div>
          {f'<p style="margin:12px 0 0 0;"><a href="{link}">Ouvrir dans Drovi</a></p>' if link else ''}
        </div>
        """.strip()
        return RenderedEmail(subject=subject, html=html, text="\n".join(text_lines))

    subject = f"[{ticket_id}] Support reply" if from_support else f"[{ticket_id}] New customer message"
    intro = "New message from support:" if from_support else "New message from customer:"
    text_lines = [
        intro,
        "",
        f"Ticket: {ticket_id}",
        f"Subject: {title}",
        "",
        message.strip(),
    ]
    if link:
        text_lines += ["", f"Open: {link}"]
    html = f"""
    <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5;">
      <h2 style="margin:0 0 12px 0;">{intro}</h2>
      <div style="margin:0 0 12px 0; color:#111827;">
        <div><strong>Ticket</strong>: {ticket_id}</div>
        <div><strong>Subject</strong>: {title}</div>
      </div>
      <div style="border:1px solid #e5e7eb; border-radius:12px; padding:12px; background:#ffffff; white-space: pre-wrap;">
        {message.strip()}
      </div>
      {f'<p style="margin:12px 0 0 0;"><a href="{link}">Open in Drovi</a></p>' if link else ''}
    </div>
    """.strip()
    return RenderedEmail(subject=subject, html=html, text="\n".join(text_lines))

