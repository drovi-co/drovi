"""
Connector OAuth token cryptography helpers.

Enforces explicit key configuration and supports key rotation by trying
previous keys for decryption while always encrypting with the primary key.
"""

from __future__ import annotations

from base64 import urlsafe_b64encode
from dataclasses import dataclass
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
import structlog

from src.config import get_settings

logger = structlog.get_logger()


@dataclass(frozen=True)
class ConnectorTokenCipher:
    """Encapsulates primary and fallback Fernet ciphers for token encryption."""

    primary_key: bytes
    primary: Fernet
    fallbacks: tuple[Fernet, ...]

    def encrypt(self, value: str) -> bytes:
        """Encrypt using the active primary key."""
        return self.primary.encrypt(value.encode())

    def decrypt(self, token: bytes) -> str:
        """Decrypt with primary key first, then configured fallback keys."""
        try:
            return self.primary.decrypt(token).decode()
        except InvalidToken:
            for index, cipher in enumerate(self.fallbacks, start=1):
                try:
                    plaintext = cipher.decrypt(token).decode()
                    logger.info(
                        "Connector token decrypted with previous key",
                        fallback_index=index,
                    )
                    return plaintext
                except InvalidToken:
                    continue
            raise


def _derive_fernet_key(raw: str) -> bytes:
    """
    Derive a Fernet-compatible key from non-Fernet key material.

    Kept for backward compatibility with existing token encryption.
    """
    key_bytes = raw.encode()[:32].ljust(32, b"0")
    return urlsafe_b64encode(key_bytes)


def _build_fernet(raw: str) -> tuple[bytes, Fernet]:
    """Build a Fernet cipher from direct or derived key material."""
    material = raw.strip()
    if not material:
        raise RuntimeError("Connector token encryption key material is empty")

    raw_bytes = material.encode()
    try:
        return raw_bytes, Fernet(raw_bytes)
    except Exception:
        derived = _derive_fernet_key(material)
        return derived, Fernet(derived)


def _parse_previous_keys(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


@lru_cache(maxsize=1)
def get_connector_token_cipher() -> ConnectorTokenCipher:
    """
    Resolve connector token ciphers from settings.

    Required env vars:
    - CONNECTOR_TOKEN_ENCRYPTION_KEY: primary key material
    - CONNECTOR_TOKEN_ENCRYPTION_PREVIOUS_KEYS: optional comma-separated
      previous key materials used only for decryption during rotation
    """
    settings = get_settings()

    primary_raw = (settings.connector_token_encryption_key or "").strip()
    if not primary_raw:
        if settings.environment == "test":
            primary_raw = "drovi-test-connector-token-key"
        else:
            raise RuntimeError(
                "CONNECTOR_TOKEN_ENCRYPTION_KEY must be set for connector token encryption"
            )

    primary_key, primary_cipher = _build_fernet(primary_raw)

    fallback_ciphers: list[Fernet] = []
    for previous in _parse_previous_keys(
        settings.connector_token_encryption_previous_keys
    ):
        if previous == primary_raw:
            continue
        _, fallback_cipher = _build_fernet(previous)
        fallback_ciphers.append(fallback_cipher)

    return ConnectorTokenCipher(
        primary_key=primary_key,
        primary=primary_cipher,
        fallbacks=tuple(fallback_ciphers),
    )


def encrypt_connector_token(value: str) -> bytes:
    """Encrypt a connector OAuth token using the active primary key."""
    return get_connector_token_cipher().encrypt(value)


def decrypt_connector_token(token: bytes) -> str:
    """Decrypt a connector OAuth token using primary + fallback keys."""
    return get_connector_token_cipher().decrypt(token)

