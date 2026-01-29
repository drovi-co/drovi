"""
Google BigQuery Connector

Extracts data from Google BigQuery datasets.
Supports incremental sync using timestamp partitions.
"""

from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

import structlog

from src.connectors.base.config import ConnectorConfig, StreamConfig
from src.connectors.base.connector import BaseConnector, RecordBatch, ConnectorRegistry
from src.connectors.base.state import ConnectorState

logger = structlog.get_logger()


class BigQueryConnector(BaseConnector):
    """
    Connector for Google BigQuery.

    Extracts:
    - Tables from BigQuery datasets
    - Custom SQL queries

    Supports:
    - Incremental sync using partition/timestamp columns
    - Full refresh mode
    - Large table streaming
    """

    def __init__(self):
        """Initialize BigQuery connector."""
        self._client = None

    async def check_connection(
        self,
        config: ConnectorConfig,
    ) -> tuple[bool, str | None]:
        """Check if BigQuery is accessible."""
        try:
            from google.cloud import bigquery
            from google.oauth2 import service_account

            credentials_json = config.credentials.get("service_account_json")
            project_id = config.credentials.get("project_id")

            if not credentials_json:
                return False, "Missing service_account_json in credentials"
            if not project_id:
                return False, "Missing project_id in credentials"

            credentials = service_account.Credentials.from_service_account_info(
                credentials_json
            )
            client = bigquery.Client(credentials=credentials, project=project_id)

            # Test query
            query = "SELECT 1"
            client.query(query).result()

            logger.info("BigQuery connection verified", project=project_id)
            return True, None

        except ImportError:
            return False, "google-cloud-bigquery not installed"
        except Exception as e:
            return False, f"Connection failed: {str(e)}"

    async def discover_streams(
        self,
        config: ConnectorConfig,
    ) -> list[StreamConfig]:
        """Discover available tables as streams."""
        from google.cloud import bigquery
        from google.oauth2 import service_account

        streams = []
        credentials_json = config.credentials.get("service_account_json")
        project_id = config.credentials.get("project_id")
        dataset_id = config.settings.get("dataset_id")

        try:
            credentials = service_account.Credentials.from_service_account_info(
                credentials_json
            )
            client = bigquery.Client(credentials=credentials, project=project_id)

            if dataset_id:
                datasets = [client.get_dataset(f"{project_id}.{dataset_id}")]
            else:
                datasets = list(client.list_datasets())

            for dataset in datasets:
                tables = client.list_tables(dataset.dataset_id)

                for table in tables:
                    full_table = client.get_table(table.reference)

                    # Check for timestamp columns
                    cursor_field = None
                    for field in full_table.schema:
                        if field.field_type in ("TIMESTAMP", "DATETIME", "DATE"):
                            if field.name.lower() in (
                                "updated_at",
                                "modified_at",
                                "created_at",
                                "_partitiontime",
                            ):
                                cursor_field = field.name
                                break

                    # Check for time partitioning
                    if not cursor_field and full_table.time_partitioning:
                        cursor_field = full_table.time_partitioning.field or "_PARTITIONTIME"

                    streams.append(
                        StreamConfig(
                            stream_name=f"{dataset.dataset_id}.{table.table_id}",
                            sync_mode="incremental" if cursor_field else "full_refresh",
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
        """Read records from a BigQuery table."""
        from google.cloud import bigquery
        from google.oauth2 import service_account

        credentials_json = config.credentials.get("service_account_json")
        project_id = config.credentials.get("project_id")
        batch_size = config.settings.get("batch_size", 10000)

        credentials = service_account.Credentials.from_service_account_info(
            credentials_json
        )
        client = bigquery.Client(credentials=credentials, project=project_id)

        # Parse table reference
        parts = stream.stream_name.split(".")
        if len(parts) == 2:
            dataset_id, table_id = parts
        else:
            dataset_id = config.settings.get("dataset_id", "default")
            table_id = stream.stream_name

        table_ref = f"`{project_id}.{dataset_id}.{table_id}`"

        # Build query
        cursor = state.get_cursor(stream.stream_name)

        if stream.sync_mode == "incremental" and stream.cursor_field and cursor:
            last_value = cursor.get(stream.cursor_field)
            query = f"""
                SELECT *
                FROM {table_ref}
                WHERE {stream.cursor_field} > @last_value
                ORDER BY {stream.cursor_field} ASC
            """
            job_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("last_value", "TIMESTAMP", last_value)
                ]
            )
        else:
            query = f"SELECT * FROM {table_ref}"
            job_config = bigquery.QueryJobConfig()

        # Execute query
        query_job = client.query(query, job_config=job_config)

        records = []
        newest_cursor_value = None

        for row in query_job:
            record = dict(row)
            record["_source_table"] = stream.stream_name
            record["_extracted_at"] = datetime.utcnow().isoformat()

            # Serialize datetime objects
            for key, value in list(record.items()):
                if isinstance(value, datetime):
                    record[key] = value.isoformat()

            records.append(record)

            # Track cursor value
            if stream.cursor_field and stream.cursor_field in row:
                cursor_val = row[stream.cursor_field]
                if isinstance(cursor_val, datetime):
                    cursor_val = cursor_val.isoformat()
                newest_cursor_value = cursor_val

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

    async def execute_query(
        self,
        config: ConnectorConfig,
        query: str,
    ) -> AsyncIterator[RecordBatch]:
        """Execute a custom SQL query."""
        from google.cloud import bigquery
        from google.oauth2 import service_account

        credentials_json = config.credentials.get("service_account_json")
        project_id = config.credentials.get("project_id")
        batch_size = config.settings.get("batch_size", 10000)

        credentials = service_account.Credentials.from_service_account_info(
            credentials_json
        )
        client = bigquery.Client(credentials=credentials, project=project_id)

        query_job = client.query(query)

        records = []
        for row in query_job:
            record = dict(row)
            record["_extracted_at"] = datetime.utcnow().isoformat()

            for key, value in list(record.items()):
                if isinstance(value, datetime):
                    record[key] = value.isoformat()

            records.append(record)

            if len(records) >= batch_size:
                yield RecordBatch(records=records)
                records = []

        if records:
            yield RecordBatch(records=records)


# Register connector
ConnectorRegistry.register("bigquery", BigQueryConnector)
