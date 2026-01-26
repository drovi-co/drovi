#!/usr/bin/env python3
"""
Provider Comparison Test Script

Runs complex multi-source intelligence extraction tests and compares
results between Together.ai (open-source) and OpenAI (proprietary).
"""

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx


@dataclass
class TestResult:
    """Result of a single test."""
    provider: str
    source_type: str
    test_name: str
    success: bool
    duration_ms: int
    claims_count: int = 0
    commitments_count: int = 0
    decisions_count: int = 0
    risks_count: int = 0
    overall_confidence: float = 0.0
    needs_review: bool = False
    error: str | None = None
    raw_response: dict = field(default_factory=dict)


@dataclass
class ComparisonReport:
    """Comparison between two providers."""
    together_results: list[TestResult] = field(default_factory=list)
    openai_results: list[TestResult] = field(default_factory=list)


# =============================================================================
# Test Cases - Complex Multi-Source Content
# =============================================================================

TEST_CASES = [
    # Test 1: Complex Email Thread with Multiple Commitments
    {
        "name": "Complex Email - Multiple Commitments & Decisions",
        "source_type": "email",
        "content": """
Subject: RE: Q1 Product Launch Planning - Final Decisions Needed

From: Sarah Chen <sarah.chen@techcorp.com>
To: Product Team <product@techcorp.com>
Date: January 20, 2026 at 3:45 PM

Hi team,

Following our discussion, here are the final decisions and action items:

**DECISIONS MADE:**
1. We will launch the beta on March 15th instead of March 1st to allow more testing time.
2. The premium tier will be priced at $49/month (not $59 as originally proposed).
3. We're going with AWS for hosting instead of GCP due to better enterprise support.

**COMMITMENTS:**
- @Mike: I need the final UI mockups by this Friday (Jan 24th). Can you confirm?
- @Jennifer: Please have the marketing copy ready by January 31st.
- I'll personally review all security audit findings by next Wednesday.
- The engineering team has committed to completing the API v2 migration by February 10th.

**OPEN QUESTIONS:**
- Who will handle the customer migration communication?
- Do we need legal review for the new terms of service?
- What's our rollback plan if the launch fails?

@David - I noticed you mentioned budget concerns in the last meeting. Can you send me the revised budget projections by EOD Monday?

Let me know if anyone has concerns about these timelines.

Best,
Sarah
VP of Product

---
Previous message from Mike Torres:
"The mockups are 80% done. I might need an extra day or two but will do my best to hit Friday. Also, I committed to helping the design team with the mobile app wireframes, so I'm a bit stretched thin."
""",
        "user_email": "sarah.chen@techcorp.com",
        "expected_min": {
            "claims": 8,
            "commitments": 4,
            "decisions": 3,
            "risks": 1,
        },
    },

    # Test 2: Calendar Event with Implicit Commitments
    {
        "name": "Calendar Event - Meeting with Implicit Commitments",
        "source_type": "calendar",
        "content": """
Event: Q4 Budget Review - MANDATORY
Organizer: CFO Michael Rodriguez
Date: February 5, 2026 10:00 AM - 12:00 PM
Location: Conference Room A / Zoom Link: https://zoom.us/j/123456789

Attendees:
- Michael Rodriguez (CFO) - Organizer
- Sarah Chen (VP Product) - Required
- James Wilson (VP Engineering) - Required
- Lisa Park (VP Sales) - Required
- Tom Anderson (Controller) - Required

Description:
AGENDA:
1. Q3 Actuals Review (Tom to present - 20 min)
2. Q4 Forecast Discussion (Each VP to present their department's numbers - 15 min each)
3. Cost Reduction Initiatives (Michael to present proposals)
4. Headcount Planning for 2027

PREP REQUIRED:
- All VPs must submit their Q4 budget requests by February 3rd
- Tom needs to finalize Q3 close by February 4th
- Sarah to bring revised product roadmap with cost estimates

DECISIONS TO BE MADE:
- Approval of Q4 discretionary spending
- Headcount freeze extension decision
- Marketing budget reallocation

Note: This meeting has been rescheduled from January 29th due to conflicts.
Please confirm attendance by January 30th.
""",
        "user_email": "sarah.chen@techcorp.com",
        "expected_min": {
            "claims": 5,
            "commitments": 3,
            "decisions": 0,  # Decisions to be made, not yet made
            "risks": 0,
        },
    },

    # Test 3: Slack Thread with Rapid-Fire Decisions
    {
        "name": "Slack Thread - Urgent Production Issue",
        "source_type": "slack",
        "content": """
#incident-response channel

[10:15 AM] @alex.kumar: 🚨 ALERT: Production API latency spiked to 5s. Dashboard showing 50% error rate.

[10:16 AM] @jennifer.wong: Looking at it now. Seeing database connection pool exhaustion.

[10:17 AM] @alex.kumar: @david.smith Can you check the recent deploys? We pushed v2.3.4 at 9:45 AM.

[10:18 AM] @david.smith: Checking... The deploy looks fine but I see we increased the batch size for the sync job from 100 to 1000.

[10:19 AM] @jennifer.wong: That's it. The large batches are holding connections too long. We need to rollback.

[10:20 AM] @alex.kumar: Decision: Let's rollback to v2.3.3 immediately. @david.smith can you do it?

[10:20 AM] @david.smith: On it. Rolling back now. ETA 5 minutes.

[10:21 AM] @jennifer.wong: I'll prepare a postmortem doc. We should also add connection pool monitoring before next release.

[10:22 AM] @alex.kumar: Agreed. @jennifer.wong can you own the postmortem? Due by EOD tomorrow.

[10:22 AM] @jennifer.wong: Yes, I'll handle it. Will include the monitoring recommendation.

[10:25 AM] @david.smith: Rollback complete. Latency back to normal (200ms). Error rate dropping.

[10:26 AM] @alex.kumar: Great work everyone! Let's do a quick sync at 2 PM to discuss next steps. I'll book the room.

[10:27 AM] @sarah.chen: Just saw this. Good job on the quick response! Please make sure the customer success team is notified about the 10-minute outage.

[10:28 AM] @alex.kumar: @jennifer.wong can you also send a brief incident summary to customer-success@company.com?

[10:28 AM] @jennifer.wong: Will do, sending now.
""",
        "user_email": "alex.kumar@company.com",
        "expected_min": {
            "claims": 6,
            "commitments": 4,
            "decisions": 2,
            "risks": 1,
        },
    },

    # Test 4: Long Document with Nuanced Commitments
    {
        "name": "Contract Negotiation Email - Complex Conditions",
        "source_type": "email",
        "content": """
Subject: RE: Enterprise Agreement - TechCorp & Acme Inc - Final Terms

From: Legal Team <contracts@techcorp.com>
To: Procurement <procurement@acmeinc.com>
CC: sarah.chen@techcorp.com, john.doe@acmeinc.com

Dear Acme Procurement Team,

After careful review of your counter-proposal, we are prepared to accept the following terms:

1. PRICING
   - We agree to the $850,000 annual license fee (reduced from our initial $1M proposal)
   - HOWEVER, this price is contingent on:
     a) A 3-year minimum commitment (non-cancellable)
     b) Payment within NET 30 terms
     c) Annual volume of at least 10,000 API calls per day
   - If daily API volume drops below 5,000 for 3 consecutive months, we reserve the right to renegotiate pricing

2. SLA COMMITMENTS
   - We commit to 99.9% uptime (excluding scheduled maintenance windows)
   - Scheduled maintenance will be limited to Sundays 2-6 AM EST
   - We will provide 72 hours notice for any emergency maintenance
   - IF uptime falls below 99.9% in any month, we will credit 10% of that month's fee

3. SUPPORT
   - Enterprise support with 4-hour response time for P1 issues
   - Dedicated account manager (to be assigned by February 15th)
   - Quarterly business reviews (first one scheduled for Q2)

4. DATA HANDLING
   - All data will be stored in US-East region unless otherwise requested
   - We will complete SOC2 Type II certification by June 30th, 2026
   - Data retention: 7 years unless you request deletion

5. OUTSTANDING ITEMS REQUIRING YOUR INPUT:
   - Please confirm your legal entity name for the contract
   - We need your certificate of insurance by February 1st
   - Who should be listed as the primary technical contact?

We would like to finalize this agreement by January 31st. Can you confirm these terms work for your team?

Best regards,
TechCorp Legal Team
""",
        "user_email": "sarah.chen@techcorp.com",
        "expected_min": {
            "claims": 10,
            "commitments": 5,
            "decisions": 2,
            "risks": 2,
        },
    },

    # Test 5: WhatsApp-style Informal Communication
    {
        "name": "WhatsApp - Informal Project Update",
        "source_type": "whatsapp",
        "content": """
[Project Alpha Group]

[Yesterday 6:45 PM] Mike: hey guys quick update - the client demo is confirmed for thursday 2pm

[Yesterday 6:47 PM] Sarah: great! is the demo environment ready?

[Yesterday 6:48 PM] Mike: working on it now. should be done by tomorrow night. @james can u make sure the test data is loaded?

[Yesterday 6:50 PM] James: yep will do it first thing tomorrow morning

[Yesterday 6:52 PM] Sarah: perfect. also reminder that the investor presentation is friday morning. i need everyones slides by wednesday EOD

[Yesterday 6:53 PM] Mike: mine are 90% done. ill send tonight

[Yesterday 6:54 PM] James: havent started yet tbh. but ill get it done wednesday

[Yesterday 6:55 PM] Sarah: james thats cutting it close. can u aim for wednesday morning so i have time to review?

[Yesterday 6:56 PM] James: ok ill try but no promises

[Yesterday 6:57 PM] Sarah: 😬 ok just do your best

[Today 9:15 AM] Mike: slides sent. also fyi i found a bug in the payment flow. not critical but should fix before demo

[Today 9:17 AM] Sarah: can u fix it today?

[Today 9:18 AM] Mike: yeah ill prioritize it. will be done by lunch

[Today 9:20 AM] James: @mike which bug? the one i reported last week?

[Today 9:21 AM] Mike: different one. ill add it to jira and link to yours though
""",
        "user_email": "sarah@company.com",
        "expected_min": {
            "claims": 6,
            "commitments": 5,
            "decisions": 1,
            "risks": 1,
        },
    },
]


