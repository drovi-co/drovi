#!/usr/bin/env python3
"""
Garbage Intelligence Cleanup Script

One-time cleanup to remove garbage UIOs from the database.
Identifies and removes:
- Marketing CTAs
- Newsletter boilerplate
- Footer garbage (legal notices, addresses)
- Noreply/automated sender content
- Social actions (LinkedIn invitations, etc.)

Run with:
  python -m scripts.cleanup_garbage --dry-run      # Preview what will be deleted
  python -m scripts.cleanup_garbage --execute      # Actually delete
  python -m scripts.cleanup_garbage --stats        # Show current stats

IMPORTANT: Always run with --dry-run first to review what will be deleted.
"""

import asyncio
import argparse
import re
from collections import defaultdict

# =============================================================================
# GARBAGE PATTERNS
# =============================================================================

# Patterns that indicate garbage content in titles/descriptions
GARBAGE_TITLE_PATTERNS = [
    # Legal/footer
    r"(?i)unsubscribe",
    r"(?i)privacy\s*policy",
    r"(?i)all\s*rights\s*reserved",
    r"(?i)terms\s*of\s*service",
    r"(?i)terms\s*and\s*conditions",
    r"(?i)manage\s*preferences",
    r"(?i)email\s*preferences",
    r"(?i)update\s*profile",
    r"(?i)view\s*in\s*browser",
    r"(?i)click\s*here\s*to",
    r"(?i)if\s*you\s*received\s*this\s*in\s*error",

    # Social actions
    r"(?i)accept\s*(linkedin|invitation)",
    r"(?i)follow\s*us\s*on",
    r"(?i)connect\s*on\s*linkedin",
    r"(?i)join\s*our\s*newsletter",

    # Marketing CTAs
    r"(?i)we'll\s*send\s*you\s*tips",
    r"(?i)more\s*next\s*week",
    r"(?i)stay\s*tuned",
    r"(?i)don't\s*miss\s*out",
    r"(?i)limited\s*time",
    r"(?i)special\s*offer",
    r"(?i)exclusive\s*deal",

    # System/automated
    r"(?i)order\s*confirmation",
    r"(?i)your\s*order\s*has\s*shipped",
    r"(?i)password\s*reset",
    r"(?i)verify\s*your\s*email",
    r"(?i)confirm\s*your\s*account",
    r"(?i)security\s*alert",
    r"(?i)login\s*attempt",

    # Addresses
    r"\d+\s+\w+\s+(street|st|avenue|ave|road|rd|blvd|boulevard|way|lane|ln|drive|dr)",

    # Generic boilerplate
    r"(?i)sent\s*from\s*my\s*iphone",
    r"(?i)sent\s*from\s*my\s*android",
    r"(?i)^regards,?$",
    r"(?i)^best,?$",
    r"(?i)^thanks,?$",
    r"(?i)^thank\s*you,?$",

    # Contact garbage
    r"(?i)^noreply@",
    r"(?i)^no-reply@",
    r"(?i)^notifications?@",
    r"(?i)^mailer-daemon@",
]

# Patterns for garbage sources
GARBAGE_SOURCE_PATTERNS = [
    r"(?i)^no[-_]?reply@",
    r"(?i)^notifications?@",
    r"(?i)^bounce@",
    r"(?i)^mailer[-_]?daemon@",
    r"(?i)@github\.com$",
    r"(?i)@linkedin\.com$",
    r"(?i)@substack\.com$",
    r"(?i)@beehiiv\.com$",
    r"(?i)@mailchimp\.com$",
    r"(?i)@sendgrid\.net$",
    r"(?i)@sentry\.io$",
    r"(?i)@vercel\.com$",
    r"(?i)@circleci\.com$",
    r"(?i)@datadog\.com$",
    r"(?i)@pagerduty\.com$",
    r"(?i)@atlassian\.com$",
    r"(?i)@jira\.atlassian\.com$",
]

# Very short claims that are likely garbage
MIN_CLAIM_LENGTH = 20

