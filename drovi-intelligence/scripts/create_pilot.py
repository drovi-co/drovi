#!/usr/bin/env python3
"""
Create Pilot Organization

CLI script to provision a new pilot organization.

Usage:
    python scripts/create_pilot.py --id org_acme_001 --name "Acme Corp" --domains acme.com --region us-west

This is NOT a self-service tool. Run by Drovi team only.
"""

import argparse
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.db.client import init_db, close_db
from src.auth.pilot_accounts import (
    create_organization,
    get_org_by_id,
    create_invite,
    update_membership_role,
)


async def main():
    parser = argparse.ArgumentParser(
        description="Create a pilot organization",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Create pilot for Acme Corp
    python scripts/create_pilot.py \\
        --id org_acme_001 \\
        --name "Acme Corp" \\
        --domains acme.com,acme.io \\
        --region us-west \\
        --expires 2025-03-31

    # Generate invite token
    python scripts/create_pilot.py \\
        --id org_acme_001 \\
        --invite --role pilot_admin

    # Promote user to admin
    python scripts/create_pilot.py \\
        --id org_acme_001 \\
        --promote user_abc123
        """,
    )

    parser.add_argument(
        "--id",
        required=True,
        help="Organization ID (e.g., org_acme_001)",
    )
    parser.add_argument(
        "--name",
        help="Organization display name",
    )
    parser.add_argument(
        "--domains",
        help="Comma-separated list of allowed email domains",
    )
    parser.add_argument(
        "--notify",
        help="Comma-separated list of notification emails for briefs/reports",
    )
    parser.add_argument(
        "--region",
        default="us-west",
        choices=["us-west", "us-east", "eu-west", "ap-southeast"],
        help="Deployment region (default: us-west)",
    )
    parser.add_argument(
        "--expires",
        help="Expiration date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--invite",
        action="store_true",
        help="Generate an invite token instead of creating org",
    )
    parser.add_argument(
        "--role",
        default="pilot_member",
        choices=["pilot_admin", "pilot_member"],
        help="Role for invite token (default: pilot_member)",
    )
    parser.add_argument(
        "--promote",
        metavar="USER_ID",
        help="Promote a user to pilot_admin",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check if organization exists",
    )

    args = parser.parse_args()

    # Initialize database
    await init_db()

    try:
        if args.check:
            # Check org exists
            org = await get_org_by_id(args.id)
            if org:
                print(f"Organization found:")
                print(f"  ID: {org['id']}")
                print(f"  Name: {org['name']}")
                print(f"  Status: {org['pilot_status']}")
                print(f"  Region: {org['region']}")
                print(f"  Domains: {', '.join(org['allowed_domains'])}")
                print(
                    f\"  Notification Emails: {', '.join(org.get('notification_emails', [])) or 'None'}\"
                )
                print(f"  Expires: {org['expires_at'] or 'Never'}")
            else:
                print(f"Organization '{args.id}' not found")
                sys.exit(1)

        elif args.invite:
            # Generate invite token
            token = await create_invite(
                org_id=args.id,
                role=args.role,
                expires_in_days=7,
            )
            print(f"Invite token created:")
            print(f"  Token: {token}")
            print(f"  Role: {args.role}")
            print(f"  Expires in: 7 days")
            print()
            print(f"Share this link with the user:")
            print(f"  https://pilot.drovi.ai/invite/{token}")

        elif args.promote:
            # Promote user to admin
            success = await update_membership_role(
                user_id=args.promote,
                org_id=args.id,
                role="pilot_admin",
            )
            if success:
                print(f"User '{args.promote}' promoted to pilot_admin in '{args.id}'")
            else:
                print(f"Failed to promote user. Check that the user and org exist.")
                sys.exit(1)

        else:
            # Create organization
            if not args.name:
                print("Error: --name is required when creating an organization")
                sys.exit(1)
            if not args.domains:
                print("Error: --domains is required when creating an organization")
                sys.exit(1)

            # Check if org already exists
            existing = await get_org_by_id(args.id)
            if existing:
                print(f"Error: Organization '{args.id}' already exists")
                sys.exit(1)

            # Parse domains
            domains = [d.strip().lower() for d in args.domains.split(",")]
            notify_emails = []
            if args.notify:
                notify_emails = [e.strip() for e in args.notify.split(",") if e.strip()]

            # Parse expiration
            expires_at = None
            if args.expires:
                expires_at = datetime.strptime(args.expires, "%Y-%m-%d").replace(
                    tzinfo=timezone.utc
                )

            # Create org
            org = await create_organization(
                org_id=args.id,
                name=args.name,
                allowed_domains=domains,
                notification_emails=notify_emails,
                region=args.region,
                expires_at=expires_at,
            )

            print(f"Pilot organization created:")
            print(f"  ID: {org['id']}")
            print(f"  Name: {org['name']}")
            print(f"  Region: {org['region']}")
            print(f"  Domains: {', '.join(org['allowed_domains'])}")
            print(
                f\"  Notification Emails: {', '.join(org.get('notification_emails', [])) or 'None'}\"
            )
            print(f"  Expires: {org['expires_at'] or 'Never'}")
            print()
            print(f"Users from these domains can now sign in:")
            for domain in domains:
                print(f"  - *@{domain}")

    finally:
        await close_db()


if __name__ == "__main__":
    asyncio.run(main())
