"""
Evidence Storage

Local filesystem-backed evidence storage with deterministic paths and hashing.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from dataclasses import dataclass
from pathlib import Path

import aiofiles
import structlog

from src.config import get_settings

logger = structlog.get_logger()


@dataclass
class StoredArtifact:
    """Result of storing an artifact."""

    storage_backend: str
    storage_path: str
    byte_size: int
    sha256: str


class EvidenceStorage:
    """Abstract storage interface for evidence artifacts."""

    async def write_bytes(
        self,
        artifact_id: str,
        data: bytes,
        extension: str = "",
        organization_id: str | None = None,
        retention_until: datetime | None = None,
        immutable: bool | None = None,
    ) -> StoredArtifact:
        raise NotImplementedError

    async def read_bytes(self, storage_path: str) -> bytes:
        raise NotImplementedError

    async def create_presigned_url(self, storage_path: str) -> str | None:
        return None


class LocalEvidenceStorage(EvidenceStorage):
    """Local filesystem storage backend."""

    def __init__(self, root_path: str) -> None:
        self.root_path = Path(root_path)
        self.root_path.mkdir(parents=True, exist_ok=True)

    def _build_path(self, artifact_id: str, extension: str) -> Path:
        shard = artifact_id[:2]
        dir_path = self.root_path / shard
        dir_path.mkdir(parents=True, exist_ok=True)
        filename = f"{artifact_id}{extension}"
        return dir_path / filename

    async def write_bytes(
        self,
        artifact_id: str,
        data: bytes,
        extension: str = "",
        organization_id: str | None = None,
        retention_until: datetime | None = None,
        immutable: bool | None = None,
    ) -> StoredArtifact:
        extension = extension if extension.startswith(".") or extension == "" else f".{extension}"
        target_path = self._build_path(artifact_id, extension)

        sha256 = hashlib.sha256(data).hexdigest()

        async with aiofiles.open(target_path, "wb") as f:
            await f.write(data)

        return StoredArtifact(
            storage_backend="local",
            storage_path=str(target_path),
            byte_size=len(data),
            sha256=sha256,
        )

    async def read_bytes(self, storage_path: str) -> bytes:
        async with aiofiles.open(storage_path, "rb") as f:
            return await f.read()


class S3EvidenceStorage(EvidenceStorage):
    """S3-compatible evidence storage backend (AWS S3 / MinIO)."""

    def __init__(
        self,
        bucket: str,
        region: str,
        endpoint_url: str | None,
        access_key_id: str | None,
        secret_access_key: str | None,
        prefix: str,
        presign_expiry_seconds: int,
        sse: str | None,
        kms_key_id: str | None,
        kms_key_map: dict[str, str],
        object_lock: bool,
        require_kms: bool,
    ) -> None:
        import boto3

        self.bucket = bucket
        self.region = region
        self.endpoint_url = endpoint_url
        self.prefix = prefix.strip("/")
        self.presign_expiry_seconds = presign_expiry_seconds
        self.sse = sse
        self.kms_key_id = kms_key_id
        self._kms_key_map = kms_key_map or {}
        self.object_lock = object_lock
        if require_kms and sse != "aws:kms":
            raise ValueError("Evidence storage requires SSE-KMS but it is not configured")
        self._client = boto3.client(
            "s3",
            region_name=region or None,
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
        )

    def _object_key(self, artifact_id: str, extension: str, organization_id: str | None) -> str:
        extension = extension if extension.startswith(".") or extension == "" else f".{extension}"
        parts = [self.prefix]
        if organization_id:
            parts.append(organization_id)
        parts.append(f"{artifact_id}{extension}")
        return "/".join(part.strip("/") for part in parts if part)

    async def write_bytes(
        self,
        artifact_id: str,
        data: bytes,
        extension: str = "",
        organization_id: str | None = None,
        retention_until: datetime | None = None,
        immutable: bool | None = None,
    ) -> StoredArtifact:
        import anyio
        import hashlib

        key = self._object_key(artifact_id, extension, organization_id)
        sha256 = hashlib.sha256(data).hexdigest()

        def _put_object() -> None:
            params = {"Bucket": self.bucket, "Key": key, "Body": data}
            if self.sse:
                params["ServerSideEncryption"] = self.sse
                if self.sse == "aws:kms":
                    kms_key = self.kms_key_id
                    if organization_id and organization_id in self._kms_key_map:
                        kms_key = self._kms_key_map[organization_id]
                    if kms_key:
                        params["SSEKMSKeyId"] = kms_key
            if self.object_lock and retention_until and immutable:
                params["ObjectLockMode"] = "COMPLIANCE"
                params["ObjectLockRetainUntilDate"] = retention_until
            self._client.put_object(**params)

        await anyio.to_thread.run_sync(_put_object)

        return StoredArtifact(
            storage_backend="s3",
            storage_path=key,
            byte_size=len(data),
            sha256=sha256,
        )

    async def read_bytes(self, storage_path: str) -> bytes:
        import anyio

        def _get_object() -> bytes:
            response = self._client.get_object(Bucket=self.bucket, Key=storage_path)
            return response["Body"].read()

        return await anyio.to_thread.run_sync(_get_object)

    async def create_presigned_url(self, storage_path: str) -> str | None:
        import anyio

        def _presign() -> str:
            return self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.bucket, "Key": storage_path},
                ExpiresIn=self.presign_expiry_seconds,
            )

        return await anyio.to_thread.run_sync(_presign)


_storage_instance: EvidenceStorage | None = None


def get_evidence_storage() -> EvidenceStorage:
    """Get configured evidence storage backend."""
    global _storage_instance

    if _storage_instance is not None:
        return _storage_instance

    settings = get_settings()

    if settings.evidence_storage_backend == "local":
        _storage_instance = LocalEvidenceStorage(settings.evidence_storage_path)
    elif settings.evidence_storage_backend == "s3":
        if not settings.evidence_s3_bucket:
            raise ValueError("Evidence S3 bucket is not configured")
        _storage_instance = S3EvidenceStorage(
            bucket=settings.evidence_s3_bucket,
            region=settings.evidence_s3_region,
            endpoint_url=settings.evidence_s3_endpoint_url,
            access_key_id=settings.evidence_s3_access_key_id,
            secret_access_key=settings.evidence_s3_secret_access_key,
            prefix=settings.evidence_s3_prefix,
            presign_expiry_seconds=settings.evidence_s3_presign_expiry_seconds,
            sse=settings.evidence_s3_sse,
            kms_key_id=settings.evidence_s3_kms_key_id,
            kms_key_map=settings.evidence_s3_kms_key_map,
            object_lock=settings.evidence_s3_object_lock,
            require_kms=settings.evidence_require_kms,
        )
    else:
        raise ValueError(f"Unsupported evidence storage backend: {settings.evidence_storage_backend}")

    logger.info(
        "Evidence storage initialized",
        backend=settings.evidence_storage_backend,
        path=settings.evidence_storage_path,
    )
    return _storage_instance
