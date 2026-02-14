from __future__ import annotations

from typing import Any

from sqlalchemy import text

from src.db.client import get_db_session
from src.kernel.errors import NotFoundError
from src.kernel.ids import new_prefixed_id
from src.kernel.serialization import json_dumps_canonical
from src.kernel.time import utc_now

from .common import row_to_dict
from .models import (
    BrowserActionLogRecord,
    BrowserActionStatus,
    BrowserActionType,
    BrowserArtifactRecord,
    BrowserArtifactStorage,
    BrowserArtifactType,
    BrowserProviderType,
    BrowserSecretRecord,
    BrowserSessionRecord,
    BrowserSessionStatus,
)


class BrowserPersistence:
    async def create_session(
        self,
        *,
        organization_id: str,
        provider: BrowserProviderType,
        deployment_id: str | None,
        run_id: str | None,
        status: BrowserSessionStatus,
        current_url: str | None,
        state: dict[str, Any],
        artifacts: dict[str, Any],
        metadata: dict[str, Any],
    ) -> BrowserSessionRecord:
        session_id = new_prefixed_id("agbrs")
        now = utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_browser_session (
                        id, organization_id, provider, deployment_id, run_id, status,
                        current_url, state, artifacts, metadata, created_at, updated_at, last_active_at
                    ) VALUES (
                        :id, :organization_id, :provider, :deployment_id, :run_id, :status,
                        :current_url, CAST(:state AS JSONB), CAST(:artifacts AS JSONB), CAST(:metadata AS JSONB),
                        :created_at, :updated_at, :last_active_at
                    )
                    """
                ),
                {
                    "id": session_id,
                    "organization_id": organization_id,
                    "provider": provider,
                    "deployment_id": deployment_id,
                    "run_id": run_id,
                    "status": status,
                    "current_url": current_url,
                    "state": json_dumps_canonical(state),
                    "artifacts": json_dumps_canonical(artifacts),
                    "metadata": json_dumps_canonical(metadata),
                    "created_at": now,
                    "updated_at": now,
                    "last_active_at": now,
                },
            )
        return await self.get_session(organization_id=organization_id, session_id=session_id)

    async def get_session(self, *, organization_id: str, session_id: str) -> BrowserSessionRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, provider, deployment_id, run_id, status, current_url,
                           state, artifacts, metadata, created_at, updated_at, last_active_at
                    FROM agent_browser_session
                    WHERE organization_id = :organization_id
                      AND id = :session_id
                    """
                ),
                {"organization_id": organization_id, "session_id": session_id},
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.browser.session_not_found",
                message="Browser session not found",
                meta={"session_id": session_id},
            )
        return BrowserSessionRecord.model_validate(row_to_dict(row))

    async def list_sessions(
        self,
        *,
        organization_id: str,
        status: BrowserSessionStatus | None = None,
        deployment_id: str | None = None,
        run_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[BrowserSessionRecord]:
        where = ["organization_id = :organization_id"]
        params: dict[str, Any] = {"organization_id": organization_id, "limit": limit, "offset": offset}
        if status:
            where.append("status = :status")
            params["status"] = status
        if deployment_id:
            where.append("deployment_id = :deployment_id")
            params["deployment_id"] = deployment_id
        if run_id:
            where.append("run_id = :run_id")
            params["run_id"] = run_id
        query = f"""
            SELECT id, organization_id, provider, deployment_id, run_id, status, current_url,
                   state, artifacts, metadata, created_at, updated_at, last_active_at
            FROM agent_browser_session
            WHERE {' AND '.join(where)}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """
        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()
        return [BrowserSessionRecord.model_validate(row_to_dict(row)) for row in rows]

    async def touch_session(
        self,
        *,
        organization_id: str,
        session_id: str,
        status: BrowserSessionStatus,
        current_url: str | None,
        state: dict[str, Any] | None = None,
        artifacts: dict[str, Any] | None = None,
        metadata_patch: dict[str, Any] | None = None,
    ) -> BrowserSessionRecord:
        now = utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    UPDATE agent_browser_session
                    SET status = :status,
                        current_url = :current_url,
                        state = CASE WHEN :state_json IS NULL THEN state ELSE CAST(:state_json AS JSONB) END,
                        artifacts = CASE WHEN :artifacts_json IS NULL THEN artifacts ELSE CAST(:artifacts_json AS JSONB) END,
                        metadata = CASE
                            WHEN :metadata_json IS NULL THEN metadata
                            ELSE COALESCE(metadata, '{}'::jsonb) || CAST(:metadata_json AS JSONB)
                        END,
                        updated_at = :updated_at,
                        last_active_at = :last_active_at
                    WHERE organization_id = :organization_id
                      AND id = :session_id
                    """
                ),
                {
                    "organization_id": organization_id,
                    "session_id": session_id,
                    "status": status,
                    "current_url": current_url,
                    "state_json": json_dumps_canonical(state) if state is not None else None,
                    "artifacts_json": json_dumps_canonical(artifacts) if artifacts is not None else None,
                    "metadata_json": json_dumps_canonical(metadata_patch) if metadata_patch is not None else None,
                    "updated_at": now,
                    "last_active_at": now,
                },
            )
        return await self.get_session(organization_id=organization_id, session_id=session_id)

    async def close_session(self, *, organization_id: str, session_id: str) -> BrowserSessionRecord:
        session_record = await self.get_session(organization_id=organization_id, session_id=session_id)
        return await self.touch_session(
            organization_id=organization_id,
            session_id=session_id,
            status="closed",
            current_url=session_record.current_url,
        )

    async def create_action_log(
        self,
        *,
        organization_id: str,
        session_id: str,
        action_type: BrowserActionType,
        status: BrowserActionStatus,
        request_payload: dict[str, Any],
        response_payload: dict[str, Any],
        error_message: str | None,
    ) -> BrowserActionLogRecord:
        action_id = new_prefixed_id("agbra")
        now = utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_browser_action_log (
                        id, session_id, organization_id, action_type, status,
                        request_payload, response_payload, error_message, created_at
                    ) VALUES (
                        :id, :session_id, :organization_id, :action_type, :status,
                        CAST(:request_payload AS JSONB), CAST(:response_payload AS JSONB), :error_message, :created_at
                    )
                    """
                ),
                {
                    "id": action_id,
                    "session_id": session_id,
                    "organization_id": organization_id,
                    "action_type": action_type,
                    "status": status,
                    "request_payload": json_dumps_canonical(request_payload),
                    "response_payload": json_dumps_canonical(response_payload),
                    "error_message": error_message,
                    "created_at": now,
                },
            )
        return await self.get_action_log(organization_id=organization_id, action_log_id=action_id)

    async def get_action_log(self, *, organization_id: str, action_log_id: str) -> BrowserActionLogRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, session_id, organization_id, action_type, status,
                           request_payload, response_payload, error_message, created_at
                    FROM agent_browser_action_log
                    WHERE organization_id = :organization_id
                      AND id = :action_log_id
                    """
                ),
                {"organization_id": organization_id, "action_log_id": action_log_id},
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.browser.action_log_not_found",
                message="Browser action log not found",
                meta={"action_log_id": action_log_id},
            )
        return BrowserActionLogRecord.model_validate(row_to_dict(row))

    async def list_action_logs(
        self,
        *,
        organization_id: str,
        session_id: str,
        limit: int = 200,
        offset: int = 0,
    ) -> list[BrowserActionLogRecord]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, session_id, organization_id, action_type, status,
                           request_payload, response_payload, error_message, created_at
                    FROM agent_browser_action_log
                    WHERE organization_id = :organization_id
                      AND session_id = :session_id
                    ORDER BY created_at DESC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                {
                    "organization_id": organization_id,
                    "session_id": session_id,
                    "limit": limit,
                    "offset": offset,
                },
            )
            rows = result.fetchall()
        return [BrowserActionLogRecord.model_validate(row_to_dict(row)) for row in rows]

    async def create_artifact(
        self,
        *,
        organization_id: str,
        session_id: str,
        action_log_id: str | None,
        artifact_type: BrowserArtifactType,
        storage_backend: BrowserArtifactStorage,
        storage_uri: str | None,
        metadata: dict[str, Any],
    ) -> BrowserArtifactRecord:
        artifact_id = new_prefixed_id("agbrf")
        now = utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_browser_artifact (
                        id, organization_id, session_id, action_log_id, artifact_type,
                        storage_backend, storage_uri, metadata, created_at
                    ) VALUES (
                        :id, :organization_id, :session_id, :action_log_id, :artifact_type,
                        :storage_backend, :storage_uri, CAST(:metadata AS JSONB), :created_at
                    )
                    """
                ),
                {
                    "id": artifact_id,
                    "organization_id": organization_id,
                    "session_id": session_id,
                    "action_log_id": action_log_id,
                    "artifact_type": artifact_type,
                    "storage_backend": storage_backend,
                    "storage_uri": storage_uri,
                    "metadata": json_dumps_canonical(metadata),
                    "created_at": now,
                },
            )
        return await self.get_artifact(organization_id=organization_id, artifact_id=artifact_id)

    async def get_artifact(self, *, organization_id: str, artifact_id: str) -> BrowserArtifactRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, session_id, action_log_id, artifact_type,
                           storage_backend, storage_uri, metadata, created_at
                    FROM agent_browser_artifact
                    WHERE organization_id = :organization_id
                      AND id = :artifact_id
                    """
                ),
                {"organization_id": organization_id, "artifact_id": artifact_id},
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.browser.artifact_not_found",
                message="Browser artifact not found",
                meta={"artifact_id": artifact_id},
            )
        return BrowserArtifactRecord.model_validate(row_to_dict(row))

    async def list_artifacts(
        self,
        *,
        organization_id: str,
        session_id: str,
        limit: int = 200,
        offset: int = 0,
    ) -> list[BrowserArtifactRecord]:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT id, organization_id, session_id, action_log_id, artifact_type,
                           storage_backend, storage_uri, metadata, created_at
                    FROM agent_browser_artifact
                    WHERE organization_id = :organization_id
                      AND session_id = :session_id
                    ORDER BY created_at DESC
                    LIMIT :limit OFFSET :offset
                    """
                ),
                {
                    "organization_id": organization_id,
                    "session_id": session_id,
                    "limit": limit,
                    "offset": offset,
                },
            )
            rows = result.fetchall()
        return [BrowserArtifactRecord.model_validate(row_to_dict(row)) for row in rows]

    async def upsert_secret(
        self,
        *,
        organization_id: str,
        provider: BrowserProviderType,
        secret_name: str,
        secret_ciphertext: str,
        secret_preview: str,
        metadata: dict[str, Any],
    ) -> BrowserSecretRecord:
        now = utc_now()
        async with get_db_session() as session:
            await session.execute(
                text(
                    """
                    INSERT INTO agent_browser_provider_secret (
                        organization_id, provider, secret_name, secret_ciphertext, secret_preview,
                        metadata, created_at, updated_at
                    ) VALUES (
                        :organization_id, :provider, :secret_name, :secret_ciphertext, :secret_preview,
                        CAST(:metadata AS JSONB), :created_at, :updated_at
                    )
                    ON CONFLICT (organization_id, provider, secret_name)
                    DO UPDATE SET
                        secret_ciphertext = EXCLUDED.secret_ciphertext,
                        secret_preview = EXCLUDED.secret_preview,
                        metadata = EXCLUDED.metadata,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "organization_id": organization_id,
                    "provider": provider,
                    "secret_name": secret_name,
                    "secret_ciphertext": secret_ciphertext,
                    "secret_preview": secret_preview,
                    "metadata": json_dumps_canonical(metadata),
                    "created_at": now,
                    "updated_at": now,
                },
            )
        return await self.get_secret(organization_id=organization_id, provider=provider, secret_name=secret_name)

    async def get_secret(
        self,
        *,
        organization_id: str,
        provider: BrowserProviderType,
        secret_name: str,
    ) -> BrowserSecretRecord:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT organization_id, provider, secret_name, secret_preview,
                           metadata, created_at, updated_at
                    FROM agent_browser_provider_secret
                    WHERE organization_id = :organization_id
                      AND provider = :provider
                      AND secret_name = :secret_name
                    """
                ),
                {
                    "organization_id": organization_id,
                    "provider": provider,
                    "secret_name": secret_name,
                },
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.browser.secret_not_found",
                message="Browser provider secret not found",
                meta={"provider": provider, "secret_name": secret_name},
            )
        return BrowserSecretRecord.model_validate(row_to_dict(row))

    async def get_secret_ciphertext(
        self,
        *,
        organization_id: str,
        provider: BrowserProviderType,
        secret_name: str,
    ) -> str:
        async with get_db_session() as session:
            result = await session.execute(
                text(
                    """
                    SELECT secret_ciphertext
                    FROM agent_browser_provider_secret
                    WHERE organization_id = :organization_id
                      AND provider = :provider
                      AND secret_name = :secret_name
                    """
                ),
                {
                    "organization_id": organization_id,
                    "provider": provider,
                    "secret_name": secret_name,
                },
            )
            row = result.fetchone()
        if row is None:
            raise NotFoundError(
                code="agentos.browser.secret_not_found",
                message="Browser provider secret not found",
                meta={"provider": provider, "secret_name": secret_name},
            )
        return str(row.secret_ciphertext)

    async def list_secrets(
        self,
        *,
        organization_id: str,
        provider: BrowserProviderType | None = None,
    ) -> list[BrowserSecretRecord]:
        where = ["organization_id = :organization_id"]
        params: dict[str, Any] = {"organization_id": organization_id}
        if provider:
            where.append("provider = :provider")
            params["provider"] = provider
        query = f"""
            SELECT organization_id, provider, secret_name, secret_preview,
                   metadata, created_at, updated_at
            FROM agent_browser_provider_secret
            WHERE {' AND '.join(where)}
            ORDER BY provider ASC, secret_name ASC
        """
        async with get_db_session() as session:
            result = await session.execute(text(query), params)
            rows = result.fetchall()
        return [BrowserSecretRecord.model_validate(row_to_dict(row)) for row in rows]
