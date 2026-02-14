# AgentOS Autonomy Tiers and Side-Effect Classes

## Autonomy tiers

| Tier | Name | Allowed behavior | Forbidden behavior |
| --- | --- | --- | --- |
| L0 | Observe | Read-only analysis and reporting. | Any side effect. |
| L1 | Recommend | Draft actions/work products for human approval. | Auto-send/commit side effects. |
| L2 | Execute Low Risk | Auto-execute low-risk writes with policy checks. | High-risk external commits without approval. |
| L3 | Execute With Guardrails | Execute high-risk actions with explicit approval policy. | Actions outside granted permissions or missing proof. |
| L4 | Trusted Operator | Broad automation in bounded systems; still policy-gated. | Bypassing policy, audit, or approval constraints. |

## Side-effect classes

| Class | Examples | Default tier | Approval default |
| --- | --- | --- | --- |
| S0 Read-only | Query data, summarize timelines, classify messages | L0 | Not required |
| S1 Low-risk internal writes | Create internal task, add draft note, label ticket | L2 | Not required |
| S2 Medium-risk internal/external writes | Send internal status update, update CRM stage, schedule meetings | L2/L3 | Role/org policy driven |
| S3 High-risk external commit | Send legal advice, submit filing, execute payment, publish customer communication | L3/L4 | Required |
| S4 Irreversible/regulated | Regulatory filing, money movement, contract execution | L4 | Multi-approver required |

## Mandatory invariants

- High-stakes classes (`S3`, `S4`) require evidence-linked justification.
- If policy evaluation returns `deny`, action does not execute.
- If policy evaluation returns `require_approval`, action pauses until resolution.
- Every side effect emits run-step, policy decision, and audit record.

## Edge-case policy

- Missing organization context -> deny.
- Missing identity binding -> deny.
- Missing memory scope grant -> deny.
- Missing proof for required classes -> deny.
- Ambiguous recipient/tool target -> require clarification (no silent guess).