# Very short commitments that are likely garbage
MIN_COMMITMENT_LENGTH = 15


async def get_garbage_stats(session) -> dict:
    """Get statistics about garbage in the database."""
    from sqlalchemy import text

    stats = {
        "total_uios": 0,
        "by_type": {},
        "garbage_by_pattern": defaultdict(int),
        "garbage_by_source": defaultdict(int),
        "short_claims": 0,
        "short_commitments": 0,
    }

    # Total UIOs by type
    result = await session.execute(text("""
        SELECT type, COUNT(*) as count
        FROM unified_intelligence_object
        GROUP BY type
    """))
    for row in result:
        stats["by_type"][row[0]] = row[1]
        stats["total_uios"] += row[1]

    # Short claims
    result = await session.execute(text(f"""
        SELECT COUNT(*) FROM unified_intelligence_object
        WHERE type = 'claim' AND LENGTH(canonical_title) < {MIN_CLAIM_LENGTH}
    """))
    stats["short_claims"] = result.scalar() or 0

    # Short commitments
    result = await session.execute(text(f"""
        SELECT COUNT(*) FROM unified_intelligence_object
        WHERE type = 'commitment' AND LENGTH(canonical_title) < {MIN_COMMITMENT_LENGTH}
    """))
    stats["short_commitments"] = result.scalar() or 0

    return stats


async def identify_garbage_uios(session) -> dict[str, list]:
    """
    Find UIOs matching garbage patterns.

    Returns dict with:
        - 'by_title': UIOs with garbage title patterns
        - 'by_source': UIOs from garbage sources
        - 'short_claims': Claims that are too short
        - 'short_commitments': Commitments that are too short
    """
    from sqlalchemy import text

    garbage = {
        "by_title": [],
        "by_source": [],
        "short_claims": [],
        "short_commitments": [],
    }

    # Get all UIOs with their sources
    result = await session.execute(text("""
        SELECT
            u.id,
            u.type,
            u.canonical_title,
            u.created_at,
            COALESCE(s.source_identifier, '') as source_identifier
        FROM unified_intelligence_object u
        LEFT JOIN unified_object_source s ON s.unified_object_id = u.id
    """))

    for row in result:
        uio_id = str(row[0])
        uio_type = row[1]
        title = row[2] or ""
        source = row[4] or ""

        uio_info = {
            "id": uio_id,
            "type": uio_type,
            "title": title[:100],
            "source": source,
        }

        # Check title patterns
        for pattern in GARBAGE_TITLE_PATTERNS:
            if re.search(pattern, title):
                uio_info["matched_pattern"] = pattern
                garbage["by_title"].append(uio_info)
                break

        # Check source patterns
        for pattern in GARBAGE_SOURCE_PATTERNS:
            if re.search(pattern, source):
                uio_info["matched_pattern"] = pattern
                garbage["by_source"].append(uio_info)
                break

        # Check short claims
        if uio_type == "claim" and len(title) < MIN_CLAIM_LENGTH:
            garbage["short_claims"].append(uio_info)

        # Check short commitments
        if uio_type == "commitment" and len(title) < MIN_COMMITMENT_LENGTH:
            garbage["short_commitments"].append(uio_info)

    return garbage


async def delete_garbage_uios(session, garbage_ids: list[str], dry_run: bool = True) -> int:
    """Delete garbage UIOs from database."""
    from sqlalchemy import text

    if not garbage_ids:
        return 0

    if dry_run:
        print(f"DRY RUN: Would delete {len(garbage_ids)} UIOs")
        return len(garbage_ids)

    # Delete related records first (foreign key constraints)
    await session.execute(text("""
        DELETE FROM unified_object_source
        WHERE unified_object_id = ANY(:ids::uuid[])
    """), {"ids": garbage_ids})

    await session.execute(text("""
        DELETE FROM uio_evidence
        WHERE uio_id = ANY(:ids::uuid[])
    """), {"ids": garbage_ids})

    # Delete the UIOs
    result = await session.execute(text("""
        DELETE FROM unified_intelligence_object
        WHERE id = ANY(:ids::uuid[])
    """), {"ids": garbage_ids})

    await session.commit()
    return result.rowcount


