#!/usr/bin/env python3
"""Generate a diversified gold set for evaluation."""
from __future__ import annotations

import json
import random
from pathlib import Path

random.seed(42)

names = [
    "Alex", "Jordan", "Taylor", "Morgan", "Riley", "Casey", "Avery", "Jamie",
    "Cameron", "Quinn", "Reese", "Drew", "Parker", "Hayden", "Rowan", "Dakota",
    "Sydney", "Robin", "Skyler", "Emerson",
]

projects = [
    "Atlas", "Nova", "Orion", "Helios", "Pulse", "Summit", "Vertex", "Beacon",
    "Nimbus", "Catalyst", "Aurora", "Voyager", "Odyssey", "Drift", "Zenith",
]

vendors = [
    "Stripe", "HubSpot", "Salesforce", "Zendesk", "Snowflake", "Databricks",
    "AWS", "GCP", "Azure", "MongoDB Atlas", "Segment", "Twilio",
]

decisions = [
    "migrate to AWS for hosting",
    "switch the CRM to HubSpot",
    "delay the launch to Q2",
    "approve the enterprise pricing tier",
    "sunset the legacy API by July",
    "pilot the new onboarding flow",
    "prioritize the healthcare segment",
    "adopt usage-based billing",
    "pause the LATAM expansion",
    "run the beta in two phases",
    "standardize on Databricks for analytics",
    "move the support team to Zendesk",
    "choose Snowflake as the warehouse",
    "bundle analytics into the Pro plan",
    "ship the feature behind a feature flag",
    "replace weekly syncs with async updates",
    "require legal review for new contracts",
    "centralize pricing approvals",
    "increase QA coverage before release",
    "freeze new feature work for two weeks",
    "use Twilio for SMS notifications",
    "adopt a hybrid sales motion",
    "roll back the UI change",
    "launch a limited beta for top customers",
    "merge Project Atlas and Nova",
    "move to a quarterly roadmap cadence",
    "freeze hiring for Q1",
    "add multi-factor auth by default",
    "prioritize reliability over new features",
    "re-scope the {project} milestone",
]

actions = [
    "send the proposal to finance",
    "share the updated roadmap",
    "draft the migration plan",
    "prepare the customer update email",
    "review the security findings",
    "deliver the revised deck",
    "update the KPI dashboard",
    "confirm the beta invite list",
    "publish the release notes",
    "sync with the legal team",
    "finalize the pricing FAQ",
    "schedule a pilot kickoff",
    "compile the competitive analysis",
    "update the contract language",
    "prepare the QBR slides",
    "ship the onboarding checklist",
    "run the load test",
    "upload the meeting recap",
    "share the support SOP",
    "coordinate the data migration",
    "send the vendor evaluation",
    "draft the risk mitigation plan",
    "review the budget variance",
    "confirm the training schedule",
    "close the open security tickets",
    "publish the API deprecation notice",
    "document the rollout plan",
    "send the weekly metrics",
    "review the escalations",
    "coordinate the pilot timeline",
]

tasks = [
    "create the onboarding checklist",
    "prepare the renewal summary",
    "set up the sandbox account",
    "update the pricing page",
    "follow up with procurement",
    "book the customer workshop",
    "clean up the backlog",
    "triage the support queue",
    "review the SSO setup",
    "draft the enablement guide",
    "sync the partner list",
    "compile the compliance evidence",
    "update the runbook",
    "set up error budget tracking",
    "tag the release candidate",
    "prepare the incident report",
    "record the demo video",
    "update the dependencies list",
    "test the rollback plan",
    "confirm the launch checklist",
    "create the change log",
    "publish the FAQ",
    "review the contract redlines",
    "set the experiment guardrails",
    "coordinate the design review",
    "update the QA checklist",
    "confirm the data export",
    "draft the status update",
    "schedule the pilot review",
    "archive the old documentation",
]

risks = [
    "miss the security review deadline",
    "overrun the infra budget",
    "ship without legal approval",
    "delay the enterprise rollout",
    "trigger a compliance breach",
    "lose the renewal due to gaps",
    "introduce regressions in the API",
    "miss the SLA for priority customers",
    "block the data migration",
    "create a support backlog spike",
    "fail the SOC2 control test",
    "delay the {project} milestone",
    "cause churn in the mid-market segment",
    "miss the QBR commitments",
    "overload the on-call rotation",
    "miss the payment processor deadline",
    "lose analytics data during cutover",
    "ship an unstable mobile build",
    "trigger an escalation from finance",
    "miss the procurement window",
]

