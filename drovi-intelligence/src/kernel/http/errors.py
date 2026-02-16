from __future__ import annotations

from typing import Any

import structlog
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from src.kernel.errors import DroviError

logger = structlog.get_logger()


def _get_request_id(request: Request) -> str | None:
    return getattr(getattr(request, "state", None), "request_id", None)


def register_exception_handlers(app: FastAPI) -> None:
    """Register Drovi-wide exception handlers on a FastAPI app.

    We keep FastAPI-compatible `detail` while adding stable `code` + `request_id`.
    """

    @app.exception_handler(DroviError)
    async def _drovi_error_handler(request: Request, exc: DroviError) -> Response:
        request_id = _get_request_id(request)
        return JSONResponse(status_code=exc.status_code, content=exc.to_public_dict(request_id=request_id))

    @app.exception_handler(HTTPException)
    async def _http_exception_handler(request: Request, exc: HTTPException) -> Response:
        request_id = _get_request_id(request)

        # Preserve existing shapes: FastAPI sometimes uses `detail` as str or list/dict.
        payload: dict[str, Any] = {
            "detail": exc.detail,
            "code": f"http.{exc.status_code}",
        }
        if request_id:
            payload["request_id"] = request_id

        headers = dict(exc.headers or {})
        return JSONResponse(status_code=int(exc.status_code), content=payload, headers=headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error_handler(request: Request, exc: RequestValidationError) -> Response:
        request_id = _get_request_id(request)
        payload: dict[str, Any] = {
            "detail": exc.errors(),
            "code": "http.validation_error",
        }
        if request_id:
            payload["request_id"] = request_id
        return JSONResponse(status_code=422, content=payload)

    @app.exception_handler(Exception)
    async def _unhandled_exception_handler(request: Request, exc: Exception) -> Response:
        request_id = _get_request_id(request)
        logger.exception("Unhandled exception", request_id=request_id, error=str(exc))

        payload: dict[str, Any] = {
            "detail": "Internal Server Error",
            "code": "internal.unhandled",
        }
        if request_id:
            payload["request_id"] = request_id
        return JSONResponse(status_code=500, content=payload)

