use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MarketRegime {
    RiskOn,
    RiskOff,
    Neutral,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegimeState {
    pub regime: MarketRegime,
    pub confidence: f64,
    pub explanation: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroIndicator {
    pub key: String,
    pub value: f64,
    pub change: f64,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiskSignal {
    pub key: String,
    pub severity: String,
    pub description: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioImpact {
    pub label: String,
    pub estimated_pnl_impact: f64,
    pub liquidity_impact: f64,
    pub hedge_size: f64,
}
