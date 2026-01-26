#!/usr/bin/env python3
"""
Direct Provider Comparison Script

Runs the same extraction using both Together.ai and OpenAI directly,
comparing the results side by side.
"""

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

# Add parent to path
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load environment variables from .env
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

from src.llm.providers import Provider, ModelTier, PROVIDER_CONFIGS


@dataclass
class ExtractionResult:
    """Result from a single extraction."""
    provider: str
    model: str
    success: bool
    duration_ms: int
    claims: list = field(default_factory=list)
    commitments: list = field(default_factory=list)
    decisions: list = field(default_factory=list)
    risks: list = field(default_factory=list)
    error: str | None = None


# Test content - simplified for direct comparison
TEST_EMAIL = """
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
"""


async def extract_with_together(content: str) -> ExtractionResult:
    """Run extraction using Together.ai (Llama 4 Maverick)."""
    from together import AsyncTogether

    api_key = os.environ.get("TOGETHER_API_KEY")
    if not api_key:
        return ExtractionResult(
            provider="Together.ai",
            model="N/A",
            success=False,
            duration_ms=0,
            error="TOGETHER_API_KEY not set"
        )

    client = AsyncTogether(api_key=api_key)
    model = PROVIDER_CONFIGS[Provider.TOGETHER].models[ModelTier.BALANCED]

    prompt = f"""Analyze this email and extract structured intelligence.

Return a JSON object with:
- claims: Array of factual statements (title, type, confidence 0-1)
- commitments: Array of obligations (title, direction: owed_by_me/owed_to_me, due_date_text, confidence 0-1)
- decisions: Array of decisions made (title, status: made/pending, confidence 0-1)
- risks: Array of potential risks (title, severity: low/medium/high, confidence 0-1)

Email:
{content}

Return ONLY valid JSON, no other text."""

    start_time = time.time()
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are an expert intelligence analyst. Extract structured data from communications."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.0,
            max_tokens=4096,
            response_format={"type": "json_object"},
        )
        duration_ms = int((time.time() - start_time) * 1000)

        text = response.choices[0].message.content
        data = json.loads(text)

        return ExtractionResult(
            provider="Together.ai",
            model=model,
            success=True,
            duration_ms=duration_ms,
            claims=data.get("claims", []),
            commitments=data.get("commitments", []),
            decisions=data.get("decisions", []),
            risks=data.get("risks", []),
        )
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return ExtractionResult(
            provider="Together.ai",
            model=model,
            success=False,
            duration_ms=duration_ms,
            error=str(e)
        )


async def extract_with_openai(content: str) -> ExtractionResult:
    """Run extraction using OpenAI (GPT-4o)."""
    import openai

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return ExtractionResult(
            provider="OpenAI",
            model="N/A",
            success=False,
            duration_ms=0,
            error="OPENAI_API_KEY not set"
        )

    client = openai.AsyncOpenAI(api_key=api_key)
    model = "gpt-4o"

    prompt = f"""Analyze this email and extract structured intelligence.

Return a JSON object with:
- claims: Array of factual statements (title, type, confidence 0-1)
- commitments: Array of obligations (title, direction: owed_by_me/owed_to_me, due_date_text, confidence 0-1)
- decisions: Array of decisions made (title, status: made/pending, confidence 0-1)
- risks: Array of potential risks (title, severity: low/medium/high, confidence 0-1)

Email:
{content}

Return ONLY valid JSON, no other text."""

    start_time = time.time()
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are an expert intelligence analyst. Extract structured data from communications."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.0,
            max_tokens=4096,
            response_format={"type": "json_object"},
        )
        duration_ms = int((time.time() - start_time) * 1000)

        text = response.choices[0].message.content
        data = json.loads(text)

        return ExtractionResult(
            provider="OpenAI",
            model=model,
            success=True,
            duration_ms=duration_ms,
            claims=data.get("claims", []),
            commitments=data.get("commitments", []),
            decisions=data.get("decisions", []),
            risks=data.get("risks", []),
        )
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return ExtractionResult(
            provider="OpenAI",
            model=model,
            success=False,
            duration_ms=duration_ms,
            error=str(e)
        )


def print_result(result: ExtractionResult):
    """Print a single extraction result."""
    print(f"\n{'='*60}")
    print(f"Provider: {result.provider}")
    print(f"Model: {result.model}")
    print(f"Success: {result.success}")
    print(f"Duration: {result.duration_ms}ms")

    if result.error:
        print(f"Error: {result.error}")
        return

    print(f"\nClaims ({len(result.claims)}):")
    for c in result.claims[:3]:
        print(f"  - {c.get('title', 'No title')[:50]} (conf: {c.get('confidence', 0):.0%})")
    if len(result.claims) > 3:
        print(f"  ... and {len(result.claims) - 3} more")

    print(f"\nCommitments ({len(result.commitments)}):")
    for c in result.commitments[:3]:
        direction = c.get('direction', 'unknown')
        print(f"  - [{direction}] {c.get('title', 'No title')[:40]}")
        print(f"    Due: {c.get('due_date_text', 'Not specified')} | Conf: {c.get('confidence', 0):.0%}")
    if len(result.commitments) > 3:
        print(f"  ... and {len(result.commitments) - 3} more")

    print(f"\nDecisions ({len(result.decisions)}):")
    for d in result.decisions[:3]:
        status = d.get('status', 'unknown')
        print(f"  - [{status}] {d.get('title', 'No title')[:50]} (conf: {d.get('confidence', 0):.0%})")
    if len(result.decisions) > 3:
        print(f"  ... and {len(result.decisions) - 3} more")

    print(f"\nRisks ({len(result.risks)}):")
    for r in result.risks[:3]:
        severity = r.get('severity', 'unknown')
        print(f"  - [{severity}] {r.get('title', 'No title')[:50]}")
    if len(result.risks) > 3:
        print(f"  ... and {len(result.risks) - 3} more")


