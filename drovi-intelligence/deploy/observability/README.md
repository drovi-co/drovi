# Observability (Prometheus + Grafana)

## Prometheus
- Scrape the API metrics endpoint: `/monitoring/metrics`
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

## SLOs (Recommended)
- API availability: 99.9% (5xx rate < 0.1%)
- API latency: p95 < 1s, p99 < 2.5s
- Ingestion latency: UEM persist p95 < 500ms
- Extraction latency: p95 < 30s

## Notes
- Use alertmanager or PagerDuty to route critical alerts.
- Run synthetic checks for `/health` and `/ready` endpoints.
