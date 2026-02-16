# Imperium Runbooks

## Purpose

Operational playbooks for incidents that can break the 05:00 briefing ritual or intraday tracking.

## Runbooks

- `/Users/jeremyscatigna/project-memory/docs/imperium/runbooks/market-or-news-provider-outage.md`
- `/Users/jeremyscatigna/project-memory/docs/imperium/runbooks/stale-brief-or-worker-failure.md`

## Primary Ops Endpoints

- `GET /metrics`
- `GET /api/v1/imperium/ops/dlq`
- `POST /api/v1/imperium/ops/dlq/{event_id}/replay`
- `GET /api/v1/imperium/ops/audit`