async def run_single_test(
    client: httpx.AsyncClient,
    test_case: dict,
    provider_name: str,
) -> TestResult:
    """Run a single test case."""
    start_time = time.time()

    payload = {
        "content": test_case["content"],
        "source_type": test_case["source_type"],
        "organization_id": "test_org_comparison",
        "user_email": test_case.get("user_email", "test@example.com"),
        "extract_commitments": True,
        "extract_decisions": True,
        "analyze_risk": True,
        "deduplicate": True,
    }

    try:
        response = await client.post(
            "http://localhost:8000/api/v1/analyze",
            json=payload,
            timeout=300.0,  # 5 minutes for complex extraction
        )
        duration_ms = int((time.time() - start_time) * 1000)

        if response.status_code != 200:
            return TestResult(
                provider=provider_name,
                source_type=test_case["source_type"],
                test_name=test_case["name"],
                success=False,
                duration_ms=duration_ms,
                error=f"HTTP {response.status_code}: {response.text[:200]}",
            )

        data = response.json()

        return TestResult(
            provider=provider_name,
            source_type=test_case["source_type"],
            test_name=test_case["name"],
            success=data.get("success", False),
            duration_ms=duration_ms,
            claims_count=len(data.get("claims", [])),
            commitments_count=len(data.get("commitments", [])),
            decisions_count=len(data.get("decisions", [])),
            risks_count=len(data.get("risks", [])),
            overall_confidence=data.get("confidence", 0.0),
            needs_review=data.get("needs_review", False),
            raw_response=data,
        )

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return TestResult(
            provider=provider_name,
            source_type=test_case["source_type"],
            test_name=test_case["name"],
            success=False,
            duration_ms=duration_ms,
            error=str(e),
        )


