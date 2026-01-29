"""
Amazon S3 Connector

Extracts files and data from Amazon S3 buckets.
Supports various file formats: JSON, CSV, Parquet, etc.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from typing import Any
import io
import json

import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig
from src.connectors.base.connector import BaseConnector, RecordBatch, ConnectorRegistry
from src.connectors.base.state import ConnectorState

logger = structlog.get_logger()


@dataclass
class S3Object:
    """Represents an S3 object."""

    key: str
    bucket: str
    size: int
    last_modified: datetime
    etag: str
    content_type: str | None = None


class S3Connector(BaseConnector):
    """
    Connector for Amazon S3.

    Extracts:
    - Files from S3 buckets (JSON, CSV, Parquet, text)
    - Supports prefix filtering
    - Incremental sync based on last_modified

    Supports file formats:
    - JSON / JSONL (newline-delimited JSON)
    - CSV
    - Parquet
    - Plain text
    """

    SUPPORTED_FORMATS = {
        ".json": "json",
        ".jsonl": "jsonl",
        ".csv": "csv",
        ".parquet": "parquet",
        ".txt": "text",
        ".log": "text",
    }

    def __init__(self):
        """Initialize S3 connector."""
        self._client = None

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if S3 bucket is accessible."""
        try:
            import aioboto3

            session = aioboto3.Session(
                aws_access_key_id=config.credentials.get("aws_access_key_id"),
                aws_secret_access_key=config.credentials.get("aws_secret_access_key"),
                region_name=config.credentials.get("region", "us-east-1"),
            )

            bucket = config.settings.get("bucket")
            if not bucket:
                return False, "No bucket specified in settings"

            async with session.client("s3") as client:
                # Try to list objects (head_bucket requires specific permissions)
                await client.list_objects_v2(Bucket=bucket, MaxKeys=1)

            logger.info("S3 connection verified", bucket=bucket)
            return True, None

        except ImportError:
            return False, "aioboto3 not installed"
        except Exception as e:
            return False, f"Connection failed: {str(e)}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available prefixes/paths as streams."""
        # S3 doesn't have schemas, so we create a single "objects" stream
        # Users can configure prefixes in settings
        return [
            StreamConfig(
                stream_name="objects",
                sync_mode="incremental",
                cursor_field="last_modified",
            ),
        ]

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read objects from S3."""
        import aioboto3

        session = aioboto3.Session(
            aws_access_key_id=config.credentials.get("aws_access_key_id"),
            aws_secret_access_key=config.credentials.get("aws_secret_access_key"),
            region_name=config.credentials.get("region", "us-east-1"),
        )

        bucket = config.settings.get("bucket")
        prefix = config.settings.get("prefix", "")
        file_formats = config.settings.get("file_formats", list(self.SUPPORTED_FORMATS.keys()))

        cursor = state.get_cursor(stream.stream_name)
        last_modified = None
        if cursor:
            last_modified_str = cursor.get("last_modified")
            if last_modified_str:
                last_modified = datetime.fromisoformat(last_modified_str)

        async with session.client("s3") as client:
            paginator = client.get_paginator("list_objects_v2")

            async for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
                objects = page.get("Contents", [])
                records = []
                newest_modified = last_modified

                for obj in objects:
                    key = obj["Key"]
                    obj_modified = obj["LastModified"]

                    # Skip if older than cursor
                    if last_modified and obj_modified <= last_modified:
                        continue

                    # Check file extension
                    extension = "." + key.rsplit(".", 1)[-1].lower() if "." in key else ""
                    if extension not in file_formats:
                        continue

                    # Download and parse file
                    try:
                        content_records = await self._read_file(
                            client, bucket, key, extension
                        )

                        for record in content_records:
                            record["_s3_key"] = key
                            record["_s3_bucket"] = bucket
                            record["_s3_last_modified"] = obj_modified.isoformat()
                            record["_extracted_at"] = datetime.utcnow().isoformat()
                            records.append(record)

                        # Track newest modified
                        if not newest_modified or obj_modified > newest_modified:
                            newest_modified = obj_modified

                    except Exception as e:
                        logger.error(
                            "Failed to read S3 object",
                            bucket=bucket,
                            key=key,
                            error=str(e),
                        )

                if records:
                    next_cursor = None
                    if newest_modified:
                        next_cursor = {"last_modified": newest_modified.isoformat()}

                    yield RecordBatch(
                        records=records,
                        next_cursor=next_cursor,
                    )

    async def _read_file(
        self,
        client,
        bucket: str,
        key: str,
        extension: str,
    ) -> list[dict[str, Any]]:
        """Read and parse a file from S3."""
        response = await client.get_object(Bucket=bucket, Key=key)
        body = await response["Body"].read()

        file_type = self.SUPPORTED_FORMATS.get(extension, "text")

        if file_type == "json":
            return [json.loads(body.decode("utf-8"))]
        elif file_type == "jsonl":
            return [
                json.loads(line)
                for line in body.decode("utf-8").strip().split("\n")
                if line.strip()
            ]
        elif file_type == "csv":
            return self._parse_csv(body)
        elif file_type == "parquet":
            return self._parse_parquet(body)
        elif file_type == "text":
            return [{"content": body.decode("utf-8", errors="replace")}]
        else:
            return [{"content": body.decode("utf-8", errors="replace")}]

    def _parse_csv(self, body: bytes) -> list[dict[str, Any]]:
        """Parse CSV content."""
        import csv

        text = body.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(text))
        return list(reader)

    def _parse_parquet(self, body: bytes) -> list[dict[str, Any]]:
        """Parse Parquet content."""
        try:
            import pyarrow.parquet as pq

            table = pq.read_table(io.BytesIO(body))
            return table.to_pylist()
        except ImportError:
            logger.warning("pyarrow not installed, cannot parse Parquet")
            return []


# Register connector
ConnectorRegistry.register("s3", S3Connector)
