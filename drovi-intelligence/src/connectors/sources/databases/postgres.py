"""
PostgreSQL Connector

Extracts data from PostgreSQL databases.
Supports incremental sync using timestamp columns.
"""

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig, SyncMode
from src.connectors.base.connector import BaseConnector, RecordBatch, ConnectorRegistry
from src.connectors.base.records import RecordType
from src.connectors.base.state import ConnectorState

logger = structlog.get_logger()


class PostgresConnector(BaseConnector):
    """
    Connector for PostgreSQL databases.

    Extracts:
    - Tables (with schema discovery)
    - Custom SQL queries

    Supports:
    - Incremental sync using timestamp/ID columns
    - Full refresh mode
    - Custom query execution
    """

    def __init__(self):
        """Initialize PostgreSQL connector."""
        self._pool = None

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if database is accessible."""
        try:
            import asyncpg

            dsn = self._build_dsn(config)
            conn = await asyncpg.connect(dsn)
            await conn.execute("SELECT 1")
            await conn.close()

            logger.info("PostgreSQL connection verified")
            return True, None

        except ImportError:
            return False, "asyncpg not installed"
        except Exception as e:
            return False, f"Connection failed: {str(e)}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available tables as streams."""
        import asyncpg

        streams = []
        dsn = self._build_dsn(config)

        try:
            conn = await asyncpg.connect(dsn)

            # Get all tables in the schema
            schema = config.get_setting("schema", "public")
            rows = await conn.fetch(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = $1
                AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """,
                schema,
            )

            for row in rows:
                table_name = row["table_name"]

                # Check for common timestamp columns
                cursor_field = None
                col_rows = await conn.fetch(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = $1
                    AND table_name = $2
                    AND column_name IN ('updated_at', 'modified_at', 'created_at', 'timestamp')
                    ORDER BY
                        CASE column_name
                            WHEN 'updated_at' THEN 1
                            WHEN 'modified_at' THEN 2
                            WHEN 'created_at' THEN 3
                            ELSE 4
                        END
                    LIMIT 1
                    """,
                    schema,
                    table_name,
                )

                if col_rows:
                    cursor_field = col_rows[0]["column_name"]

                streams.append(
                    StreamConfig(
                        stream_name=table_name,
                        sync_mode=SyncMode.INCREMENTAL if cursor_field else SyncMode.FULL_REFRESH,
                        cursor_field=cursor_field,
                    )
                )

            await conn.close()

        except Exception as e:
            logger.error("Failed to discover streams", error=str(e))

        return streams

    async def read_stream(
        self,
        config: ConnectorConfig,
        stream: StreamConfig,
        state: ConnectorState,
    ) -> AsyncIterator[RecordBatch]:
        """Read records from a table."""
        import asyncpg

        dsn = self._build_dsn(config)
        schema = config.get_setting("schema", "public")
        batch_size = config.get_setting("batch_size", 1000)

        conn = await asyncpg.connect(dsn)

        try:
            # Build query
            table = f'"{schema}"."{stream.stream_name}"'
            cursor = state.get_cursor(stream.stream_name)

            if stream.sync_mode == SyncMode.INCREMENTAL and stream.cursor_field and cursor:
                last_value = cursor.get(stream.cursor_field)
                query = f"""
                    SELECT * FROM {table}
                    WHERE "{stream.cursor_field}" > $1
                    ORDER BY "{stream.cursor_field}" ASC
                """
                params = [last_value]
            else:
                query = f"SELECT * FROM {table}"
                params = []

            # Execute with cursor for streaming
            async with conn.transaction():
                cursor_name = f"fetch_{stream.stream_name}"
                await conn.execute(f"DECLARE {cursor_name} CURSOR FOR {query}", *params)

                while True:
                    rows = await conn.fetch(
                        f"FETCH {batch_size} FROM {cursor_name}"
                    )

                    if not rows:
                        break

                    batch = self.create_batch(stream.stream_name, config.connection_id)
                    newest_cursor_value = None

                    for row in rows:
                        record = dict(row)
                        record["_source_table"] = stream.stream_name
                        record["_extracted_at"] = datetime.utcnow().isoformat()
                        record_id = None
                        if stream.primary_key:
                            try:
                                record_id = ":".join(str(record.get(k)) for k in stream.primary_key)
                            except Exception:
                                record_id = None
                        if not record_id:
                            record_id = str(record.get("id") or record.get("uuid") or record.get("pk") or record.get("ID") or record.get("Id") or record.get("_id") or record.get("_source_table"))

                        rec = self.create_record(
                            record_id=record_id,
                            stream_name=stream.stream_name,
                            data=record,
                            cursor_value=record.get(stream.cursor_field) if stream.cursor_field else None,
                        )
                        rec.record_type = RecordType.CUSTOM
                        batch.add_record(rec)

                        # Track cursor value
                        if stream.cursor_field and stream.cursor_field in record:
                            cursor_val = record[stream.cursor_field]
                            if cursor_val is not None:
                                if isinstance(cursor_val, datetime):
                                    cursor_val = cursor_val.isoformat()
                                newest_cursor_value = cursor_val

                    next_cursor = None
                    if newest_cursor_value and stream.cursor_field:
                        next_cursor = {stream.cursor_field: newest_cursor_value}

                    if batch.records:
                        batch.complete(next_cursor=next_cursor, has_more=True)
                        yield batch

        finally:
            await conn.close()

    def _build_dsn(self, config: ConnectorConfig) -> str:
        """Build PostgreSQL connection string."""
        host = config.get_credential("host", "localhost")
        port = config.get_credential("port", 5432)
        database = config.get_credential("database", "postgres")
        user = config.get_credential("user", "postgres")
        password = config.get_credential("password", "")

        return f"postgresql://{user}:{password}@{host}:{port}/{database}"


# Register connector
ConnectorRegistry.register("postgres", PostgresConnector)
