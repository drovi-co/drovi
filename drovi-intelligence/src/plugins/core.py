from __future__ import annotations

from typing import Any

from src.plugins.contracts import ExtensionTypeSpec, UIOTypeSpec


class CorePlugin:
    plugin_id = "core"

    def uio_types(self) -> list[UIOTypeSpec]:
        # Keep this list short and stable. Vertical plugins add namespaced types.
        return [
            UIOTypeSpec(type="commitment", title="Commitment", high_stakes=True),
            UIOTypeSpec(type="decision", title="Decision", high_stakes=True),
            UIOTypeSpec(type="risk", title="Risk", high_stakes=True),
            UIOTypeSpec(type="task", title="Task"),
            UIOTypeSpec(type="claim", title="Claim"),
            UIOTypeSpec(type="brief", title="Brief"),
        ]

    def extension_types(self) -> list[ExtensionTypeSpec]:
        return []

    def validate_extension_payload(
        self,
        *,
        type_name: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        _ = type_name
        return dict(payload or {})

    async def upsert_typed_extension(
        self,
        *,
        session,
        organization_id: str,
        uio_id: str,
        type_name: str,
        payload: dict[str, Any],
    ) -> None:
        _ = (session, organization_id, uio_id, type_name, payload)
        return None

    def migration_revisions(self) -> list[str]:
        return []

    def storage_rules(self) -> dict[str, str]:
        return {}

    def capabilities(self) -> dict[str, bool]:
        return {
            "core.uios": True,
            "core.evidence": True,
            "core.documents": True,
        }

    def ui_hints(self) -> dict[str, object]:
        # Frontends can choose to ignore these; they are non-authoritative hints.
        return {
            "uio_icons": {
                "commitment": "flag",
                "decision": "gavel",
                "risk": "triangle-alert",
                "task": "check-square",
                "claim": "quote",
                "brief": "file-text",
            }
        }
