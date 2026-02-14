"""Kernel utilities shared across bounded contexts.

Rules:
- Kernel code must not import from presentation layers (e.g. FastAPI routes).
- Kernel utilities should stay small and stable; avoid business logic here.
"""

