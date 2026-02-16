use axum::{extract::State, Json};
use imperium_infra::{error::AppError, SharedAppState};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::routes::context::AuthContext;

#[derive(Debug, Serialize, ToSchema)]
pub struct RegimeStateView {
    pub regime: String,
    pub confidence: f64,
    pub explanation: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MacroIndicatorView {
    pub key: String,
    pub value: f64,
    pub change: f64,
    pub updated_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RiskSignalView {
    pub key: String,
    pub severity: String,
    pub description: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ScenarioPreviewRequest {
    pub label: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ScenarioPreviewResponse {
    pub label: String,
    pub estimated_pnl_impact: f64,
    pub liquidity_impact: f64,
    pub hedge_size: f64,
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/risk/regime",
    tag = "imperium",
    responses(
        (status = 200, description = "Current regime state", body = RegimeStateView)
    )
)]
pub async fn regime(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<RegimeStateView>, AppError> {
    let service = imperium_risk::RiskRegimeService::default();
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let regime_state = match state.repository.load_regime_state(user_id).await? {
        Some(regime) => regime,
        None => {
            let sample = service.regime_state();
            let signals = service.risk_signals();
            let indicators = service.macro_indicators();
            state
                .repository
                .upsert_regime_state(user_id, &sample)
                .await?;
            state
                .repository
                .upsert_risk_observations(user_id, &signals, &indicators)
                .await?;
            sample
        }
    };

    let regime = match regime_state.regime {
        imperium_domain::risk::MarketRegime::RiskOn => "risk_on",
        imperium_domain::risk::MarketRegime::RiskOff => "risk_off",
        imperium_domain::risk::MarketRegime::Neutral => "neutral",
    };

    Ok(Json(RegimeStateView {
        regime: regime.to_string(),
        confidence: regime_state.confidence,
        explanation: regime_state.explanation,
        updated_at: regime_state.updated_at.to_rfc3339(),
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/risk/indicators",
    tag = "imperium",
    responses(
        (status = 200, description = "Macro indicators", body = [MacroIndicatorView])
    )
)]
pub async fn indicators(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<Vec<MacroIndicatorView>>, AppError> {
    let service = imperium_risk::RiskRegimeService::default();
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let mut indicators = state.repository.list_macro_indicators(user_id, 20).await?;
    if indicators.is_empty() {
        indicators = service.macro_indicators();
    }

    Ok(Json(
        indicators
            .into_iter()
            .map(|indicator| MacroIndicatorView {
                key: indicator.key,
                value: indicator.value,
                change: indicator.change,
                updated_at: indicator.updated_at.to_rfc3339(),
            })
            .collect(),
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/risk/signals",
    tag = "imperium",
    responses(
        (status = 200, description = "Risk signals", body = [RiskSignalView])
    )
)]
pub async fn signals(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<Vec<RiskSignalView>>, AppError> {
    let service = imperium_risk::RiskRegimeService::default();
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let mut signals = state.repository.list_risk_signals(user_id, 20).await?;
    if signals.is_empty() {
        signals = service.risk_signals();
    }

    Ok(Json(
        signals
            .into_iter()
            .map(|signal| RiskSignalView {
                key: signal.key,
                severity: signal.severity,
                description: signal.description,
                created_at: signal.created_at.to_rfc3339(),
            })
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/risk/scenario/preview",
    tag = "imperium",
    request_body = ScenarioPreviewRequest,
    responses(
        (status = 200, description = "Scenario preview", body = ScenarioPreviewResponse)
    )
)]
pub async fn scenario_preview(
    Json(payload): Json<ScenarioPreviewRequest>,
) -> Json<ScenarioPreviewResponse> {
    let service = imperium_risk::RiskRegimeService::default();
    let impact = service.scenario_preview(&payload.label);

    Json(ScenarioPreviewResponse {
        label: impact.label,
        estimated_pnl_impact: impact.estimated_pnl_impact,
        liquidity_impact: impact.liquidity_impact,
        hedge_size: impact.hedge_size,
    })
}
