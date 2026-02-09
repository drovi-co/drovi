# Observability (Prometheus + Grafana)

This folder contains a dev/prod-parity observability bundle:
- Prometheus scrapes the Drovi API `/metrics` plus internal worker metrics endpoints.
- Alertmanager routes firing/resolved alerts to Drovi via a webhook.
- Grafana is provisioned with a Prometheus datasource and baseline dashboards.

The docker compose wiring lives at:
- `/Users/jeremyscatigna/project-memory/docker-compose.yml`

## Prometheus
- Scrape the API metrics endpoint: `/metrics`
- Scrape worker metrics (started when `PROMETHEUS_METRICS_PORT` is set):
  - `drovi-worker:9101/metrics`
  - `drovi-jobs-worker:9102/metrics`
  - `drovi-scheduler:9103/metrics`
- Load alert rules from `deploy/observability/prometheus-alerts.yml`

## Grafana
- Provisioning is configured in `deploy/observability/grafana/provisioning/`.
- The baseline dashboard is at `deploy/observability/grafana/dashboards/drovi-intelligence-overview.json`.
- Default dev credentials (set in docker compose):
  - user: `admin`
  - pass: `admin`

## Metrics Catalog
- HTTP: `drovi_http_requests_total`, `drovi_http_request_duration_seconds`
- Extraction: `drovi_extractions_total`, `drovi_extraction_duration_seconds`, `drovi_uios_extracted_total`, `drovi_entities_extracted_total`
- UEM/Ingestion: `drovi_uem_events_total`, `drovi_uem_persist_duration_seconds`
- Connector sync: `drovi_sync_jobs_total`, `drovi_sync_job_duration_seconds`, `drovi_records_synced_total`, `drovi_connector_last_success_timestamp_seconds`, `drovi_connector_last_error_timestamp_seconds`, `drovi_connector_time_to_first_data_seconds`
- Graph ops: `drovi_graph_operations_total`, `drovi_graph_operation_duration_seconds`, `drovi_graph_nodes_total`, `drovi_graph_edges_total`
- LLM usage: `drovi_llm_requests_total`, `drovi_llm_request_duration_seconds`, `drovi_llm_tokens_total`
- Search: `drovi_search_requests_total`, `drovi_search_duration_seconds`, `drovi_search_results_count`
- Streaming/events: `drovi_events_published_total`, `drovi_active_event_subscriptions`
- Kafka consumer: `drovi_kafka_consumer_lag`, `drovi_kafka_consumer_queue_depth`, `drovi_kafka_consumer_paused`, `drovi_kafka_consumer_last_poll_timestamp_seconds`
- Evidence: `drovi_evidence_latency_seconds`, `drovi_evidence_requests_total`
- Proof-first: `drovi_evidence_completeness_total`
- Live sessions: `drovi_streaming_latency_seconds`, `drovi_streaming_backpressure_total`, `drovi_streaming_dropped_total`, `drovi_transcript_ingest_duration_seconds`
- Identity resolution: `drovi_identity_resolution_attempts_total`, `drovi_identity_resolution_success_total`
- Memory decay: `drovi_memory_decay_runs_total`, `drovi_nodes_decayed_total`, `drovi_nodes_archived_total`
- Build info: `drovi_build_info`

## Alerting (Slack/Email)
Alertmanager is configured to POST to:
- `/api/v1/monitoring/alerts/webhook`

Configuration:
- `MONITORING_ALERT_WEBHOOK_TOKEN`
  - dev fallback: `dev` (only when `ENVIRONMENT != production`)
- `MONITORING_ALERT_EMAIL_TO`
  - comma-separated list of recipients (requires Resend configured)
- `MONITORING_ALERT_SLACK_WEBHOOK_URL`

## SLOs (Pilot-Grade)
Suggested SLOs and where to measure them:
- Time-to-first-data after connect
  - `drovi_connector_time_to_first_data_seconds` histogram (observed on first successful sync).
- Backfill throughput
  - `drovi_records_synced_total` vs `drovi_sync_job_duration_seconds`.
- New-event ingestion freshness
  - `drovi_connector_last_success_timestamp_seconds` (alert if stale).
- API p95 latency
  - `drovi_http_request_duration_seconds` histogram.
- Extraction success rate
  - `drovi_extractions_total{status="ok"|"error"}`.
- Evidence completeness rate
  - Track evidence-present vs evidence-missing at persistence time (TODO: metric hardening as we add doc spans + proof-first).

## Notes
- In production, secure the admin APIs and metrics endpoints via network-level controls and auth.
