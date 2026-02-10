from __future__ import annotations

import re
from typing import Any


_ERROR_CODE_RE = re.compile(r"^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)*$")


class DroviError(Exception):
    """Base typed error for Drovi.

    Goals:
    - Stable `code` for programmatic handling across clients.
    - Human-readable `message` for UI surfaces.
    - Optional `meta` payload for debugging (safe-to-expose only).
    """

    def __init__(
        self,
        *,
        code: str,
        message: str,
        status_code: int = 500,
        meta: dict[str, Any] | None = None,
    ) -> None:
        if not _ERROR_CODE_RE.fullmatch(code):
            raise ValueError(
                "Invalid Drovi error code. Expected dot-separated lowercase tokens, "
                f"got: {code!r}"
            )
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = int(status_code)
        self.meta = dict(meta or {})

    def to_public_dict(self, *, request_id: str | None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            # Keep `detail` for compatibility with FastAPI error surfaces.
            "detail": self.message,
            "code": self.code,
        }
        if request_id:
            payload["request_id"] = request_id
        if self.meta:
            payload["meta"] = self.meta
        return payload


class NotFoundError(DroviError):
    def __init__(self, *, message: str = "Not found", code: str = "resource.not_found", meta: dict[str, Any] | None = None):
        super().__init__(code=code, message=message, status_code=404, meta=meta)


class UnauthorizedError(DroviError):
    def __init__(
        self,
        *,
        message: str = "Not authenticated",
        code: str = "auth.unauthorized",
        meta: dict[str, Any] | None = None,
    ):
        super().__init__(code=code, message=message, status_code=401, meta=meta)


class ForbiddenError(DroviError):
    def __init__(
        self,
        *,
        message: str = "Forbidden",
        code: str = "auth.forbidden",
        meta: dict[str, Any] | None = None,
    ):
        super().__init__(code=code, message=message, status_code=403, meta=meta)


class ConflictError(DroviError):
    def __init__(
        self,
        *,
        message: str = "Conflict",
        code: str = "request.conflict",
        meta: dict[str, Any] | None = None,
    ):
        super().__init__(code=code, message=message, status_code=409, meta=meta)


class ValidationError(DroviError):
    def __init__(
        self,
        *,
        message: str = "Validation error",
        code: str = "request.validation_error",
        meta: dict[str, Any] | None = None,
        status_code: int = 422,
    ):
        super().__init__(code=code, message=message, status_code=status_code, meta=meta)


class UpstreamError(DroviError):
    def __init__(
        self,
        *,
        message: str = "Upstream service error",
        code: str = "upstream.error",
        meta: dict[str, Any] | None = None,
        status_code: int = 502,
    ):
        super().__init__(code=code, message=message, status_code=status_code, meta=meta)

