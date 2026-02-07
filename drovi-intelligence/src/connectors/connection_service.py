"""
Connection Service

Provides unified access to connection configurations with decrypted tokens.
Bridges the database models with the connector framework.
"""

from base64 import urlsafe_b64encode
from datetime import datetime, timedelta
from typing import Any

import structlog
import httpx
from cryptography.fernet import Fernet
from sqlalchemy import select, text

from src.config import get_settings
from src.connectors.base.config import AuthConfig, AuthType, ConnectorConfig, StreamConfig, SyncMode
from src.db.client import get_db_session
from src.db.models.connections import Connection, OAuthToken

logger = structlog.get_logger()


def get_fernet() -> Fernet:
    """
    Get Fernet cipher using the same key derivation as auth.py.

    This must match the encryption used when storing tokens.
    """
    settings = get_settings()
    encryption_key = settings.api_key_salt or "default-key-change-me"
    key_bytes = encryption_key.encode()[:32].ljust(32, b"0")
    fernet_key = urlsafe_b64encode(key_bytes)
    return Fernet(fernet_key)


def decrypt_token(encrypted: bytes) -> str:
    """Decrypt a token using the application Fernet key."""
    fernet = get_fernet()
    return fernet.decrypt(encrypted).decode()


def encrypt_token(value: str) -> bytes:
    """Encrypt a token using the application Fernet key."""
    fernet = get_fernet()
    return fernet.encrypt(value.encode())


def _infer_oauth_provider(connector_type: str) -> str | None:
    """
    Map connector_type to its underlying OAuth provider.

    This is a fallback for older rows and non-OAuth flows.
    """
    if connector_type in ("gmail", "google_docs", "google_calendar"):
        return "google"
    if connector_type in ("outlook", "teams"):
        return "microsoft"
    if connector_type == "hubspot":
        return "hubspot"
    if connector_type == "slack":
        return "slack"
    if connector_type == "notion":
        return "notion"
    if connector_type == "whatsapp":
        return "meta"
    return None


def _build_auth_extra(
    *,
    oauth_provider: str | None,
    settings: Any,
) -> dict[str, Any]:
    extra: dict[str, Any] = {}
    if oauth_provider:
        extra["oauth_provider"] = oauth_provider

    if oauth_provider == "google":
        extra.update(
            {
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
            }
        )
    elif oauth_provider == "microsoft":
        extra.update(
            {
                "client_id": settings.microsoft_client_id,
                "client_secret": settings.microsoft_client_secret,
                "tenant_id": settings.microsoft_tenant_id or "common",
            }
        )
    elif oauth_provider == "hubspot":
        extra.update(
            {
                "client_id": settings.hubspot_client_id,
                "client_secret": settings.hubspot_client_secret,
            }
        )
    elif oauth_provider == "slack":
        extra.update(
            {
                "client_id": settings.slack_client_id,
                "client_secret": settings.slack_client_secret,
            }
        )
    elif oauth_provider == "notion":
        extra.update(
            {
                "client_id": settings.notion_client_id,
                "client_secret": settings.notion_client_secret,
            }
        )
    elif oauth_provider == "meta":
        extra.update(
            {
                "app_id": settings.meta_app_id,
                "app_secret": settings.meta_app_secret,
            }
        )

    return extra


