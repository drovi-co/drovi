from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet

from src.config import get_settings


class BrowserSecretManager:
    """Encrypt/decrypt org browser provider secrets."""

    def __init__(self) -> None:
        self._fernet = Fernet(self._derive_fernet_key())

    def encrypt(self, value: str) -> str:
        token = self._fernet.encrypt(value.encode("utf-8"))
        return token.decode("utf-8")

    def decrypt(self, token: str) -> str:
        value = self._fernet.decrypt(token.encode("utf-8"))
        return value.decode("utf-8")

    @staticmethod
    def preview(value: str) -> str:
        if not value:
            return ""
        if len(value) <= 6:
            return "*" * len(value)
        return f"{value[:3]}***{value[-3:]}"

    @staticmethod
    def _derive_fernet_key() -> bytes:
        settings = get_settings()
        seed = settings.browser_secrets_encryption_key or settings.api_key_salt or "drovi-browser-secrets-dev-key"
        digest = hashlib.sha256(seed.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest)