def print_comparison(together: ExtractionResult, openai: ExtractionResult):
    """Print side-by-side comparison."""
    print("\n" + "=" * 80)
    print("SIDE-BY-SIDE COMPARISON: Together.ai (Llama 4) vs OpenAI (GPT-4o)")
    print("=" * 80)

    print(f"\n{'Metric':<30} {'Together.ai':<25} {'OpenAI':<25}")
    print("-" * 80)
    print(f"{'Model':<30} {together.model[:23]:<25} {openai.model:<25}")
    print(f"{'Success':<30} {str(together.success):<25} {str(openai.success):<25}")
    print(f"{'Duration (ms)':<30} {together.duration_ms:<25} {openai.duration_ms:<25}")
    print(f"{'Claims Count':<30} {len(together.claims):<25} {len(openai.claims):<25}")
    print(f"{'Commitments Count':<30} {len(together.commitments):<25} {len(openai.commitments):<25}")
    print(f"{'Decisions Count':<30} {len(together.decisions):<25} {len(openai.decisions):<25}")
    print(f"{'Risks Count':<30} {len(together.risks):<25} {len(openai.risks):<25}")

    # Calculate average confidence
    t_conf = sum(c.get('confidence', 0) for c in together.commitments) / max(len(together.commitments), 1)
    o_conf = sum(c.get('confidence', 0) for c in openai.commitments) / max(len(openai.commitments), 1)
    t_conf_str = f"{t_conf:.1%}"
    o_conf_str = f"{o_conf:.1%}"
    print(f"{'Avg Commitment Conf':<30} {t_conf_str:<25} {o_conf_str:<25}")

    # Speed comparison
    if together.duration_ms > 0 and openai.duration_ms > 0:
        speed_ratio = openai.duration_ms / together.duration_ms
        if speed_ratio > 1:
            print(f"\nTogether.ai is {speed_ratio:.1f}x faster than OpenAI")
        else:
            print(f"\nOpenAI is {1/speed_ratio:.1f}x faster than Together.ai")

    # Quality comparison
    print("\n" + "=" * 80)
    print("QUALITY ANALYSIS")
    print("=" * 80)

    # Compare commitments extracted
    print("\nCommitments Comparison:")
    print(f"  Together.ai found: {len(together.commitments)} commitments")
    print(f"  OpenAI found: {len(openai.commitments)} commitments")

    # Check for overlapping content
    t_titles = {c.get('title', '').lower()[:30] for c in together.commitments}
    o_titles = {c.get('title', '').lower()[:30] for c in openai.commitments}
    overlap = t_titles & o_titles
    print(f"  Overlap (same commitments found): {len(overlap)}")

    print("\nExpected commitments from the email:")
    print("  1. UI mockups by Friday - @Mike")
    print("  2. Marketing copy by Jan 31st - @Jennifer")
    print("  3. Review security audit by next Wednesday - Sarah")
    print("  4. API v2 migration by Feb 10th - Engineering")
    print("  5. Budget projections by EOD Monday - @David")

    t_found = sum(1 for c in together.commitments if any(
        x in c.get('title', '').lower()
        for x in ['mockup', 'marketing', 'security', 'api', 'budget']
    ))
    o_found = sum(1 for c in openai.commitments if any(
        x in c.get('title', '').lower()
        for x in ['mockup', 'marketing', 'security', 'api', 'budget']
    ))

    print(f"\n  Together.ai correctly identified: {t_found}/5 key commitments")
    print(f"  OpenAI correctly identified: {o_found}/5 key commitments")


async def main():
    """Main entry point."""
    print("=" * 80)
    print("DROVI INTELLIGENCE - DIRECT PROVIDER COMPARISON")
    print("=" * 80)
    print(f"Timestamp: {datetime.now().isoformat()}")
    print("\nRunning identical extraction on both providers...")

    # Run both providers in parallel
    print("\n[1/2] Running Together.ai extraction...")
    together_result = await extract_with_together(TEST_EMAIL)
    print(f"      Done in {together_result.duration_ms}ms")

    print("[2/2] Running OpenAI extraction...")
    openai_result = await extract_with_openai(TEST_EMAIL)
    print(f"      Done in {openai_result.duration_ms}ms")

    # Print individual results
    print_result(together_result)
    print_result(openai_result)

    # Print comparison
    print_comparison(together_result, openai_result)

    # Save results
    results = {
        "timestamp": datetime.now().isoformat(),
        "test_content": "Complex Email - Multiple Commitments & Decisions",
        "together": {
            "model": together_result.model,
            "success": together_result.success,
            "duration_ms": together_result.duration_ms,
            "claims": together_result.claims,
            "commitments": together_result.commitments,
            "decisions": together_result.decisions,
            "risks": together_result.risks,
            "error": together_result.error,
        },
        "openai": {
            "model": openai_result.model,
            "success": openai_result.success,
            "duration_ms": openai_result.duration_ms,
            "claims": openai_result.claims,
            "commitments": openai_result.commitments,
            "decisions": openai_result.decisions,
            "risks": openai_result.risks,
            "error": openai_result.error,
        }
    }

    with open("direct_comparison_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to: direct_comparison_results.json")


if __name__ == "__main__":
    asyncio.run(main())
