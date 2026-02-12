from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime

from src.evidence.storage import EvidenceStorage, StoredArtifact


@dataclass(slots=True)
class FakeEvidenceStorage(EvidenceStorage):
    """
    In-memory fake for EvidenceStorage.

    Stores artifacts in a dict keyed by storage_path. The storage_path format is
    stable and includes organization scoping when provided.
    """

    objects: dict[str, bytes] = field(default_factory=dict)

    async def write_bytes(
        self,
        artifact_id: str,
        data: bytes,
        extension: str = "",
        organization_id: str | None = None,
        retention_until: datetime | None = None,
        immutable: bool | None = None,
    ) -> StoredArtifact:
        ext = extension if extension.startswith(".") or extension == "" else f".{extension}"
        prefix = organization_id or "global"
        storage_path = f"{prefix}/{artifact_id}{ext}"
        self.objects[storage_path] = data
        sha256 = hashlib.sha256(data).hexdigest()
        return StoredArtifact(
            storage_backend="fake",
            storage_path=storage_path,
            byte_size=len(data),
            sha256=sha256,
        )

    async def read_bytes(self, storage_path: str) -> bytes:
        return self.objects[storage_path]

    async def create_presigned_url(self, storage_path: str) -> str | None:
        return f"https://fake-objects.local/{storage_path}"

    async def delete(self, storage_path: str) -> bool:
        existed = storage_path in self.objects
        self.objects.pop(storage_path, None)
        return existed

