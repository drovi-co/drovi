"""Resolve speaker labels to contact IDs."""

from __future__ import annotations

import re

from sqlalchemy import text

from src.db.client import get_db_session


_EMAIL_RE = re.compile(r"[\w\.-]+@[\w\.-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"\+?\d[\d\s\-()]{7,}\d")


def _normalize_phone(phone: str) -> str:
    return "".join(ch for ch in phone if ch.isdigit())


async def resolve_speaker_contact_id(
    organization_id: str,
    speaker_label: str,
) -> str | None:
    if not speaker_label:
        return None

    email_match = _EMAIL_RE.search(speaker_label)
    phone_match = _PHONE_RE.search(speaker_label)

    async with get_db_session() as session:
        if email_match:
            result = await session.execute(
                text(
                    """
                    SELECT id FROM contact
                    WHERE organization_id = :org_id
                      AND lower(primary_email) = :email
                    LIMIT 1
                    """
                ),
                {"org_id": organization_id, "email": email_match.group().lower()},
            )
            row = result.fetchone()
            if row:
                return row.id

        if phone_match:
            phone = _normalize_phone(phone_match.group())
            result = await session.execute(
                text(
                    """
                    SELECT id FROM contact
                    WHERE organization_id = :org_id
                      AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = :phone
                    LIMIT 1
                    """
                ),
                {"org_id": organization_id, "phone": phone},
            )
            row = result.fetchone()
            if row:
                return row.id

    return None
