use chrono::Utc;
use imperium_domain::alerts::{dedupe_key, AlertEvent, AlertRule};
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct AlertEventView {
    pub alert_id: String,
    pub category: String,
    pub title: String,
    pub what_happened: String,
    pub why_it_matters: String,
    pub what_to_watch_next: String,
    pub dedupe_key: String,
    pub created_at: String,
}

#[derive(Default)]
pub struct AlertEngineService;

impl AlertEngineService {
    pub fn sample_rules(&self, user_id: Uuid) -> Vec<AlertRule> {
        vec![
            AlertRule {
                rule_id: Uuid::new_v4(),
                user_id,
                category: "market".to_string(),
                name: "BTC 2pct 10m move".to_string(),
                threshold: 2.0,
                cooldown_seconds: 300,
                enabled: true,
            },
            AlertRule {
                rule_id: Uuid::new_v4(),
                user_id,
                category: "business".to_string(),
                name: "Runway below 4 months".to_string(),
                threshold: 4.0,
                cooldown_seconds: 3600,
                enabled: true,
            },
        ]
    }

    pub fn sample_feed(&self) -> Vec<AlertEventView> {
        let events = vec![
            AlertEvent {
                alert_id: Uuid::new_v4(),
                rule_id: None,
                category: "market".to_string(),
                title: "BTC moved 2.4% in 10 minutes".to_string(),
                what_happened: "Spot BTC rose rapidly during US premarket.".to_string(),
                why_it_matters: "High volatility can spill into correlated risk assets."
                    .to_string(),
                what_to_watch_next: "Track perp funding and major exchange inflows.".to_string(),
                created_at: Utc::now(),
            },
            AlertEvent {
                alert_id: Uuid::new_v4(),
                rule_id: None,
                category: "business".to_string(),
                title: "Runway now 3.8 months".to_string(),
                what_happened: "Cash projection dropped after expense revision.".to_string(),
                why_it_matters: "Capital buffer is below strategic threshold.".to_string(),
                what_to_watch_next: "Prioritize collections and discretionary spend controls."
                    .to_string(),
                created_at: Utc::now(),
            },
        ];

        events
            .into_iter()
            .map(|event| {
                let key = dedupe_key(
                    &event.category,
                    &event.title,
                    &event.created_at.format("%Y%m%d%H").to_string(),
                );
                AlertEventView {
                    alert_id: event.alert_id.to_string(),
                    category: event.category,
                    title: event.title,
                    what_happened: event.what_happened,
                    why_it_matters: event.why_it_matters,
                    what_to_watch_next: event.what_to_watch_next,
                    dedupe_key: key,
                    created_at: event.created_at.to_rfc3339(),
                }
            })
            .collect()
    }
}
