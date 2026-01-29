"""
API Key generation and validation for Drovi Intelligence API.

Provides secure key generation, hashing, and validation.
"""

import hashlib
import secrets
from datetime import datetime
from typing import NamedTuple

import structlog

logger = structlog.get_logger()

# API key format: sk_live_<32 random chars> or sk_test_<32 random chars>
KEY_PREFIX_LIVE = "sk_live_"
KEY_PREFIX_TEST = "sk_test_"
KEY_LENGTH = 32  # Random portion length


class APIKeyInfo(NamedTuple):
    """Information about a validated API key."""

    id: str
    organization_id: str
    scopes: list[str]
    rate_limit_per_minute: int
    expires_at: datetime | None
    revoked_at: datetime | None
    name: str


def generate_api_key(is_test: bool = False) -> tuple[str, str, str]:
    """
    Generate a new API key.

    Returns:
        Tuple of (full_key, key_prefix, key_hash)
        - full_key: The complete key to give to the user (only shown once)
        - key_prefix: First 8 chars for identification
        - key_hash: SHA-256 hash for storage
    """
    prefix = KEY_PREFIX_TEST if is_test else KEY_PREFIX_LIVE
    random_part = secrets.token_urlsafe(KEY_LENGTH)[:KEY_LENGTH]
    full_key = f"{prefix}{random_part}"
    key_prefix = full_key[:8]
    key_hash = hash_api_key(full_key)

    return full_key, key_prefix, key_hash


def hash_api_key(api_key: str) -> str:
    """
    Hash an API key using SHA-256.

    Args:
        api_key: The full API key

    Returns:
        SHA-256 hash of the key
    """
    return hashlib.sha256(api_key.encode()).hexdigest()


async def validate_api_key(api_key: str) -> APIKeyInfo | None:
    """
    Validate an API key against the database.

    Args:
        api_key: The API key to validate

    Returns:
        APIKeyInfo if valid, None otherwise
    """
    from src.db.client import get_db_pool

    if not api_key:
        return None

    # Check format
    if not (api_key.startswith(KEY_PREFIX_LIVE) or api_key.startswith(KEY_PREFIX_TEST)):
        logger.warning("Invalid API key format")
        return None

    key_hash = hash_api_key(api_key)

    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    id,
                    organization_id,
                    scopes,
                    rate_limit_per_minute,
                    expires_at,
                    revoked_at,
                    name,
                    last_used_at
                FROM api_keys
                WHERE key_hash = $1
                """,
                key_hash,
            )

            if not row:
                logger.warning("API key not found", key_prefix=api_key[:8])
                return None

            # Update last_used_at
            await conn.execute(
                "UPDATE api_keys SET last_used_at = NOW() WHERE id = $1",
                row["id"],
            )

            return APIKeyInfo(
                id=row["id"],
                organization_id=row["organization_id"],
                scopes=row["scopes"] or [],
                rate_limit_per_minute=row["rate_limit_per_minute"] or 100,
                expires_at=row["expires_at"],
                revoked_at=row["revoked_at"],
                name=row["name"],
            )

    except Exception as e:
        logger.error("Failed to validate API key", error=str(e))
        return None


async def create_api_key(
    organization_id: str,
    name: str,
    scopes: list[str] | None = None,
    rate_limit_per_minute: int = 100,
    expires_at: datetime | None = None,
    created_by: str | None = None,
    is_test: bool = False,
) -> tuple[str, str]:
    """
    Create a new API key in the database.

    Args:
        organization_id: Organization this key belongs to
        name: Human-readable name for the key
        scopes: List of granted scopes
        rate_limit_per_minute: Rate limit for this key
        expires_at: Optional expiration date
        created_by: User who created the key
        is_test: Whether this is a test key

    Returns:
        Tuple of (full_key, key_id)
        Note: full_key is only returned once and should be shown to the user
    """
    from src.db.client import get_db_pool
    from src.auth.scopes import get_default_scopes

    full_key, key_prefix, key_hash = generate_api_key(is_test=is_test)
    scopes = scopes or get_default_scopes()

    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            key_id = await conn.fetchval(
                """
                INSERT INTO api_keys (
                    organization_id,
                    key_hash,
                    key_prefix,
                    name,
                    scopes,
                    rate_limit_per_minute,
                    expires_at,
                    created_by
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
                """,
                organization_id,
                key_hash,
                key_prefix,
                name,
                scopes,
                rate_limit_per_minute,
                expires_at,
                created_by,
            )

            logger.info(
                "Created API key",
                key_id=key_id,
                organization_id=organization_id,
                key_prefix=key_prefix,
            )

            return full_key, key_id

    except Exception as e:
        logger.error("Failed to create API key", error=str(e))
        raise


async def revoke_api_key(key_id: str, organization_id: str) -> bool:
    """
    Revoke an API key.

    Args:
        key_id: The key ID to revoke
        organization_id: Organization owning the key (for authorization)

    Returns:
        True if revoked, False otherwise
    """
    from src.db.client import get_db_pool

    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE api_keys
                SET revoked_at = NOW()
                WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL
                """,
                key_id,
                organization_id,
            )

            if result == "UPDATE 1":
                logger.info("Revoked API key", key_id=key_id)
                return True

            logger.warning(
                "API key not found or already revoked",
                key_id=key_id,
            )
            return False

    except Exception as e:
        logger.error("Failed to revoke API key", error=str(e))
        return False


async def list_api_keys(organization_id: str) -> list[dict]:
    """
    List all API keys for an organization.

    Args:
        organization_id: Organization ID

    Returns:
        List of API key info (without the actual keys)
    """
    from src.db.client import get_db_pool

    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    id,
                    key_prefix,
                    name,
                    scopes,
                    rate_limit_per_minute,
                    created_at,
                    expires_at,
                    revoked_at,
                    last_used_at
                FROM api_keys
                WHERE organization_id = $1
                ORDER BY created_at DESC
                """,
                organization_id,
            )

            return [dict(row) for row in rows]

    except Exception as e:
        logger.error("Failed to list API keys", error=str(e))
        return []
