"""
Connection Service

Provides unified access to connection configurations with decrypted tokens.
Bridges the database models with the connector framework.
"""

from base64 import urlsafe_b64encode
from datetime import datetime
from typing import Any
from uuid import UUID

import structlog
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

    if not oauth_token:
        logger.warning("OAuth tokens not found", connection_id=connection_id)
        return None

    # Decrypt tokens
    try:
        access_token = decrypt_token(oauth_token.access_token_encrypted)
        refresh_token = None
        if oauth_token.refresh_token_encrypted:
            refresh_token = decrypt_token(oauth_token.refresh_token_encrypted)
    except Exception as e:
        logger.error("Failed to decrypt tokens", connection_id=connection_id, error=str(e))
        return None

    # Build auth config
    auth = AuthConfig(
        auth_type=AuthType.OAUTH2,
        access_token=access_token,
        refresh_token=refresh_token,
        token_expires_at=oauth_token.expires_at,
        scopes=oauth_token.scopes or [],
        extra={
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
        },
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