def print_stats(stats: dict):
    """Print database statistics."""
    print("\n" + "=" * 60)
    print("DATABASE STATISTICS")
    print("=" * 60)

    print(f"\nTotal UIOs: {stats['total_uios']}")
    print("\nBy Type:")
    for uio_type, count in sorted(stats["by_type"].items()):
        print(f"  {uio_type}: {count}")

    print(f"\nShort claims (< {MIN_CLAIM_LENGTH} chars): {stats['short_claims']}")
    print(f"Short commitments (< {MIN_COMMITMENT_LENGTH} chars): {stats['short_commitments']}")


def print_garbage_summary(garbage: dict):
    """Print summary of identified garbage."""
    print("\n" + "=" * 60)
    print("GARBAGE IDENTIFIED")
    print("=" * 60)

    total = 0
    for category, items in garbage.items():
        count = len(items)
        total += count
        print(f"\n{category}: {count} items")

        # Show sample
        for item in items[:5]:
            print(f"  - [{item['type']}] {item['title'][:60]}...")
            if item.get("matched_pattern"):
                print(f"    Pattern: {item['matched_pattern']}")

        if count > 5:
            print(f"  ... and {count - 5} more")

    print(f"\nTOTAL GARBAGE: {total} items")
    return total


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Cleanup garbage UIOs from database")
    parser.add_argument("--dry-run", action="store_true", help="Preview what will be deleted (default)")
    parser.add_argument("--execute", action="store_true", help="Actually delete garbage UIOs")
    parser.add_argument("--stats", action="store_true", help="Show current database stats")
    parser.add_argument("--limit", type=int, default=0, help="Limit deletion to N items")

    args = parser.parse_args()

    # Default to dry-run if neither --execute nor --stats specified
    if not args.execute and not args.stats:
        args.dry_run = True

    try:
        from src.db import get_db_session
    except ImportError:
        print("ERROR: Could not import database module.")
        print("Run this script from the drovi-intelligence directory:")
        print("  cd /path/to/drovi-intelligence")
        print("  python -m scripts.cleanup_garbage --dry-run")
        return

    async with get_db_session() as session:
        # Always show stats first
        stats = await get_garbage_stats(session)
        print_stats(stats)

        if args.stats:
            return

        # Identify garbage
        print("\nIdentifying garbage UIOs...")
        garbage = await identify_garbage_uios(session)
        total = print_garbage_summary(garbage)

        if total == 0:
            print("\nNo garbage found!")
            return

        # Collect all garbage IDs
        all_garbage_ids = set()
        for category, items in garbage.items():
            for item in items:
                all_garbage_ids.add(item["id"])

        garbage_list = list(all_garbage_ids)

        if args.limit > 0:
            garbage_list = garbage_list[:args.limit]
            print(f"\nLimiting to {args.limit} items")

        if args.dry_run:
            print(f"\n{'=' * 60}")
            print("DRY RUN MODE")
            print(f"{'=' * 60}")
            print(f"Would delete {len(garbage_list)} unique UIOs")
            print("\nTo actually delete, run:")
            print("  python -m scripts.cleanup_garbage --execute")
            return

        if args.execute:
            print(f"\n{'=' * 60}")
            print("EXECUTING DELETION")
            print(f"{'=' * 60}")

            confirm = input(f"\nAre you sure you want to delete {len(garbage_list)} UIOs? [y/N]: ")
            if confirm.lower() != "y":
                print("Aborted.")
                return

            deleted = await delete_garbage_uios(session, garbage_list, dry_run=False)
            print(f"\nDeleted {deleted} UIOs")

            # Show updated stats
            print("\nUpdated stats:")
            new_stats = await get_garbage_stats(session)
            print_stats(new_stats)


if __name__ == "__main__":
    asyncio.run(main())
