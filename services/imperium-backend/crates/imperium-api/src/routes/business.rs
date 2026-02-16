use axum::{extract::State, Json};
use imperium_domain::business::detect_anomalies;
use imperium_infra::{error::AppError, SharedAppState};
use serde::Serialize;
use utoipa::ToSchema;

use crate::routes::context::AuthContext;

#[derive(Debug, Serialize, ToSchema)]
pub struct BusinessOverviewView {
    pub as_of: String,
    pub entity_name: String,
    pub mrr: f64,
    pub burn: f64,
    pub runway_months: f64,
    pub cash_balance: f64,
    pub overdue_invoices: usize,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BusinessMetricView {
    pub key: String,
    pub value: f64,
    pub window: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BusinessAnomalyView {
    pub metric_key: String,
    pub severity: String,
    pub message: String,
    pub recommended_action: String,
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/business/overview",
    tag = "imperium",
    responses(
        (status = 200, description = "Business command overview", body = BusinessOverviewView)
    )
)]
pub async fn overview(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<BusinessOverviewView>, AppError> {
    let service = imperium_business::BusinessCommandService::default();
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let overview = match state.repository.load_business_overview(user_id).await? {
        Some(overview) => overview,
        None => {
            let sample = service.current_overview();
            state
                .repository
                .upsert_business_snapshot(user_id, &sample, &service.metric_snapshot())
                .await?;
            sample
        }
    };

    Ok(Json(BusinessOverviewView {
        as_of: overview.as_of.to_rfc3339(),
        entity_name: overview.entity_name,
        mrr: overview.mrr,
        burn: overview.burn,
        runway_months: overview.runway_months,
        cash_balance: overview.cash_balance,
        overdue_invoices: overview.overdue_invoices,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/business/metrics",
    tag = "imperium",
    responses(
        (status = 200, description = "Business metric snapshot", body = [BusinessMetricView])
    )
)]
pub async fn metrics(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<Vec<BusinessMetricView>>, AppError> {
    let service = imperium_business::BusinessCommandService::default();
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let mut metrics = state
        .repository
        .list_business_metric_snapshot(user_id)
        .await?;
    if metrics.is_empty() {
        let sample_overview = service.current_overview();
        let sample_metrics = service.metric_snapshot();
        state
            .repository
            .upsert_business_snapshot(user_id, &sample_overview, &sample_metrics)
            .await?;
        metrics = sample_metrics;
    }

    Ok(Json(
        metrics
            .into_iter()
            .map(|metric| BusinessMetricView {
                key: metric.key,
                value: metric.value,
                window: metric.window,
            })
            .collect(),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/business/anomalies",
    tag = "imperium",
    responses(
        (status = 200, description = "Business anomalies", body = [BusinessAnomalyView])
    )
)]
pub async fn anomalies(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<Vec<BusinessAnomalyView>>, AppError> {
    let service = imperium_business::BusinessCommandService::default();
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let anomalies = match state.repository.load_business_overview(user_id).await? {
        Some(current) => {
            let previous = state
                .repository
                .load_previous_business_overview(user_id)
                .await?;
            detect_anomalies(&current, previous.as_ref())
        }
        None => service.anomaly_signals(),
    };

    Ok(Json(
        anomalies
            .into_iter()
            .map(|signal| BusinessAnomalyView {
                metric_key: signal.metric_key,
                severity: signal.severity,
                message: signal.message,
                recommended_action: signal.recommended_action,
            })
            .collect(),
    ))
}
