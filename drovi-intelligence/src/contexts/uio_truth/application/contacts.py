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


async def resolve_contact_id(
    session,
    org_id: str,
    *,
    email: str | None = None,
    name: str | None = None,
) -> str | None:
    """Resolve contact by email first, then by an unambiguous display name."""
    contact_id = await resolve_contact_id_by_email(session, org_id, email)
    if contact_id:
        return contact_id

    display_name = (name or "").strip()
    if not display_name:
        return None

    exact_result = await session.execute(
        text(
            """
            SELECT id
            FROM contact
            WHERE organization_id = :org_id
              AND display_name IS NOT NULL
              AND lower(display_name) = lower(:display_name)
            LIMIT 1
            """
        ),
        {"org_id": org_id, "display_name": display_name},
    )
    exact_row = exact_result.fetchone()
    if exact_row:
        return exact_row[0]

    # For short first-name hints ("Jules"), only accept if unique.
    if " " not in display_name:
        prefix_result = await session.execute(
            text(
                """
                SELECT id
                FROM contact
                WHERE organization_id = :org_id
                  AND display_name IS NOT NULL
                  AND lower(display_name) LIKE lower(:prefix)
                LIMIT 2
                """
            ),
            {"org_id": org_id, "prefix": f"{display_name}%"},
        )
        rows = prefix_result.fetchall()
        if len(rows) == 1:
            return rows[0][0]

    return None
