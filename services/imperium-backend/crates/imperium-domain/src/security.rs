use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub event_id: Uuid,
    pub actor_user_id: Option<Uuid>,
    pub action: String,
    pub target: String,
    pub metadata: serde_json::Value,
    pub timestamp: DateTime<Utc>,
}

pub fn new_audit_event(
    actor_user_id: Option<Uuid>,
    action: impl Into<String>,
    target: impl Into<String>,
    metadata: serde_json::Value,
) -> AuditEvent {
    AuditEvent {
        event_id: Uuid::new_v4(),
        actor_user_id,
        action: action.into(),
        target: target.into(),
        metadata,
        timestamp: Utc::now(),
    }
}
