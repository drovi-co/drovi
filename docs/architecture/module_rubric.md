# Drovi Module Rubric (Contexts + Layers)

This repo is moving toward a **modular monolith** organized as bounded contexts under `drovi-intelligence/src/contexts/*`.

Each context follows a hexagonal-ish shape:

- `domain/`: entities, value objects, invariants. No IO. No SQL. No HTTP.
- `application/`: use-cases (commands/queries), orchestration, policy composition. No HTTP. No framework types.
- `infrastructure/`: IO adapters: Postgres, Kafka, FalkorDB, object stores, OAuth clients.
- `presentation/`: FastAPI routes, request parsing, response mapping. Must be thin.

## Allowed Dependencies (Rules Of Thumb)

- `domain` can import:
  - `src/kernel/*`
  - stdlib + pure types
- `application` can import:
  - `domain`
  - `src/kernel/*`
  - ports/interfaces defined in `domain` or `application`
- `infrastructure` can import:
  - `application`, `domain`, `src/kernel/*`
  - SQLAlchemy/asyncpg, SDKs, clients, etc.
- `presentation` can import:
  - `application`
  - FastAPI/Starlette types
  - mapping/DTOs (ideally local)

Anti-patterns:

- `domain` importing `fastapi`, `sqlalchemy`, or `src.api.*`.
- `application` doing raw SQL.
- `presentation` embedding business logic or complex query building.

## Migration Guide (Strangler)

We will not big-bang rewrite. Instead:

1. Introduce empty context skeletons.
2. Add use-cases in `contexts/*/application`.
3. Add small “anti-corruption adapters” so existing routes can call new use-cases.
4. Move code module-by-module, keeping old imports working via thin shims until deleted.

## Current Code → Future Context Hints

These are starting points (not exhaustive):

- `src/auth/**` → `contexts/auth/*`
- `src/api/routes/org.py` → `contexts/org/presentation/*` (with use-cases in `contexts/org/application/*`)
- `src/connectors/**` → `contexts/connectors/*`
- `src/ingestion/**`, `src/streaming/**` → `contexts/ingestion/*`
- `src/evidence/**` → `contexts/evidence/*`
- `src/documents/**` → `contexts/documents/*`
- `src/search/**`, `src/graphrag/**` → `contexts/search/*` (split retrieval vs synthesis later)
- `src/notifications/**` → `contexts/notifications/*`
- admin support endpoints → `contexts/admin_ops/*`

## Kernel vs Context

`src/kernel/*` is for primitives shared across contexts:

- time, ids, hashing, serialization, error taxonomy

Kernel must not depend on `src.api.*` or any particular context.

