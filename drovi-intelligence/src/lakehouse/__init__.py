"""Lakehouse module (bronze/silver/gold pipelines)."""

from src.lakehouse.contracts import (
    SCHEMA_REGISTRY,
    assert_schema_evolution_compatible,
    get_table_schema,
    validate_schema_payload,
)
from src.lakehouse.control_plane import (
    get_checkpoint,
    list_partitions,
    record_cost_attribution,
    summarize_cost_attribution,
    upsert_checkpoint,
    upsert_partition_state,
)
from src.lakehouse.jobs import (
    run_lakehouse_backfill,
    run_lakehouse_quality,
    run_lakehouse_retention,
    run_lakehouse_replay,
)
from src.lakehouse.query import query_lakehouse_table
from src.lakehouse.writer import LakehouseWriteResult, write_lake_record

__all__ = [
    "SCHEMA_REGISTRY",
    "get_table_schema",
    "validate_schema_payload",
    "assert_schema_evolution_compatible",
    "upsert_checkpoint",
    "get_checkpoint",
    "upsert_partition_state",
    "list_partitions",
    "record_cost_attribution",
    "summarize_cost_attribution",
    "LakehouseWriteResult",
    "write_lake_record",
    "run_lakehouse_backfill",
    "run_lakehouse_replay",
    "run_lakehouse_quality",
    "run_lakehouse_retention",
    "query_lakehouse_table",
]
