"""
DLQ Tooling (Inspect / Replay / Drop)

Phase 0.5 requires operator-friendly tooling for Kafka DLQs so poison messages
do not wedge consumer groups and can be replayed deterministically.

Run inside docker (recommended):
  docker exec -it drovi-intel-api python -m src.streaming.dlq_cli inspect --topic raw.connector.events.dlq --limit 5
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import structlog

from src.audit.log import record_audit_event
from src.config import get_settings
from src.streaming.kafka_producer import get_kafka_producer

logger = structlog.get_logger()


@dataclass(frozen=True)
class DlqEntry:
    wrapper: dict[str, Any]
    payload: dict[str, Any]

    @property
    def base_topic(self) -> str | None:
        return self.payload.get("base_topic") if isinstance(self.payload, dict) else None

    @property
    def original_key(self) -> str | None:
        return self.payload.get("original_key") if isinstance(self.payload, dict) else None

    @property
    def original_headers(self) -> dict[str, str | None]:
        headers = self.payload.get("headers") if isinstance(self.payload, dict) else None
        if isinstance(headers, dict):
            # Keep as str|None for filtering later.
            return {str(k): (str(v) if v is not None else None) for k, v in headers.items()}
        return {}

    @property
    def original_payload(self) -> Any:
        if not isinstance(self.payload, dict):
            return None
        return self.payload.get("payload")

    @property
    def organization_id(self) -> str:
        # Best-effort: try payload, then headers, else internal.
        try:
            if isinstance(self.original_payload, dict) and self.original_payload.get("organization_id"):
                return str(self.original_payload["organization_id"])
        except Exception:
            pass
        header_org = self.original_headers.get("organization_id")
        if header_org:
            return str(header_org)
        return "internal"


def _load_wrapper(raw_bytes: bytes | None) -> dict[str, Any] | None:
    if not raw_bytes:
        return None
    try:
        return json.loads(raw_bytes.decode("utf-8"))
    except Exception:
        return None


def _extract_dlq_entry(wrapper: dict[str, Any]) -> DlqEntry | None:
    payload = wrapper.get("payload")
    if not isinstance(payload, dict):
        return None
    return DlqEntry(wrapper=wrapper, payload=payload)


def _build_consumer(*, topic: str, group_id: str, from_beginning: bool) -> Any:
    """Construct a confluent_kafka.Consumer configured for DLQ tooling."""
    try:
        from confluent_kafka import Consumer
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("confluent-kafka is required for DLQ tooling") from exc

    settings = get_settings()
    consumer = Consumer(
        {
            "bootstrap.servers": settings.kafka_bootstrap_servers,
            "group.id": group_id,
            "security.protocol": settings.kafka_security_protocol,
            "auto.offset.reset": "earliest" if from_beginning else "latest",
            "enable.auto.commit": False,
        }
    )
    consumer.subscribe([topic])
    return consumer


def _assign_exact_offset(consumer: Any, *, topic: str, partition: int, offset: int) -> None:
    from confluent_kafka import TopicPartition

    consumer.assign([TopicPartition(topic, partition, offset)])


def _poll_one(consumer: Any, *, timeout: float = 5.0) -> Any:
    msg = consumer.poll(timeout=timeout)
    if msg is None:
        return None
    if msg.error():
        raise RuntimeError(str(msg.error()))
    return msg


async def _audit(action: str, entry: DlqEntry, *, extra: dict[str, Any]) -> None:
    try:
        await record_audit_event(
            organization_id=entry.organization_id,
            action=action,
            actor_type="system",
            actor_id=None,
            resource_type="kafka.dlq",
            resource_id=str(entry.base_topic or "unknown"),
            metadata=extra,
        )
    except Exception as exc:
        logger.warning("DLQ audit log failed", action=action, error=str(exc))


def _print_json(data: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(data, default=str) + "\n")
    sys.stdout.flush()


async def cmd_inspect(args: argparse.Namespace) -> int:
    consumer = _build_consumer(
        topic=args.topic,
        group_id=f"drovi-dlq-inspect:{uuid4()}",
        from_beginning=bool(args.from_beginning),
    )
    try:
        seen = 0
        while seen < int(args.limit):
            msg = _poll_one(consumer, timeout=3.0)
            if msg is None:
                break
            wrapper = _load_wrapper(msg.value())
            if not wrapper:
                continue
            entry = _extract_dlq_entry(wrapper)
            if not entry:
                continue
            _print_json(
                {
                    "topic": msg.topic(),
                    "partition": msg.partition(),
                    "offset": msg.offset(),
                    "key": msg.key().decode("utf-8") if msg.key() else None,
                    "failed_at": entry.payload.get("failed_at"),
                    "base_topic": entry.base_topic,
                    "error": entry.payload.get("error"),
                    "retry_count": entry.payload.get("retry_count"),
                    "organization_id": entry.organization_id,
                }
            )
            seen += 1
        return 0
    finally:
        consumer.close()


async def cmd_replay(args: argparse.Namespace) -> int:
    consumer = _build_consumer(
        topic=args.topic,
        group_id=f"drovi-dlq-replay:{uuid4()}",
        from_beginning=True,
    )
    try:
        if args.offset is not None:
            _assign_exact_offset(consumer, topic=args.topic, partition=int(args.partition), offset=int(args.offset))

        msg = _poll_one(consumer, timeout=5.0)
        if msg is None:
            raise RuntimeError("No message found")

        wrapper = _load_wrapper(msg.value())
        if not wrapper:
            raise RuntimeError("Failed to decode message JSON")
        entry = _extract_dlq_entry(wrapper)
        if not entry:
            raise RuntimeError("Message is not a Drovi DLQ envelope")
        if not entry.base_topic:
            raise RuntimeError("Missing base_topic in DLQ payload")

        original_payload = entry.original_payload
        if not isinstance(original_payload, dict):
            raise RuntimeError("DLQ payload has no structured original payload to replay")

        producer = await get_kafka_producer()

        # Preserve original headers where possible, but reset retry counts.
        replay_headers = {
            **{k: v for k, v in entry.original_headers.items() if v is not None},
            "drovi_retry_count": "0",
            "drovi_replay": "1",
            "drovi_replay_from_dlq_topic": args.topic,
        }

        await producer.produce(
            topic=entry.base_topic,
            value=original_payload,
            key=entry.original_key,
            headers=replay_headers,
            wait_for_delivery=True,
        )

        # Ack the DLQ message by committing its offset.
        consumer.commit(asynchronous=False, message=msg)

        await _audit(
            "kafka.dlq.replay",
            entry,
            extra={
                "dlq_topic": args.topic,
                "partition": msg.partition(),
                "offset": msg.offset(),
                "base_topic": entry.base_topic,
            },
        )

        _print_json(
            {
                "status": "replayed",
                "dlq_topic": args.topic,
                "partition": msg.partition(),
                "offset": msg.offset(),
                "base_topic": entry.base_topic,
            }
        )
        return 0
    finally:
        consumer.close()


async def cmd_drop(args: argparse.Namespace) -> int:
    consumer = _build_consumer(
        topic=args.topic,
        group_id=f"drovi-dlq-drop:{uuid4()}",
        from_beginning=True,
    )
    try:
        if args.offset is not None:
            _assign_exact_offset(consumer, topic=args.topic, partition=int(args.partition), offset=int(args.offset))

        msg = _poll_one(consumer, timeout=5.0)
        if msg is None:
            raise RuntimeError("No message found")

        wrapper = _load_wrapper(msg.value())
        entry = _extract_dlq_entry(wrapper) if wrapper else None

        # Commit offset to drop it.
        consumer.commit(asynchronous=False, message=msg)

        if entry:
            await _audit(
                "kafka.dlq.drop",
                entry,
                extra={
                    "dlq_topic": args.topic,
                    "partition": msg.partition(),
                    "offset": msg.offset(),
                    "base_topic": entry.base_topic,
                    "error": entry.payload.get("error"),
                },
            )

        _print_json(
            {
                "status": "dropped",
                "dlq_topic": args.topic,
                "partition": msg.partition(),
                "offset": msg.offset(),
                "base_topic": entry.base_topic if entry else None,
            }
        )
        return 0
    finally:
        consumer.close()


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="drovi-dlq-cli", description="Inspect/replay/drop DLQ messages")
    sub = parser.add_subparsers(dest="cmd", required=True)

    inspect_p = sub.add_parser("inspect", help="Inspect messages in a DLQ topic")
    inspect_p.add_argument("--topic", required=True)
    inspect_p.add_argument("--limit", type=int, default=10)
    inspect_p.add_argument("--from-beginning", action="store_true", default=False)
    inspect_p.set_defaults(func=cmd_inspect)

    replay_p = sub.add_parser("replay", help="Replay a DLQ message back to its base topic and ack it")
    replay_p.add_argument("--topic", required=True)
    replay_p.add_argument("--partition", type=int, default=0)
    replay_p.add_argument("--offset", type=int, default=None)
    replay_p.set_defaults(func=cmd_replay)

    drop_p = sub.add_parser("drop", help="Drop (ack) a DLQ message without replay and audit the action")
    drop_p.add_argument("--topic", required=True)
    drop_p.add_argument("--partition", type=int, default=0)
    drop_p.add_argument("--offset", type=int, default=None)
    drop_p.set_defaults(func=cmd_drop)

    return parser


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    parser = _build_parser()
    args = parser.parse_args(argv)

    import asyncio
    from src.db.client import close_db, init_db

    async def _run() -> int:
        # Only initialize Postgres when we might write audit logs.
        needs_db = getattr(args, "cmd", None) in {"replay", "drop"}
        if needs_db:
            await init_db()
        try:
            return await args.func(args)
        finally:
            if needs_db:
                await close_db()

    return asyncio.run(_run())


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
