from __future__ import annotations

from src.streaming.dlq_cli import _build_parser, _extract_dlq_entry


def test_dlq_entry_extracts_world_brain_payload_properties() -> None:
    wrapper = {
        "message_id": "msg-1",
        "payload": {
            "base_topic": "belief.update.v1",
            "original_key": "org-1:belief.update.v1:evt-1",
            "headers": {
                "organization_id": "org-1",
                "event_type": "belief.update.v1",
            },
            "payload": {
                "organization_id": "org-1",
                "event_type": "belief.update.v1",
            },
        },
    }

    entry = _extract_dlq_entry(wrapper)
    assert entry is not None
    assert entry.base_topic == "belief.update.v1"
    assert entry.original_key == "org-1:belief.update.v1:evt-1"
    assert entry.organization_id == "org-1"


def test_dlq_cli_parser_accepts_world_brain_topics() -> None:
    parser = _build_parser()

    inspect_args = parser.parse_args(["inspect", "--topic", "belief.update.v1.dlq", "--limit", "5"])
    replay_args = parser.parse_args(["replay", "--topic", "outcome.realized.v1.dlq", "--partition", "1", "--offset", "42"])
    drop_args = parser.parse_args(["drop", "--topic", "observation.raw.v1.dlq"])

    assert inspect_args.topic == "belief.update.v1.dlq"
    assert inspect_args.limit == 5
    assert replay_args.topic == "outcome.realized.v1.dlq"
    assert replay_args.partition == 1
    assert replay_args.offset == 42
    assert drop_args.topic == "observation.raw.v1.dlq"
