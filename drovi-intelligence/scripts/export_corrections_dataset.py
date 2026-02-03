import asyncio
import json
import os
from datetime import datetime
from pathlib import Path

import asyncpg


def _normalize_dsn(dsn: str) -> str:
    if dsn.startswith("postgresql+asyncpg://"):
        return dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    return dsn


async def main() -> None:
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL is not set")

    dsn = _normalize_dsn(dsn)
    conn = await asyncpg.connect(dsn)
    try:
        rows = await conn.fetch(
            """
            SELECT u.id as uio_id, u.type, u.canonical_title, u.canonical_description,
                   t.previous_value, t.new_value, t.created_at
            FROM unified_object_timeline t
            JOIN unified_intelligence_object u ON u.id = t.unified_object_id
            WHERE t.event_type = 'corrected'
            ORDER BY t.created_at DESC
            """
        )
    finally:
        await conn.close()

    out_dir = Path("/Users/jeremyscatigna/project-memory/drovi-intelligence/training_data/datasets")
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    out_path = out_dir / f"corrections_{stamp}.jsonl"

    with out_path.open("w", encoding="utf-8") as f:
        for row in rows:
            record = {
                "uio_id": row["uio_id"],
                "uio_type": row["type"],
                "canonical_title": row["canonical_title"],
                "canonical_description": row["canonical_description"],
                "previous_value": row["previous_value"],
                "new_value": row["new_value"],
                "corrected_at": row["created_at"].isoformat() if row["created_at"] else None,
            }
            f.write(json.dumps(record) + "\n")

    print(f"Wrote {len(rows)} correction records to {out_path}")


if __name__ == "__main__":
    asyncio.run(main())