async def run_all_tests(provider_name: str) -> list[TestResult]:
    """Run all test cases."""
    results = []

    async with httpx.AsyncClient() as client:
        for test_case in TEST_CASES:
            print(f"  Running: {test_case['name']}...")
            result = await run_single_test(client, test_case, provider_name)
            results.append(result)
            print(f"    ✓ {result.duration_ms}ms - Claims:{result.claims_count} Commits:{result.commitments_count} Decisions:{result.decisions_count} Risks:{result.risks_count}")

    return results


def print_comparison_report(together_results: list[TestResult], openai_results: list[TestResult]):
    """Print a detailed comparison report."""

    print("\n" + "=" * 100)
    print("PROVIDER COMPARISON REPORT - Together.ai vs OpenAI")
    print("=" * 100)
    print(f"Timestamp: {datetime.now().isoformat()}")
    print(f"Tests Run: {len(TEST_CASES)}")
    print()

    # Summary statistics
    together_total_time = sum(r.duration_ms for r in together_results)
    openai_total_time = sum(r.duration_ms for r in openai_results) if openai_results else 0

    together_success = sum(1 for r in together_results if r.success)
    openai_success = sum(1 for r in openai_results if r.success) if openai_results else 0

    together_claims = sum(r.claims_count for r in together_results)
    openai_claims = sum(r.claims_count for r in openai_results) if openai_results else 0

    together_commits = sum(r.commitments_count for r in together_results)
    openai_commits = sum(r.commitments_count for r in openai_results) if openai_results else 0

    together_decisions = sum(r.decisions_count for r in together_results)
    openai_decisions = sum(r.decisions_count for r in openai_results) if openai_results else 0

    together_risks = sum(r.risks_count for r in together_results)
    openai_risks = sum(r.risks_count for r in openai_results) if openai_results else 0

    together_avg_conf = sum(r.overall_confidence for r in together_results) / len(together_results) if together_results else 0
    openai_avg_conf = sum(r.overall_confidence for r in openai_results) / len(openai_results) if openai_results else 0

    print("=" * 100)
    print("SUMMARY STATISTICS")
    print("=" * 100)
    print(f"{'Metric':<35} {'Together.ai':<25} {'OpenAI':<25} {'Difference':<15}")
    print("-" * 100)
    print(f"{'Success Rate':<35} {together_success}/{len(together_results):<25} {openai_success}/{len(openai_results) if openai_results else 0:<25} {'-':<15}")
    print(f"{'Total Time (ms)':<35} {together_total_time:<25} {openai_total_time:<25} {together_total_time - openai_total_time:+d}")
    print(f"{'Avg Time per Test (ms)':<35} {together_total_time // len(together_results) if together_results else 0:<25} {openai_total_time // len(openai_results) if openai_results else 0:<25} {'-':<15}")
    print(f"{'Total Claims Extracted':<35} {together_claims:<25} {openai_claims:<25} {together_claims - openai_claims:+d}")
    print(f"{'Total Commitments Extracted':<35} {together_commits:<25} {openai_commits:<25} {together_commits - openai_commits:+d}")
    print(f"{'Total Decisions Extracted':<35} {together_decisions:<25} {openai_decisions:<25} {together_decisions - openai_decisions:+d}")
    print(f"{'Total Risks Detected':<35} {together_risks:<25} {openai_risks:<25} {together_risks - openai_risks:+d}")
    together_conf_str = f"{together_avg_conf:.2%}"
    openai_conf_str = f"{openai_avg_conf:.2%}"
    diff_conf_str = f"{together_avg_conf - openai_avg_conf:+.2%}"
    print(f"{'Avg Confidence Score':<35} {together_conf_str:<25} {openai_conf_str:<25} {diff_conf_str:<15}")
    print()

    # Per-test comparison
    print("=" * 100)
    print("PER-TEST COMPARISON")
    print("=" * 100)

    for i, (t_result, test_case) in enumerate(zip(together_results, TEST_CASES)):
        o_result = openai_results[i] if i < len(openai_results) else None
        expected = test_case.get("expected_min", {})

        print(f"\n{'─' * 100}")
        print(f"TEST {i+1}: {test_case['name']}")
        print(f"Source Type: {test_case['source_type']}")
        print(f"{'─' * 100}")

        print(f"{'Metric':<25} {'Together.ai':<18} {'OpenAI':<18} {'Expected Min':<18} {'T vs Exp':<12}")
        print("-" * 90)

        o_claims = o_result.claims_count if o_result else "-"
        o_commits = o_result.commitments_count if o_result else "-"
        o_decisions = o_result.decisions_count if o_result else "-"
        o_risks = o_result.risks_count if o_result else "-"
        o_time = f"{o_result.duration_ms}ms" if o_result else "-"
        o_conf = f"{o_result.overall_confidence:.1%}" if o_result else "-"

        exp_claims = expected.get("claims", "-")
        exp_commits = expected.get("commitments", "-")
        exp_decisions = expected.get("decisions", "-")
        exp_risks = expected.get("risks", "-")

        t_claims_ok = "✓" if isinstance(exp_claims, int) and t_result.claims_count >= exp_claims else "✗"
        t_commits_ok = "✓" if isinstance(exp_commits, int) and t_result.commitments_count >= exp_commits else "✗"
        t_decisions_ok = "✓" if isinstance(exp_decisions, int) and t_result.decisions_count >= exp_decisions else "✗"
        t_risks_ok = "✓" if isinstance(exp_risks, int) and t_result.risks_count >= exp_risks else "✗"

        print(f"{'Duration':<25} {t_result.duration_ms}ms{'':<10} {o_time:<18} {'-':<18} {'-':<12}")
        print(f"{'Claims':<25} {t_result.claims_count:<18} {o_claims:<18} {exp_claims:<18} {t_claims_ok:<12}")
        print(f"{'Commitments':<25} {t_result.commitments_count:<18} {o_commits:<18} {exp_commits:<18} {t_commits_ok:<12}")
        print(f"{'Decisions':<25} {t_result.decisions_count:<18} {o_decisions:<18} {exp_decisions:<18} {t_decisions_ok:<12}")
        print(f"{'Risks':<25} {t_result.risks_count:<18} {o_risks:<18} {exp_risks:<18} {t_risks_ok:<12}")
        print(f"{'Confidence':<25} {t_result.overall_confidence:.1%}{'':<10} {o_conf:<18} {'-':<18} {'-':<12}")
        print(f"{'Success':<25} {t_result.success:<18} {o_result.success if o_result else '-':<18}")

        if t_result.error:
            print(f"  Together Error: {t_result.error[:80]}")
        if o_result and o_result.error:
            print(f"  OpenAI Error: {o_result.error[:80]}")

    # Detailed extraction samples
    print("\n" + "=" * 100)
    print("SAMPLE EXTRACTIONS (Together.ai)")
    print("=" * 100)

    for i, t_result in enumerate(together_results):
        if not t_result.success or not t_result.raw_response:
            continue

        print(f"\n{'─' * 100}")
        print(f"TEST {i+1}: {t_result.test_name}")
        print(f"{'─' * 100}")

        # Show first 2 commitments
        commits = t_result.raw_response.get("commitments", [])
        if commits:
            print(f"\nCommitments ({len(commits)} total):")
            for j, c in enumerate(commits[:2]):
                print(f"  {j+1}. [{c.get('direction', 'unknown')}] {c.get('title', 'No title')}")
                print(f"     Due: {c.get('due_date_text', 'Not specified')} | Confidence: {c.get('confidence', 0):.1%}")
                if c.get('quoted_text'):
                    print(f"     Quote: \"{c['quoted_text'][:80]}...\"" if len(c.get('quoted_text', '')) > 80 else f"     Quote: \"{c.get('quoted_text')}\"")

        # Show first 2 decisions
        decisions = t_result.raw_response.get("decisions", [])
        if decisions:
            print(f"\nDecisions ({len(decisions)} total):")
            for j, d in enumerate(decisions[:2]):
                print(f"  {j+1}. [{d.get('status', 'unknown')}] {d.get('title', 'No title')}")
                print(f"     Confidence: {d.get('confidence', 0):.1%}")

        # Show risks
        risks = t_result.raw_response.get("risks", [])
        if risks:
            print(f"\nRisks ({len(risks)} total):")
            for j, r in enumerate(risks[:2]):
                print(f"  {j+1}. [{r.get('severity', 'unknown')}] {r.get('title', 'No title')}")

    print("\n" + "=" * 100)
    print("END OF REPORT")
    print("=" * 100)


