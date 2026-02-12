"""Contact persistence (truth spine helper).

Contacts are part of the org identity graph. Here we upsert them into Postgres.
Graph nodes/relationships are handled separately.
"""

from __future__ import annotations

from typing import Any

import structlog
from sqlalchemy import text

from src.contexts.uio_truth.application.persist_envelope import PersistEnvelope
from src.contexts.uio_truth.application.persist_results import PersistResults
from src.kernel.time import utc_now_naive as utc_now

logger = structlog.get_logger()


async def persist_contacts(
    *,
    envelope: PersistEnvelope,
    contacts: list[Any],
    results: PersistResults,
) -> None:
    from src.db.client import get_db_session

    if not contacts:
        return

    async with get_db_session() as session:
        for contact in contacts:
            contact_id = getattr(contact, "id", None)
            email = getattr(contact, "email", None)
            if not contact_id or not email:
                continue

            now = utc_now()
            await session.execute(
                text(
                    """
                    INSERT INTO contact (
                        id, organization_id, primary_email, display_name,
                        created_at, updated_at
                    ) VALUES (
                        :id, :org_id, :email, :name,
                        :now, :now
                    )
                    ON CONFLICT (organization_id, primary_email)
                    DO UPDATE SET
                        display_name = COALESCE(EXCLUDED.display_name, contact.display_name),
                        updated_at = :now
                    """
                ),
                {
                    "id": contact_id,
                    "org_id": envelope.organization_id,
                    "email": email,
                    "name": getattr(contact, "name", None),
                    "now": now,
                },
            )
            results.contacts_created.append({"id": contact_id, "email": email})

        await session.commit()

