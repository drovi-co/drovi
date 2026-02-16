use chrono::Utc;
use imperium_domain::business::{
    detect_anomalies, BusinessAnomaly, BusinessMetric, BusinessOverview,
};

#[derive(Default)]
pub struct BusinessCommandService;

impl BusinessCommandService {
    pub fn current_overview(&self) -> BusinessOverview {
        BusinessOverview {
            as_of: Utc::now(),
            entity_name: "Imperium Holdings".to_string(),
            mrr: 182_000.0,
            burn: 140_000.0,
            runway_months: 5.2,
            cash_balance: 740_000.0,
            overdue_invoices: 4,
        }
    }

    pub fn previous_overview(&self) -> BusinessOverview {
        BusinessOverview {
            as_of: Utc::now() - chrono::Duration::days(30),
            entity_name: "Imperium Holdings".to_string(),
            mrr: 195_000.0,
            burn: 102_000.0,
            runway_months: 7.1,
            cash_balance: 890_000.0,
            overdue_invoices: 2,
        }
    }

    pub fn metric_snapshot(&self) -> Vec<BusinessMetric> {
        vec![
            BusinessMetric {
                key: "mrr".to_string(),
                value: 182_000.0,
                window: "current_month".to_string(),
            },
            BusinessMetric {
                key: "burn".to_string(),
                value: 140_000.0,
                window: "current_month".to_string(),
            },
            BusinessMetric {
                key: "runway_months".to_string(),
                value: 5.2,
                window: "current".to_string(),
            },
            BusinessMetric {
                key: "overdue_invoices".to_string(),
                value: 4.0,
                window: "current".to_string(),
            },
        ]
    }

    pub fn anomaly_signals(&self) -> Vec<BusinessAnomaly> {
        let current = self.current_overview();
        let previous = self.previous_overview();

        detect_anomalies(&current, Some(&previous))
    }
}
