# AgentOS Proof Requirements

## Goal

Ensure all high-stakes outputs and actions are evidence-anchored and auditable.

## Evidence primitives

- `evidence_artifact_id`: immutable artifact reference.
- `segment_hash`: stable hash for quoted source segment.
- `quote_span`: precise excerpt metadata (offsets/pages/timestamps).
- `claim_id`: unique claim identifier within a run.

## Proof policy by output/action class

| Class | Proof requirement | Persist/action rule |
| --- | --- | --- |
| Informational summary | At least one supporting citation recommended. | Persist allowed with confidence note. |
| Operational recommendation | At least one citation per recommendation block. | Persist allowed; no action without policy check. |
| High-stakes recommendation | Evidence citation per critical claim. | No persist if required evidence missing. |
| Low-risk side effect | At least one supporting context citation. | Action allowed if policy allows. |
| High-risk side effect | Citation + quote span + explicit reasoning record. | No evidence -> no action. |
| Regulated side effect | Citation + quote span + approver-linked rationale. | No evidence or no approval -> no action. |

## Response rendering requirements

User-visible responses for high-stakes tasks must include:
- `Why this matters`
- `What changed`
- `Evidence`
- `Next action / approval state`

## Failure behavior

- If proof retrieval fails: return `evidence_unavailable` and block high-stakes action.
- If contradiction check fails: mark output as `needs_review` and block high-stakes action.
- If evidence is stale/outdated vs current timeline: downgrade confidence and require approval.
