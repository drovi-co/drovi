"""
Organization Personalization Profiles.

Stores per-organization extraction context (language, jargon, roles, projects)
that can be injected into prompts for higher precision.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import aiofiles
from pydantic import BaseModel, Field

from src.config import get_settings


def _dedupe_terms(terms: list[str], max_terms: int = 50) -> list[str]:
    cleaned = []
    seen = set()
    for term in terms:
        if not term:
            continue
        normalized = str(term).strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(normalized)
        if len(cleaned) >= max_terms:
            break
    return cleaned


class OrgProfile(BaseModel):
    """Per-organization extraction profile."""

    organization_id: str
    preferred_language: str | None = None
    jargon_terms: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    project_names: list[str] = Field(default_factory=list)
    domain_terms: list[str] = Field(default_factory=list)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    def merge_updates(self, updates: "OrgProfileUpdate") -> "OrgProfile":
        data = self.model_dump()
        if updates.preferred_language is not None:
            data["preferred_language"] = updates.preferred_language
        if updates.jargon_terms is not None:
            data["jargon_terms"] = _dedupe_terms(self.jargon_terms + updates.jargon_terms)
        if updates.roles is not None:
            data["roles"] = _dedupe_terms(self.roles + updates.roles)
        if updates.project_names is not None:
            data["project_names"] = _dedupe_terms(self.project_names + updates.project_names)
        if updates.domain_terms is not None:
            data["domain_terms"] = _dedupe_terms(self.domain_terms + updates.domain_terms)
        data["updated_at"] = datetime.utcnow()
        return OrgProfile(**data)


class OrgProfileUpdate(BaseModel):
    """Partial updates to an organization profile."""

    preferred_language: str | None = None
    jargon_terms: list[str] | None = None
    roles: list[str] | None = None
    project_names: list[str] | None = None
    domain_terms: list[str] | None = None


class OrgProfileStore:
    """File-backed store for organization profiles."""

    def __init__(self, base_path: str | None = None):
        settings = get_settings()
        root = Path(base_path or settings.training_data_path)
        self._dir = root / "org_profiles"
        self._dir.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, OrgProfile] = {}

    def _path_for(self, organization_id: str) -> Path:
        return self._dir / f"{organization_id}.json"

    async def get_profile(self, organization_id: str) -> OrgProfile:
        if organization_id in self._cache:
            return self._cache[organization_id]

        path = self._path_for(organization_id)
        if not path.exists():
            profile = OrgProfile(organization_id=organization_id)
            self._cache[organization_id] = profile
            return profile

        async with aiofiles.open(path, "r") as f:
            content = await f.read()
        profile = OrgProfile.model_validate_json(content)
        self._cache[organization_id] = profile
        return profile

    async def save_profile(self, profile: OrgProfile) -> OrgProfile:
        profile.updated_at = datetime.utcnow()
        path = self._path_for(profile.organization_id)
        async with aiofiles.open(path, "w") as f:
            await f.write(profile.model_dump_json(indent=2))
        self._cache[profile.organization_id] = profile
        return profile

    async def update_profile(self, organization_id: str, updates: OrgProfileUpdate) -> OrgProfile:
        profile = await self.get_profile(organization_id)
        updated = profile.merge_updates(updates)
        return await self.save_profile(updated)


_profile_store: OrgProfileStore | None = None


def get_profile_store() -> OrgProfileStore:
    global _profile_store
    if _profile_store is None:
        _profile_store = OrgProfileStore()
    return _profile_store


def format_profile_for_prompt(profile: OrgProfile | None) -> str | None:
    if not profile:
        return None

    parts: list[str] = []
    if profile.preferred_language:
        parts.append(f"Preferred language: {profile.preferred_language}")
    if profile.project_names:
        parts.append(f"Projects: {', '.join(profile.project_names[:8])}")
    if profile.jargon_terms:
        parts.append(f"Jargon: {', '.join(profile.jargon_terms[:8])}")
    if profile.roles:
        parts.append(f"Roles: {', '.join(profile.roles[:8])}")
    if profile.domain_terms:
        parts.append(f"Domain terms: {', '.join(profile.domain_terms[:8])}")

    return "\n".join(parts) if parts else None
