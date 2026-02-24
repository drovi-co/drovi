"""Encryption helpers for sensitive cognitive payloads at rest."""

from __future__ import annotations

from base64 import urlsafe_b64encode
from dataclasses import dataclass
from functools import lru_cache
import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
import structlog

from src.config import get_settings

logger = structlog.get_logger()

_ENVELOPE_KEY = "_enc"
_ENVELOPE_VERSION = "v1"
_ENVELOPE_ALG = "fernet"


@dataclass(frozen=True)
class CognitivePayloadCipher:
    """Primary and fallback ciphers used for encrypt/decrypt."""

    primary: Fernet
    fallbacks: tuple[Fernet, ...]

    def encrypt_json(self, payload: Any) -> str:
        serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        return self.primary.encrypt(serialized.encode("utf-8")).decode("utf-8")

    def decrypt_json(self, ciphertext: str) -> Any:
        token = ciphertext.encode("utf-8")
        try:
            raw = self.primary.decrypt(token).decode("utf-8")
        except InvalidToken:
            for index, fallback in enumerate(self.fallbacks, start=1):
                try:
                    raw = fallback.decrypt(token).decode("utf-8")
                    logger.info(
                        "Cognitive payload decrypted with previous key",
                        fallback_index=index,
                    )
                    break
                except InvalidToken:
                    continue
            else:
                raise
        return json.loads(raw)


def _derive_fernet_key(raw: str) -> bytes:
    key_bytes = raw.encode()[:32].ljust(32, b"0")
    return urlsafe_b64encode(key_bytes)


def _build_fernet(raw: str) -> Fernet:
    material = str(raw or "").strip()
    if not material:
        raise RuntimeError("Cognitive payload encryption key material is empty")
    raw_bytes = material.encode("utf-8")
    try:
        return Fernet(raw_bytes)
    except Exception:
        return Fernet(_derive_fernet_key(material))


def _parse_previous_keys(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


@lru_cache(maxsize=1)
def get_cognitive_payload_cipher() -> CognitivePayloadCipher:
    settings = get_settings()
    primary_raw = (
        settings.cognitive_payload_encryption_key
        or settings.api_key_salt
        or settings.internal_jwt_secret
        or ""
    ).strip()
    if not primary_raw:
        if settings.environment == "test":
            primary_raw = "drovi-test-cognitive-payload-key"
        else:
            raise RuntimeError(
                "COGNITIVE_PAYLOAD_ENCRYPTION_KEY must be set for cognitive payload encryption"
            )
    primary = _build_fernet(primary_raw)

    fallbacks: list[Fernet] = []
    for previous in _parse_previous_keys(settings.cognitive_payload_encryption_previous_keys):
        if previous == primary_raw:
            continue
        fallbacks.append(_build_fernet(previous))
    return CognitivePayloadCipher(primary=primary, fallbacks=tuple(fallbacks))


def encrypt_payload_envelope(payload: Any) -> dict[str, Any]:
    ciphertext = get_cognitive_payload_cipher().encrypt_json(payload)
    return {
        _ENVELOPE_KEY: {
            "version": _ENVELOPE_VERSION,
            "alg": _ENVELOPE_ALG,
            "ciphertext": ciphertext,
        }
    }


def decrypt_payload_envelope(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    envelope = payload.get(_ENVELOPE_KEY)
    if not isinstance(envelope, dict):
        return payload
    ciphertext = envelope.get("ciphertext")
    if not isinstance(ciphertext, str) or not ciphertext.strip():
        return {}
    try:
        decrypted = get_cognitive_payload_cipher().decrypt_json(ciphertext)
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.warning("Failed to decrypt cognitive payload envelope", error=str(exc))
        return {}
    return decrypted


def encode_reason_payload(reason_payload: dict[str, Any]) -> str:
    encrypted = encrypt_payload_envelope(reason_payload)
    return json.dumps(encrypted, sort_keys=True, separators=(",", ":"), default=str)


def decode_reason_payload(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if isinstance(parsed, dict) and _ENVELOPE_KEY in parsed:
        decrypted = decrypt_payload_envelope(parsed)
        return decrypted if isinstance(decrypted, dict) else {}
    return parsed if isinstance(parsed, dict) else {}
