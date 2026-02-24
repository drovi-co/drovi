from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.crawlers.policy import evaluate_crawl_policy, request_legal_hold, request_takedown

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


async def test_policy_denies_domain_from_global_denylist(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.crawlers.policy.get_settings",
        lambda: SimpleNamespace(
            crawl_domain_allowlist=[],
            crawl_domain_denylist=["blocked.example.com"],
            crawl_robots_enforced=False,
            crawl_robots_timeout_seconds=5.0,
            crawl_user_agent="DroviCrawler/1.0",
        ),
    )
    monkeypatch.setattr(
        "src.crawlers.policy.list_policy_rules",
        AsyncMock(return_value=[]),
    )

    decision = await evaluate_crawl_policy(
        organization_id="org_test",
        url="https://blocked.example.com/news",
    )

    assert decision.allowed is False
    assert decision.policy_state == "denylist_blocked"


async def test_policy_applies_legal_hold_rule(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "src.crawlers.policy.get_settings",
        lambda: SimpleNamespace(
            crawl_domain_allowlist=[],
            crawl_domain_denylist=[],
            crawl_robots_enforced=False,
            crawl_robots_timeout_seconds=5.0,
            crawl_user_agent="DroviCrawler/1.0",
        ),
    )
    monkeypatch.setattr(
        "src.crawlers.policy.list_policy_rules",
        AsyncMock(
            return_value=[
                {
                    "id": "rule_1",
                    "rule_type": "legal_hold_url",
                    "scope": "https://example.com/matter",
                    "action": "hold",
                    "reason": "Matter under litigation hold",
                    "expires_at": None,
                }
            ]
        ),
    )

    decision = await evaluate_crawl_policy(
        organization_id="org_test",
        url="https://example.com/matter/123",
    )

    assert decision.allowed is False
    assert decision.policy_state == "legal_hold"
    assert decision.matched_rule_id == "rule_1"


async def test_takedown_and_legal_hold_workflows_apply_policy_and_audit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "src.crawlers.policy.upsert_policy_rule",
        AsyncMock(return_value={"id": "rule_x"}),
    )
    monkeypatch.setattr(
        "src.crawlers.policy.apply_policy_to_frontier",
        AsyncMock(return_value=3),
    )
    audit_log = AsyncMock(return_value="audit_1")
    monkeypatch.setattr("src.crawlers.policy.write_audit_log", audit_log)

    takedown = await request_takedown(
        organization_id="org_test",
        scope="example.com",
        reason="Licensing revocation",
        actor="api_key_1",
    )
    legal_hold = await request_legal_hold(
        organization_id="org_test",
        scope="https://example.com/case/5",
        reason="Court order",
        actor="api_key_1",
    )

    assert takedown["affected_frontier_entries"] == 3
    assert legal_hold["affected_frontier_entries"] == 3
    assert audit_log.await_count == 2