async def get_connection_config(
    connection_id: str,
    organization_id: str,
) -> ConnectorConfig | None:
    """
    Build a ConnectorConfig from database records with decrypted tokens.

    Args:
        connection_id: Connection UUID (as string)
        organization_id: Organization ID

    Returns:
        ConnectorConfig ready for use with connectors, or None if not found
    """
    settings = get_settings()

    async with get_db_session() as session:
        # Fetch connection
        result = await session.execute(
            select(Connection).where(
                Connection.id == connection_id,
                Connection.organization_id == organization_id,
            )
        )
        connection = result.scalar_one_or_none()

        if not connection:
            logger.warning("Connection not found", connection_id=connection_id)
            return None

        # Fetch OAuth tokens
        token_result = await session.execute(
            select(OAuthToken).where(
                OAuthToken.connection_id == connection_id,
            )
        )
        oauth_token = token_result.scalar_one_or_none()

    access_token: str | None = None
    refresh_token: str | None = None
    token_expires_at = None
    scopes: list[str] = []
    oauth_provider: str | None = None

    if oauth_token:
        oauth_provider = str(oauth_token.provider) if oauth_token.provider else None
        # Decrypt tokens
        try:
            access_token = decrypt_token(oauth_token.access_token_encrypted)
            if oauth_token.refresh_token_encrypted:
                refresh_token = decrypt_token(oauth_token.refresh_token_encrypted)
            token_expires_at = oauth_token.expires_at
            scopes = list(oauth_token.scopes or [])
        except Exception as e:
            logger.error("Failed to decrypt tokens", connection_id=connection_id, error=str(e))
            return None

    if not oauth_provider:
        oauth_provider = _infer_oauth_provider(connection.connector_type)

    auth_type = AuthType.OAUTH2 if access_token else AuthType.NONE

    # Build auth config
    auth = AuthConfig(
        auth_type=auth_type,
        access_token=access_token,
        refresh_token=refresh_token,
        token_expires_at=token_expires_at,
        scopes=scopes,
        extra=_build_auth_extra(
            oauth_provider=oauth_provider,
            settings=settings,
        ),
    )

    # Build stream configs based on connector type
    streams = []
    if connection.connector_type == "gmail":
        streams = [
            StreamConfig(
                stream_name="messages",
                enabled=True,
                sync_mode=SyncMode.INCREMENTAL,
                cursor_field="historyId",
                primary_key=["id"],
                batch_size=100,
            ),
        ]
    elif connection.connector_type == "slack":
        streams = [
            StreamConfig(
                stream_name="messages",
                enabled=True,
                sync_mode=SyncMode.INCREMENTAL,
                cursor_field="ts",
                primary_key=["ts", "channel"],
                batch_size=100,
            ),
        ]

    # Parse config JSON
    config_data = connection.config or {}

    # Build ConnectorConfig
    return ConnectorConfig(
        connection_id=str(connection.id),
        organization_id=connection.organization_id,
        connector_type=connection.connector_type,
        name=connection.name,
        description=connection.description,
        auth=auth,
        streams=streams,
        default_sync_mode=SyncMode.INCREMENTAL,
        sync_frequency_minutes=connection.sync_frequency_minutes or 5,
        backfill_start_date=connection.backfill_start_date,
        backfill_enabled=connection.backfill_enabled,
        status=connection.status,
        last_sync_at=connection.last_sync_at,
        last_error=connection.last_sync_error,
        provider_config=config_data,
        created_at=connection.created_at,
        updated_at=connection.updated_at,
    )


