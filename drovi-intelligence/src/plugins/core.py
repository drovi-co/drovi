from __future__ import annotations

from src.plugins.contracts import UIOTypeSpec


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

