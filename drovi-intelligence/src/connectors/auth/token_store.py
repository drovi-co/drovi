"""
Token Storage

Provides encrypted token storage for OAuth2 credentials.
"""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any

import structlog
from cryptography.fernet import Fernet
from pydantic import BaseModel, Field

from src.connectors.auth.oauth2 import OAuth2Tokens

logger = structlog.get_logger()


class StoredToken(BaseModel):
    """Token data as stored in the database."""

    # Identity
    connection_id: str
    organization_id: str
    provider: str

    # Encrypted token data
    access_token_encrypted: bytes
    refresh_token_encrypted: bytes | None = None

    # Metadata (not encrypted)
    token_type: str = "Bearer"
    expires_at: datetime | None = None
    scopes: list[str] = Field(default_factory=list)

    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        """Pydantic config."""
        extra = "allow"


class TokenStore(ABC):
    """
    Abstract base class for token storage.

    Implementations should handle:
    - Encryption at rest
    - Multi-tenant isolation
    - Token expiry tracking
    """

    @abstractmethod
    async def store_tokens(
        self,
        connection_id: str,
        organization_id: str,
        provider: str,
        tokens: OAuth2Tokens,
    ) -> None:
        """
        Store tokens for a connection.

        Args:
            connection_id: Connection identifier
            organization_id: Organization identifier
            provider: OAuth2 provider name
            tokens: Token data to store
        """
        pass

    @abstractmethod
    async def get_tokens(
        self,
        connection_id: str,
        organization_id: str,
    ) -> OAuth2Tokens | None:
        """
        Retrieve tokens for a connection.

        Args:
            connection_id: Connection identifier
            organization_id: Organization identifier

        Returns:
            OAuth2Tokens or None if not found
        """
        pass

    @abstractmethod
    async def delete_tokens(
        self,
        connection_id: str,
        organization_id: str,
    ) -> bool:
        """
        Delete tokens for a connection.

        Args:
            connection_id: Connection identifier
            organization_id: Organization identifier

        Returns:
            True if deleted, False if not found
        """
        pass

    @abstractmethod
    async def list_expiring_tokens(
        self,
        within_minutes: int = 60,
    ) -> list[tuple[str, str, datetime]]:
        """
        List tokens expiring soon.

        Args:
            within_minutes: Time window in minutes

        Returns:
            List of (connection_id, organization_id, expires_at) tuples
        """
        pass


class InMemoryTokenStore(TokenStore):
    """
    In-memory token storage for development/testing.

    Tokens are encrypted in memory but not persisted.
    """

    def __init__(self, encryption_key: bytes | None = None):
        """
        Initialize in-memory token store.

        Args:
            encryption_key: 32-byte Fernet encryption key
                           If not provided, a new key is generated
        """
        if encryption_key:
            self._fernet = Fernet(encryption_key)
        else:
            self._fernet = Fernet(Fernet.generate_key())

        self._tokens: dict[str, StoredToken] = {}

    def _make_key(self, connection_id: str, organization_id: str) -> str:
        """Create storage key from identifiers."""
        return f"{organization_id}:{connection_id}"

    def _encrypt(self, data: str) -> bytes:
        """Encrypt string data."""
        return self._fernet.encrypt(data.encode())

    def _decrypt(self, data: bytes) -> str:
        """Decrypt to string."""
        return self._fernet.decrypt(data).decode()

    async def store_tokens(
        self,
        connection_id: str,
        organization_id: str,
        provider: str,
        tokens: OAuth2Tokens,
    ) -> None:
        """Store tokens in memory."""
        key = self._make_key(connection_id, organization_id)

        stored = StoredToken(
            connection_id=connection_id,
            organization_id=organization_id,
            provider=provider,
            access_token_encrypted=self._encrypt(tokens.access_token),
            refresh_token_encrypted=self._encrypt(tokens.refresh_token) if tokens.refresh_token else None,
            token_type=tokens.token_type,
            expires_at=tokens.expires_at,
            scopes=tokens.scopes,
            updated_at=datetime.utcnow(),
        )

        self._tokens[key] = stored

        logger.debug(
            "Stored tokens",
            connection_id=connection_id,
            provider=provider,
            expires_at=tokens.expires_at,
        )

    async def get_tokens(
        self,
        connection_id: str,
        organization_id: str,
    ) -> OAuth2Tokens | None:
        """Retrieve tokens from memory."""
        key = self._make_key(connection_id, organization_id)
        stored = self._tokens.get(key)

        if not stored:
            return None

        return OAuth2Tokens(
            access_token=self._decrypt(stored.access_token_encrypted),
            refresh_token=self._decrypt(stored.refresh_token_encrypted) if stored.refresh_token_encrypted else None,
            token_type=stored.token_type,
            expires_at=stored.expires_at,
            scopes=stored.scopes,
        )

    async def delete_tokens(
        self,
        connection_id: str,
        organization_id: str,
    ) -> bool:
        """Delete tokens from memory."""
        key = self._make_key(connection_id, organization_id)

        if key in self._tokens:
            del self._tokens[key]
            logger.debug("Deleted tokens", connection_id=connection_id)
            return True

        return False

    async def list_expiring_tokens(
        self,
        within_minutes: int = 60,
    ) -> list[tuple[str, str, datetime]]:
        """List tokens expiring within the specified time window."""
        from datetime import timedelta

        threshold = datetime.utcnow() + timedelta(minutes=within_minutes)
        expiring = []

        for stored in self._tokens.values():
            if stored.expires_at and stored.expires_at <= threshold:
                expiring.append((
                    stored.connection_id,
                    stored.organization_id,
                    stored.expires_at,
                ))

        return sorted(expiring, key=lambda x: x[2])


