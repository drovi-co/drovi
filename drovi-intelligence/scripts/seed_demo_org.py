#!/usr/bin/env python3
"""
Seed a single organization with extensive, realistic-looking demo data.

This is meant for Loom demos and product walkthroughs. It seeds:
- Users + memberships (non-login synthetic members)
- Contacts (internal + external) in Postgres and FalkorDB
- Communication graph edges + persisted analytics (pagerank/betweenness/communities)
- Unified events (email/slack/meeting/document) for evidence-backed citations
- UIOs (commitments/decisions/tasks/risks/claims/briefs) via UIOManager
- Contradictions + timelines + entity_versions (reality stream)
- Smart Drive documents stored in MinIO/S3 + parsed chunks (optionally)
- Continuums + exchange bundles + runs/alerts
- Simulations + actuations
- Support tickets

The dataset is synthetic (no real PII) but "feels real" and is Drovi-themed.

Idempotency: uses deterministic IDs based on a seed tag. Re-running with the
same args will upsert most records and skip existing UIO ids.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import random
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4, uuid5, NAMESPACE_DNS

import structlog
from sqlalchemy import text

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.db.client import init_db, close_db, get_db_session  # noqa: E402
from src.db.rls import rls_context  # noqa: E402
from src.graph.client import get_graph_client, get_analytics_engine  # noqa: E402
from src.graph.changes.version import VersionManager  # noqa: E402
from src.ingestion.unified_event import (  # noqa: E402
    build_content_hash,
    build_segment_hash,
    build_source_fingerprint,
)
from src.uio.manager import UIOManager  # noqa: E402
from src.uio.schemas import (  # noqa: E402
    BriefAction,
    BriefDetailsCreate,
    BriefPriority,
    ClaimDetailsCreate,
    ClaimImportance,
    ClaimType,
    CommitmentDetailsCreate,
    CommitmentDirection,
    CommitmentPriority,
    CommitmentStatus,
    CreateBriefUIO,
    CreateClaimUIO,
    CreateCommitmentUIO,
    CreateDecisionUIO,
    CreateRiskUIO,
    CreateTaskUIO,
    DecisionDetailsCreate,
    DecisionStatus,
    RiskDetailsCreate,
    RiskSeverity,
    RiskType,
    SourceContext,
    TaskDetailsCreate,
    TaskPriority,
    TaskStatus,
    UIOBeliefState,
    UIOCreate,
    UIOStatus,
    UIOTruthState,
    UIOType,
)

logger = structlog.get_logger()


def _utcnow() -> datetime:
    return datetime.utcnow()


def _stable_id(prefix: str, *parts: str) -> str:
    raw = "||".join([prefix, *parts]).encode("utf-8", errors="ignore")
    digest = hashlib.sha1(raw).hexdigest()[:16]  # stable + short
    return f"{prefix}_{digest}"


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _pick(rng: random.Random, seq: list[str]) -> str:
    return seq[rng.randrange(0, len(seq))]


def _clamp(v: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, v))


def _find_quote_span(content: str, quote: str) -> tuple[int | None, int | None]:
    if not content or not quote:
        return None, None
    idx = content.find(quote)
    if idx < 0:
        return None, None
    return idx, idx + len(quote)


@dataclass(frozen=True)
class DemoIdentity:
    user_id: str
    org_id: str
    seed_tag: str


async def _fetch_user_and_org(*, owner_email: str, org_id: str) -> DemoIdentity:
    async with get_db_session() as session:
        user = (
            await session.execute(
                text("SELECT id, email FROM users WHERE email = :email"),
                {"email": owner_email},
            )
        ).fetchone()
        if not user:
            raise RuntimeError(f"User not found: {owner_email}")

        org = (
            await session.execute(
                text("SELECT id, name FROM organizations WHERE id = :id"),
                {"id": org_id},
            )
        ).fetchone()
        if not org:
            raise RuntimeError(f"Organization not found: {org_id}")

        return DemoIdentity(
            user_id=str(getattr(user, "id")),
            org_id=str(getattr(org, "id")),
            seed_tag=f"demo::{org_id}::{owner_email}",
        )


async def _upsert_user(*, user_id: str, email: str, name: str | None, locale: str = "en") -> None:
    now = _utcnow()
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO users (id, email, name, locale, created_at)
                VALUES (:id, :email, :name, :locale, :created_at)
                ON CONFLICT (email)
                DO UPDATE SET
                    name = COALESCE(EXCLUDED.name, users.name),
                    locale = COALESCE(EXCLUDED.locale, users.locale)
                """
            ),
            {
                "id": user_id,
                "email": email,
                "name": name,
                "locale": locale,
                "created_at": now,
            },
        )


async def _upsert_membership(*, user_id: str, org_id: str, role: str) -> None:
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO memberships (user_id, org_id, role)
                VALUES (:user_id, :org_id, :role)
                ON CONFLICT (user_id, org_id)
                DO UPDATE SET role = EXCLUDED.role
                """
            ),
            {"user_id": user_id, "org_id": org_id, "role": role},
        )


async def _upsert_contact(
    *,
    contact_id: str,
    org_id: str,
    email: str,
    display_name: str,
    first_name: str | None,
    last_name: str | None,
    company: str | None,
    title: str | None,
    department: str | None,
    is_internal: bool,
    tags: list[str] | None = None,
) -> None:
    now = _utcnow()
    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO contact (
                    id, organization_id, primary_email, emails,
                    display_name, first_name, last_name,
                    company, title, department,
                    is_internal, tags,
                    first_interaction_at, last_interaction_at,
                    created_at, updated_at
                ) VALUES (
                    :id, :org_id, :primary_email, :emails,
                    :display_name, :first_name, :last_name,
                    :company, :title, :department,
                    :is_internal, :tags,
                    :first_interaction_at, :last_interaction_at,
                    :created_at, :updated_at
                )
                ON CONFLICT (organization_id, primary_email)
                DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    first_name = COALESCE(EXCLUDED.first_name, contact.first_name),
                    last_name = COALESCE(EXCLUDED.last_name, contact.last_name),
                    company = COALESCE(EXCLUDED.company, contact.company),
                    title = COALESCE(EXCLUDED.title, contact.title),
                    department = COALESCE(EXCLUDED.department, contact.department),
                    is_internal = EXCLUDED.is_internal,
                    tags = EXCLUDED.tags,
                    last_interaction_at = EXCLUDED.last_interaction_at,
                    updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "id": contact_id,
                "org_id": org_id,
                "primary_email": email,
                "emails": [email],
                "display_name": display_name,
                "first_name": first_name,
                "last_name": last_name,
                "company": company,
                "title": title,
                "department": department,
                "is_internal": bool(is_internal),
                "tags": tags or [],
                "first_interaction_at": now - timedelta(days=120),
                "last_interaction_at": now - timedelta(days=random.randint(0, 14)),
                "created_at": now,
                "updated_at": now,
            },
        )


async def _graph_upsert_contact(
    *,
    graph,
    org_id: str,
    contact_id: str,
    email: str,
    display_name: str,
    company: str | None,
    title: str | None,
    role_type: str,
    is_internal: bool,
) -> None:
    now = _utcnow().isoformat()
    await graph.query(
        """
        MERGE (c:Contact {id: $id, organizationId: $org})
        ON CREATE SET c.createdAt = $now
        SET c.updatedAt = $now,
            c.email = $email,
            c.displayName = $display_name,
            c.name = $display_name,
            c.company = $company,
            c.title = $title,
            c.roleType = $role_type,
            c.isInternal = $is_internal
        """,
        {
            "id": contact_id,
            "org": org_id,
            "now": now,
            "email": email,
            "display_name": display_name,
            "company": company,
            "title": title,
            "role_type": role_type,
            "is_internal": bool(is_internal),
        },
    )


async def _graph_upsert_comm_edge(
    *,
    graph,
    org_id: str,
    a_id: str,
    b_id: str,
    count: int,
    weight: float,
    channel: str,
    last_at: datetime,
    sentiment_avg: float,
) -> None:
    await graph.query(
        """
        MATCH (a:Contact {id: $a, organizationId: $org})
        MATCH (b:Contact {id: $b, organizationId: $org})
        MERGE (a)-[r:COMMUNICATES_WITH]->(b)
        SET r.count = $count,
            r.weight = $weight,
            r.channel = $channel,
            r.lastAt = $last_at,
            r.sentimentAvg = $sentiment_avg,
            r.updatedAt = $updated_at
        """,
        {
            "a": a_id,
            "b": b_id,
            "org": org_id,
            "count": int(count),
            "weight": float(weight),
            "channel": channel,
            "last_at": last_at.isoformat(),
            "sentiment_avg": float(sentiment_avg),
            "updated_at": _utcnow().isoformat(),
        },
    )


async def _insert_unified_event(
    *,
    org_id: str,
    source_type: str,
    event_type: str,
    content_text: str,
    conversation_id: str,
    message_id: str,
    participants: list[dict[str, Any]],
    metadata: dict[str, Any] | None,
    captured_at: datetime,
) -> tuple[str, str]:
    fingerprint = build_source_fingerprint(source_type, conversation_id, message_id)
    content_hash = build_content_hash(content_text, fingerprint)
    event_id = f"uem_{content_hash[:24]}"

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO unified_event (
                    id, organization_id, source_type, source_id,
                    conversation_id, message_id, event_type,
                    content_text, content_json,
                    participants, metadata,
                    content_hash, captured_at, received_at
                ) VALUES (
                    :id, :org_id, :source_type, :source_id,
                    :conversation_id, :message_id, :event_type,
                    :content_text, NULL,
                    CAST(:participants AS jsonb), CAST(:metadata AS jsonb),
                    :content_hash, :captured_at, :received_at
                )
                ON CONFLICT (organization_id, content_hash)
                DO UPDATE SET
                    received_at = EXCLUDED.received_at
                """
            ),
            {
                "id": event_id,
                "org_id": org_id,
                "source_type": source_type,
                "source_id": conversation_id,
                "conversation_id": conversation_id,
                "message_id": message_id,
                "event_type": event_type,
                "content_text": content_text,
                # unified_event.participants and metadata are JSONB.
                "participants": json.dumps(participants or []),
                "metadata": json.dumps(metadata or {}),
                "content_hash": content_hash,
                "captured_at": captured_at,
                "received_at": _utcnow(),
            },
        )

    return event_id, content_hash