async def refresh_oauth_tokens_for_config(
    config: ConnectorConfig,
    *,
    force: bool = False,
) -> ConnectorConfig:
    """
    Refresh OAuth tokens for a ConnectorConfig and persist them.

    Supported providers: google, microsoft, hubspot.
    Other providers are a no-op.
    """
    if config.auth.auth_type != AuthType.OAUTH2:
        return config

    refresh_token = config.auth.refresh_token
    if not refresh_token:
        return config

    oauth_provider = str(config.auth.extra.get("oauth_provider") or "").lower() or None
    if not oauth_provider:
        oauth_provider = _infer_oauth_provider(config.connector_type)
    if oauth_provider not in ("google", "microsoft", "hubspot"):
        return config

    # If we have expiry information, do not refresh unless we are close to expiry.
    if not force and not config.token_needs_refresh:
        return config

    settings = get_settings()

    token_url: str
    data: dict[str, Any]

    if oauth_provider == "google":
        token_url = "https://oauth2.googleapis.com/token"
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
        }
    elif oauth_provider == "microsoft":
        tenant = settings.microsoft_tenant_id or "common"
        token_url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": settings.microsoft_client_id,
            "client_secret": settings.microsoft_client_secret,
        }
    else:
        token_url = "https://api.hubapi.com/oauth/v1/token"
        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": settings.hubspot_client_id,
            "client_secret": settings.hubspot_client_secret,
        }

    response: httpx.Response
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            token_url,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if response.status_code != 200:
        raise RuntimeError(
            f"Token refresh failed provider={oauth_provider} "
            f"status={response.status_code} body={response.text[:200]}"
        )

    token_data = response.json()
    new_access_token = token_data.get("access_token")
    if not new_access_token:
        raise RuntimeError(f"Token refresh returned no access_token provider={oauth_provider}")

    # Preserve refresh token if the provider did not return it.
    new_refresh_token = token_data.get("refresh_token") or refresh_token

    expires_at = None
    expires_in = token_data.get("expires_in")
    if expires_in is not None:
        try:
            expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in))
        except Exception:
            expires_at = None

    # Prefer server-returned scopes if present.
    scopes = config.auth.scopes
    if token_data.get("scope"):
        raw_scope = str(token_data.get("scope") or "")
        if raw_scope:
            scopes = raw_scope.split()

    access_encrypted = encrypt_token(new_access_token)
    refresh_encrypted = encrypt_token(new_refresh_token) if new_refresh_token else None
    token_type = token_data.get("token_type") or "Bearer"

    async with get_db_session() as session:
        await session.execute(
            text(
                """
                UPDATE oauth_tokens
                SET access_token_encrypted = :access_token,
                    refresh_token_encrypted = :refresh_token,
                    token_type = :token_type,
                    expires_at = :expires_at,
                    scopes = :scopes,
                    updated_at = NOW()
                WHERE connection_id = :connection_id
                """
            ),
            {
                "connection_id": config.connection_id,
                "access_token": access_encrypted,
                "refresh_token": refresh_encrypted,
                "token_type": token_type,
                "expires_at": expires_at,
                "scopes": scopes,
            },
        )

    logger.info(
        "Refreshed OAuth tokens",
        connection_id=config.connection_id,
        organization_id=config.organization_id,
        oauth_provider=oauth_provider,
        expires_at=expires_at.isoformat() if expires_at else None,
    )

    updated_auth = config.auth.model_copy(
        update={
            "access_token": new_access_token,
            "refresh_token": new_refresh_token,
            "token_expires_at": expires_at,
            "scopes": scopes,
        }
    )
    return config.model_copy(update={"auth": updated_auth})


async def list_active_connections(organization_id: str | None = None) -> list[dict[str, Any]]:
    """
    List all active connections, optionally filtered by org.

    Returns minimal info for scheduling purposes.
    """
    async with get_db_session() as session:
        query = select(Connection).where(Connection.status == "active")

        if organization_id:
            query = query.where(Connection.organization_id == organization_id)

        result = await session.execute(query)
        connections = result.scalars().all()

    return [
        {
            "connection_id": str(conn.id),
            "organization_id": conn.organization_id,
            "connector_type": conn.connector_type,
            "name": conn.name,
            "sync_frequency_minutes": conn.sync_frequency_minutes,
            "last_sync_at": conn.last_sync_at,
        }
        for conn in connections
    ]


async def update_sync_status(
    connection_id: str,
    status: str,
    records_synced: int = 0,
    error: str | None = None,
) -> None:
    """Update connection sync status after a sync job."""
    async with get_db_session() as session:
        if status == "success":
            # Update both the sync status and the main connection status to 'connected'
            await session.execute(
                text("""
                    UPDATE connections
                    SET status = 'connected',
                        last_sync_at = NOW(),
                        last_sync_status = 'success',
                        last_sync_records = :records,
                        last_sync_error = NULL,
                        updated_at = NOW()
                    WHERE id = :connection_id
                """),
                {"connection_id": connection_id, "records": records_synced},
            )
        else:
            # Update status to 'error' when sync fails
            await session.execute(
                text("""
                    UPDATE connections
                    SET status = 'error',
                        last_sync_at = NOW(),
                        last_sync_status = 'failed',
                        last_sync_error = :error,
                        updated_at = NOW()
                    WHERE id = :connection_id
                """),
                {"connection_id": connection_id, "error": error},
            )
        await session.commit()

    logger.info(
        "Updated sync status",
        connection_id=connection_id,
        status=status,
        records_synced=records_synced,
    )