class PostgresTokenStore(TokenStore):
    """
    PostgreSQL-backed token storage.

    Tokens are encrypted using Fernet symmetric encryption.
    """

    def __init__(
        self,
        encryption_key: bytes,
    ):
        """
        Initialize PostgreSQL token store.

        Args:
            encryption_key: 32-byte Fernet encryption key
        """
        self._fernet = Fernet(encryption_key)

    def _encrypt(self, data: str) -> bytes:
        """Encrypt string data."""
        return self._fernet.encrypt(data.encode())

    def _decrypt(self, data: bytes) -> str:
        """Decrypt to string."""
        return self._fernet.decrypt(data).decode()

    async def store_tokens(
        self,
        connection_id: str,
        organization_id: str,
        provider: str,
        tokens: OAuth2Tokens,
    ) -> None:
        """Store tokens in PostgreSQL."""
        from sqlalchemy import text

        from src.db.client import get_db_session

        access_encrypted = self._encrypt(tokens.access_token)
        refresh_encrypted = self._encrypt(tokens.refresh_token) if tokens.refresh_token else None

        async with get_db_session() as session:
            # Upsert token record
            query = text("""
                INSERT INTO oauth_tokens (
                    connection_id, organization_id, provider,
                    access_token_encrypted, refresh_token_encrypted,
                    token_type, expires_at, scopes, updated_at
                ) VALUES (
                    :connection_id, :organization_id, :provider,
                    :access_token, :refresh_token,
                    :token_type, :expires_at, :scopes, NOW()
                )
                ON CONFLICT (connection_id) DO UPDATE SET
                    access_token_encrypted = :access_token,
                    refresh_token_encrypted = :refresh_token,
                    token_type = :token_type,
                    expires_at = :expires_at,
                    scopes = :scopes,
                    updated_at = NOW()
            """)

            await session.execute(query, {
                "connection_id": connection_id,
                "organization_id": organization_id,
                "provider": provider,
                "access_token": access_encrypted,
                "refresh_token": refresh_encrypted,
                "token_type": tokens.token_type,
                "expires_at": tokens.expires_at,
                "scopes": tokens.scopes,
            })

        logger.debug(
            "Stored tokens in PostgreSQL",
            connection_id=connection_id,
            provider=provider,
        )

    async def get_tokens(
        self,
        connection_id: str,
        organization_id: str,
    ) -> OAuth2Tokens | None:
        """Retrieve tokens from PostgreSQL."""
        from sqlalchemy import text

        from src.db.client import get_db_session

        async with get_db_session() as session:
            query = text("""
                SELECT
                    access_token_encrypted,
                    refresh_token_encrypted,
                    token_type,
                    expires_at,
                    scopes
                FROM oauth_tokens
                WHERE connection_id = :connection_id
                  AND organization_id = :organization_id
            """)

            result = await session.execute(query, {
                "connection_id": connection_id,
                "organization_id": organization_id,
            })
            row = result.fetchone()

        if not row:
            return None

        return OAuth2Tokens(
            access_token=self._decrypt(row.access_token_encrypted),
            refresh_token=self._decrypt(row.refresh_token_encrypted) if row.refresh_token_encrypted else None,
            token_type=row.token_type,
            expires_at=row.expires_at,
            scopes=row.scopes or [],
        )

    async def delete_tokens(
        self,
        connection_id: str,
        organization_id: str,
    ) -> bool:
        """Delete tokens from PostgreSQL."""
        from sqlalchemy import text

        from src.db.client import get_db_session

        async with get_db_session() as session:
            query = text("""
                DELETE FROM oauth_tokens
                WHERE connection_id = :connection_id
                  AND organization_id = :organization_id
            """)

            result = await session.execute(query, {
                "connection_id": connection_id,
                "organization_id": organization_id,
            })

        return result.rowcount > 0

    async def list_expiring_tokens(
        self,
        within_minutes: int = 60,
    ) -> list[tuple[str, str, datetime]]:
        """List tokens expiring within the specified time window."""
        from datetime import timedelta

        from sqlalchemy import text

        from src.db.client import get_db_session

        threshold = datetime.utcnow() + timedelta(minutes=within_minutes)

        async with get_db_session() as session:
            query = text("""
                SELECT connection_id, organization_id, expires_at
                FROM oauth_tokens
                WHERE expires_at IS NOT NULL
                  AND expires_at <= :threshold
                ORDER BY expires_at ASC
            """)

            result = await session.execute(query, {"threshold": threshold})
            rows = result.fetchall()

        return [(row.connection_id, row.organization_id, row.expires_at) for row in rows]
