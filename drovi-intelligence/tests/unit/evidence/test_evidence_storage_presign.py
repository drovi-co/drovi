from __future__ import annotations

from types import SimpleNamespace

import pytest

boto3 = pytest.importorskip("boto3")

from src.evidence import storage as evidence_storage


pytestmark = [pytest.mark.unit]


@pytest.mark.asyncio
async def test_evidence_storage_uses_public_endpoint_for_presigned_urls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict] = []

    class DummyClient:
        def __init__(self, endpoint_url: str | None) -> None:
            self.endpoint_url = endpoint_url

        def generate_presigned_url(self, *_args, **_kwargs):  # noqa: ANN001
            # Embed endpoint URL in the output so the test can assert it.
            return f"{self.endpoint_url}/presigned"

        def put_object(self, **_kwargs):  # noqa: ANN001
            return None

        def get_object(self, **_kwargs):  # noqa: ANN001
            raise AssertionError("read path not exercised in this test")

        def delete_object(self, **_kwargs):  # noqa: ANN001
            return None

    def fake_client(service_name: str, **kwargs):  # noqa: ANN001
        assert service_name == "s3"
        calls.append(kwargs)
        return DummyClient(kwargs.get("endpoint_url"))

    monkeypatch.setattr(boto3, "client", fake_client)

    monkeypatch.setattr(
        evidence_storage,
        "get_settings",
        lambda: SimpleNamespace(
            evidence_storage_backend="s3",
            evidence_storage_path="/tmp/drovi-evidence",
            evidence_s3_bucket="drovi-evidence",
            evidence_s3_region="",
            evidence_s3_endpoint_url="http://minio:9000",
            evidence_s3_public_endpoint_url="http://127.0.0.1:9000",
            evidence_s3_access_key_id="minioadmin",
            evidence_s3_secret_access_key="minioadmin",
            evidence_s3_prefix="drovi-evidence",
            evidence_s3_presign_expiry_seconds=3600,
            evidence_s3_sse=None,
            evidence_s3_kms_key_id=None,
            evidence_s3_kms_key_map={},
            evidence_s3_object_lock=False,
            evidence_require_kms=False,
            s3_force_path_style=True,
        ),
    )

    # Reset singleton so the patched settings/client are used.
    monkeypatch.setattr(evidence_storage, "_storage_instance", None)

    storage = evidence_storage.get_evidence_storage()
    url = await storage.create_presigned_url("drovi-evidence/org/ev_test")
    assert url.startswith("http://127.0.0.1:9000/")

    assert len(calls) == 2
    assert calls[0].get("endpoint_url") == "http://minio:9000"
    assert calls[1].get("endpoint_url") == "http://127.0.0.1:9000"
    # Force path style must be applied for MinIO.
    assert calls[0].get("config") is not None
    assert calls[1].get("config") is not None

