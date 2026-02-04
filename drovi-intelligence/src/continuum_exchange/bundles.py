"""Continuum Exchange: packaging, signing, and installation."""

from __future__ import annotations

import hmac
import hashlib
import json
from datetime import datetime
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field
from sqlalchemy import text

from src.actuation.registry import list_drivers
from src.continuum.dsl import ContinuumDefinition
from src.continuum.manager import create_continuum
from src.db.client import get_db_session
from src.db.rls import rls_context
from src.config import get_settings


class BundleManifest(BaseModel):
    name: str
    version: str
    description: str | None = None
    continuum_definition: dict[str, Any]
    required_drivers: list[str] = Field(default_factory=list)
    policy_requirements: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


def _serialize_manifest(manifest: BundleManifest) -> str:
    return json.dumps(manifest.model_dump(), sort_keys=True, separators=(",", ":"))


def sign_manifest(manifest: BundleManifest, secret: str) -> str:
    payload = _serialize_manifest(manifest).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_manifest(manifest: BundleManifest, signature: str, secret: str) -> bool:
    expected = sign_manifest(manifest, secret)
    return hmac.compare_digest(expected, signature)


async def publish_bundle(
    *,
    organization_id: str,
    manifest: BundleManifest,
    signature: str | None,
    created_by: str | None,
    visibility: str = "private",
    governance_status: str = "pending",
    price_cents: int | None = None,
    currency: str | None = None,
    billing_model: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    secret = settings.continuum_exchange_signing_secret or "dev-exchange-secret"
    signature = signature or sign_manifest(manifest, secret)

    bundle_id = str(uuid4())
    version_id = str(uuid4())
    now = datetime.utcnow()

    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO continuum_bundle (
                        id, organization_id, name, description, created_by,
                        created_at, updated_at, visibility, governance_status,
                        price_cents, currency, billing_model
                    ) VALUES (
                        :id, :org_id, :name, :description, :created_by,
                        :created_at, :updated_at, :visibility, :governance_status,
                        :price_cents, :currency, :billing_model
                    )
                    """
                ),
                {
                    "id": bundle_id,
                    "org_id": organization_id,
                    "name": manifest.name,
                    "description": manifest.description,
                    "created_by": created_by,
                    "created_at": now,
                    "updated_at": now,
                    "visibility": visibility,
                    "governance_status": governance_status,
                    "price_cents": price_cents,
                    "currency": currency,
                    "billing_model": billing_model,
                },
            )

            await session.execute(
                text(
                    """
                    INSERT INTO continuum_bundle_version (
                        id, bundle_id, organization_id, version,
                        manifest, signature, created_at
                    ) VALUES (
                        :id, :bundle_id, :org_id, :version,
                        :manifest, :signature, :created_at
                    )
                    """
                ),
                {
                    "id": version_id,
                    "bundle_id": bundle_id,
                    "org_id": organization_id,
                    "version": manifest.version,
                    "manifest": manifest.model_dump(),
                    "signature": signature,
                    "created_at": now,
                },
            )

    return {
        "bundle_id": bundle_id,
        "version": manifest.version,
        "signature": signature,
    }


async def install_bundle(
    *,
    organization_id: str,
    bundle_id: str,
    version: str | None,
    installed_by: str | None,
) -> dict[str, Any]:
    settings = get_settings()
    secret = settings.continuum_exchange_signing_secret or "dev-exchange-secret"

    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT v.id, v.manifest, v.signature, v.version,
                           b.visibility, b.governance_status, b.organization_id
                    FROM continuum_bundle_version v
                    JOIN continuum_bundle b ON b.id = v.bundle_id
                    WHERE v.bundle_id = :bundle_id
                      AND (:version IS NULL OR v.version = :version)
                    ORDER BY v.created_at DESC
                    LIMIT 1
                    """
                ),
                {"bundle_id": bundle_id, "version": version},
            )
            row = result.fetchone()
            if not row:
                raise ValueError("Bundle version not found")

    manifest = BundleManifest.model_validate(row.manifest)
    if not verify_manifest(manifest, row.signature, secret):
        raise ValueError("Bundle signature invalid")

    available_drivers = set(list_drivers())
    missing = [driver for driver in manifest.required_drivers if driver not in available_drivers]
    if missing:
        raise ValueError(f"Missing required drivers: {', '.join(missing)}")

    if row.visibility in {"public", "curated"} and row.governance_status != "approved":
        raise ValueError("Bundle not approved for distribution")

    definition = ContinuumDefinition.model_validate(manifest.continuum_definition)
    created = await create_continuum(
        organization_id=organization_id,
        definition=definition,
        created_by=installed_by,
        activate=True,
    )

    install_id = str(uuid4())
    now = datetime.utcnow()
    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO continuum_bundle_installation (
                        id, bundle_id, organization_id, bundle_version_id,
                        continuum_id, installed_by, installed_at
                    ) VALUES (
                        :id, :bundle_id, :org_id, :bundle_version_id,
                        :continuum_id, :installed_by, :installed_at
                    )
                    """
                ),
                {
                    "id": install_id,
                    "bundle_id": bundle_id,
                    "org_id": organization_id,
                    "bundle_version_id": row.id,
                    "continuum_id": created["id"],
                    "installed_by": installed_by,
                    "installed_at": now,
                },
            )

    return {
        "installation_id": install_id,
        "continuum_id": created["id"],
        "bundle_version": row.version,
    }


async def list_bundles(
    *,
    organization_id: str,
    visibility: str | None = None,
    governance_status: str | None = None,
) -> list[dict[str, Any]]:
    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT b.id, b.name, b.description, b.organization_id,
                           b.visibility, b.governance_status, b.price_cents,
                           b.currency, b.billing_model,
                           v.version, v.manifest, v.signature
                    FROM continuum_bundle b
                    JOIN LATERAL (
                        SELECT version, manifest, signature
                        FROM continuum_bundle_version
                        WHERE bundle_id = b.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) v ON true
                    WHERE b.organization_id = :org_id
                      AND (:visibility IS NULL OR b.visibility = :visibility)
                      AND (:governance_status IS NULL OR b.governance_status = :governance_status)
                    ORDER BY b.created_at DESC
                    """
                ),
                {
                    "org_id": organization_id,
                    "visibility": visibility,
                    "governance_status": governance_status,
                },
            )
            return [dict(row._mapping) for row in result.fetchall()]


async def update_bundle_governance(
    *,
    organization_id: str,
    bundle_id: str,
    governance_status: str,
) -> None:
    with rls_context(organization_id, is_internal=True):
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    UPDATE continuum_bundle
                    SET governance_status = :governance_status,
                        updated_at = :updated_at
                    WHERE id = :bundle_id AND organization_id = :org_id
                    """
                ),
                {
                    "governance_status": governance_status,
                    "updated_at": datetime.utcnow(),
                    "bundle_id": bundle_id,
                    "org_id": organization_id,
                },
            )
