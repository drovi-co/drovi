from src.mlops import InferenceGateway, InferenceRequest, build_default_route


def test_inference_gateway_uses_fallback_when_primary_response_invalid() -> None:
    gateway = InferenceGateway()
    gateway.register(
        route=build_default_route(
            route_id="route_prod_bad",
            backend_id="llm-prod",
            model_family="verifier_nli",
            model_stage="prod",
            risk_class="critical",
            latency_p95_ms=200,
            cost_per_1k_tokens=0.7,
        ),
        handler=lambda _payload: {"unexpected": True},
        required_response_keys={"score"},
    )
    gateway.register(
        route=build_default_route(
            route_id="route_canary_ok",
            backend_id="llm-canary",
            model_family="verifier_nli",
            model_stage="canary",
            risk_class="high",
            latency_p95_ms=250,
            cost_per_1k_tokens=0.6,
        ),
        handler=lambda _payload: {"score": 0.81},
        required_response_keys={"score"},
    )

    response = gateway.infer(
        InferenceRequest(
            request_id="req_1",
            model_family="verifier_nli",
            payload={"claim": "X", "evidence": "Y"},
            risk_class="high",
            latency_budget_ms=500,
            cost_budget_per_1k_tokens=1.0,
        )
    )

    assert response.backend_id == "llm-canary"
    assert response.fallback_used is True
    assert response.payload["score"] == 0.81


def test_inference_gateway_batch_path_keeps_output_contract() -> None:
    gateway = InferenceGateway()
    gateway.register(
        route=build_default_route(
            route_id="route_prod_ok",
            backend_id="temporal-prod",
            model_family="temporal_forecast",
            model_stage="prod",
            risk_class="medium",
            latency_p95_ms=120,
            cost_per_1k_tokens=0.2,
        ),
        handler=lambda payload: {"prediction": payload["x"] + 1},
        required_response_keys={"prediction"},
    )
    results = gateway.run_batch(
        [
            InferenceRequest(
                request_id="r1",
                model_family="temporal_forecast",
                payload={"x": 1},
            ),
            InferenceRequest(
                request_id="r2",
                model_family="temporal_forecast",
                payload={"x": 2},
            ),
        ]
    )

    assert len(results) == 2
    assert results[0].payload["prediction"] == 2
    assert results[1].payload["prediction"] == 3

