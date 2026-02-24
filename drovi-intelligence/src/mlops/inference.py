"""Unified inference gateway with policy-aware routing and fallback cascades."""

from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from typing import Any, Callable

from src.mlops.models import (
    InferenceRequest,
    InferenceResponse,
    InferenceRoute,
    ModelFamily,
    ModelStage,
    RiskClass,
)


def _stage_rank(stage: ModelStage) -> int:
    return {"prod": 0, "canary": 1, "shadow": 2, "dev": 3}.get(stage, 99)


@dataclass(slots=True)
class RouteExecution:
    route: InferenceRoute
    handler: Callable[[dict[str, Any]], dict[str, Any]]
    required_response_keys: set[str]


class PolicyAwareRouter:
    """Selects model routes by risk class, latency budget, and cost budget."""

    _RISK_MIN_STAGE = {
        "low": {"dev", "shadow", "canary", "prod"},
        "medium": {"shadow", "canary", "prod"},
        "high": {"canary", "prod"},
        "critical": {"prod"},
    }

    def pick_routes(
        self,
        *,
        request: InferenceRequest,
        routes: list[InferenceRoute],
    ) -> list[InferenceRoute]:
        allowed_stages = self._RISK_MIN_STAGE.get(request.risk_class, {"prod"})
        candidates = [
            route
            for route in routes
            if route.model_stage in allowed_stages
            and route.latency_p95_ms <= request.latency_budget_ms
            and route.cost_per_1k_tokens <= request.cost_budget_per_1k_tokens
        ]
        if not candidates:
            # Always return at least prod routes so caller can attempt best effort.
            candidates = [route for route in routes if route.model_stage == "prod"] or routes
        return sorted(
            candidates,
            key=lambda route: (_stage_rank(route.model_stage), route.latency_p95_ms, route.cost_per_1k_tokens),
        )


class InferenceGateway:
    """Runs inference across neural/LLM backends with schema checks and fallback."""

    def __init__(self, *, router: PolicyAwareRouter | None = None) -> None:
        self._router = router or PolicyAwareRouter()
        self._routes: dict[str, RouteExecution] = {}

    def register(
        self,
        *,
        route: InferenceRoute,
        handler: Callable[[dict[str, Any]], dict[str, Any]],
        required_response_keys: set[str] | None = None,
    ) -> None:
        self._routes[route.route_id] = RouteExecution(
            route=route,
            handler=handler,
            required_response_keys=set(required_response_keys or []),
        )

    def infer(self, request: InferenceRequest) -> InferenceResponse:
        family_routes = [
            execution.route
            for execution in self._routes.values()
            if execution.route.model_family == request.model_family
        ]
        if not family_routes:
            raise ValueError(f"No routes registered for model family: {request.model_family}")

        route_order = self._router.pick_routes(request=request, routes=family_routes)
        last_error: str | None = None

        for idx, route in enumerate(route_order):
            execution = self._routes[route.route_id]
            started = perf_counter()
            try:
                payload = execution.handler(dict(request.payload))
                latency_ms = (perf_counter() - started) * 1000
                self._validate_response(payload=payload, required_keys=execution.required_response_keys)
                return InferenceResponse(
                    request_id=request.request_id,
                    route_id=route.route_id,
                    backend_id=route.backend_id,
                    model_stage=route.model_stage,
                    payload=payload,
                    latency_ms=round(latency_ms, 3),
                    estimated_cost_per_1k_tokens=route.cost_per_1k_tokens,
                    fallback_used=idx > 0,
                    metadata={"mode": request.mode, "risk_class": request.risk_class},
                )
            except Exception as exc:
                last_error = str(exc)
                continue

        raise ValueError(f"Inference failed across all routes: {last_error or 'unknown_error'}")

    def run_batch(self, requests: list[InferenceRequest]) -> list[InferenceResponse]:
        return [self.infer(request) for request in requests]

    @staticmethod
    def _validate_response(*, payload: dict[str, Any], required_keys: set[str]) -> None:
        if not isinstance(payload, dict):
            raise ValueError("Inference response must be a dictionary")
        missing = [key for key in required_keys if key not in payload]
        if missing:
            raise ValueError(f"Inference response missing keys: {', '.join(sorted(missing))}")


def build_default_route(
    *,
    route_id: str,
    backend_id: str,
    model_family: ModelFamily,
    model_stage: ModelStage,
    risk_class: RiskClass,
    latency_p95_ms: float,
    cost_per_1k_tokens: float,
) -> InferenceRoute:
    return InferenceRoute(
        route_id=route_id,
        backend_id=backend_id,
        model_family=model_family,
        model_stage=model_stage,
        risk_class=risk_class,
        latency_p95_ms=latency_p95_ms,
        cost_per_1k_tokens=cost_per_1k_tokens,
    )
