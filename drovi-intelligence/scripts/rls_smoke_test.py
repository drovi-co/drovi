import asyncio
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import text

from src.db.client import get_db_session
from src.db.rls import rls_context


async def _insert_event(session, org_id: str, content: str) -> str:
    event_id = str(uuid4())
    await session.execute(
        text(
            """
            INSERT INTO unified_event (
                id, organization_id, source_type, event_type,
                content_text, participants, metadata, received_at
            ) VALUES (
                :id, :org_id, 'api', 'message', :content, '[]'::jsonb, '{}'::jsonb, :received_at
            )
            """
        ),
        {
            "id": event_id,
            "org_id": org_id,
            "content": content,
            "received_at": datetime.now(timezone.utc),
        },
    )
    return event_id


async def _count_events(session, org_id: str | None = None) -> int:
    if org_id:
        result = await session.execute(
            text("SELECT COUNT(*) FROM unified_event WHERE organization_id = :org_id"),
            {"org_id": org_id},
        )
    else:
        result = await session.execute(text("SELECT COUNT(*) FROM unified_event"))
    return int(result.scalar() or 0)


async def main() -> int:
    org_a = f"rls-org-a-{uuid4()}"
    org_b = f"rls-org-b-{uuid4()}"
    event_a = None
    event_b = None

    try:
        with rls_context(None, True):
            async with get_db_session() as session:
                event_a = await _insert_event(session, org_a, "rls test a")
                event_b = await _insert_event(session, org_b, "rls test b")

        with rls_context(org_a, False):
            async with get_db_session() as session:
                count_total = await _count_events(session)
                count_other = await _count_events(session, org_b)
                if count_other != 0:
                    print("RLS FAIL: org_a can see org_b data")
                    return 1
                if count_total < 1:
                    print("RLS FAIL: org_a sees no data")
                    return 1

        with rls_context(org_b, False):
            async with get_db_session() as session:
                count_total = await _count_events(session)
                count_other = await _count_events(session, org_a)
                if count_other != 0:
                    print("RLS FAIL: org_b can see org_a data")
                    return 1
                if count_total < 1:
                    print("RLS FAIL: org_b sees no data")
                    return 1

        print("RLS OK: tenant isolation verified on unified_event")
        return 0
    finally:
        if event_a or event_b:
            with rls_context(None, True):
                async with get_db_session() as session:
                    await session.execute(
                        text("DELETE FROM unified_event WHERE id = ANY(:ids)"),
                        {"ids": [i for i in [event_a, event_b] if i]},
                    )


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
