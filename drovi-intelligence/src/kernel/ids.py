from __future__ import annotations

import re
from uuid import uuid4


_PREFIX_RE = re.compile(r"^[a-z][a-z0-9]{1,24}$")


def new_prefixed_id(prefix: str) -> str:
    """Generate a new stable-looking ID using a short prefix.

    Format: `{prefix}_{uuidhex}`.

    Notes:
    - UUIDv4 is not time-sortable. We intentionally keep this simple until
      Phase 9 introduces keyset pagination everywhere and we can switch to a
      sortable ID (ULID/UUIDv7) in a controlled migration.
    """
    if not _PREFIX_RE.fullmatch(prefix):
        raise ValueError(
            "Invalid id prefix. Expected lowercase letters/digits, 2-25 chars, "
            "starting with a letter."
        )
    return f"{prefix}_{uuid4().hex}"


def is_prefixed_id(value: str, prefix: str) -> bool:
    """Return True if `value` starts with the `{prefix}_` convention."""
    return value.startswith(f"{prefix}_")

