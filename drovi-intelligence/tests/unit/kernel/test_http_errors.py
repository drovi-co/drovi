from __future__ import annotations

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from src.api.middleware.security import RequestIDMiddleware
from src.kernel.errors import DroviError
from src.kernel.http.errors import register_exception_handlers


@pytest.mark.unit
def test_drovi_error_payload_shape_includes_code_and_request_id():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)
    register_exception_handlers(app)

    @app.get("/boom")
    async def boom():  # pragma: no cover - exercised via request
        raise DroviError(code="test.bad_request", message="Nope", status_code=400)

    client = TestClient(app)
    response = client.get("/boom", headers={"X-Request-ID": "req_123"})
    assert response.status_code == 400
    assert response.json() == {"detail": "Nope", "code": "test.bad_request", "request_id": "req_123"}


@pytest.mark.unit
def test_http_exception_payload_shape_preserves_detail():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)
    register_exception_handlers(app)

    @app.get("/forbidden")
    async def forbidden():  # pragma: no cover - exercised via request
        raise HTTPException(status_code=403, detail="Forbidden")

    client = TestClient(app)
    response = client.get("/forbidden", headers={"X-Request-ID": "req_999"})
    assert response.status_code == 403
    payload = response.json()
    assert payload["detail"] == "Forbidden"
    assert payload["code"] == "http.403"
    assert payload["request_id"] == "req_999"


@pytest.mark.unit
def test_request_validation_error_payload_shape_is_stable():
    app = FastAPI()
    app.add_middleware(RequestIDMiddleware)
    register_exception_handlers(app)

    class Body(BaseModel):
        value: int

    @app.post("/validate")
    async def validate(body: Body):  # pragma: no cover - exercised via request
        return {"ok": True, "value": body.value}

    client = TestClient(app)
    response = client.post("/validate", json={"value": "not-an-int"})
    assert response.status_code == 422
    payload = response.json()
    assert isinstance(payload.get("detail"), list)
    assert payload.get("code") == "http.validation_error"

