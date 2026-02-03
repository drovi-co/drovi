# Drovi Migration Plan (UEM + Candidates + Bi-Temporal)

## Scope
Move from legacy message/conversation-only storage to the Unified Event Model (UEM),
signal candidate store, and bi-temporal UIOs without downtime.

---

## Step 1: Deploy Schema
- Apply migrations up to:
  - `016_create_unified_event_model`
  - `017_create_contact_identity_table`
  - `018_create_signal_candidate_table`
  - `019_add_bitemporal_fields_to_uios`

## Step 2: Backfill Unified Events
Run:
```
python drovi-intelligence/scripts/backfill_unified_events.py
```
Validates:
- `unified_event` row count grows
- No duplicate `content_hash` per org

## Step 3: Enable Candidate Persistence
- Deploy app with `persist_candidates` node enabled.
- Verify candidate insertions:
  - `SELECT COUNT(*) FROM signal_candidate;`

## Step 4: Bi-Temporal Validation
- New UIOs should have `valid_from` and `system_from` populated.
- Superseded UIOs should have `valid_to` and `system_to` set.

## Step 5: Cutover
- Use `/signals/events` and `/signals/candidates` for UI/agent queries.
- Keep legacy `conversation/message` read paths for 2 releases.

## Step 6: Deprecation
- After 2 releases and a full backfill audit:
  - Freeze legacy UEM backfill job
  - Migrate UI to unified_event as primary source
  - Keep conversation/message for archival only
