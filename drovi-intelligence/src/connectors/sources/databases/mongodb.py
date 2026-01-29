"""
MongoDB Connector

Extracts data from MongoDB databases.
Supports incremental sync using _id or timestamp fields.
"""

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig
from src.connectors.base.connector import BaseConnector, RecordBatch, ConnectorRegistry
from src.connectors.base.state import ConnectorState

logger = structlog.get_logger()


class MongoDBConnector(BaseConnector):
    """
    Connector for MongoDB databases.

    Extracts:
    - Collections (with schema inference)

    Supports:
    - Incremental sync using _id or timestamp fields
    - Full refresh mode
    - Change streams for real-time sync (requires replica set)
    """

    def __init__(self):
        """Initialize MongoDB connector."""
        self._client = None

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if database is accessible."""
        try:
            from motor.motor_asyncio import AsyncIOMotorClient

            uri = self._build_uri(config.credentials)
            client = AsyncIOMotorClient(uri)

            # Ping the database
            await client.admin.command("ping")

            logger.info("MongoDB connection verified")
            return True, None

        except ImportError:
            return False, "motor not installed"
        except Exception as e:
            return False, f"Connection failed: {str(e)}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available collections as streams."""
        from motor.motor_asyncio import AsyncIOMotorClient

        streams = []
        uri = self._build_uri(config.credentials)

        try:
            client = AsyncIOMotorClient(uri)
            database = config.credentials.get("database", "test")
            db = client[database]

            # Get all collections
            collection_names = await db.list_collection_names()

            for name in collection_names:
                # Skip system collections
                if name.startswith("system."):
                    continue

                # Check for common timestamp fields
                collection = db[name]
                sample = await collection.find_one()

                cursor_field = None
                if sample:
                    for field in ["updatedAt", "updated_at", "modifiedAt", "createdAt", "created_at"]:
                        if field in sample and isinstance(sample[field], (datetime, str)):
                            cursor_field = field
                            break

                    # Default to _id for incremental
                    if not cursor_field:
                        cursor_field = "_id"

                streams.append(
                    StreamConfig(
                        stream_name=name,
                        sync_mode="incremental",
                        cursor_field=cursor_field,
                    )
                )

        except Exception as e:
            logger.error("Failed to discover streams", error=str(e))

        return streams

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read records from a collection."""
        from bson import ObjectId
        from motor.motor_asyncio import AsyncIOMotorClient

        uri = self._build_uri(config.credentials)
        database = config.credentials.get("database", "test")
        batch_size = config.settings.get("batch_size", 1000)

        client = AsyncIOMotorClient(uri)
        db = client[database]
        collection = db[stream.stream_name]

        try:
            # Build query
            query: dict[str, Any] = {}
            sort_field = stream.cursor_field or "_id"
            state_cursor = state.get_cursor(stream.stream_name)

            if state_cursor and stream.cursor_field:
                last_value = state_cursor.get(stream.cursor_field)
                if last_value:
                    # Handle ObjectId for _id field
                    if stream.cursor_field == "_id" and isinstance(last_value, str):
                        try:
                            last_value = ObjectId(last_value)
                        except Exception:
                            pass

                    query[stream.cursor_field] = {"$gt": last_value}

            # Query with cursor
            cursor = collection.find(query).sort(sort_field, 1).batch_size(batch_size)

            records = []
            newest_cursor_value = None

            async for doc in cursor:
                record = self._serialize_document(doc)
                record["_source_collection"] = stream.stream_name
                record["_extracted_at"] = datetime.utcnow().isoformat()
                records.append(record)

                # Track cursor value
                if stream.cursor_field and stream.cursor_field in doc:
                    newest_cursor_value = doc[stream.cursor_field]
                    if isinstance(newest_cursor_value, ObjectId):
                        newest_cursor_value = str(newest_cursor_value)
                    elif isinstance(newest_cursor_value, datetime):
                        newest_cursor_value = newest_cursor_value.isoformat()

                # Yield batch
                if len(records) >= batch_size:
                    next_cursor = None
                    if newest_cursor_value and stream.cursor_field:
                        next_cursor = {stream.cursor_field: newest_cursor_value}

                    yield RecordBatch(
                        records=records,
                        next_cursor=next_cursor,
                    )
                    records = []

            # Yield remaining records
            if records:
                next_cursor = None
                if newest_cursor_value and stream.cursor_field:
                    next_cursor = {stream.cursor_field: newest_cursor_value}

                yield RecordBatch(
                    records=records,
                    next_cursor=next_cursor,
                )

        finally:
            client.close()

    def _build_uri(self, credentials: dict[str, Any]) -> str:
        """Build MongoDB connection URI."""
        # Check for full URI
        if "uri" in credentials:
            return credentials["uri"]

        host = credentials.get("host", "localhost")
        port = credentials.get("port", 27017)
        user = credentials.get("user")
        password = credentials.get("password")
        auth_source = credentials.get("auth_source", "admin")

        if user and password:
            return f"mongodb://{user}:{password}@{host}:{port}/?authSource={auth_source}"
        else:
            return f"mongodb://{host}:{port}/"

    def _serialize_document(self, doc: dict[str, Any]) -> dict[str, Any]:
        """Serialize MongoDB document to JSON-compatible format."""
        from bson import ObjectId

        result = {}
        for key, value in doc.items():
            if isinstance(value, ObjectId):
                result[key] = str(value)
            elif isinstance(value, datetime):
                result[key] = value.isoformat()
            elif isinstance(value, bytes):
                result[key] = value.decode("utf-8", errors="replace")
            elif isinstance(value, dict):
                result[key] = self._serialize_document(value)
            elif isinstance(value, list):
                result[key] = [
                    self._serialize_document(v) if isinstance(v, dict) else v
                    for v in value
                ]
            else:
                result[key] = value

        return result


# Register connector
ConnectorRegistry.register("mongodb", MongoDBConnector)
