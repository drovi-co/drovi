use axum::{
    extract::{Query, State},
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use imperium_infra::{error::AppError, SharedAppState};
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, time::Duration};
use tokio_stream::StreamExt;
use utoipa::{IntoParams, ToSchema};

use crate::routes::context::AuthContext;

#[derive(Debug, Serialize, ToSchema)]
pub struct AlertRuleView {
    pub rule_id: String,
    pub category: String,
    pub name: String,
    pub threshold: f64,
    pub cooldown_seconds: u64,
    pub enabled: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AlertEventView {
    pub alert_id: String,
    pub category: String,
    pub title: String,
    pub what_happened: String,
    pub why_it_matters: String,
    pub what_to_watch_next: String,
    pub dedupe_key: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AlertSimulationRequest {
    pub category: String,
    pub target: String,
    pub threshold: f64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AlertSimulationResponse {
    pub should_trigger: bool,
    pub dedupe_key: String,
    pub explanation: String,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct AlertStreamQuery {
    pub subject: Option<String>,
    pub event: Option<String>,
    pub heartbeat_seconds: Option<u64>,
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/alerts/rules",
    tag = "imperium",
    responses(
        (status = 200, description = "Alert rules", body = [AlertRuleView])
    )
)]
pub async fn rules(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<Vec<AlertRuleView>>, AppError> {
    let service = imperium_alerts::AlertEngineService;
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let mut rules = state.repository.list_alert_rules(user_id).await?;
    if rules.is_empty() {
        rules = service.sample_rules(user_id);
    }

    Ok(Json(
        rules
            .into_iter()
            .map(|rule| AlertRuleView {
                rule_id: rule.rule_id.to_string(),
                category: rule.category,
                name: rule.name,
                threshold: rule.threshold,
                cooldown_seconds: rule.cooldown_seconds,
                enabled: rule.enabled,
            })
            .collect(),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/alerts/feed",
    tag = "imperium",
    responses(
        (status = 200, description = "Alert feed", body = [AlertEventView])
    )
)]
pub async fn feed(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<Vec<AlertEventView>>, AppError> {
    let service = imperium_alerts::AlertEngineService;
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let persisted = state.repository.list_alert_events(user_id, 100).await?;
    if !persisted.is_empty() {
        return Ok(Json(
            persisted
                .into_iter()
                .map(|event| AlertEventView {
                    alert_id: event.alert_id.to_string(),
                    category: event.category,
                    title: event.title,
                    what_happened: event.what_happened,
                    why_it_matters: event.why_it_matters,
                    what_to_watch_next: event.what_to_watch_next,
                    dedupe_key: event.dedupe_key,
                    created_at: event.created_at.to_rfc3339(),
                })
                .collect(),
        ));
    }

    Ok(Json(
        service
            .sample_feed()
            .into_iter()
            .map(|event| AlertEventView {
                alert_id: event.alert_id,
                category: event.category,
                title: event.title,
                what_happened: event.what_happened,
                why_it_matters: event.why_it_matters,
                what_to_watch_next: event.what_to_watch_next,
                dedupe_key: event.dedupe_key,
                created_at: event.created_at,
            })
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/alerts/simulate",
    tag = "imperium",
    request_body = AlertSimulationRequest,
    responses(
        (status = 200, description = "Alert simulation result", body = AlertSimulationResponse)
    )
)]
pub async fn simulate(
    Json(payload): Json<AlertSimulationRequest>,
) -> Json<AlertSimulationResponse> {
    let dedupe_key = imperium_domain::alerts::dedupe_key(&payload.category, &payload.target, "now");

    Json(AlertSimulationResponse {
        should_trigger: payload.threshold > 0.0,
        dedupe_key,
        explanation:
            "Simulation is scaffold-level and validates dedupe key and threshold semantics."
                .to_string(),
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/alerts/stream/sse",
    tag = "imperium",
    params(AlertStreamQuery),
    responses(
        (status = 200, description = "Server-sent alert stream")
    )
)]
pub async fn stream_sse(
    State(state): State<SharedAppState>,
    Query(query): Query<AlertStreamQuery>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, AppError> {
    let subject = query
        .subject
        .unwrap_or_else(|| "imperium.alert.event".to_string());
    let event_name = query.event.unwrap_or_else(|| "alert_event".to_string());
    let heartbeat_seconds = query.heartbeat_seconds.unwrap_or(15).clamp(5, 120);

    let subscriber = state.nats.subscribe(&subject).await?;
    let stream = subscriber.map(move |message| {
        let payload = String::from_utf8_lossy(&message.payload).to_string();
        Ok::<Event, Infallible>(Event::default().event(event_name.clone()).data(payload))
    });

    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(heartbeat_seconds))
            .text("keepalive"),
    ))
}
