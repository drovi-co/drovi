"""
Pilot Permissions (Team Model)

Centralized permission matrix for the pilot surface.

Role semantics:
- pilot_owner: full control (same permissions as admin for now).
- pilot_admin: manage org + sources + members.
- pilot_member: can connect sources and work with shared/private memory they own.
- pilot_viewer: read-only, cannot connect sources or change org settings.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal


PilotRole = Literal["pilot_owner", "pilot_admin", "pilot_member", "pilot_viewer"]


class Permission(str, Enum):
    INVITE_MEMBERS = "invite_members"
    REMOVE_MEMBERS = "remove_members"
    CONNECT_SOURCES = "connect_sources"
    CHANGE_SOURCE_VISIBILITY = "change_source_visibility"
    VIEW_PRIVATE_SOURCES = "view_private_sources"
    EXPORT_DATA = "export_data"
    MANAGE_ORG_SETTINGS = "manage_org_settings"
    MANAGE_ORG_POLICIES = "manage_org_policies"


PERMISSION_MATRIX: dict[PilotRole, set[Permission]] = {
    "pilot_owner": {
        Permission.INVITE_MEMBERS,
        Permission.REMOVE_MEMBERS,
        Permission.CONNECT_SOURCES,
        Permission.CHANGE_SOURCE_VISIBILITY,
        Permission.VIEW_PRIVATE_SOURCES,
        Permission.EXPORT_DATA,
        Permission.MANAGE_ORG_SETTINGS,
        Permission.MANAGE_ORG_POLICIES,
    },
    "pilot_admin": {
        Permission.INVITE_MEMBERS,
        Permission.REMOVE_MEMBERS,
        Permission.CONNECT_SOURCES,
        Permission.CHANGE_SOURCE_VISIBILITY,
        Permission.VIEW_PRIVATE_SOURCES,
        Permission.EXPORT_DATA,
        Permission.MANAGE_ORG_SETTINGS,
        Permission.MANAGE_ORG_POLICIES,
    },
    "pilot_member": {
        Permission.CONNECT_SOURCES,
        Permission.CHANGE_SOURCE_VISIBILITY,
        Permission.VIEW_PRIVATE_SOURCES,
    },
    "pilot_viewer": {
        Permission.VIEW_PRIVATE_SOURCES,
    },
}


def is_admin_role(role: str | None) -> bool:
    return role in ("pilot_owner", "pilot_admin")


def has_permission(role: str | None, permission: Permission) -> bool:
    if role not in PERMISSION_MATRIX:
        return False
    return permission in PERMISSION_MATRIX[role]  # type: ignore[index]

