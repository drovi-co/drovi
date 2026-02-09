"""Organization invitation email templates (Resend-backed)."""

from __future__ import annotations

from dataclasses import dataclass

from src.config import get_settings


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str


def _invite_link(invite_token: str) -> str | None:
    settings = get_settings()
    if not settings.web_app_url:
        return None
    base = settings.web_app_url.rstrip("/")
    # /login defaults to sign-in, so we provide a hint for the UI to open sign-up directly.
    return f"{base}/login?invite={invite_token}&mode=sign-up"


def render_org_invite_email(
    *,
    invite_token: str,
    organization_name: str | None,
    locale: str | None,
) -> RenderedEmail:
    normalized = (locale or "en").lower()
    is_fr = normalized.startswith("fr")
    link = _invite_link(invite_token)

    org = organization_name.strip() if organization_name and organization_name.strip() else "Drovi"

    if is_fr:
        subject = f"Invitation a rejoindre {org}"
        text_lines = [
            "Vous avez ete invite a rejoindre une organisation sur Drovi.",
            "",
            f"Organisation: {org}",
        ]
        if link:
            text_lines += ["", f"Accepter l'invitation: {link}"]
        text_lines += ["", "Equipe Drovi"]

        html = f"""
        <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5;">
          <h2 style="margin:0 0 12px 0;">Invitation</h2>
          <p style="margin:0 0 12px 0;">Vous avez ete invite a rejoindre une organisation sur Drovi.</p>
          <div style="border:1px solid #e5e7eb; border-radius:12px; padding:12px; background:#fafafa;">
            <div><strong>Organisation</strong>: {org}</div>
          </div>
          {f"<p style=\"margin:12px 0 0 0;\"><a href=\"{link}\">Accepter l'invitation</a></p>" if link else ''}
          <p style="margin:16px 0 0 0; color:#6b7280; font-size:12px;">Equipe Drovi</p>
        </div>
        """.strip()

        return RenderedEmail(subject=subject, html=html, text="\n".join(text_lines))

    subject = f"Invitation to join {org}"
    text_lines = [
        "You have been invited to join an organization on Drovi.",
        "",
        f"Organization: {org}",
    ]
    if link:
        text_lines += ["", f"Accept invite: {link}"]
    text_lines += ["", "Drovi Team"]

    html = f"""
    <div style="font-family: ui-sans-serif, system-ui; line-height: 1.5;">
      <h2 style="margin:0 0 12px 0;">Invitation</h2>
      <p style="margin:0 0 12px 0;">You have been invited to join an organization on Drovi.</p>
      <div style="border:1px solid #e5e7eb; border-radius:12px; padding:12px; background:#fafafa;">
        <div><strong>Organization</strong>: {org}</div>
      </div>
      {f'<p style="margin:12px 0 0 0;"><a href="{link}">Accept invite</a></p>' if link else ''}
      <p style="margin:16px 0 0 0; color:#6b7280; font-size:12px;">Drovi Team</p>
    </div>
    """.strip()

    return RenderedEmail(subject=subject, html=html, text="\n".join(text_lines))
