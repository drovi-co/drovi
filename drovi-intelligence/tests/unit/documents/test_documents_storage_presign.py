from __future__ import annotations

from types import SimpleNamespace

import pytest

boto3 = pytest.importorskip("boto3")

from src.documents import storage as documents_storage


pytestmark = [pytest.mark.unit]


@pytest.mark.asyncio
async def test_documents_storage_presigns_with_public_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict] = []

    class DummyClient:
        def __init__(self, endpoint_url: str | None) -> None:
            self.endpoint_url = endpoint_url

        def create_multipart_upload(self, **_kwargs):  # noqa: ANN001
            return {"UploadId": "upl_test_123"}

        def generate_presigned_url(self, *_args, **_kwargs):  # noqa: ANN001
            return f"{self.endpoint_url}/presigned"

        def complete_multipart_upload(self, **_kwargs):  # noqa: ANN001
            return None

        def abort_multipart_upload(self, **_kwargs):  # noqa: ANN001
            return None

        def get_object(self, **_kwargs):  # noqa: ANN001
            raise AssertionError("read path not exercised in this test")

        def put_object(self, **_kwargs):  # noqa: ANN001
            return None

    def fake_client(service_name: str, **kwargs):  # noqa: ANN001
        assert service_name == "s3"
        calls.append(kwargs)
        return DummyClient(kwargs.get("endpoint_url"))

    monkeypatch.setattr(boto3, "client", fake_client)

    monkeypatch.setattr(
        documents_storage,
        "get_settings",
        lambda: SimpleNamespace(
            evidence_s3_bucket="drovi-evidence",
            evidence_s3_region="",
            evidence_s3_endpoint_url="http://minio:9000",
            evidence_s3_public_endpoint_url="http://127.0.0.1:9000",
            evidence_s3_access_key_id="minioadmin",
            evidence_s3_secret_access_key="minioadmin",
            evidence_s3_sse=None,
            evidence_s3_kms_key_id=None,
            s3_force_path_style=True,
            documents_s3_prefix="drovi-documents",
        ),
    )

    # Reset module-level clients so patched settings apply.
    monkeypatch.setattr(documents_storage, "_s3_client_ops", None)
    monkeypatch.setattr(documents_storage, "_s3_client_presign", None)

    session = await documents_storage.initiate_multipart_upload(key="drovi-documents/org/sha.pdf", content_type=None)
    url = await documents_storage.presign_upload_part(
        key=session.key,
        upload_id=session.upload_id,
        part_number=1,
        expires_in=3600,
    )

    assert url.startswith("http://127.0.0.1:9000/")
    assert len(calls) == 2
    assert calls[0].get("endpoint_url") == "http://minio:9000"
    assert calls[1].get("endpoint_url") == "http://127.0.0.1:9000"
    # Force path style must be applied for MinIO.
    assert calls[0].get("config") is not None
    assert calls[1].get("config") is not None

