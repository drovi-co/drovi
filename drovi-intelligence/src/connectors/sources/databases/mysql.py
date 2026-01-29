"""
MySQL Connector

Extracts data from MySQL databases.
Supports incremental sync using timestamp columns.
"""

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig
from src.connectors.base.connector import BaseConnector, RecordBatch, ConnectorRegistry
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

            conn_params = self._build_conn_params(config.credentials)
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
        conn_params = self._build_conn_params(config.credentials)

        try:
            conn = await aiomysql.connect(**conn_params)
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                database = config.credentials.get("database")

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
                            sync_mode="incremental" if cursor_field else "full_refresh",
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

        conn_params = self._build_conn_params(config.credentials)
        batch_size = config.settings.get("batch_size", 1000)

        conn = await aiomysql.connect(**conn_params)

        try:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                # Build query
                table = f"`{stream.stream_name}`"
                state_cursor = state.get_cursor(stream.stream_name)

                if stream.sync_mode == "incremental" and stream.cursor_field and state_cursor:
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

                    records = []
                    newest_cursor_value = None

                    for row in rows:
                        record = dict(row)
                        record["_source_table"] = stream.stream_name
                        record["_extracted_at"] = datetime.utcnow().isoformat()

                        # Convert datetime objects to ISO format
                        for key, value in record.items():
                            if isinstance(value, datetime):
                                record[key] = value.isoformat()

                        records.append(record)

                        if stream.cursor_field and stream.cursor_field in row:
                            cursor_val = row[stream.cursor_field]
                            if cursor_val is not None:
                                if isinstance(cursor_val, datetime):
                                    cursor_val = cursor_val.isoformat()
                                newest_cursor_value = cursor_val

                    next_cursor = None
                    if newest_cursor_value and stream.cursor_field:
                        next_cursor = {stream.cursor_field: newest_cursor_value}

                    yield RecordBatch(
                        records=records,
                        next_cursor=next_cursor,
                    )

        finally:
            conn.close()

    def _build_conn_params(self, credentials: dict[str, Any]) -> dict[str, Any]:
        """Build MySQL connection parameters."""
        return {
            "host": credentials.get("host", "localhost"),
            "port": credentials.get("port", 3306),
            "db": credentials.get("database", "mysql"),
            "user": credentials.get("user", "root"),
            "password": credentials.get("password", ""),
            "charset": "utf8mb4",
        }


# Register connector
ConnectorRegistry.register("mysql", MySQLConnector)
