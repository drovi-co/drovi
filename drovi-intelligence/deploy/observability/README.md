# Observability (Prometheus + Grafana)

## Prometheus
- Scrape the API metrics endpoint: `/api/v1/monitoring/metrics`
- Load alert rules from `deploy/observability/prometheus-alerts.yml`

## Grafana
- Import your Prometheus data source
- Import `deploy/observability/grafana-dashboard.json` for the baseline dashboard
- Build dashboards around:
  - `drovi_http_request_duration_seconds`
  - `drovi_extraction_duration_seconds`
  - `drovi_llm_requests_total`
  - `drovi_uem_persist_duration_seconds`
  - `drovi_connector_last_success_timestamp_seconds`
  - `drovi_kafka_consumer_lag`
  - `drovi_evidence_latency_seconds`

## Metrics Catalog
- HTTP: `drovi_http_requests_total`, `drovi_http_request_duration_seconds`
- Extraction: `drovi_extractions_total`, `drovi_extraction_duration_seconds`, `drovi_uios_extracted_total`, `drovi_entities_extracted_total`
- UEM/Ingestion: `drovi_uem_events_total`, `drovi_uem_persist_duration_seconds`
- Connector sync: `drovi_sync_jobs_total`, `drovi_sync_job_duration_seconds`, `drovi_records_synced_total`, `drovi_connector_last_success_timestamp_seconds`, `drovi_connector_last_error_timestamp_seconds`
- Graph ops: `drovi_graph_operations_total`, `drovi_graph_operation_duration_seconds`, `drovi_graph_nodes_total`, `drovi_graph_edges_total`
- LLM usage: `drovi_llm_requests_total`, `drovi_llm_request_duration_seconds`, `drovi_llm_tokens_total`
- Search: `drovi_search_requests_total`, `drovi_search_duration_seconds`, `drovi_search_results_count`
- Streaming/events: `drovi_events_published_total`, `drovi_active_event_subscriptions`
- Kafka consumer: `drovi_kafka_consumer_lag`, `drovi_kafka_consumer_queue_depth`, `drovi_kafka_consumer_paused`, `drovi_kafka_consumer_last_poll_timestamp_seconds`
- Evidence: `drovi_evidence_latency_seconds`, `drovi_evidence_requests_total`
- Live sessions: `drovi_streaming_latency_seconds`, `drovi_streaming_backpressure_total`, `drovi_streaming_dropped_total`, `drovi_transcript_ingest_duration_seconds`
- Identity resolution: `drovi_identity_resolution_attempts_total`, `drovi_identity_resolution_success_total`
- Memory decay: `drovi_memory_decay_runs_total`, `drovi_nodes_decayed_total`, `drovi_nodes_archived_total`
- Build info: `drovi_build_info`

## SLOs (Recommended)
- API availability: 99.9% (5xx rate < 0.1%)
- API latency: p95 < 1s, p99 < 2.5s
- Ingestion latency: UEM persist p95 < 500ms
- Extraction latency: p95 < 30s

## Notes
- Use alertmanager or PagerDuty to route critical alerts.
- Run synthetic checks for `/health` and `/ready` endpoints.
