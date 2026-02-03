"""
MySQL Connector

Extracts data from MySQL databases.
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


class MySQLConnector(BaseConnector):
    """
    Connector for MySQL databases.

    Extracts:
    - Tables (with schema discovery)
    - Custom SQL queries

    Supports:
    - Incremental sync using timestamp/ID columns
    - Full refresh mode
    """

    def __init__(self):
        """Initialize MySQL connector."""
        pass

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if database is accessible."""
        try:
            import aiomysql

            conn_params = self._build_conn_params(config)
            conn = await aiomysql.connect(**conn_params)
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT 1")
            conn.close()

            logger.info("MySQL connection verified")
            return True, None

        except ImportError:
            return False, "aiomysql not installed"
        except Exception as e:
            return False, f"Connection failed: {str(e)}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available tables as streams."""
        import aiomysql

        streams = []
        conn_params = self._build_conn_params(config)

        try:
            conn = await aiomysql.connect(**conn_params)
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                database = config.get_credential("database")

                # Get all tables
                await cursor.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = %s
                    AND table_type = 'BASE TABLE'
                    ORDER BY table_name
                    """,
                    (database,),
                )
                tables = await cursor.fetchall()

                for row in tables:
                    table_name = row["table_name"]

                    # Check for timestamp columns
                    await cursor.execute(
                        """
                        SELECT column_name
                        FROM information_schema.columns
                        WHERE table_schema = %s
                        AND table_name = %s
                        AND column_name IN ('updated_at', 'modified_at', 'created_at', 'timestamp')
                        ORDER BY FIELD(column_name, 'updated_at', 'modified_at', 'created_at', 'timestamp')
                        LIMIT 1
                        """,
                        (database, table_name),
                    )
                    cursor_col = await cursor.fetchone()

                    cursor_field = cursor_col["column_name"] if cursor_col else None

                    streams.append(
                        StreamConfig(
                            stream_name=table_name,
                            sync_mode=SyncMode.INCREMENTAL if cursor_field else SyncMode.FULL_REFRESH,
                            cursor_field=cursor_field,
                        )
                    )

            conn.close()

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
        import aiomysql

        conn_params = self._build_conn_params(config)
        batch_size = config.get_setting("batch_size", 1000)

        conn = await aiomysql.connect(**conn_params)

        try:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                # Build query
                table = f"`{stream.stream_name}`"
                state_cursor = state.get_cursor(stream.stream_name)

                if stream.sync_mode == SyncMode.INCREMENTAL and stream.cursor_field and state_cursor:
                    last_value = state_cursor.get(stream.cursor_field)
                    query = f"""
                        SELECT * FROM {table}
                        WHERE `{stream.cursor_field}` > %s
                        ORDER BY `{stream.cursor_field}` ASC
                    """
                    await cursor.execute(query, (last_value,))
                else:
                    query = f"SELECT * FROM {table}"
                    await cursor.execute(query)

                while True:
                    rows = await cursor.fetchmany(batch_size)

                    if not rows:
                        break

                    batch = self.create_batch(stream.stream_name, config.connection_id)
                    newest_cursor_value = None

                    for row in rows:
                        record = dict(row)
                        record["_source_table"] = stream.stream_name
                        record["_extracted_at"] = datetime.utcnow().isoformat()

                        # Convert datetime objects to ISO format
                        for key, value in record.items():
                            if isinstance(value, datetime):
                                record[key] = value.isoformat()

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

                        if stream.cursor_field and stream.cursor_field in row:
                            cursor_val = row[stream.cursor_field]
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
            conn.close()

    def _build_conn_params(self, config: ConnectorConfig) -> dict[str, Any]:
        """Build MySQL connection parameters."""
        return {
            "host": config.get_credential("host", "localhost"),
            "port": config.get_credential("port", 3306),
            "db": config.get_credential("database", "mysql"),
            "user": config.get_credential("user", "root"),
            "password": config.get_credential("password", ""),
            "charset": "utf8mb4",
        }


# Register connector
ConnectorRegistry.register("mysql", MySQLConnector)
