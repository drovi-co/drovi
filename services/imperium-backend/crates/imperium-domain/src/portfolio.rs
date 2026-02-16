use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioAccountSummary {
    pub account_id: String,
    pub name: String,
    pub account_type: String,
    pub balance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionSummary {
    pub symbol: String,
    pub quantity: f64,
    pub market_value: f64,
    pub asset_class: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Exposure {
    pub bucket: String,
    pub weight_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioOverview {
    pub as_of: DateTime<Utc>,
    pub net_worth: f64,
    pub daily_change: f64,
    pub ytd_change: f64,
    pub risk_score: f64,
    pub accounts: Vec<PortfolioAccountSummary>,
    pub top_positions: Vec<PositionSummary>,
    pub exposures: Vec<Exposure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioInput {
    pub scenario_name: String,
    pub market_drop_percent: f64,
    pub fx_shock_percent: f64,
    pub rate_spike_bps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioResult {
    pub scenario_name: String,
    pub estimated_loss: f64,
    pub liquidity_impact: f64,
    pub hedge_notional: f64,
}

pub fn calculate_concentration_risk(positions: &[PositionSummary]) -> f64 {
    let total: f64 = positions.iter().map(|position| position.market_value).sum();
    if total <= 0.0 {
        return 0.0;
    }

    let max_weight = positions
        .iter()
        .map(|position| position.market_value / total)
        .fold(0.0_f64, f64::max);

    (max_weight * 100.0).min(100.0)
}

pub fn simulate_scenario(overview: &PortfolioOverview, input: &ScenarioInput) -> ScenarioResult {
    let market_factor = input.market_drop_percent.abs() / 100.0;
    let fx_factor = input.fx_shock_percent.abs() / 100.0 * 0.35;
    let rates_factor = (input.rate_spike_bps.abs() / 100.0) * 0.2;

    let loss_factor = (market_factor + fx_factor + rates_factor).min(0.95);
    let estimated_loss = overview.net_worth * loss_factor;
    let liquidity_impact = estimated_loss * 0.4;
    let hedge_notional = estimated_loss * 1.15;

    ScenarioResult {
        scenario_name: input.scenario_name.clone(),
        estimated_loss,
        liquidity_impact,
        hedge_notional,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_concentration_risk() {
        let positions = vec![
            PositionSummary {
                symbol: "A".to_string(),
                quantity: 1.0,
                market_value: 70.0,
                asset_class: "equity".to_string(),
            },
            PositionSummary {
                symbol: "B".to_string(),
                quantity: 1.0,
                market_value: 30.0,
                asset_class: "equity".to_string(),
            },
        ];

        let concentration = calculate_concentration_risk(&positions);
        assert!(concentration >= 70.0);
    }
}
