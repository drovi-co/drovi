from __future__ import annotations

from src.agentos.presence.common import build_continuity_key, build_external_thread_id
from src.agentos.presence.service import AgentPresenceService


def test_parse_channel_action_extracts_approval_command() -> None:
    service = AgentPresenceService()
    parsed = service.parse_channel_action(body_text="approve agapr_12345: go ahead", channel_type="teams")

    assert parsed.intent == "approval"
    assert parsed.approval_id == "agapr_12345"
    assert parsed.approval_decision == "approved"
    assert parsed.approval_reason == "go ahead"


def test_parse_channel_action_detects_task_and_mentions() -> None:
    service = AgentPresenceService()
    parsed = service.parse_channel_action(
        body_text="@alex please draft the weekly update and send it to finance",
        channel_type="slack",
    )

    assert parsed.intent == "task"
    assert "alex" in parsed.mentions
    assert parsed.confidence > 0.7


def test_build_external_thread_id_prefers_channel_native_ids() -> None:
    slack_thread = build_external_thread_id(
        channel_type="slack",
        sender="user@example.com",
        subject="",
        explicit_target=None,
        raw_payload={"thread_ts": "1715085622.010100"},
    )
    teams_thread = build_external_thread_id(
        channel_type="teams",
        sender="user@example.com",
        subject="",
        explicit_target=None,
        raw_payload={"conversation_id": "19:abc123@thread.v2"},
    )

    assert slack_thread == "1715085622.010100"
    assert teams_thread == "19:abc123@thread.v2"


def test_build_continuity_key_is_stable() -> None:
    key_a = build_continuity_key(
        channel_type="email",
        sender="user@example.com",
        channel_target="agent@agents.drovi.co",
        subject="Weekly Report",
    )
    key_b = build_continuity_key(
        channel_type="email",
        sender="user@example.com",
        channel_target="agent@agents.drovi.co",
        subject="Weekly   Report",
    )

    assert key_a == key_b
