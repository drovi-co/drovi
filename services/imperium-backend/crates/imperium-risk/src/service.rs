use chrono::Utc;
use imperium_domain::risk::{
    MacroIndicator, MarketRegime, RegimeState, RiskSignal, ScenarioImpact,
};

#[derive(Default)]
pub struct RiskRegimeService;

impl RiskRegimeService {
    pub fn regime_state(&self) -> RegimeState {
        RegimeState {
            regime: MarketRegime::RiskOff,
            confidence: 0.78,
            explanation: "Rates and volatility trends imply defensive positioning pressure."
                .to_string(),
            updated_at: Utc::now(),
        }
    }

    pub fn macro_indicators(&self) -> Vec<MacroIndicator> {
        vec![
            MacroIndicator {
                key: "VIX".to_string(),
                value: 19.8,
                change: 1.6,
                updated_at: Utc::now(),
            },
            MacroIndicator {
                key: "US10Y".to_string(),
                value: 4.18,
                change: 0.07,
                updated_at: Utc::now(),
            },
            MacroIndicator {
                key: "DXY".to_string(),
                value: 105.4,
                change: 0.4,
                updated_at: Utc::now(),
            },
        ]
    }

    pub fn risk_signals(&self) -> Vec<RiskSignal> {
        vec![
            RiskSignal {
                key: "concentration".to_string(),
                severity: "high".to_string(),
                description: "Top position exceeds concentration tolerance.".to_string(),
                created_at: Utc::now(),
            },
            RiskSignal {
                key: "duration".to_string(),
                severity: "medium".to_string(),
                description: "Rate sensitivity elevated across growth basket.".to_string(),
                created_at: Utc::now(),
            },
        ]
    }

    pub fn scenario_preview(&self, label: &str) -> ScenarioImpact {
        ScenarioImpact {
            label: label.to_string(),
            estimated_pnl_impact: -184_000.0,
            liquidity_impact: -74_000.0,
            hedge_size: 220_000.0,
        }
    }
}
