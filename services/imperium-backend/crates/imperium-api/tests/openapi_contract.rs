#[test]
fn openapi_contains_core_routes() {
    let document = imperium_api::openapi::openapi_json();

    let paths = document
        .get("paths")
        .and_then(|value| value.as_object())
        .expect("OpenAPI paths section is missing");

    assert!(paths.contains_key("/api/v1/imperium/health"));
    assert!(paths.contains_key("/api/v1/imperium/ready"));
    assert!(paths.contains_key("/api/v1/imperium/meta"));
    assert!(paths.contains_key("/api/v1/imperium/providers"));
    assert!(paths.contains_key("/api/v1/imperium/providers/health"));
    assert!(paths.contains_key("/api/v1/imperium/openapi.json"));
    assert!(paths.contains_key("/api/v1/imperium/metrics"));
    assert!(paths.contains_key("/api/v1/imperium/ops/dlq"));
    assert!(paths.contains_key("/api/v1/imperium/ops/dlq/{event_id}/replay"));
    assert!(paths.contains_key("/api/v1/imperium/ops/audit"));
    assert!(paths.contains_key("/api/v1/imperium/auth/session/token"));
    assert!(paths.contains_key("/api/v1/imperium/markets/watchlist"));
    assert!(paths.contains_key("/api/v1/imperium/markets/watchlist/{symbol}"));
    assert!(paths.contains_key("/api/v1/imperium/markets/stream/sse"));
    assert!(paths.contains_key("/api/v1/imperium/intelligence/inbox"));
    assert!(paths.contains_key("/api/v1/imperium/brief/today"));
    assert!(paths.contains_key("/api/v1/imperium/portfolio/overview"));
    assert!(paths.contains_key("/api/v1/imperium/business/overview"));
    assert!(paths.contains_key("/api/v1/imperium/alerts/feed"));
    assert!(paths.contains_key("/api/v1/imperium/alerts/stream/sse"));
    assert!(paths.contains_key("/api/v1/imperium/risk/regime"));
    assert!(paths.contains_key("/api/v1/imperium/journal/theses"));
    assert!(paths.contains_key("/api/v1/imperium/journal/theses/{thesis_id}/archive"));
    assert!(paths.contains_key("/api/v1/imperium/journal/playbooks/{playbook_id}/toggle"));
}
