"""Sensor registry for reality instrumentation."""

from __future__ import annotations

from typing import Iterable

from src.sensors.schemas import (
    PermissionScope,
    SensorCapability,
    SensorCategory,
    SensorDefinition,
    SensorStatus,
)

_SENSOR_REGISTRY: dict[str, SensorDefinition] = {}


def register_sensor(sensor: SensorDefinition) -> None:
    if sensor.id in _SENSOR_REGISTRY:
        raise ValueError(f"Sensor already registered: {sensor.id}")
    _SENSOR_REGISTRY[sensor.id] = sensor


def register_sensors(sensors: Iterable[SensorDefinition]) -> None:
    for sensor in sensors:
        register_sensor(sensor)


def list_sensors() -> list[SensorDefinition]:
    return list(_SENSOR_REGISTRY.values())


def get_sensor(sensor_id: str) -> SensorDefinition | None:
    return _SENSOR_REGISTRY.get(sensor_id)


def clear_registry() -> None:
    _SENSOR_REGISTRY.clear()


def _builtin_sensors() -> list[SensorDefinition]:
    return [
        SensorDefinition(
            id="sensor.email",
            name="Email Streams",
            category=SensorCategory.COMMUNICATION,
            description="Inbound/outbound email events with evidence spans.",
            status=SensorStatus.STABLE,
            data_types=["message", "thread", "attachment"],
            contexts=["commitments", "decisions", "risks"],
        ),
        SensorDefinition(
            id="sensor.slack",
            name="Slack Streams",
            category=SensorCategory.COMMUNICATION,
            description="Slack channels, DMs, and thread events.",
            status=SensorStatus.BETA,
            data_types=["message", "thread"],
            contexts=["commitments", "decisions", "risks"],
        ),
        SensorDefinition(
            id="sensor.calendar",
            name="Calendar",
            category=SensorCategory.CALENDAR,
            description="Calendar events and meeting metadata.",
            status=SensorStatus.BETA,
            data_types=["event", "participant"],
            contexts=["meetings", "attendance"],
        ),
        SensorDefinition(
            id="sensor.meeting.audio",
            name="Meeting Audio",
            category=SensorCategory.MEETINGS,
            description="Audio recordings with diarization and timestamps.",
            status=SensorStatus.EXPERIMENTAL,
            data_types=["audio", "transcript"],
            contexts=["decisions", "commitments"],
        ),
        SensorDefinition(
            id="sensor.docs",
            name="Documents",
            category=SensorCategory.DOCUMENTS,
            description="Document edits, diffs, and approvals.",
            status=SensorStatus.BETA,
            data_types=["doc", "diff", "comment"],
            contexts=["changes", "approvals"],
        ),
        SensorDefinition(
            id="sensor.doc.approval",
            name="Document Approvals",
            category=SensorCategory.DOCUMENTS,
            description="Approval events with reviewer evidence.",
            status=SensorStatus.EXPERIMENTAL,
            data_types=["approval"],
            contexts=["approvals", "decisions"],
        ),
        SensorDefinition(
            id="sensor.code.merge",
            name="Code Merge Events",
            category=SensorCategory.ENGINEERING,
            description="Pull request merges and deploy signals.",
            status=SensorStatus.EXPERIMENTAL,
            data_types=["merge", "deploy"],
            contexts=["delivery", "risk"],
        ),
        SensorDefinition(
            id="sensor.crm",
            name="CRM",
            category=SensorCategory.CRM,
            description="CRM updates, stage changes, and revenue signals.",
            status=SensorStatus.BETA,
            data_types=["deal", "stage", "note"],
            contexts=["revenue", "renewals"],
        ),
        SensorDefinition(
            id="sensor.desktop.context",
            name="Desktop Context",
            category=SensorCategory.DESKTOP,
            description="Active app context and selected text.",
            status=SensorStatus.EXPERIMENTAL,
            origin="desktop",
            requires_local_agent=True,
            capabilities=[
                SensorCapability(
                    name="accessibility_context",
                    description="Read active app metadata and selected text.",
                    scopes=[PermissionScope.ACCESSIBILITY, PermissionScope.READ_METADATA],
                )
            ],
            data_types=["active_app", "selection"],
            contexts=["in_focus"],
        ),
        SensorDefinition(
            id="sensor.desktop.capture",
            name="Focused Window Capture",
            category=SensorCategory.DESKTOP,
            description="User‑approved window capture for visual context.",
            status=SensorStatus.EXPERIMENTAL,
            origin="desktop",
            requires_local_agent=True,
            capabilities=[
                SensorCapability(
                    name="screen_capture",
                    description="Capture focused window for context.",
                    scopes=[PermissionScope.SCREEN_CAPTURE],
                ),
                SensorCapability(
                    name="ocr",
                    description="Extract text from captured frames.",
                    scopes=[PermissionScope.OCR],
                ),
            ],
            data_types=["image", "ocr_text"],
            contexts=["visual"],
        ),
    ]


register_sensors(_builtin_sensors())
