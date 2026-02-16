use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRule {
    pub rule_id: Uuid,
    pub user_id: Uuid,
    pub category: String,
    pub name: String,
    pub threshold: f64,
    pub cooldown_seconds: u64,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertEvent {
    pub alert_id: Uuid,
    pub rule_id: Option<Uuid>,
    pub category: String,
    pub title: String,
    pub what_happened: String,
    pub why_it_matters: String,
    pub what_to_watch_next: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertThrottleState {
    pub dedupe_key: String,
    pub last_triggered_at: DateTime<Utc>,
}

pub fn dedupe_key(category: &str, target: &str, bucket: &str) -> String {
    format!(
        "{}:{}:{}",
        category.to_lowercase(),
        target.to_lowercase(),
        bucket
    )
}
