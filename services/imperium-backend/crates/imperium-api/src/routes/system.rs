use axum::{
    extract::{Path, Query, State},
    http::header,
    response::IntoResponse,
    Json,
};
use chrono::Utc;
use imperium_connectors::ConnectorRuntime;
use imperium_domain::security::new_audit_event;
use imperium_infra::{
    error::AppError,
    telemetry::{record_dead_letter_event, render_prometheus_metrics},
    DeadLetterEventRecord, SharedAppState, StoredAuditEvent,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::routes::context::AuthContext;

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiHealthResponse {
    pub status: &'static str,
    pub service: &'static str,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiMetaResponse {
    pub name: &'static str,
    pub version: &'static str,
    pub environment: String,
    pub data_mode: String,
    pub providers: Vec<ProviderConfigView>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiReadinessResponse {
    pub ready: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProviderConfigView {
    pub domain: String,
    pub primary: String,
    pub fallbacks: Vec<String>,
    pub configured: bool,
    pub required_credentials: Vec<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiProvidersResponse {
    pub mode: String,
    pub providers: Vec<ProviderConfigView>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProviderHealthView {
    pub domain: String,
    pub provider: String,
    pub healthy: bool,
    pub details: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiProvidersHealthResponse {
    pub mode: String,
    pub checked_at: String,
    pub checks: Vec<ProviderHealthView>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeadLetterEventView {
    pub event_id: String,
    pub worker_role: String,
    pub subject: String,
    pub payload: String,
    pub error_message: String,
    pub retry_count: i32,
    pub status: String,
    pub first_failed_at: String,
    pub last_failed_at: String,
    pub replayed_at: Option<String>,
    pub replayed_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiDeadLetterResponse {
    pub events: Vec<DeadLetterEventView>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReplayDeadLetterResponse {
    pub replayed: bool,
    pub event_id: String,
    pub subject: String,
    pub status: String,
    pub retry_count: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AuditEventView {
    pub event_id: String,
    pub stream_key: String,
    pub actor_user_id: Option<String>,
    pub action: String,
    pub target: String,
    pub metadata: String,
    pub payload_hash: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiAuditEventsResponse {
    pub events: Vec<AuditEventView>,
}

#[derive(Debug, Deserialize)]
pub struct DeadLetterQuery {
    pub limit: Option<usize>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AuditEventsQuery {
    pub limit: Option<usize>,
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/health",
    tag = "imperium",
    responses(
        (status = 200, description = "Service health", body = ApiHealthResponse)
    )
)]
pub async fn health() -> Json<ApiHealthResponse> {
    Json(ApiHealthResponse {
        status: "ok",
        service: "imperium-api",
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/ready",
    tag = "imperium",
    responses(
        (status = 200, description = "Dependencies ready", body = ApiReadinessResponse),
        (status = 503, description = "Dependencies unavailable")
    )
)]
pub async fn ready(
    State(state): State<SharedAppState>,
) -> Result<Json<ApiReadinessResponse>, AppError> {
    state.readiness_check().await?;

    Ok(Json(ApiReadinessResponse { ready: true }))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/meta",
    tag = "imperium",
    responses(
        (status = 200, description = "Service metadata", body = ApiMetaResponse)
    )
)]
pub async fn meta(State(state): State<SharedAppState>) -> Json<ApiMetaResponse> {
    let providers = provider_view(&state);

    Json(ApiMetaResponse {
        name: "imperium-api",
        version: env!("CARGO_PKG_VERSION"),
        environment: state.config.environment.clone(),
        data_mode: providers.mode,
        providers: providers.providers,
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/providers",
    tag = "imperium",
    responses(
        (status = 200, description = "Provider configuration", body = ApiProvidersResponse)
    )
)]
pub async fn providers(State(state): State<SharedAppState>) -> Json<ApiProvidersResponse> {
    Json(provider_view(&state))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/providers/health",
    tag = "imperium",
    responses(
        (status = 200, description = "Active provider health checks", body = ApiProvidersHealthResponse)
    )
)]
pub async fn providers_health(
    State(state): State<SharedAppState>,
) -> Json<ApiProvidersHealthResponse> {
    let checked_at = Utc::now().to_rfc3339();
    let mode = state.config.providers.mode.as_str().to_string();

    let runtime = match ConnectorRuntime::from_config(&state.config) {
        Ok(runtime) => runtime,
        Err(error) => {
            return Json(ApiProvidersHealthResponse {
                mode,
                checked_at,
                checks: vec![ProviderHealthView {
                    domain: "runtime".to_string(),
                    provider: "connectors".to_string(),
                    healthy: false,
                    details: format!("connector runtime initialization failed: {error}"),
                }],
            });
        }
    };

    let market_primary = state.config.providers.markets.primary.clone();
    let news_primary = state.config.providers.news.primary.clone();
    let banking_primary = state.config.providers.banking.primary.clone();

    let market_check =
        tokio::time::timeout(Duration::from_secs(8), runtime.market_provider_tick(1)).await;
    let market = match market_check {
        Ok(Ok(tick)) => {
            let fallback = tick.provider != market_primary;
            ProviderHealthView {
                domain: "markets".to_string(),
                provider: tick.provider.clone(),
                healthy: !fallback,
                details: if fallback {
                    format!(
                        "degraded: primary `{}` unavailable, serving fallback `{}`",
                        market_primary, tick.provider
                    )
                } else {
                    "ok".to_string()
                },
            }
        }
        Ok(Err(error)) => ProviderHealthView {
            domain: "markets".to_string(),
            provider: market_primary,
            healthy: false,
            details: error.to_string(),
        },
        Err(_) => ProviderHealthView {
            domain: "markets".to_string(),
            provider: market_primary,
            healthy: false,
            details: "timeout while checking market provider".to_string(),
        },
    };

    let news_check = tokio::time::timeout(Duration::from_secs(8), runtime.news_articles(1)).await;
    let news = match news_check {
        Ok(Ok(articles)) => {
            let source = articles
                .first()
                .map(|article| article.source.clone())
                .unwrap_or_else(|| news_primary.clone());
            let fallback = source != news_primary;
            ProviderHealthView {
                domain: "news".to_string(),
                provider: source.clone(),
                healthy: !fallback,
                details: if fallback {
                    format!(
                        "degraded: primary `{}` unavailable, serving fallback `{}`",
                        news_primary, source
                    )
                } else {
                    "ok".to_string()
                },
            }
        }
        Ok(Err(error)) => ProviderHealthView {
            domain: "news".to_string(),
            provider: news_primary,
            healthy: false,
            details: error.to_string(),
        },
        Err(_) => ProviderHealthView {
            domain: "news".to_string(),
            provider: news_primary,
            healthy: false,
            details: "timeout while checking news provider".to_string(),
        },
    };

    let banking_check =
        tokio::time::timeout(Duration::from_secs(10), runtime.portfolio_overview()).await;
    let banking = match banking_check {
        Ok(Ok(Some(overview))) => ProviderHealthView {
            domain: "banking".to_string(),
            provider: banking_primary,
            healthy: true,
            details: format!(
                "ok: {} accounts, net worth {:.2}",
                overview.accounts.len(),
                overview.net_worth
            ),
        },
        Ok(Ok(None)) => ProviderHealthView {
            domain: "banking".to_string(),
            provider: banking_primary,
            healthy: false,
            details: "no real banking snapshot available; synthetic path or fallback active"
                .to_string(),
        },
        Ok(Err(error)) => ProviderHealthView {
            domain: "banking".to_string(),
            provider: banking_primary,
            healthy: false,
            details: error.to_string(),
        },
        Err(_) => ProviderHealthView {
            domain: "banking".to_string(),
            provider: banking_primary,
            healthy: false,
            details: "timeout while checking banking provider".to_string(),
        },
    };

    Json(ApiProvidersHealthResponse {
        mode,
        checked_at,
        checks: vec![market, news, banking],
    })
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/openapi.json",
    tag = "imperium",
    responses(
        (status = 200, description = "OpenAPI document as JSON")
    )
)]
pub async fn openapi_document() -> Json<serde_json::Value> {
    Json(crate::openapi::openapi_json())
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/metrics",
    tag = "imperium",
    responses(
        (status = 200, description = "Prometheus metrics payload")
    )
)]
pub async fn metrics() -> impl IntoResponse {
    (
        [(
            header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        render_prometheus_metrics(),
    )
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/ops/dlq",
    tag = "imperium",
    responses(
        (status = 200, description = "Dead-letter queue events", body = ApiDeadLetterResponse)
    )
)]
pub async fn dead_letter_queue(
    _auth: AuthContext,
    State(state): State<SharedAppState>,
    Query(query): Query<DeadLetterQuery>,
) -> Result<Json<ApiDeadLetterResponse>, AppError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let status = query.status.as_deref();
    if let Some(value) = status {
        if value != "pending" && value != "replayed" {
            return Err(AppError::validation(
                "invalid status filter; expected pending|replayed",
            ));
        }
    }

    let events = state
        .repository
        .list_dead_letter_events(limit, status)
        .await?;
    Ok(Json(ApiDeadLetterResponse {
        events: events.into_iter().map(map_dead_letter_event).collect(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/ops/dlq/{event_id}/replay",
    tag = "imperium",
    responses(
        (status = 200, description = "Dead-letter event replayed", body = ReplayDeadLetterResponse),
        (status = 400, description = "Invalid event id or replay failure")
    )
)]
pub async fn replay_dead_letter(
    _auth: AuthContext,
    State(state): State<SharedAppState>,
    Path(event_id): Path<String>,
) -> Result<Json<ReplayDeadLetterResponse>, AppError> {
    let event_id = Uuid::parse_str(&event_id)
        .map_err(|_| AppError::validation("invalid dead-letter event id"))?;

    let Some(event) = state.repository.get_dead_letter_event(event_id).await? else {
        return Err(AppError::validation(format!(
            "dead-letter event {event_id} not found"
        )));
    };

    let subject = event.subject.clone();
    match state.nats.publish_json(&subject, &event.payload).await {
        Ok(()) => {
            state
                .repository
                .mark_dead_letter_replayed(event_id, "imperium-api")
                .await?;
            record_dead_letter_event(&event.worker_role, &event.subject, "replay");
            emit_ops_audit(
                &state,
                "dlq.replay.succeeded",
                format!("dead_letter:{event_id}"),
                serde_json::json!({
                    "worker_role": event.worker_role,
                    "subject": event.subject,
                }),
            )
            .await;

            Ok(Json(ReplayDeadLetterResponse {
                replayed: true,
                event_id: event_id.to_string(),
                subject,
                status: "replayed".to_string(),
                retry_count: event.retry_count,
            }))
        }
        Err(error) => {
            state
                .repository
                .record_dead_letter_retry_failure(event_id, &error.to_string())
                .await?;
            record_dead_letter_event(&event.worker_role, &event.subject, "replay_failed");
            emit_ops_audit(
                &state,
                "dlq.replay.failed",
                format!("dead_letter:{event_id}"),
                serde_json::json!({
                    "worker_role": event.worker_role,
                    "subject": event.subject,
                    "error": error.to_string(),
                }),
            )
            .await;

            Err(error)
        }
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/ops/audit",
    tag = "imperium",
    responses(
        (status = 200, description = "Audit feed", body = ApiAuditEventsResponse)
    )
)]
pub async fn audit_events(
    _auth: AuthContext,
    State(state): State<SharedAppState>,
    Query(query): Query<AuditEventsQuery>,
) -> Result<Json<ApiAuditEventsResponse>, AppError> {
    let limit = query.limit.unwrap_or(50).clamp(1, 500);
    let events = state.repository.list_audit_events(limit).await?;
    Ok(Json(ApiAuditEventsResponse {
        events: events.into_iter().map(map_audit_event).collect(),
    }))
}

fn provider_view(state: &SharedAppState) -> ApiProvidersResponse {
    let providers = state
        .config
        .providers
        .bindings()
        .into_iter()
        .map(|binding| ProviderConfigView {
            domain: binding.domain.as_str().to_string(),
            primary: binding.primary.clone(),
            fallbacks: binding.fallbacks.clone(),
            configured: binding.configured,
            required_credentials: binding.required_credentials.clone(),
        })
        .collect();

    ApiProvidersResponse {
        mode: state.config.providers.mode.as_str().to_string(),
        providers,
    }
}

fn map_dead_letter_event(event: DeadLetterEventRecord) -> DeadLetterEventView {
    DeadLetterEventView {
        event_id: event.event_id.to_string(),
        worker_role: event.worker_role,
        subject: event.subject,
        payload: event.payload.to_string(),
        error_message: event.error_message,
        retry_count: event.retry_count,
        status: event.status,
        first_failed_at: event.first_failed_at.to_rfc3339(),
        last_failed_at: event.last_failed_at.to_rfc3339(),
        replayed_at: event.replayed_at.map(|value| value.to_rfc3339()),
        replayed_by: event.replayed_by,
        created_at: event.created_at.to_rfc3339(),
        updated_at: event.updated_at.to_rfc3339(),
    }
}

fn map_audit_event(event: StoredAuditEvent) -> AuditEventView {
    AuditEventView {
        event_id: event.event_id.to_string(),
        stream_key: event.stream_key,
        actor_user_id: event.actor_user_id.map(|value| value.to_string()),
        action: event.action,
        target: event.target,
        metadata: event.metadata.to_string(),
        payload_hash: event.payload_hash,
        created_at: event.created_at.to_rfc3339(),
    }
}

async fn emit_ops_audit(
    state: &SharedAppState,
    action: impl Into<String>,
    target: impl Into<String>,
    metadata: serde_json::Value,
) {
    let event = new_audit_event(None, action, target, metadata);
    if let Err(error) = state
        .repository
        .append_audit_event("imperium.ops.audit", &event)
        .await
    {
        tracing::warn!("failed to persist ops audit event: {error}");
    }
}
