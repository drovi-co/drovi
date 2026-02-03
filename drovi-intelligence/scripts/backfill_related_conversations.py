import asyncio
import os
import re
from datetime import datetime, timedelta
from uuid import uuid4

import asyncpg


def _normalize_title(title: str | None) -> str:
    if not title:
        return ""
    cleaned = title.strip().lower()
    cleaned = re.sub(r"^(re:|fw:|fwd:)\s*", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"[^\w\s\-]", "", cleaned)
    return cleaned


def _normalize_dsn(dsn: str) -> str:
    if dsn.startswith("postgresql+asyncpg://"):
        return dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    return dsn


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL is not set")
    dsn = _normalize_dsn(dsn)
    org_id = os.environ.get("ORG_ID")
    lookback_days = int(os.environ.get("LOOKBACK_DAYS", "30"))

    conn = await asyncpg.connect(dsn)
    try:
        params = [datetime.utcnow() - timedelta(days=lookback_days)]
        org_clause = ""
        if org_id:
            org_clause = "AND s.organization_id = $2"
            params.append(org_id)

        rows = await conn.fetch(
            f"""
            SELECT c.id, c.title, c.participant_ids, c.first_message_at, c.last_message_at
            FROM conversation c
            JOIN source_account s ON c.source_account_id = s.id
            WHERE c.last_message_at >= $1
            {org_clause}
            """,
            *params,
        )

        convs = [dict(r) for r in rows]
        title_map = {}
        for conv in convs:
            key = _normalize_title(conv.get("title"))
            if key:
                title_map.setdefault(key, []).append(conv)

        inserted = 0
        now = datetime.utcnow()

        async def _insert_pair(a_id, b_id, relation_type, confidence, reason):
            nonlocal inserted
            await conn.execute(
                """
                INSERT INTO related_conversation (
                    id, conversation_id, related_conversation_id,
                    relation_type, confidence, match_reason,
                    is_auto_detected, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, true, $7, $7
                )
                ON CONFLICT (conversation_id, related_conversation_id, relation_type)
                DO NOTHING
                """,
                str(uuid4()),
                a_id,
                b_id,
                relation_type,
                confidence,
                reason,
                now,
            )
            inserted += 1

        for key, group in title_map.items():
            if len(group) < 2:
                continue
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    await _insert_pair(group[i]["id"], group[j]["id"], "duplicate", 0.85, "normalized_title_match")
                    await _insert_pair(group[j]["id"], group[i]["id"], "duplicate", 0.85, "normalized_title_match")

        # Participant overlap heuristic
        participant_map = {}
        for conv in convs:
            for participant in conv.get("participant_ids") or []:
                participant_map.setdefault(participant, set()).add(conv["id"])

        for conv in convs:
            overlaps = set()
            for participant in conv.get("participant_ids") or []:
                overlaps |= participant_map.get(participant, set())
            overlaps.discard(conv["id"])
            for other_id in overlaps:
                await _insert_pair(conv["id"], other_id, "follow_up", 0.6, "participant_overlap")

        print(f"Inserted/attempted {inserted} related conversation links")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
