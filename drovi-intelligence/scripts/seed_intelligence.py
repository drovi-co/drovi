"""
Seed the intelligence pipeline with synthetic but realistic content.

Generates mixed-source inputs (email, slack, meeting, docs) and posts them to /api/v1/analyze.
This populates Postgres + FalkorDB via the normal pipeline.
"""

from __future__ import annotations

import argparse
import json
import random
import time
from datetime import datetime, timedelta
from typing import Iterable

import httpx


PRODUCTS = [
    "Onboarding Flow",
    "Billing Dashboard",
    "AI Assistant",
    "Mobile App",
    "Analytics Suite",
    "Security Review",
    "Pricing Page",
    "Enterprise SSO",
    "Usage Alerts",
    "Customer Portal",
]

TEAMS = ["Growth", "Platform", "Revenue", "Support", "Ops", "Security", "Product"]
PEOPLE = ["Alice", "Bob", "Charlie", "Dina", "Eli", "Farah", "Gabe", "Hana", "Ivan", "Jules"]
COMPANIES = ["Acme", "Nimbus", "Arbor", "Helio", "Polar", "Glacier", "Vertex", "Atlas"]

RISK_PHRASES = [
    "Risk: if the vendor audit fails, we may slip the launch by two weeks.",
    "Risk: dependency on the payments API could block rollout.",
    "Risk: the legal review may delay the contract signature.",
    "Risk: compliance approval is pending for EU rollout.",
]


def _future_date(days: int) -> str:
    return (datetime.utcnow() + timedelta(days=days)).strftime("%B %d, %Y")


def _pick(seq: list[str]) -> str:
    return random.choice(seq)


def build_content(source_type: str, idx: int) -> str:
    product = _pick(PRODUCTS)
    team = _pick(TEAMS)
    owner = _pick(PEOPLE)
    company = _pick(COMPANIES)
    ship_date = _future_date(random.randint(3, 45))
    review_date = _future_date(random.randint(1, 21))
    budget = random.randint(25, 250) * 1000

    commitments = [
        f"{owner} will ship the {product} by {ship_date}.",
        f"{team} will deliver the rollout checklist by {review_date}.",
    ]
    decisions = [
        f"Decision: We will prioritize the {product} for Q2 rollout.",
        f"Decision: The {team} team will own {product} quality gates.",
    ]
    tasks = [
        f"Task: Create a launch plan for {product} by {review_date}.",
        f"Task: Prepare customer comms for {company} by {ship_date}.",
    ]
    claims = [
        f"The {product} is forecasted to reduce churn by 8%.",
        f"Budget approved: ${budget} for {product} initiatives.",
    ]
    risk = random.choice(RISK_PHRASES)

    body = "\n".join(
        [
            f"Update {idx}: {company} pipeline review for {product}.",
            *claims,
            *decisions,
            *commitments,
            *tasks,
            risk,
        ]
    )

    if source_type in {"meeting", "call", "recording", "transcript"}:
        return "\n".join(
            [
                f"{owner}: We reviewed the {product} timeline.",
                f"{_pick(PEOPLE)}: {decisions[0]}",
                f"{_pick(PEOPLE)}: {commitments[0]}",
                f"{_pick(PEOPLE)}: {tasks[0]}",
                f"{_pick(PEOPLE)}: {risk}",
                f"{_pick(PEOPLE)}: {claims[0]}",
            ]
        )

    if source_type in {"slack", "whatsapp"}:
        return "\n".join(
            [
                f"[{team}] {owner}: {commitments[0]}",
                f"[{team}] {_pick(PEOPLE)}: {decisions[1]}",
                f"[{team}] {_pick(PEOPLE)}: {tasks[1]}",
                f"[{team}] {_pick(PEOPLE)}: {claims[1]}",
                f"[{team}] {_pick(PEOPLE)}: {risk}",
            ]
        )

    if source_type in {"notion", "google_docs"}:
        return "\n".join(
            [
                f"# {product} plan ({team})",
                "## Decisions",
                f"- {decisions[0]}",
                "## Commitments",
                f"- {commitments[0]}",
                "## Tasks",
                f"- {tasks[0]}",
                "## Risks",
                f"- {risk}",
                "## Notes",
                f"- {claims[0]}",
            ]
        )

    return body


def build_payload(source_type: str, org_id: str, idx: int) -> dict:
    return {
        "content": build_content(source_type, idx),
        "source_type": source_type,
        "organization_id": org_id,
        "extract_commitments": True,
        "extract_decisions": True,
        "analyze_risk": True,
        "deduplicate": True,
    }


def iter_sources(source_types: Iterable[str], count: int) -> list[str]:
    types = list(source_types)
    return [types[i % len(types)] for i in range(count)]


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed intelligence pipeline with synthetic content.")
    parser.add_argument("--api-base", default="http://localhost:8000/api/v1")
    parser.add_argument("--org-id", default="internal")
    parser.add_argument("--count", type=int, default=120)
    parser.add_argument("--sleep", type=float, default=0.2, help="Sleep between requests (seconds)")
    parser.add_argument("--timeout", type=float, default=300.0, help="Per-request timeout in seconds")
    parser.add_argument("--retries", type=int, default=2, help="Retries per request on timeout")
    parser.add_argument(
        "--source-types",
        nargs="*",
        default=["email", "slack", "meeting", "notion", "google_docs", "call", "recording"],
    )
    parser.add_argument("--output", default="seed_results.jsonl")
    args = parser.parse_args()

    headers = {
        "X-Internal-Service-Token": "dev-test-token-drovi-2024",
        "X-Organization-ID": args.org_id,
        "Content-Type": "application/json",
    }

    source_schedule = iter_sources(args.source_types, args.count)
    results = []
    start = time.time()

    with httpx.Client(timeout=args.timeout) as client, open(args.output, "w", encoding="utf-8") as handle:
        for idx, source_type in enumerate(source_schedule, start=1):
            payload = build_payload(source_type, args.org_id, idx)
            data = None
            for attempt in range(args.retries + 1):
                try:
                    resp = client.post(f"{args.api_base}/analyze", headers=headers, json=payload)
                    resp.raise_for_status()
                    data = resp.json()
                    break
                except httpx.ReadTimeout:
                    if attempt >= args.retries:
                        raise
                    time.sleep(2 + attempt)
            if data is None:
                raise RuntimeError("No response data after retries")
            record = {
                "index": idx,
                "source_type": source_type,
                "analysis_id": data.get("analysis_id"),
                "commitments": len(data.get("commitments", [])),
                "decisions": len(data.get("decisions", [])),
                "risks": len(data.get("risks", [])),
                "claims": len(data.get("claims", [])),
                "confidence": data.get("confidence"),
                "needs_review": data.get("needs_review"),
            }
            results.append(record)
            handle.write(json.dumps(record) + "\n")
            if idx % 10 == 0:
                print(f"Seeded {idx}/{args.count} items...")
            if args.sleep:
                time.sleep(args.sleep)

    duration = time.time() - start
    avg_conf = sum(r.get("confidence", 0.0) or 0.0 for r in results) / max(len(results), 1)
    print(
        json.dumps(
            {
                "count": len(results),
                "avg_confidence": avg_conf,
                "duration_seconds": round(duration, 2),
                "output": args.output,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
