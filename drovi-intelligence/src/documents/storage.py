"""S3/R2/MinIO storage helpers for Smart Drive uploads.

We keep this separate from evidence storage because:
- uploads are multipart/resumable
- object keys are content-addressed by SHA-256
- the lifecycle is "upload session" -> "complete" -> "process"
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import structlog

from src.config import get_settings

logger = structlog.get_logger()

_s3_client_ops = None
_s3_client_presign = None


def _sanitize_filename(file_name: str) -> str:
    # Keep it stable and safe for object keys. Preserve extension if present.
    name = (file_name or "document").strip()
    name = name.replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^a-zA-Z0-9._-]+", "-", name)
    name = re.sub(r"-{2,}", "-", name).strip("-")
    return name or "document"


def _build_s3_client(*, endpoint_url: str | None):
    import boto3
    from botocore.config import Config

    settings = get_settings()
    if not settings.evidence_s3_bucket:
        raise ValueError("S3 bucket is not configured (EVIDENCE_S3_BUCKET)")

    config = None
    if settings.s3_force_path_style:
        config = Config(s3={"addressing_style": "path"})

    return boto3.client(
        "s3",
        region_name=settings.evidence_s3_region or None,
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.evidence_s3_access_key_id,
        aws_secret_access_key=settings.evidence_s3_secret_access_key,
        config=config,
    )


def _get_s3_client_ops():
    global _s3_client_ops
    if _s3_client_ops is not None:
        return _s3_client_ops

    settings = get_settings()
    _s3_client_ops = _build_s3_client(endpoint_url=settings.evidence_s3_endpoint_url)
    return _s3_client_ops


def _get_s3_client_presign():
    global _s3_client_presign
    if _s3_client_presign is not None:
        return _s3_client_presign

    settings = get_settings()
    endpoint_url = settings.evidence_s3_public_endpoint_url or settings.evidence_s3_endpoint_url
    # If the public endpoint is the same as the internal one, reuse the ops client.
    if endpoint_url == settings.evidence_s3_endpoint_url:
        _s3_client_presign = _get_s3_client_ops()
        return _s3_client_presign

    _s3_client_presign = _build_s3_client(endpoint_url=endpoint_url)
    return _s3_client_presign


def get_documents_bucket() -> str:
    settings = get_settings()
    if not settings.evidence_s3_bucket:
        raise ValueError("S3 bucket is not configured (EVIDENCE_S3_BUCKET)")
    return settings.evidence_s3_bucket


def build_document_object_key(*, organization_id: str, sha256: str, file_name: str) -> str:
    settings = get_settings()
    safe_name = _sanitize_filename(file_name)
    extension = ""
    if "." in safe_name:
        extension = "." + safe_name.split(".")[-1].lower()
    prefix = (settings.documents_s3_prefix or "drovi-documents").strip("/")
    # Content-addressed path: prefix/org/sha256.ext
    return f"{prefix}/{organization_id}/{sha256}{extension}"


def build_document_page_object_key(
    *,
    organization_id: str,
    document_sha256: str,
    page_index: int,
    image_sha256: str,
) -> str:
    settings = get_settings()
    prefix = (settings.documents_s3_prefix or "drovi-documents").strip("/")
    # Each page image is also content-addressed (includes image hash).
    return f"{prefix}/{organization_id}/{document_sha256}/pages/{page_index:04d}-{image_sha256}.png"


@dataclass(frozen=True)
class MultipartUploadSession:
    bucket: str
    key: str
    upload_id: str


async def initiate_multipart_upload(*, key: str, content_type: str | None) -> MultipartUploadSession:
    import anyio

    bucket = get_documents_bucket()
    client = _get_s3_client_ops()

    settings = get_settings()

    def _create() -> str:
        params: dict[str, Any] = {
            "Bucket": bucket,
            "Key": key,
        }
        if content_type:
            params["ContentType"] = content_type
        if settings.evidence_s3_sse:
            params["ServerSideEncryption"] = settings.evidence_s3_sse
            if settings.evidence_s3_sse == "aws:kms" and settings.evidence_s3_kms_key_id:
                params["SSEKMSKeyId"] = settings.evidence_s3_kms_key_id
        resp = client.create_multipart_upload(**params)
        return str(resp["UploadId"])

    upload_id = await anyio.to_thread.run_sync(_create)
    return MultipartUploadSession(bucket=bucket, key=key, upload_id=upload_id)


async def presign_upload_part(
    *,
    key: str,
    upload_id: str,
    part_number: int,
    expires_in: int,
) -> str:
    import anyio

    bucket = get_documents_bucket()
    client = _get_s3_client_presign()

    def _presign() -> str:
        return client.generate_presigned_url(
            "upload_part",
            Params={
                "Bucket": bucket,
                "Key": key,
                "UploadId": upload_id,
                "PartNumber": int(part_number),
            },
            ExpiresIn=int(expires_in),
        )

    return await anyio.to_thread.run_sync(_presign)


async def complete_multipart_upload(
    *,
    key: str,
    upload_id: str,
    parts: list[dict[str, Any]],
) -> None:
    import anyio

    bucket = get_documents_bucket()
    client = _get_s3_client_ops()

    normalized_parts = [
        {"PartNumber": int(p["part_number"]), "ETag": str(p["etag"])}
        for p in parts
        if p and "part_number" in p and "etag" in p
    ]
    normalized_parts.sort(key=lambda p: p["PartNumber"])

    def _complete() -> None:
        client.complete_multipart_upload(
            Bucket=bucket,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={"Parts": normalized_parts},
        )

    await anyio.to_thread.run_sync(_complete)


async def abort_multipart_upload(*, key: str, upload_id: str) -> None:
    import anyio

    bucket = get_documents_bucket()
    client = _get_s3_client_ops()

    def _abort() -> None:
        client.abort_multipart_upload(
            Bucket=bucket,
            Key=key,
            UploadId=upload_id,
        )

    await anyio.to_thread.run_sync(_abort)


async def get_object_bytes(*, key: str) -> bytes:
    import anyio

    bucket = get_documents_bucket()
    client = _get_s3_client_ops()

    def _get() -> bytes:
        resp = client.get_object(Bucket=bucket, Key=key)
        return resp["Body"].read()

    return await anyio.to_thread.run_sync(_get)


async def put_object_bytes(*, key: str, data: bytes, content_type: str | None = None) -> None:
    import anyio

    bucket = get_documents_bucket()
    client = _get_s3_client_ops()
    settings = get_settings()

    def _put() -> None:
        params: dict[str, Any] = {
            "Bucket": bucket,
            "Key": key,
            "Body": data,
        }
        if content_type:
            params["ContentType"] = content_type
        if settings.evidence_s3_sse:
            params["ServerSideEncryption"] = settings.evidence_s3_sse
            if settings.evidence_s3_sse == "aws:kms" and settings.evidence_s3_kms_key_id:
                params["SSEKMSKeyId"] = settings.evidence_s3_kms_key_id
        client.put_object(**params)

    await anyio.to_thread.run_sync(_put)
