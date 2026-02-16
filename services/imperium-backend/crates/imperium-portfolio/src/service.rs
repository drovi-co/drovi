use chrono::Utc;
use imperium_domain::portfolio::{
    calculate_concentration_risk, simulate_scenario, Exposure, PortfolioAccountSummary,
    PortfolioOverview, PositionSummary, ScenarioInput, ScenarioResult,
};

#[derive(Default)]
pub struct PortfolioService;

impl PortfolioService {
    pub fn sample_overview(&self) -> PortfolioOverview {
        let accounts = vec![
            PortfolioAccountSummary {
                account_id: "acct-main-brokerage".to_string(),
                name: "Main Brokerage".to_string(),
                account_type: "brokerage".to_string(),
                balance: 2_400_000.0,
            },
            PortfolioAccountSummary {
                account_id: "acct-crypto".to_string(),
                name: "Treasury Crypto".to_string(),
                account_type: "crypto".to_string(),
                balance: 580_000.0,
            },
        ];

        let top_positions = vec![
            PositionSummary {
                symbol: "NVDA".to_string(),
                quantity: 2800.0,
                market_value: 980_000.0,
                asset_class: "equity".to_string(),
            },
            PositionSummary {
                symbol: "MSFT".to_string(),
                quantity: 1500.0,
                market_value: 620_000.0,
                asset_class: "equity".to_string(),
            },
            PositionSummary {
                symbol: "BTCUSD".to_string(),
                quantity: 8.0,
                market_value: 410_000.0,
                asset_class: "crypto".to_string(),
            },
        ];

        let concentration = calculate_concentration_risk(&top_positions);

        PortfolioOverview {
            as_of: Utc::now(),
            net_worth: 3_120_000.0,
            daily_change: -22_500.0,
            ytd_change: 320_000.0,
            risk_score: (concentration * 0.62).min(100.0),
            accounts,
            top_positions,
            exposures: vec![
                Exposure {
                    bucket: "Technology".to_string(),
                    weight_percent: 58.0,
                },
                Exposure {
                    bucket: "Crypto".to_string(),
                    weight_percent: 13.0,
                },
                Exposure {
                    bucket: "Cash".to_string(),
                    weight_percent: 17.0,
                },
                Exposure {
                    bucket: "Other".to_string(),
                    weight_percent: 12.0,
                },
            ],
        }
    }

    pub fn simulate(&self, input: ScenarioInput) -> ScenarioResult {
        let overview = self.sample_overview();
        simulate_scenario(&overview, &input)
    }
}
