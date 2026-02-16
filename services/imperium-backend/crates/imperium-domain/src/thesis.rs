use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThesisEntry {
    pub thesis_id: Uuid,
    pub user_id: Uuid,
    pub title: String,
    pub position: String,
    pub conviction_percent: f64,
    pub rationale: String,
    pub invalidation_criteria: String,
    pub review_date: NaiveDate,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playbook {
    pub playbook_id: Uuid,
    pub user_id: Uuid,
    pub title: String,
    pub trigger: String,
    pub response_steps: Vec<String>,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThesisReviewReminder {
    pub thesis_id: Uuid,
    pub title: String,
    pub review_date: NaiveDate,
}
