"""UIO-truth-side contact lookups.

This is intentionally small and SQL-based for now. In a later phase, we can
promote contacts into an Org/Identity context with explicit ports/adapters.
"""

from __future__ import annotations

from sqlalchemy import text


async def resolve_contact_id_by_email(session, org_id: str, email: str | None) -> str | None:
    """Look up a contact id by email within an organization."""
    if not email:
        return None

    result = await session.execute(
        text(
            """
            SELECT id FROM contact
            WHERE organization_id = :org_id AND primary_email = :email
            LIMIT 1
            """
        ),
        {"org_id": org_id, "email": email.lower()},
    )
    row = result.fetchone()
    return row[0] if row else None