async def main():
    """Main entry point."""
    print("\n" + "=" * 80)
    print("DROVI INTELLIGENCE - PROVIDER COMPARISON TEST")
    print("=" * 80)

    # Check server is running
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get("http://localhost:8000/health", timeout=5.0)
            health = resp.json()
            print(f"Server Status: {health.get('status', 'unknown')}")
        except Exception as e:
            print(f"ERROR: Server not reachable - {e}")
            return

    # Run tests with Together.ai (current config)
    print("\n" + "-" * 80)
    print("PHASE 1: Testing with Together.ai (Open-Source Models)")
    print("-" * 80)
    together_results = await run_all_tests("Together.ai")

    # Note: To compare with OpenAI, you would need to:
    # 1. Stop the server
    # 2. Change env to use OpenAI
    # 3. Restart server
    # 4. Run tests again
    # For now, we'll just show Together.ai results

    openai_results = []  # Placeholder - would need server restart to compare

    print("\n" + "-" * 80)
    print("PHASE 2: OpenAI comparison")
    print("-" * 80)
    print("Note: To compare with OpenAI, restart the server with TOGETHER_API_KEY unset")
    print("and OPENAI_API_KEY set, then run this script again.")

    # Print comparison report
    print_comparison_report(together_results, openai_results)

    # Save results to JSON
    results_file = "test_results_comparison.json"
    with open(results_file, "w") as f:
        json.dump({
            "timestamp": datetime.now().isoformat(),
            "together_results": [
                {
                    "test_name": r.test_name,
                    "source_type": r.source_type,
                    "success": r.success,
                    "duration_ms": r.duration_ms,
                    "claims_count": r.claims_count,
                    "commitments_count": r.commitments_count,
                    "decisions_count": r.decisions_count,
                    "risks_count": r.risks_count,
                    "confidence": r.overall_confidence,
                    "raw_response": r.raw_response,
                }
                for r in together_results
            ],
        }, f, indent=2, default=str)

    print(f"\nResults saved to: {results_file}")


if __name__ == "__main__":
    asyncio.run(main())
