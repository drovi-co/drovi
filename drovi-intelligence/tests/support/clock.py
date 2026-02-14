from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass
class FakeClock:
    """
    Minimal deterministic clock for tests.

    New domain/application code should consume time via a kernel clock interface
    (introduced in Phase 1). This helper lets tests move time forward explicitly.
    """

    now_utc: datetime

    @classmethod
    def fixed(cls, *, year: int = 2026, month: int = 1, day: int = 1) -> "FakeClock":
        return cls(now_utc=datetime(year, month, day, 0, 0, 0, tzinfo=timezone.utc))

    def now(self) -> datetime:
        return self.now_utc

    def advance(self, delta: timedelta) -> None:
        self.now_utc = self.now_utc + delta