claims = [
    "Q3 revenue reached $2.1M",
    "NPS improved to 46 last quarter",
    "the churn rate is down to 3%",
    "we closed 12 enterprise deals in January",
    "the pilot has 18 active users",
    "AWS costs increased by 12% in Q4",
    "the uptime SLA is currently 99.92%",
    "support backlog is at 42 tickets",
    "the onboarding funnel dropped 8%",
    "the new UI reduced time-to-value by 15%",
    "we shipped release 2.4.1 last week",
    "the contract value is $480k annually",
    "the security audit found 2 medium findings",
    "the integration coverage is 68%",
    "the trial-to-paid conversion is 22%",
    "the latest pipeline includes 6 enterprise prospects",
    "the forecast shows a 9% ARR shortfall",
    "the uptime incident lasted 27 minutes",
    "the customer requested a 10% discount",
    "the migration touched 14 services",
]

patterns = [
    {"decision": True, "commitment": True, "task": True, "risk": False, "claim": True},
    {"decision": True, "commitment": False, "task": True, "risk": True, "claim": False},
    {"decision": False, "commitment": True, "task": True, "risk": True, "claim": True},
    {"decision": True, "commitment": True, "task": False, "risk": True, "claim": True},
    {"decision": True, "commitment": False, "task": False, "risk": True, "claim": True},
    {"decision": False, "commitment": True, "task": False, "risk": False, "claim": True},
    {"decision": False, "commitment": False, "task": True, "risk": False, "claim": True},
    {"decision": False, "commitment": False, "task": False, "risk": True, "claim": True},
    {"decision": True, "commitment": True, "task": True, "risk": True, "claim": True},
]

sources = ["email", "slack", "meeting", "doc"]


def build_content(source: str, decision: str | None, commitment: str | None, task: str | None, risk: str | None, claim: str | None) -> str:
    speaker = random.choice(names)
    project = random.choice(projects)
    lines = []

    if source == "email":
        lines.append(f"Subject: {project} update")
        lines.append("")
        lines.append(f"Hi team,")
    elif source == "slack":
        lines.append(f"{speaker} 9:12 AM")
    elif source == "meeting":
        lines.append(f"[00:05] {speaker}:")
    else:
        lines.append(f"Project {project} notes")
        lines.append("")

    if decision:
        lines.append(f"Decision: {decision}.")
    if commitment:
        lines.append(f"I will {commitment}.")
    if task:
        lines.append(f"Action item: {task}.")
    if risk:
        lines.append(f"Risk: we could {risk} if we miss the timeline.")
    if claim:
        lines.append(f"FYI: {claim}.")

    if source == "email":
        lines.append("")
        lines.append(f"Thanks,\n{speaker}")

    return "\n".join(lines)


def main() -> None:
    records = []
    count = 500
    for i in range(count):
        pattern = patterns[i % len(patterns)]
        source = sources[i % len(sources)]
        project = random.choice(projects)

        decision = random.choice(decisions).format(project=project) if pattern["decision"] else None
        commitment = random.choice(actions) if pattern["commitment"] else None
        task = random.choice(tasks) if pattern["task"] else None
        risk = random.choice(risks).format(project=project) if pattern["risk"] else None
        claim = random.choice(claims) if pattern["claim"] else None

        content = build_content(source, decision, commitment, task, risk, claim)

        expected = {
            "decisions": [decision] if decision else [],
            "commitments": [commitment] if commitment else [],
            "tasks": [task] if task else [],
            "risks": [risk] if risk else [],
            "claims": [claim] if claim else [],
        }

        records.append({
            "id": f"eval-{i + 1}",
            "source": source,
            "content": content,
            "expected": expected,
        })

    out_path = Path(__file__).parent / "goldset.jsonl"
    with out_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False))
            handle.write("\n")

    summary = {
        "samples": len(records),
        "source_breakdown": {s: sum(1 for r in records if r["source"] == s) for s in sources},
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
