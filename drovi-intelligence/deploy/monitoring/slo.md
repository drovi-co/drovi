# Observability + SLOs

## Service Level Objectives
- API availability: 99.9% monthly
- API p95 latency: < 1.5s (all endpoints), < 5s for `/api/v1/ask`
- Streaming ingestion: < 5s median chunk‑to‑transcript latency
- Evidence retrieval: p95 < 2s
- Connector freshness: successful sync within 1h for active connectors

## Metrics
- `http_requests_total` and `http_request_duration_seconds_bucket`
- `drovi_streaming_backpressure_total` (custom counter)
- `drovi_evidence_latency_seconds`
- `drovi_connector_last_success_timestamp_seconds`

## Alerting
See `deploy/monitoring/alerts.yml` for Prometheus alerts.

## Dashboards
Recommended panels:
- Request rate/error rate/latency (p50/p95/p99)
- Streaming queue depth + backpressure
- Evidence read/write latency
- Kafka consumer lag
- Connector freshness by connector_type

## SLO Burn Alerts
Configure 1h and 6h burn alerts at 2x and 5x of error budget.
