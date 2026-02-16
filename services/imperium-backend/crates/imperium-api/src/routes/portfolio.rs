use axum::{extract::State, Json};
use imperium_domain::portfolio::{simulate_scenario as simulate_portfolio_scenario, ScenarioInput};
use imperium_infra::{error::AppError, SharedAppState};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::routes::context::AuthContext;

#[derive(Debug, Serialize, ToSchema)]
pub struct PortfolioAccountView {
    pub account_id: String,
    pub name: String,
    pub account_type: String,
    pub balance: f64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PortfolioPositionView {
    pub symbol: String,
    pub quantity: f64,
    pub market_value: f64,
    pub asset_class: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ExposureView {
    pub bucket: String,
    pub weight_percent: f64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PortfolioOverviewView {
    pub as_of: String,
    pub net_worth: f64,
    pub daily_change: f64,
    pub ytd_change: f64,
    pub risk_score: f64,
    pub accounts: Vec<PortfolioAccountView>,
    pub top_positions: Vec<PortfolioPositionView>,
    pub exposures: Vec<ExposureView>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ScenarioRequest {
    pub scenario_name: String,
    pub market_drop_percent: f64,
    pub fx_shock_percent: f64,
    pub rate_spike_bps: f64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ScenarioResponse {
    pub scenario_name: String,
    pub estimated_loss: f64,
    pub liquidity_impact: f64,
    pub hedge_notional: f64,
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/portfolio/overview",
    tag = "imperium",
    responses(
        (status = 200, description = "Portfolio overview", body = PortfolioOverviewView)
    )
)]
pub async fn overview(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<PortfolioOverviewView>, AppError> {
    let service = imperium_portfolio::PortfolioService;
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let overview = match state.repository.load_portfolio_overview(user_id).await? {
        Some(overview) => overview,
        None => {
            let sample = service.sample_overview();
            state
                .repository
                .upsert_portfolio_overview(user_id, &sample)
                .await?;
            sample
        }
    };

    Ok(Json(map_overview(overview)))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/portfolio/accounts",
    tag = "imperium",
    responses(
        (status = 200, description = "Portfolio accounts", body = [PortfolioAccountView])
    )
)]
pub async fn accounts(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<Vec<PortfolioAccountView>>, AppError> {
    let service = imperium_portfolio::PortfolioService;
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let mut accounts = state.repository.load_portfolio_accounts(user_id).await?;
    if accounts.is_empty() {
        let sample = service.sample_overview();
        state
            .repository
            .upsert_portfolio_overview(user_id, &sample)
            .await?;
        accounts = sample.accounts;
    }

    Ok(Json(
        accounts
            .into_iter()
            .map(|account| PortfolioAccountView {
                account_id: account.account_id,
                name: account.name,
                account_type: account.account_type,
                balance: account.balance,
            })
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/portfolio/scenario/simulate",
    tag = "imperium",
    request_body = ScenarioRequest,
    responses(
        (status = 200, description = "Scenario simulation", body = ScenarioResponse)
    )
)]
pub async fn simulate_scenario(
    State(state): State<SharedAppState>,
    auth: AuthContext,
    Json(payload): Json<ScenarioRequest>,
) -> Result<Json<ScenarioResponse>, AppError> {
    let service = imperium_portfolio::PortfolioService;
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let scenario = ScenarioInput {
        scenario_name: payload.scenario_name,
        market_drop_percent: payload.market_drop_percent,
        fx_shock_percent: payload.fx_shock_percent,
        rate_spike_bps: payload.rate_spike_bps,
    };

    let baseline = match state.repository.load_portfolio_overview(user_id).await? {
        Some(overview) => overview,
        None => service.sample_overview(),
    };

    let result = simulate_portfolio_scenario(&baseline, &scenario);

    Ok(Json(ScenarioResponse {
        scenario_name: result.scenario_name,
        estimated_loss: result.estimated_loss,
        liquidity_impact: result.liquidity_impact,
        hedge_notional: result.hedge_notional,
    }))
}

fn map_overview(overview: imperium_domain::portfolio::PortfolioOverview) -> PortfolioOverviewView {
    PortfolioOverviewView {
        as_of: overview.as_of.to_rfc3339(),
        net_worth: overview.net_worth,
        daily_change: overview.daily_change,
        ytd_change: overview.ytd_change,
        risk_score: overview.risk_score,
        accounts: overview
            .accounts
            .into_iter()
            .map(|account| PortfolioAccountView {
                account_id: account.account_id,
                name: account.name,
                account_type: account.account_type,
                balance: account.balance,
            })
            .collect(),
        top_positions: overview
            .top_positions
            .into_iter()
            .map(|position| PortfolioPositionView {
                symbol: position.symbol,
                quantity: position.quantity,
                market_value: position.market_value,
                asset_class: position.asset_class,
            })
            .collect(),
        exposures: overview
            .exposures
            .into_iter()
            .map(|exposure| ExposureView {
                bucket: exposure.bucket,
                weight_percent: exposure.weight_percent,
            })
            .collect(),
    }
}
