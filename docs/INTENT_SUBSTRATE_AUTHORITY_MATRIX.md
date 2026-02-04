# Intent Substrate Authority Matrix

This matrix defines the authoritative source for truth, evidence, and actions.

| Domain | Authoritative System | Notes |
| --- | --- | --- |
| Raw Events | Unified Event Model (UEM) | Immutable event stream (source of ingestion truth). |
| Evidence Storage | Evidence Store | Immutable evidence blobs + hash chain. |
| Truth State | Reality Fabric | Bi‑temporal world state with validFrom/validTo. |
| Continuum State | Continuum Runtime | Goal lifecycle, status, and escalations. |
| Executions | Actuation Plane | Action log with policy and approvals. |
| Policies | Policy Core | Policy‑as‑code runtime and access rules. |
| UI Output | Proof Core | Every output references evidence + confidence. |
| Analytics | Truth Aggregates | Derived views (never authoritative). |

**Rules**
- No system may overwrite Reality Fabric without Proof Core verification.
- Evidence Store is immutable; only references exist in other systems.
- Executions require policy checks + audit log entry.
- Analytics views are read‑only and cannot mutate truth.

