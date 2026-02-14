# Internal Pilot Runbook

## Goal
Validate extraction quality, correction rate trends, and evidence trustworthiness in a real pilot environment.

## Setup
1. Create a pilot organization and API key.
2. Connect at least 3 sources (email, Slack, calendar/meeting).
3. Enable Kafka ingestion and evidence storage (MinIO/S3).
4. Confirm `/api/v1/monitoring/metrics` is scraped and dashboards are visible.
5. Seed AgentOS demo baseline (optional but recommended):
   - `python scripts/seed_agentos_demo.py --org-id <ORG_ID> --owner-user-id <USER_ID>`

## Pilot Execution
1. Run the pilot for 2–4 weeks with real daily usage.
2. Ask pilot users to submit corrections in the UI for every inaccurate item.
3. Track correction rate weekly:
   - Corrections per extracted item
   - Corrections per user per week
   - Top error categories (commitment/decision/risk/task/claim)
4. Track AgentOS reliability weekly:
   - Agent run success rate
   - Agent run p95 latency
   - Approval backlog by org
   - Quality drift score by role

## Data Collection
1. Export corrections weekly:
   - `python drovi-intelligence/scripts/export_corrections_dataset.py`
2. Archive the dataset with timestamped filenames.
3. Feed corrections into the feedback pipeline:
   - `python drovi-intelligence/scripts/finetune.py` (if enabled)

## Success Criteria
- Correction rate trends downward week-over-week.
- Evidence links reduce disputes during review.
- Pilot users can explain decisions using evidence trails without manual digging.
