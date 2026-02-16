use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusinessMetric {
    pub key: String,
    pub value: f64,
    pub window: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusinessOverview {
    pub as_of: DateTime<Utc>,
    pub entity_name: String,
    pub mrr: f64,
    pub burn: f64,
    pub runway_months: f64,
    pub cash_balance: f64,
    pub overdue_invoices: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusinessAnomaly {
    pub metric_key: String,
    pub severity: String,
    pub message: String,
    pub recommended_action: String,
}

pub fn detect_anomalies(
    current: &BusinessOverview,
    previous: Option<&BusinessOverview>,
) -> Vec<BusinessAnomaly> {
    let mut anomalies = Vec::new();

    if current.runway_months < 4.0 {
        anomalies.push(BusinessAnomaly {
            metric_key: "runway_months".to_string(),
            severity: "high".to_string(),
            message: "Runway dropped below 4 months".to_string(),
            recommended_action: "Reduce burn and secure contingency capital".to_string(),
        });
    }

    if current.overdue_invoices > 5 {
        anomalies.push(BusinessAnomaly {
            metric_key: "overdue_invoices".to_string(),
            severity: "medium".to_string(),
            message: "Overdue invoices are elevated".to_string(),
            recommended_action: "Escalate collections and revise credit terms".to_string(),
        });
    }

    if let Some(previous) = previous {
        if current.burn > previous.burn * 1.25 {
            anomalies.push(BusinessAnomaly {
                metric_key: "burn".to_string(),
                severity: "high".to_string(),
                message: "Burn increased by more than 25%".to_string(),
                recommended_action: "Review recurring spend and recent hiring commitments"
                    .to_string(),
            });
        }

        if current.mrr < previous.mrr * 0.9 {
            anomalies.push(BusinessAnomaly {
                metric_key: "mrr".to_string(),
                severity: "high".to_string(),
                message: "MRR dropped by more than 10%".to_string(),
                recommended_action: "Activate churn recovery playbook and pipeline acceleration"
                    .to_string(),
            });
        }
    }

    anomalies
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_material_burn_increase() {
        let previous = BusinessOverview {
            as_of: Utc::now() - chrono::Duration::days(30),
            entity_name: "Test".to_string(),
            mrr: 100_000.0,
            burn: 80_000.0,
            runway_months: 8.0,
            cash_balance: 640_000.0,
            overdue_invoices: 1,
        };

        let current = BusinessOverview {
            as_of: Utc::now(),
            entity_name: "Test".to_string(),
            mrr: 98_000.0,
            burn: 110_000.0,
            runway_months: 5.0,
            cash_balance: 500_000.0,
            overdue_invoices: 2,
        };

        let anomalies = detect_anomalies(&current, Some(&previous));
        assert!(anomalies.iter().any(|item| item.metric_key == "burn"));
    }
}
