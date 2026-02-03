"""Personalization utilities for organization-specific extraction context."""

from .profile import (
    OrgProfile,
    OrgProfileUpdate,
    OrgProfileStore,
    get_profile_store,
    format_profile_for_prompt,
)


async def get_org_profile(organization_id: str) -> OrgProfile:
    store = get_profile_store()
    return await store.get_profile(organization_id)


async def update_org_profile(organization_id: str, updates: OrgProfileUpdate) -> OrgProfile:
    store = get_profile_store()
    return await store.update_profile(organization_id, updates)


__all__ = [
    "OrgProfile",
    "OrgProfileUpdate",
    "OrgProfileStore",
    "get_profile_store",
    "format_profile_for_prompt",
    "get_org_profile",
    "update_org_profile",
]
