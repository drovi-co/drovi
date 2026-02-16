# AgentOS Vocabulary Migration

## Purpose

Standardize product language away from `Continuums` so users see AgentOS primitives everywhere.

## Canonical naming

| Legacy term | AgentOS term | Notes |
| --- | --- | --- |
| Continuum | Agent Role | Job definition for an AI employee. |
| Continuum Definition | Agent Playbook | Objective + SOP + constraints + escalation rules. |
| Continuum Runtime | Agent Runtime | Durable execution lifecycle. |
| Continuum Schedule | Agent Trigger | Event/schedule/manual trigger. |
| Continuum Builder | Agent Studio | Role/profile/playbook authoring UI. |
| Continuum Exchange | Agent Catalog | Templates and installable packs. |
| Continuum Runs | Agent Runs | Traceable execution runs with audit/proof. |
| Continuum Marketplace Bundle | Agent Template | Installable role pack. |

## UI naming standards

- Use **AI Employee** for user-facing copy.
- Use **Agent** for technical objects and APIs.
- Never introduce new user-facing labels with `Continuum` from this point forward.
- Existing routes may remain temporarily for compatibility, but labels must use AgentOS names.

## Current compatibility policy

- Existing routes `/dashboard/continuums`, `/dashboard/builder`, `/dashboard/exchange` are compatibility shells.
- Labels/breadcrumbs/intent commands should be migrated to AgentOS wording.
- Backend compatibility endpoints remain until Phase 13 decommission.

## API naming policy

- New APIs must be under `/api/v1/agents/*`.
- Existing `/api/v1/continuums*` endpoints are legacy and must be treated as migration-only surfaces.

## Done criteria

- No new strings, docs, or UI labels use `Continuum` except in migration notes.
- New features and roadmap references use AgentOS primitives only.