async def _uio_exists(*, uio_id: str) -> bool:
    async with get_db_session() as session:
        row = (
            await session.execute(
                text("SELECT 1 FROM unified_intelligence_object WHERE id = :id"),
                {"id": uio_id},
            )
        ).fetchone()
    return bool(row)


async def _seed_demo(
    *,
    org_id: str,
    owner_user_id: str,
    seed_tag: str,
    scale: str,
    process_documents: bool,
) -> None:
    rng = random.Random()
    rng.seed(seed_tag)

    # ---------------------------------------------------------------------
    # Scale knobs
    # ---------------------------------------------------------------------
    if scale == "huge":
        contact_count = 140
        uio_count = 260
        document_count = 35
        ticket_count = 18
    elif scale == "medium":
        contact_count = 80
        uio_count = 160
        document_count = 20
        ticket_count = 10
    else:
        contact_count = 45
        uio_count = 90
        document_count = 12
        ticket_count = 6

    # ---------------------------------------------------------------------
    # Users / memberships (synthetic members for Team page)
    # ---------------------------------------------------------------------
    synthetic_members = [
        ("maya@drovi.co", "Maya Laurent", "pilot_admin"),
        ("noah@drovi.co", "Noah Kim", "pilot_admin"),
        ("ines@drovi.co", "Ines Moreau", "pilot_member"),
        ("sam@drovi.co", "Sam Patel", "pilot_member"),
        ("luca@drovi.co", "Luca Rossi", "pilot_member"),
    ]

    for email, name, role in synthetic_members:
        uid = _stable_id("user", org_id, email)
        await _upsert_user(user_id=uid, email=email, name=name, locale="en")
        await _upsert_membership(user_id=uid, org_id=org_id, role=role)

    # Ensure owner is in membership (should already be, but make it stable).
    await _upsert_membership(user_id=owner_user_id, org_id=org_id, role="pilot_admin")

    # ---------------------------------------------------------------------
    # Contacts (internal + external)
    # ---------------------------------------------------------------------
    internal_contacts = [
        ("jeremy@drovi.co", "Jeremy Scatigna", "Drovi", "Founder & CEO", "Leadership", "decision_maker"),
        ("maya@drovi.co", "Maya Laurent", "Drovi", "Head of Product", "Product", "decision_maker"),
        ("noah@drovi.co", "Noah Kim", "Drovi", "Staff Engineer", "Engineering", "builder"),
        ("ines@drovi.co", "Ines Moreau", "Drovi", "Ops Lead", "Operations", "operator"),
        ("sam@drovi.co", "Sam Patel", "Drovi", "Solutions Engineer", "Solutions", "builder"),
        ("luca@drovi.co", "Luca Rossi", "Drovi", "Head of Growth", "Growth", "operator"),
    ]

    external_companies = [
        ("BuildRight Construction", "buildright.example", "Client"),
        ("Vertex Holdings", "vertex.example", "Client"),
        ("Cobalt & Finch LLP", "cobaltfinch.example", "Legal"),
        ("Ledgerline CPAs", "ledgerline.example", "Accounting"),
        ("Northshore Capital", "northshore.example", "Investor"),
        ("Praxis Ventures", "praxis.example", "Investor"),
        ("Atlas Insurance Group", "atlasins.example", "Client"),
        ("Sable Biotech", "sablebio.example", "Client"),
    ]

    first_names = [
        "Aisha", "Mateo", "Priya", "Elena", "Wei", "Omar", "Sofia", "Raj", "Ingrid", "Carlos",
        "Hana", "Jules", "Fatima", "Jin", "Lena", "Nikhil", "Amir", "Zoe", "Mina", "Theo",
    ]
    last_names = [
        "Chen", "Patel", "Kumar", "Singh", "Garcia", "Nguyen", "Yamamoto", "Mueller", "Johansson",
        "Costa", "Schmidt", "Petrov", "White", "Brown", "Anderson", "Taylor", "Kim", "Lopez",
    ]
    titles = [
        "Managing Partner", "Partner", "Senior Counsel", "General Counsel",
        "Tax Director", "Audit Partner", "Controller", "VP Finance",
        "VP Engineering", "Director of Operations", "Head of Compliance",
        "Procurement Lead", "Program Manager", "CISO", "Data Protection Officer",
    ]
    role_types = ["decision_maker", "stakeholder", "legal", "finance", "operator", "builder"]

    # Upsert internal contacts
    contact_map: dict[str, dict[str, Any]] = {}
    for email, name, company, title, dept, role_type in internal_contacts:
        first = name.split(" ")[0]
        last = name.split(" ")[-1]
        cid = _stable_id("ct", org_id, email)
        await _upsert_contact(
            contact_id=cid,
            org_id=org_id,
            email=email,
            display_name=name,
            first_name=first,
            last_name=last,
            company=company,
            title=title,
            department=dept,
            is_internal=True,
            tags=["team", "drovi"],
        )
        contact_map[email] = {
            "id": cid,
            "email": email,
            "name": name,
            "company": company,
            "title": title,
            "role_type": role_type,
            "is_internal": True,
        }

    # Generate external contacts
    while len(contact_map) < contact_count:
        company, domain, company_kind = _pick(rng, external_companies)
        first = _pick(rng, first_names)
        last = _pick(rng, last_names)
        name = f"{first} {last}"
        title = _pick(rng, titles)
        role_type = _pick(rng, role_types)
        email = f"{first.lower()}.{last.lower()}@{domain}"
        if email in contact_map:
            continue

        cid = _stable_id("ct", org_id, email)
        await _upsert_contact(
            contact_id=cid,
            org_id=org_id,
            email=email,
            display_name=name,
            first_name=first,
            last_name=last,
            company=company,
            title=title,
            department=company_kind,
            is_internal=False,
            tags=[company_kind.lower()],
        )
        contact_map[email] = {
            "id": cid,
            "email": email,
            "name": name,
            "company": company,
            "title": title,
            "role_type": role_type,
            "is_internal": False,
        }

    # ---------------------------------------------------------------------
    # Graph: upsert contacts + communication edges
    # ---------------------------------------------------------------------
    graph = await get_graph_client()

    for contact in contact_map.values():
        await _graph_upsert_contact(
            graph=graph,
            org_id=org_id,
            contact_id=contact["id"],
            email=contact["email"],
            display_name=contact["name"],
            company=contact.get("company"),
            title=contact.get("title"),
            role_type=contact.get("role_type") or "unknown",
            is_internal=bool(contact.get("is_internal")),
        )

    contact_ids = [c["id"] for c in contact_map.values()]
    # Build a dense-ish graph with a few hubs.
    hubs = rng.sample(contact_ids, k=_clamp(len(contact_ids) // 12, 3, 10))
    now = _utcnow()
    for a_id in contact_ids:
        for _ in range(rng.randint(2, 8)):
            # Bias towards hub nodes to make pagerank meaningful.
            b_id = rng.choice(hubs if rng.random() < 0.65 else contact_ids)
            if b_id == a_id:
                continue
            count = rng.randint(1, 55)
            weight = 1.0 + min(3.0, count / 20.0)
            channel = rng.choice(["email", "slack", "meeting"])
            last_at = now - timedelta(days=rng.randint(0, 30), hours=rng.randint(0, 18))
            sentiment_avg = rng.uniform(-0.1, 0.6)
            await _graph_upsert_comm_edge(
                graph=graph,
                org_id=org_id,
                a_id=a_id,
                b_id=b_id,
                count=count,
                weight=weight,
                channel=channel,
                last_at=last_at,
                sentiment_avg=sentiment_avg,
            )

    # Persist analytics so Ask templates have influence/bridge/community fields.
    analytics = await get_analytics_engine()
    pagerank = await analytics.compute_pagerank(org_id)
    betweenness = await analytics.compute_betweenness_centrality(org_id, sample_size=120)
    communities = await analytics.detect_communities(org_id)
    await analytics.persist_analytics(org_id, pagerank, betweenness, communities)

    # ---------------------------------------------------------------------
    # Unified events (evidence sources)
    # ---------------------------------------------------------------------
    themes = [
        (
            "fundraising",
            "email",
            "Seed round: narrative + pilots",
            [
                "We should frame Drovi as the truth-first memory layer: evidence, timelines, and drift detection.",
                "Pilot readiness: legal firm wants 'show me where we said that' and advice drift detection on every matter.",
                "Accounting firm wants document-first workflows: engagement letters, schedules, memos, and reconciliation trails.",
            ],
        ),
        (
            "product",
            "slack",
            "Product: Continuums and actuators",
            [
                "Continuum Exchange: publish bundles like 'Advice Drift Sentinel' and 'Risk-Weighted Matters'.",
                "Actuators should draft emails, open tickets, and schedule follow-ups with strict evidence gating.",
                "Command bar should become an Intent Bar: ask, act, and navigate with context from the whole org.",
            ],
        ),
        (
            "security",
            "meeting",
            "Security: SOC2 + data retention",
            [
                "Evidence artifacts must be immutable and chain-of-custody logged for high-stakes outputs.",
                "R2/MinIO storage should support legal hold and retention policies per client and matter.",
                "We need bi-temporal memory: what we believed then, and what is true now.",
            ],
        ),
        (
            "connectors",
            "email",
            "Connectors: backfill + live ingestion",
            [
                "Gmail backfill should complete in under 30 minutes for a 250-person firm via parallelism and idempotency.",
                "Every connector should have replay, dedupe by content_hash, and durable job history.",
                "Status in UI must reflect real backfill progress and next scheduled sync.",
            ],
        ),
    ]

    # Make ~20-35 events across 4 themes.
    all_events: list[dict[str, Any]] = []
    for theme_name, source_type, subject, lines in themes:
        thread_id = _stable_id("conv", org_id, theme_name)
        participants = rng.sample(list(contact_map.values()), k=6)
        captured_base = _utcnow() - timedelta(days=30)

        for i in range(rng.randint(5, 9)):
            sender = rng.choice(participants)
            body_lines = []
            body_lines.append(f"Subject: {subject}")
            body_lines.append("")
            body_lines.append(_pick(rng, lines))
            body_lines.append(_pick(rng, lines))
            body_lines.append("")
            body_lines.append("Next steps:")
            body_lines.append(f"- Action: {_pick(rng, ['ship the connector', 'draft the bundle', 'prepare the pilot deck', 'run the SOC2 gap assessment'])}")
            body_lines.append(f"- Owner: {sender['name']}")
            body_lines.append(f"- Due: {(captured_base + timedelta(days=rng.randint(2, 18))).strftime('%Y-%m-%d')}")
            content = "\n".join(body_lines)

            message_id = _stable_id("msg", thread_id, str(i))
            captured_at = captured_base + timedelta(days=i * 2, hours=rng.randint(0, 9))

            event_id, content_hash = await _insert_unified_event(
                org_id=org_id,
                source_type=source_type,
                event_type=f"{source_type}.message",
                content_text=content,
                conversation_id=thread_id,
                message_id=message_id,
                participants=[
                    {"email": p["email"], "name": p["name"], "role": "participant"}
                    for p in participants
                ],
                metadata={"subject": subject, "theme": theme_name, "seed_tag": seed_tag},
                captured_at=captured_at,
            )
            all_events.append(
                {
                    "theme": theme_name,
                    "source_type": source_type,
                    "subject": subject,
                    "conversation_id": thread_id,
                    "message_id": message_id,
                    "captured_at": captured_at,
                    "content": content,
                    "event_id": event_id,
                    "content_hash": content_hash,
                    "participants": participants,
                }
            )

    # ---------------------------------------------------------------------
    # Smart Drive documents (optional processing)
    # ---------------------------------------------------------------------
    from src.documents.storage import build_document_object_key, put_object_bytes
    from src.documents.jobs import process_document_job

    folders = [
        "/Drovi/Internal/Strategy",
        "/Drovi/Pilots/Legal",
        "/Drovi/Pilots/Accounting",
        "/Drovi/Product/Specs",
        "/Drovi/Security",
        "/Drovi/Sales/Enablement",
    ]
    doc_templates = [
        ("Drovi Seed Round Narrative", "/Drovi/Internal/Strategy", ["fundraising", "strategy"]),
        ("Pilot Readiness: Legal Firm (Advice Timeline)", "/Drovi/Pilots/Legal", ["legal", "pilot"]),
        ("Pilot Readiness: Accounting Firm (Document Workflows)", "/Drovi/Pilots/Accounting", ["accounting", "pilot"]),
        ("SOC2 Readiness Plan and Evidence Controls", "/Drovi/Security", ["security", "compliance"]),
        ("Connector Throughput Plan (Backfill and Live)", "/Drovi/Product/Specs", ["connectors", "ingestion"]),
        ("Continuum Bundle Catalog (Draft)", "/Drovi/Product/Specs", ["continuum", "exchange"]),
        ("Proof-First AI: Evidence and Bi-Temporal Memory", "/Drovi/Product/Specs", ["evidence", "memory"]),
    ]

    created_docs: list[dict[str, Any]] = []
    for i in range(document_count):
        base_title, folder, tags = doc_templates[i % len(doc_templates)]
        title = base_title if i < len(doc_templates) else f"{base_title} v{1 + (i // len(doc_templates))}"
        file_name = f"{title.replace(' ', '_').replace(':', '')}.md"

        # Content is stable and dense, but includes some variability per doc.
        content_lines = [
            f"# {title}",
            "",
            "## Context",
            "Drovi is an evidence-first intelligence layer. Every output links back to exact text spans.",
            "",
            "## Key Points",
            "- Seed focus: pilots with a 250+ person accounting firm and a 250+ person legal firm.",
            "- Bi-temporal memory: validFrom/validTo plus systemFrom/systemTo on every claim.",
            "- Zero hallucination goal: no evidence -> no persist.",
            "",
            "## Decisions",
            "- Decision: Treat timelines as first-class primitives (advice trails, commitment trails).",
            "- Decision: Multi-pass extraction with verification and contradiction detection.",
            "",
            "## Risks",
            "- Risk: silent drift in advice across matters and lawyers.",
            "- Risk: connector backfill slowness can kill trust on day 1.",
            "",
            "## Next Steps",
            f"- Owner: {rng.choice(list(contact_map.values()))['name']}",
            f"- Due: {(now + timedelta(days=rng.randint(3, 24))).strftime('%Y-%m-%d')}",
        ]
        body = "\n".join(content_lines) + "\n"

        data = body.encode("utf-8")
        sha256 = _sha256_bytes(data)
        doc_id = f"doc_{sha256}"
        object_key = build_document_object_key(
            organization_id=org_id,
            sha256=sha256,
            file_name=file_name,
        )

        # Upload bytes (overwrites are OK; key is content-addressed).
        await put_object_bytes(key=object_key, data=data, content_type="text/markdown")

        created_at = now - timedelta(days=rng.randint(2, 60))
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO document (
                        id, organization_id, title, file_name, file_type, mime_type,
                        byte_size, sha256, storage_backend, storage_path,
                        status, folder_path, tags, created_by_user_id,
                        metadata, created_at, updated_at
                    ) VALUES (
                        :id, :org_id, :title, :file_name, :file_type, :mime_type,
                        :byte_size, :sha256, 's3', :storage_path,
                        'uploaded', :folder_path, CAST(:tags AS jsonb), :created_by_user_id,
                        CAST(:metadata AS jsonb), :created_at, :updated_at
                    )
                    ON CONFLICT (organization_id, sha256)
                    DO UPDATE SET
                        title = COALESCE(EXCLUDED.title, document.title),
                        file_name = EXCLUDED.file_name,
                        folder_path = EXCLUDED.folder_path,
                        tags = EXCLUDED.tags,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "id": doc_id,
                    "org_id": org_id,
                    "title": title,
                    "file_name": file_name,
                    "file_type": "markdown",
                    "mime_type": "text/markdown",
                    "byte_size": len(data),
                    "sha256": sha256,
                    "storage_path": object_key,
                    # Document.tags and metadata are JSONB; serialize explicitly for raw SQL.
                    "tags": json.dumps(tags),
                    "created_by_user_id": owner_user_id,
                    "metadata": json.dumps({"seed_tag": seed_tag, "template": base_title}),
                    "created_at": created_at,
                    "updated_at": now,
                    "folder_path": folder,
                },
            )

        created_docs.append(
            {
                "document_id": doc_id,
                "sha256": sha256,
                "title": title,
                "file_name": file_name,
                "folder": folder,
            }
        )

        if process_documents:
            try:
                await process_document_job(organization_id=org_id, document_id=doc_id)
            except Exception as exc:
                logger.warning("Document processing failed (continuing)", document_id=doc_id, error=str(exc))

    # ---------------------------------------------------------------------
    # UIOs (evidence-backed)
    # ---------------------------------------------------------------------
    uio_mgr = UIOManager(org_id)

    # Use a mix of events and documents as evidence. For doc sources, we use the document id
    # as conversation_id and include quoted spans from the markdown body.
    def make_source_from_event(event: dict[str, Any], quote: str) -> SourceContext:
        start, end = _find_quote_span(event["content"], quote)
        return SourceContext(
            source_type=event["source_type"],
            source_account_id=None,
            conversation_id=event["conversation_id"],
            message_id=event["message_id"],
            quoted_text=quote,
            quoted_text_start=start,
            quoted_text_end=end,
            segment_hash=build_segment_hash(quote),
            confidence=0.86,
        )

    def make_source_from_doc(doc: dict[str, Any], quote: str) -> SourceContext:
        # We do not store full document bytes in this script; keep stable anchors.
        start, end = 0, len(quote)
        return SourceContext(
            source_type="document",
            source_account_id=None,
            conversation_id=doc["document_id"],
            message_id=doc["document_id"],
            quoted_text=quote,
            quoted_text_start=start,
            quoted_text_end=end,
            segment_hash=build_segment_hash(quote),
            confidence=0.9,
        )

    # Compose a pool of evidence sources.
    evidence_events = all_events
    evidence_docs = created_docs

    # Build UIO templates that map to demo themes.
    uio_templates: list[dict[str, Any]] = [
        {
            "type": "commitment",
            "title": "Ship Gmail connector backfill for pilot firms",
            "desc": "Complete historical backfill with idempotent replay and expose live sync status in-app.",
            "quote": "Gmail backfill should complete in under 30 minutes for a 250-person firm via parallelism and idempotency.",
            "theme": "connectors",
        },
        {
            "type": "decision",
            "title": "Adopt proof-first extraction policy (no evidence -> no persist)",
            "desc": "Persist only evidence-anchored items for high-stakes categories: decisions, commitments, risks.",
            "quote": "Evidence artifacts must be immutable and chain-of-custody logged for high-stakes outputs.",
            "theme": "security",
        },
        {
            "type": "risk",
            "title": "Advice drift across matters goes unnoticed",
            "desc": "Conflicting advice over time is a silent risk for legal firms. Detect contradictions and require explicit notice.",
            "quote": "Pilot readiness: legal firm wants 'show me where we said that' and advice drift detection on every matter.",
            "theme": "fundraising",
        },
        {
            "type": "task",
            "title": "Implement Advice Timeline UI (Git history for advice)",
            "desc": "Timeline of advice with exact wording, evidence link, and change detection across time.",
            "quote": "We need bi-temporal memory: what we believed then, and what is true now.",
            "theme": "security",
        },
        {
            "type": "claim",
            "title": "Zero-hallucination outputs increase retention in pilots",
            "desc": "Drovi outputs feel authoritative because citations are inline and every item has evidence.",
            "quote": "We should frame Drovi as the truth-first memory layer: evidence, timelines, and drift detection.",
            "theme": "fundraising",
        },
        {
            "type": "brief",
            "title": "Weekly pilot brief: legal + accounting readiness",
            "desc": "Summarize what changed, what is blocked, and which risks are rising with evidence-first references.",
            "quote": "Accounting firm wants document-first workflows: engagement letters, schedules, memos, and reconciliation trails.",
            "theme": "fundraising",
        },
    ]

    # Expand to reach uio_count with variations.
    while len(uio_templates) < uio_count:
        base = rng.choice(uio_templates[:6])
        variant = dict(base)
        variant["title"] = f"{base['title']} ({rng.choice(['v2', 'follow-up', 'refinement', 'expedite'])})"
        variant["desc"] = base["desc"] + f" Notes: {_pick(rng, ['requires evidence', 'needs owner clarity', 'pilot-critical', 'timeboxed'])}."
        uio_templates.append(variant)

    created_uio_ids: list[str] = []
    commitment_ids: list[str] = []
    decision_ids: list[str] = []
    risk_ids: list[str] = []

    for idx, spec in enumerate(uio_templates):
        uio_type = spec["type"]
        uio_id = _stable_id("uio", org_id, seed_tag, uio_type, str(idx), spec["title"])
        if await _uio_exists(uio_id=uio_id):
            continue

        # Choose evidence source.
        if rng.random() < 0.72 and evidence_events:
            event = rng.choice(evidence_events)
            source = make_source_from_event(event, spec["quote"])
            seen_at = event["captured_at"]
        else:
            doc = rng.choice(evidence_docs)
            doc_quote = rng.choice(
                [
                    "Drovi is an evidence-first intelligence layer. Every output links back to exact text spans.",
                    "- Decision: Multi-pass extraction with verification and contradiction detection.",
                    "- Zero hallucination goal: no evidence -> no persist.",
                    "- Risk: connector backfill slowness can kill trust on day 1.",
                ]
            )
            source = make_source_from_doc(doc, doc_quote)
            seen_at = now - timedelta(days=rng.randint(1, 55))

        owner = rng.choice(list(contact_map.values()))
        participants = rng.sample(list(contact_map.values()), k=rng.randint(2, 6))
        participant_ids = [p["id"] for p in participants]

        base = UIOCreate(
            id=uio_id,
            organization_id=org_id,
            type=UIOType(uio_type),
            canonical_title=spec["title"],
            canonical_description=spec["desc"],
            status=UIOStatus.ACTIVE,
            first_seen_at=seen_at,
            last_updated_at=seen_at + timedelta(hours=rng.randint(1, 72)),
            due_date=(seen_at + timedelta(days=rng.randint(3, 21))) if uio_type in {"task", "commitment"} else None,
            due_date_confidence=0.85 if uio_type in {"task", "commitment"} else None,
            owner_contact_id=owner["id"],
            participant_contact_ids=participant_ids,
            overall_confidence=0.86 if uio_type != "risk" else 0.78,
            belief_state=UIOBeliefState.ASSERTED,
            truth_state=UIOTruthState.UNKNOWN,
            last_update_reason="demo_seed",
        )

        # Create via manager
        if uio_type == "commitment":
            details = CommitmentDetailsCreate(
                direction=CommitmentDirection.OWED_BY_ME,
                debtor_contact_id=owner["id"],
                creditor_contact_id=participants[0]["id"],
                due_date_source="explicit",
                due_date_original_text="by next sprint",
                priority=rng.choice(
                    [CommitmentPriority.MEDIUM, CommitmentPriority.HIGH, CommitmentPriority.URGENT]
                ),
                status=rng.choice(
                    [CommitmentStatus.PENDING, CommitmentStatus.IN_PROGRESS, CommitmentStatus.OVERDUE]
                ),
                is_conditional=rng.random() < 0.18,
                condition="Pending security review sign-off" if rng.random() < 0.18 else None,
                extraction_context=None,
            )
            await uio_mgr.create_commitment_uio(CreateCommitmentUIO(base=base, details=details, source=source))
            commitment_ids.append(uio_id)

        elif uio_type == "decision":
            details = DecisionDetailsCreate(
                statement=spec["title"],
                rationale=spec["desc"],
                alternatives=[],
                decision_maker_contact_id=owner["id"],
                stakeholder_contact_ids=participant_ids,
                impact_areas=["product", "security", "pilots"],
                status=rng.choice([DecisionStatus.MADE, DecisionStatus.DEFERRED]),
                decided_at=seen_at,
                extraction_context=None,
            )
            await uio_mgr.create_decision_uio(CreateDecisionUIO(base=base, details=details, source=source))
            decision_ids.append(uio_id)

        elif uio_type == "task":
            details = TaskDetailsCreate(
                assignee_contact_id=owner["id"],
                created_by_contact_id=rng.choice(list(contact_map.values()))["id"],
                status=rng.choice([TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW]),
                priority=rng.choice([TaskPriority.MEDIUM, TaskPriority.HIGH, TaskPriority.URGENT]),
                estimated_effort=rng.choice(["1h", "4h", "1d", "3d", "1w"]),
                project=rng.choice(["Pilots", "Connectors", "Continuums", "Evidence", "Admin"]),
                tags=["demo", "execution"],
                extraction_context=None,
            )
            await uio_mgr.create_task_uio(CreateTaskUIO(base=base, details=details, source=source))

        elif uio_type == "risk":
            details = RiskDetailsCreate(
                risk_type=rng.choice([RiskType.CONTRADICTION, RiskType.DEADLINE_RISK, RiskType.OTHER]),
                severity=rng.choice([RiskSeverity.MEDIUM, RiskSeverity.HIGH, RiskSeverity.CRITICAL]),
                likelihood=rng.choice(["low", "medium", "high"]),
                impact=spec["desc"],
                mitigations=[
                    "Add verification pass to extraction",
                    "Enforce evidence gating for decisions",
                    "Run contradiction scan weekly",
                ],
                status=rng.choice(["open", "mitigating", "watching"]),
                extraction_context=None,
            )
            await uio_mgr.create_risk_uio(CreateRiskUIO(base=base, details=details, source=source))
            risk_ids.append(uio_id)

        elif uio_type == "claim":
            details = ClaimDetailsCreate(
                claim_type=rng.choice([ClaimType.FACT, ClaimType.OPINION, ClaimType.DECISION]),
                importance=rng.choice([ClaimImportance.MEDIUM, ClaimImportance.HIGH]),
                value=spec["desc"],
                extraction_context=None,
            )
            await uio_mgr.create_claim_uio(CreateClaimUIO(base=base, details=details, source=source))

        elif uio_type == "brief":
            details = BriefDetailsCreate(
                summary=spec["desc"],
                why_this_matters="Proof-first outputs are sticky: stakeholders trust evidence, timelines, and drift detection.",
                what_changed=rng.choice(
                    [
                        "New contradictions detected across pilot readiness threads.",
                        "Connector backfill performance improved; fewer ingestion errors.",
                        "Two high-severity risks escalated to owners with evidence links.",
                    ]
                ),
                suggested_action=rng.choice([BriefAction.REVIEW, BriefAction.FOLLOW_UP, BriefAction.ESCALATE]),
                action_reasoning="Pilot-critical: approaching deadlines with unresolved open loops.",
                open_loops=[
                    {
                        "description": "Confirm pilot kickoff date, retention policy, and evidence redaction rules.",
                        "owner": rng.choice(list(contact_map.values()))["name"],
                        "is_blocking": True,
                    },
                    {
                        "description": "Validate connector scopes and shared-vs-private visibility policy.",
                        "owner": rng.choice(list(contact_map.values()))["name"],
                        "is_blocking": False,
                    },
                ],
                priority_tier=rng.choice([BriefPriority.MEDIUM, BriefPriority.HIGH, BriefPriority.URGENT]),
                urgency_score=float(rng.random()),
                importance_score=float(rng.random()),
                sentiment_score=float(rng.uniform(-0.2, 0.6)),
                intent_classification="pilot_brief",
                conversation_id=source.conversation_id,
            )
            await uio_mgr.create_brief_uio(CreateBriefUIO(base=base, details=details, source=source))

        created_uio_ids.append(uio_id)

    # ---------------------------------------------------------------------
    # Graph relationships (OWNED_BY, THREATENS, IMPACTS)
    # ---------------------------------------------------------------------
    from src.uio.sync import get_uio_sync

    sync = await get_uio_sync(org_id)

    # OWNED_BY edges for commitments and decisions (improves customer_360 query).
    # We map owner_contact_id -> email by looking up contact_map.
    email_by_contact_id = {c["id"]: c["email"] for c in contact_map.values()}

    async with get_db_session() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id, type, owner_contact_id
                    FROM unified_intelligence_object
                    WHERE organization_id = :org_id
                      AND type IN ('commitment', 'decision')
                      AND owner_contact_id IS NOT NULL
                    """
                ),
                {"org_id": org_id},
            )
        ).fetchall()
    for row in rows:
        uio_id = str(getattr(row, "id"))
        owner_id = str(getattr(row, "owner_contact_id"))
        email = email_by_contact_id.get(owner_id)
        if email:
            await sync.sync_contact_relationship(uio_id, email, "OWNED_BY")

    # Create some THREATENS edges: risks -> commitments
    rng.shuffle(commitment_ids)
    for risk_id in risk_ids[: min(len(risk_ids), 28)]:
        if not commitment_ids:
            break
        target = rng.choice(commitment_ids)
        await sync.sync_uio_relationship(risk_id, target, "THREATENS", {"severity": "high"})

    # Create some IMPACTS edges: decisions -> commitments
    for decision_id in decision_ids[: min(len(decision_ids), 22)]:
        if not commitment_ids:
            break
        target = rng.choice(commitment_ids)
        await sync.sync_uio_relationship(decision_id, target, "IMPACTS", {"confidence": 0.72})

    # ---------------------------------------------------------------------
    # Contradictions (Postgres)
    # ---------------------------------------------------------------------
    contradiction_pairs = []
    for i in range(min(12, len(commitment_ids) // 2)):
        a = commitment_ids[i]
        b = commitment_ids[-(i + 1)]
        if a == b:
            continue
        contradiction_pairs.append((a, b))

    now = _utcnow()
    async with get_db_session() as session:
        for a, b in contradiction_pairs:
            cid = _stable_id("contr", org_id, a, b)
            await session.execute(
                text(
                    """
                    INSERT INTO uio_contradiction (
                        id, organization_id, uio_a_id, uio_b_id,
                        contradiction_type, severity, status,
                        evidence_quote, detected_at,
                        created_at, updated_at
                    ) VALUES (
                        :id, :org_id, :a, :b,
                        :type, :severity, :status,
                        :quote, :detected_at,
                        :created_at, :updated_at
                    )
                    ON CONFLICT (uio_a_id, uio_b_id)
                    DO NOTHING
                    """
                ),
                {
                    "id": cid,
                    "org_id": org_id,
                    "a": a,
                    "b": b,
                    "type": "scope_drift",
                    "severity": rng.choice(["medium", "high"]),
                    "status": rng.choice(["open", "investigating"]),
                    "quote": "Conflicting commitments detected across timeline; see evidence spans.",
                    "detected_at": now - timedelta(days=rng.randint(1, 20)),
                    "created_at": now,
                    "updated_at": now,
                },
            )

    # ---------------------------------------------------------------------
    # Reality stream (entity_versions)
    # ---------------------------------------------------------------------
    ver = VersionManager()
    # Create 2-4 versions for a handful of UIOs to make the stream feel alive.
    for uio_id in created_uio_ids[: min(40, len(created_uio_ids))]:
        # Snapshot: v1
        async with get_db_session() as session:
            row = (
                await session.execute(
                    text(
                        """
                        SELECT id, type, canonical_title, canonical_description,
                               status, last_updated_at, overall_confidence
                        FROM unified_intelligence_object
                        WHERE id = :id AND organization_id = :org_id
                        """
                    ),
                    {"id": uio_id, "org_id": org_id},
                )
            ).fetchone()
        if not row:
            continue
        data = {
            "id": row.id,
            "type": row.type,
            "title": row.canonical_title,
            "description": row.canonical_description,
            "status": row.status,
            "confidence": row.overall_confidence,
        }
        await ver.save_version(uio_id, f"uio:{row.type}", data, created_by="system", change_reason="seed:v1")

        if rng.random() < 0.55:
            data2 = dict(data)
            data2["description"] = (data2.get("description") or "") + " Update: refined scope and added evidence."
            await ver.save_version(uio_id, f"uio:{row.type}", data2, created_by="system", change_reason="seed:v2")

        if rng.random() < 0.25:
            data3 = dict(data)
            data3["status"] = "in_progress"
            await ver.save_version(uio_id, f"uio:{row.type}", data3, created_by="system", change_reason="seed:status")

    # ---------------------------------------------------------------------
    # Continuums + Exchange
    # ---------------------------------------------------------------------
    async with get_db_session() as session:
        continuum_ids: list[str] = []
        for name, desc, interval in [
            (
                "Advice Drift Sentinel",
                "Detect contradictory or drifting advice across matters with evidence links.",
                60,
            ),
            (
                "Risk-Weighted Matters",
                "Rank matters by unresolved risks, silence, and contradictory advice.",
                120,
            ),
            (
                "Commitment Escalation Loop",
                "Escalate overdue commitments with evidence and owner routing.",
                30,
            ),
        ]:
            cont_id = _stable_id("cont", org_id, name)
            continuum_ids.append(cont_id)
            await session.execute(
                text(
                    """
                    INSERT INTO continuum (
                        id, organization_id, name, description,
                        status, current_version, active_version,
                        schedule_type, schedule_interval_minutes,
                        created_by, created_at, updated_at,
                        last_run_at, next_run_at
                    ) VALUES (
                        :id, :org_id, :name, :description,
                        'active', 1, 1,
                        'interval', :interval,
                        :created_by, :created_at, :updated_at,
                        :last_run_at, :next_run_at
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        updated_at = EXCLUDED.updated_at,
                        status = EXCLUDED.status,
                        next_run_at = EXCLUDED.next_run_at
                    """
                ),
                {
                    "id": cont_id,
                    "org_id": org_id,
                    "name": name,
                    "description": desc,
                    "interval": int(interval),
                    "created_by": owner_user_id,
                    "created_at": now - timedelta(days=45),
                    "updated_at": now,
                    "last_run_at": now - timedelta(minutes=rng.randint(10, 240)),
                    "next_run_at": now + timedelta(minutes=interval),
                },
            )
            definition = {
                "dslVersion": "1",
                "name": name,
                "steps": [
                    {"id": "retrieve", "type": "retrieve", "query": "recent decisions, risks, commitments"},
                    {"id": "verify", "type": "verify", "policy": "evidence_required"},
                    {"id": "act", "type": "actuate", "driver": "support_ticket", "mode": "draft"},
                ],
            }
            await session.execute(
                text(
                    """
                    INSERT INTO continuum_version (
                        id, continuum_id, organization_id,
                        version, definition, definition_hash,
                        created_by, created_at, is_active
                    ) VALUES (
                        :id, :continuum_id, :org_id,
                        1, CAST(:definition AS json), :definition_hash,
                        :created_by, :created_at, true
                    )
                    ON CONFLICT (continuum_id, version) DO NOTHING
                    """
                ),
                {
                    "id": _stable_id("contv", cont_id, "1"),
                    "continuum_id": cont_id,
                    "org_id": org_id,
                    "definition": json.dumps(definition),
                    "definition_hash": hashlib.sha1(json.dumps(definition).encode("utf-8")).hexdigest(),
                    "created_by": owner_user_id,
                    "created_at": now - timedelta(days=45),
                },
            )

            # Create a few runs
            for run_i in range(4):
                run_id = _stable_id("run", cont_id, str(run_i))
                started = now - timedelta(days=run_i * 2, minutes=rng.randint(2, 120))
                completed = started + timedelta(seconds=rng.randint(8, 55))
                await session.execute(
                    text(
                        """
                        INSERT INTO continuum_run (
                            id, continuum_id, organization_id,
                            version, status,
                            started_at, completed_at,
                            error_message, run_metadata, step_results,
                            attempt, created_at
                        ) VALUES (
                            :id, :continuum_id, :org_id,
                            1, :status,
                            :started_at, :completed_at,
                            NULL, CAST(:run_metadata AS json), CAST(:step_results AS json),
                            1, :created_at
                        )
                        ON CONFLICT (id) DO NOTHING
                        """
                    ),
                    {
                        "id": run_id,
                        "continuum_id": cont_id,
                        "org_id": org_id,
                        "status": rng.choice(["success", "success", "success", "failed"]),
                        "started_at": started,
                        "completed_at": completed,
                        "run_metadata": json.dumps({"seed_tag": seed_tag, "trigger": "schedule"}),
                        "step_results": json.dumps(
                            [
                                {"step": "retrieve", "status": "ok", "items": rng.randint(8, 42)},
                                {"step": "verify", "status": "ok", "rejected": rng.randint(0, 6)},
                                {"step": "act", "status": "drafted", "actions": rng.randint(1, 4)},
                            ]
                        ),
                        "created_at": started,
                    },
                )

        # Exchange bundles (public within org)
        bundles = [
            ("Advice Drift Sentinel", "Contradiction detection for legal advice trails", 4900),
            ("Risk-Weighted Matters", "Matter scoring and partner dashboard", 7900),
            ("Proof-First Briefs", "Weekly briefs with inline evidence and 'what changed'", 3900),
        ]
        for name, desc, price in bundles:
            bundle_id = _stable_id("bun", org_id, name)
            await session.execute(
                text(
                    """
                    INSERT INTO continuum_bundle (
                        id, organization_id, name, description,
                        created_by, created_at, updated_at,
                        visibility, governance_status,
                        price_cents, currency, billing_model
                    ) VALUES (
                        :id, :org_id, :name, :description,
                        :created_by, :created_at, :updated_at,
                        'public', 'approved',
                        :price_cents, 'usd', 'subscription'
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        updated_at = EXCLUDED.updated_at,
                        visibility = EXCLUDED.visibility,
                        governance_status = EXCLUDED.governance_status
                    """
                ),
                {
                    "id": bundle_id,
                    "org_id": org_id,
                    "name": name,
                    "description": desc,
                    "created_by": owner_user_id,
                    "created_at": now - timedelta(days=30),
                    "updated_at": now,
                    "price_cents": int(price),
                },
            )
            manifest = {
                "name": name,
                "version": "1.0.0",
                "continuum": {
                    "name": name,
                    "schedule": {"type": "interval", "minutes": 60},
                },
                "capabilities": ["evidence", "timelines", "contradictions"],
            }
            bundle_version_id = _stable_id("bunv", bundle_id, "1.0.0")
            await session.execute(
                text(
                    """
                    INSERT INTO continuum_bundle_version (
                        id, bundle_id, organization_id,
                        version, manifest, signature, created_at
                    ) VALUES (
                        :id, :bundle_id, :org_id,
                        :version, CAST(:manifest AS json), :signature, :created_at
                    )
                    ON CONFLICT (id) DO NOTHING
                    """
                ),
                {
                    "id": bundle_version_id,
                    "bundle_id": bundle_id,
                    "org_id": org_id,
                    "version": "1.0.0",
                    "manifest": json.dumps(manifest),
                    "signature": hashlib.sha1(json.dumps(manifest).encode("utf-8")).hexdigest(),
                    "created_at": now - timedelta(days=30),
                },
            )
            # "Install" to first continuum if names match.
            matching = [cid for cid in continuum_ids if name.lower() in cid.lower() or True]
            install_cont_id = continuum_ids[0] if continuum_ids else None
            if install_cont_id:
                install_id = _stable_id("inst", bundle_id, install_cont_id)
                await session.execute(
                    text(
                        """
                        INSERT INTO continuum_bundle_installation (
                            id, bundle_id, bundle_version_id,
                            organization_id, continuum_id,
                            installed_by, installed_at
                        ) VALUES (
                            :id, :bundle_id, :bundle_version_id,
                            :org_id, :continuum_id,
                            :installed_by, :installed_at
                        )
                        ON CONFLICT (id) DO NOTHING
                        """
                    ),
                    {
                        "id": install_id,
                        "bundle_id": bundle_id,
                        "bundle_version_id": bundle_version_id,
                        "org_id": org_id,
                        "continuum_id": install_cont_id,
                        "installed_by": owner_user_id,
                        "installed_at": now - timedelta(days=10),
                    },
                )

    # ---------------------------------------------------------------------
    # Simulations + Actuations
    # ---------------------------------------------------------------------
    async with get_db_session() as session:
        for i in range(8):
            sim_id = _stable_id("sim", org_id, str(i))
            scenario = rng.choice(
                [
                    "Pilot timeline slip simulation",
                    "Connector backfill throughput simulation",
                    "Advice drift risk simulation",
                    "Retention impact of proof-first outputs",
                ]
            )
            await session.execute(
                text(
                    """
                    INSERT INTO simulation_run (
                        id, organization_id, scenario_name,
                        input_payload, output_payload,
                        created_at
                    ) VALUES (
                        :id, :org_id, :scenario_name,
                        CAST(:input AS json), CAST(:output AS json),
                        :created_at
                    )
                    ON CONFLICT (id) DO NOTHING
                    """
                ),
                {
                    "id": sim_id,
                    "org_id": org_id,
                    "scenario_name": scenario,
                    "input": json.dumps({"seed_tag": seed_tag, "scenario": scenario, "assumptions": {"latency_ms": 250}}),
                    "output": json.dumps(
                        {
                            "summary": "Simulation completed",
                            "signals": [
                                {"name": "backfill_minutes", "p50": 18, "p95": 42},
                                {"name": "contradictions_detected", "p50": 3, "p95": 11},
                            ],
                        }
                    ),
                    "created_at": now - timedelta(days=rng.randint(1, 25)),
                },
            )

        for i in range(10):
            act_id = _stable_id("act", org_id, str(i))
            await session.execute(
                text(
                    """
                    INSERT INTO actuation_action (
                        id, organization_id, driver, action_type, tier, status,
                        input_payload, draft_payload, stage_payload, result_payload,
                        policy_decisions, created_by, approval_by,
                        created_at, updated_at, executed_at
                    ) VALUES (
                        :id, :org_id, :driver, :action_type, :tier, :status,
                        CAST(:input AS json), CAST(:draft AS json), CAST(:stage AS json), CAST(:result AS json),
                        CAST(:policy AS json), :created_by, :approval_by,
                        :created_at, :updated_at, :executed_at
                    )
                    ON CONFLICT (id) DO NOTHING
                    """
                ),
                {
                    "id": act_id,
                    "org_id": org_id,
                    "driver": rng.choice(["resend_email", "support_ticket", "slack", "calendar"]),
                    "action_type": rng.choice(["draft_email", "create_ticket", "notify", "schedule_followup"]),
                    "tier": rng.choice(["safe", "review", "high_stakes"]),
                    "status": rng.choice(["drafted", "staged", "executed"]),
                    "input": json.dumps({"seed_tag": seed_tag, "prompt": "Follow up on overdue pilot item", "evidence_required": True}),
                    "draft": json.dumps({"subject": "Follow-up", "body": "Evidence-linked follow-up draft."}),
                    "stage": json.dumps({"requires_approval": True, "approvers": ["support@drovi.co"]}),
                    "result": json.dumps({"ok": True, "external_id": f"ext_{uuid4().hex[:10]}"}),
                    "policy": json.dumps({"decision": "allow", "reasons": ["evidence_present", "low_risk"]}),
                    "created_by": owner_user_id,
                    "approval_by": rng.choice([None, owner_user_id]),
                    "created_at": now - timedelta(days=rng.randint(1, 18)),
                    "updated_at": now,
                    "executed_at": now - timedelta(days=rng.randint(0, 7)),
                },
            )

    # ---------------------------------------------------------------------
    # Support tickets
    # ---------------------------------------------------------------------
    async with get_db_session() as session:
        for i in range(ticket_count):
            ticket_id = _stable_id("tkt", org_id, str(i))
            created_at = now - timedelta(days=rng.randint(1, 22), hours=rng.randint(0, 18))
            subject = rng.choice(
                [
                    "Pilot onboarding: connector status unclear",
                    "Document upload: need OCR evidence highlights",
                    "Exchange bundle governance approval",
                    "Contradiction flagged incorrectly",
                    "Ask: citations missing on brief",
                ]
            )
            status = rng.choice(["open", "open", "pending", "closed"])
            priority = rng.choice(["normal", "high", "urgent"])
            await session.execute(
                text(
                    """
                    INSERT INTO support_ticket (
                        id, organization_id, created_by_user_id, created_by_email,
                        subject, status, priority, assignee_email, created_via,
                        metadata, created_at, updated_at, last_message_at, closed_at
                    ) VALUES (
                        :id, :org_id, :created_by_user_id, :created_by_email,
                        :subject, :status, :priority, :assignee_email, 'web',
                        CAST(:metadata AS jsonb), :created_at, :updated_at, :last_message_at, :closed_at
                    )
                    ON CONFLICT (id) DO NOTHING
                    """
                ),
                {
                    "id": ticket_id,
                    "org_id": org_id,
                    "created_by_user_id": owner_user_id,
                    "created_by_email": "jeremy@drovi.co",
                    "subject": subject,
                    "status": status,
                    "priority": priority,
                    "assignee_email": rng.choice(["support@drovi.co", "maya@drovi.co", None]),
                    "metadata": json.dumps({"seed_tag": seed_tag, "page": rng.choice(["sources", "drive", "exchange", "ask"])}),
                    "created_at": created_at,
                    "updated_at": now,
                    "last_message_at": created_at + timedelta(hours=rng.randint(1, 6)),
                    "closed_at": (created_at + timedelta(days=2)) if status == "closed" else None,
                },
            )
            # Messages
            for j in range(rng.randint(1, 4)):
                msg_id = _stable_id("tmsg", ticket_id, str(j))
                sender = rng.choice(["jeremy@drovi.co", "support@drovi.co"])
                body = rng.choice(
                    [
                        "Repro steps: connect Gmail, backfill starts, status stuck in 'processing'.",
                        "Expected: evidence link shows exact quote span; got blank.",
                        "Request: show me where we said that across docs + email + meetings.",
                        "This looks like a rate limiting issue; please confirm Redis health.",
                        "We pushed a fix; can you refresh and retry the upload?",
                    ]
                )
                msg_uuid = uuid5(NAMESPACE_DNS, msg_id)
                direction = "inbound" if sender == "jeremy@drovi.co" else "outbound"
                author_type = "user" if sender == "jeremy@drovi.co" else "support"
                await session.execute(
                    text(
                        """
                        INSERT INTO support_ticket_message (
                            id, ticket_id, organization_id,
                            direction, visibility,
                            author_type, author_email, author_user_id,
                            subject,
                            body_text, body_html,
                            raw_payload,
                            created_at
                        ) VALUES (
                            :id, :ticket_id, :org_id,
                            :direction, 'external',
                            :author_type, :author_email, :author_user_id,
                            :subject,
                            :body_text, NULL,
                            CAST(:raw_payload AS jsonb),
                            :created_at
                        )
                        ON CONFLICT (id) DO NOTHING
                        """
                    ),
                    {
                        "id": str(msg_uuid),
                        "ticket_id": ticket_id,
                        "org_id": org_id,
                        "direction": direction,
                        "author_type": author_type,
                        "author_email": sender,
                        "author_user_id": owner_user_id if sender == "jeremy@drovi.co" else None,
                        "subject": subject if j == 0 else None,
                        "body_text": body,
                        "raw_payload": json.dumps(
                            {
                                "seed_tag": seed_tag,
                                "sender": sender,
                                "direction": direction,
                            }
                        ),
                        "created_at": created_at + timedelta(hours=j),
                    },
                )

    # ---------------------------------------------------------------------
    # Connections (connectors) + sync stats (for onboarding + Sources page)
    # ---------------------------------------------------------------------
    connector_specs: list[dict[str, Any]] = [
        {
            "connector_type": "gmail",
            "name": "Jeremy Gmail (Primary)",
            "config": {
                "email": "jeremy@drovi.co",
                "scopes": ["gmail.readonly", "profile"],
                "restricted_labels": ["spam", "trash"],
                "sync_progress": 1.0,
            },
            "streams": ["messages", "threads"],
            "records_synced": 124_350,
            "bytes_synced": 950_000_000,
        },
        {
            "connector_type": "slack",
            "name": "Drovi Slack Workspace",
            "config": {
                "workspace": "drovi-demo",
                "scopes": ["channels:history", "users:read"],
                "restricted_channels": ["#random"],
                "sync_progress": 0.96,
            },
            "streams": ["messages", "channels", "users"],
            "records_synced": 88_420,
            "bytes_synced": 410_000_000,
        },
        {
            "connector_type": "notion",
            "name": "Drovi Notion",
            "config": {"workspace": "Drovi HQ", "scopes": ["read"], "sync_progress": 0.92},
            "streams": ["pages", "databases"],
            "records_synced": 12_650,
            "bytes_synced": 35_000_000,
        },
        {
            "connector_type": "google_drive",
            "name": "Drovi Google Drive",
            "config": {"scopes": ["drive.readonly"], "sync_progress": 0.88},
            "streams": ["files"],
            "records_synced": 6_120,
            # sync_states.bytes_synced is int4; keep under 2,147,483,647.
            "bytes_synced": 2_000_000_000,
        },
        {
            "connector_type": "google_calendar",
            "name": "Drovi Calendar",
            "config": {"scopes": ["calendar.readonly"], "sync_progress": 0.99},
            "streams": ["events"],
            "records_synced": 2_840,
            "bytes_synced": 18_000_000,
        },
    ]

    async with get_db_session() as session:
        for spec in connector_specs:
            conn_uuid = uuid5(
                NAMESPACE_DNS,
                f"{org_id}::{seed_tag}::{spec['connector_type']}::{spec['name']}",
            )
            created_at = now - timedelta(days=60)
            last_sync = now - timedelta(minutes=rng.randint(2, 35))

            await session.execute(
                text(
                    """
                    INSERT INTO connections (
                        id, organization_id, connector_type, name, description,
                        config, streams_config,
                        sync_frequency_minutes, sync_enabled, backfill_enabled, backfill_start_date,
                        status, last_sync_at, last_sync_status, last_sync_error, last_sync_records,
                        created_at, updated_at, created_by_user_id, visibility
                    ) VALUES (
                        :id, :org_id, :connector_type, :name, :description,
                        CAST(:config AS jsonb), CAST(:streams_config AS jsonb),
                        :freq, true, true, :backfill_start,
                        'active', :last_sync_at, 'ok', NULL, :last_sync_records,
                        :created_at, :updated_at, :created_by_user_id, 'org_shared'
                    )
                    ON CONFLICT (id)
                    DO UPDATE SET
                        status = EXCLUDED.status,
                        config = EXCLUDED.config,
                        last_sync_at = EXCLUDED.last_sync_at,
                        last_sync_status = EXCLUDED.last_sync_status,
                        last_sync_records = EXCLUDED.last_sync_records,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "id": str(conn_uuid),
                    "org_id": org_id,
                    "connector_type": spec["connector_type"],
                    "name": spec["name"],
                    "description": f"Seeded demo connection for {spec['connector_type']}",
                    "config": json.dumps(spec.get("config") or {}),
                    "streams_config": json.dumps([{"stream": s, "enabled": True} for s in spec.get("streams", [])]),
                    "freq": int(rng.choice([5, 10, 15])),
                    "backfill_start": now - timedelta(days=180),
                    "last_sync_at": last_sync,
                    "last_sync_records": int(spec.get("records_synced") or 0),
                    "created_at": created_at,
                    "updated_at": now,
                    "created_by_user_id": owner_user_id,
                },
            )

            # Per-stream sync state counters
            per_stream = spec.get("streams") or ["messages"]
            records_total = int(spec.get("records_synced") or 0)
            bytes_total = int(spec.get("bytes_synced") or 0)
            for i, stream_name in enumerate(per_stream):
                # Spread totals across streams deterministically.
                stream_records = int(records_total / max(len(per_stream), 1)) + (i * 17)
                stream_bytes = int(bytes_total / max(len(per_stream), 1)) + (i * 1024 * 1024)
                await session.execute(
                    text(
                        """
                        INSERT INTO sync_states (
                            connection_id, stream_name, cursor_state,
                            records_synced, bytes_synced,
                            status, last_sync_started_at, last_sync_completed_at,
                            created_at, updated_at
                        ) VALUES (
                            :connection_id, :stream_name, CAST(:cursor_state AS jsonb),
                            :records_synced, :bytes_synced,
                            'idle', :started_at, :completed_at,
                            :created_at, :updated_at
                        )
                        ON CONFLICT (connection_id, stream_name)
                        DO UPDATE SET
                            records_synced = EXCLUDED.records_synced,
                            bytes_synced = EXCLUDED.bytes_synced,
                            last_sync_completed_at = EXCLUDED.last_sync_completed_at,
                            updated_at = EXCLUDED.updated_at
                        """
                    ),
                    {
                        "connection_id": str(conn_uuid),
                        "stream_name": stream_name,
                        "cursor_state": json.dumps({"seed_tag": seed_tag, "cursor": f"{stream_name}:{uuid4().hex[:8]}"}),
                        "records_synced": stream_records,
                        "bytes_synced": stream_bytes,
                        "started_at": last_sync - timedelta(seconds=rng.randint(8, 55)),
                        "completed_at": last_sync,
                        "created_at": created_at,
                        "updated_at": now,
                    },
                )

            # Backfill job history (completed)
            started = now - timedelta(days=rng.randint(6, 25), hours=rng.randint(0, 10))
            completed = started + timedelta(minutes=rng.randint(4, 22))
            await session.execute(
                text(
                    """
                    INSERT INTO sync_job_history (
                        connection_id, organization_id,
                        job_type, streams, full_refresh,
                        status, started_at, completed_at, duration_seconds,
                        records_synced, bytes_synced,
                        streams_completed, streams_failed,
                        error_message, extra_data,
                        created_at
                    ) VALUES (
                        :connection_id, :org_id,
                        'backfill', :streams, false,
                        'completed', :started_at, :completed_at, :duration_seconds,
                        :records_synced, :bytes_synced,
                        :streams_completed, :streams_failed,
                        NULL, CAST(:extra_data AS jsonb),
                        :created_at
                    )
                    """
                ),
                {
                    "connection_id": str(conn_uuid),
                    "org_id": org_id,
                    "streams": per_stream,
                    "started_at": started,
                    "completed_at": completed,
                    "duration_seconds": int((completed - started).total_seconds()),
                    "records_synced": int(spec.get("records_synced") or 0),
                    "bytes_synced": int(spec.get("bytes_synced") or 0),
                    "streams_completed": per_stream,
                    "streams_failed": [],
                    "extra_data": json.dumps({"seed_tag": seed_tag, "windows": 12, "idempotent": True}),
                    "created_at": started,
                },
            )

            # A queued/running durable backfill plan job for at least one connector
            if spec["connector_type"] == "google_drive":
                job_id = _stable_id("job", org_id, "connector.backfill_plan", spec["connector_type"])
                await session.execute(
                    text(
                        """
                        INSERT INTO background_job (
                            id, organization_id, job_type, status,
                            priority, run_at, resource_key,
                            attempts, max_attempts,
                            payload, created_at, updated_at,
                            idempotency_key
                        ) VALUES (
                            :id, :org_id, 'connector.backfill_plan', 'running',
                            10, :run_at, :resource_key,
                            0, 5,
                            CAST(:payload AS json), :created_at, :updated_at,
                            :idempotency_key
                        )
                        ON CONFLICT (organization_id, idempotency_key)
                        DO NOTHING
                        """
                    ),
                    {
                        "id": job_id,
                        "org_id": org_id,
                        "run_at": now - timedelta(minutes=2),
                        "resource_key": f"connection:{str(conn_uuid)}",
                        "payload": json.dumps({"connection_id": str(conn_uuid), "windows": 18, "mode": "parallel"}),
                        "created_at": now - timedelta(minutes=2),
                        "updated_at": now,
                        "idempotency_key": f"seed::{job_id}",
                    },
                )


async def main() -> int:
    parser = argparse.ArgumentParser(description="Seed extensive demo data into a single org.")
    parser.add_argument("--org-id", required=True, help="Target organization id (e.g. org_fb213b99f09387d2)")
    parser.add_argument("--owner-email", required=True, help="Existing owner user email (e.g. jeremy@drovi.co)")
    parser.add_argument("--scale", default="huge", choices=["small", "medium", "huge"])
    parser.add_argument(
        "--process-documents",
        action="store_true",
        help="Run Smart Drive processing for seeded documents (slower but richer).",
    )
    args = parser.parse_args()

    await init_db()

    try:
        with rls_context(args.org_id, is_internal=True):
            ident = await _fetch_user_and_org(owner_email=args.owner_email, org_id=args.org_id)
            logger.info(
                "Seeding demo org",
                org_id=ident.org_id,
                owner_user_id=ident.user_id,
                scale=args.scale,
                process_documents=args.process_documents,
            )
            await _seed_demo(
                org_id=ident.org_id,
                owner_user_id=ident.user_id,
                seed_tag=ident.seed_tag,
                scale=args.scale,
                process_documents=bool(args.process_documents),
            )
            logger.info("Demo seed complete", org_id=ident.org_id)
    finally:
        await close_db()

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
