# Observability + SLOs

## Service Level Objectives
- API availability: 99.9% monthly
- API p95 latency: < 1.5s (all endpoints), < 5s for `/api/v1/ask`
- Streaming ingestion: < 5s median chunk‑to‑transcript latency
- Evidence retrieval: p95 < 2s
- Connector freshness: successful sync within 1h for active connectors
- Agent run success rate: >= 90% over rolling 15m
- Agent run p95 latency: < 120s over rolling 15m
- Agent approval backlog: < 20 pending approvals per organization
- Agent quality drift score: < 0.8 per role scope

## Metrics
- `drovi_http_requests_total` and `drovi_http_request_duration_seconds_bucket`
- `drovi_streaming_backpressure_total` (custom counter)
- `drovi_streaming_latency_seconds`
- `drovi_evidence_latency_seconds`
- `drovi_uem_persist_duration_seconds_bucket`
- `drovi_extraction_duration_seconds_bucket`
- `drovi_kafka_consumer_lag`
- `drovi_connector_last_success_timestamp_seconds`
- `drovi_agent_runs_status_total`
- `drovi_agent_run_duration_seconds_bucket`
- `drovi_agent_approval_backlog`
- `drovi_agent_quality_drift_score`

## Alerting
See `deploy/monitoring/alerts.yml` for Prometheus alerts.

## Dashboards
Recommended panels:
- Request rate/error rate/latency (p50/p95/p99)
- Streaming queue depth + backpressure
- Evidence read/write latency
- Kafka consumer lag
- Connector freshness by connector_type
- Agent run status transitions (`completed`, `failed`, `cancelled`)
- Agent run latency p50/p95
- Approval backlog by organization
- Drift score by role scope

## SLO Burn Alerts
Configure 1h and 6h burn alerts on the 99.9% availability error budget (0.1%):
- 1h burn fast: `error_rate / 0.001 > 14.4`
- 6h burn: `error_rate / 0.001 > 6`
These align with fast/slow multi-window alerting for availability SLOs.
