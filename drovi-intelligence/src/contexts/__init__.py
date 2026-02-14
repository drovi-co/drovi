"""Bounded contexts (modular monolith).

Each context follows a hexagonal-ish structure:
- domain: entities/value objects/invariants (no IO)
- application: use-cases/commands/queries (orchestrates domain)
- infrastructure: DB/queue/external adapters (IO lives here)
- presentation: HTTP/CLI/webhook adapters (thin)
"""

