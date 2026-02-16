use chrono::Utc;
use imperium_domain::brief::{
    validate_daily_brief, BriefCitation, BriefClaim, BriefSection, BriefValidationError, DailyBrief,
};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct BriefContext {
    pub user_id: Uuid,
    pub watchlist: Vec<String>,
    pub key_events: Vec<String>,
    pub timezone: String,
}

#[derive(Debug, Error)]
pub enum BriefServiceError {
    #[error("brief validation failed: {0}")]
    Validation(#[from] BriefValidationError),
}

#[derive(Default)]
pub struct BriefService;

impl BriefService {
    pub fn generate_daily_brief(
        &self,
        context: BriefContext,
    ) -> Result<DailyBrief, BriefServiceError> {
        let now = Utc::now();

        let sections = vec![
            BriefSection {
                section_key: "overnight".to_string(),
                title: "Overnight Market Narrative".to_string(),
                summary: format!(
                    "Asia close to Europe open summary for watchlist: {}",
                    if context.watchlist.is_empty() {
                        "SPY, QQQ, BTCUSD".to_string()
                    } else {
                        context.watchlist.join(", ")
                    }
                ),
                claims: vec![BriefClaim {
                    statement: "Futures implied a defensive open with rates-sensitive sectors under pressure.".to_string(),
                    impact_score: 0.82,
                    confidence_score: 0.9,
                    citations: vec![BriefCitation {
                        source_url: "https://example.com/overnight-futures".to_string(),
                        source_snippet: "Futures drifted lower into Europe open.".to_string(),
                    }],
                    recommended_action: Some("Monitor opening breadth and yields before adding risk".to_string()),
                }],
            },
            BriefSection {
                section_key: "macro_calendar".to_string(),
                title: "Macro Calendar".to_string(),
                summary: if context.key_events.is_empty() {
                    "No major macro releases configured in profile.".to_string()
                } else {
                    format!("Key events today: {}", context.key_events.join(", "))
                },
                claims: vec![BriefClaim {
                    statement: "Event volatility risk is elevated around scheduled macro prints.".to_string(),
                    impact_score: 0.74,
                    confidence_score: 0.86,
                    citations: vec![BriefCitation {
                        source_url: "https://example.com/macro-calendar".to_string(),
                        source_snippet: "Major releases cluster around market open.".to_string(),
                    }],
                    recommended_action: Some("Predefine hedge and sizing thresholds ahead of release windows".to_string()),
                }],
            },
        ];

        let brief = DailyBrief {
            brief_id: Uuid::new_v4(),
            user_id: context.user_id,
            brief_date: now.date_naive(),
            generated_at: now,
            sections,
            required_reads: vec![
                "https://example.com/overnight-futures".to_string(),
                "https://example.com/macro-calendar".to_string(),
            ],
        };

        validate_daily_brief(&brief)?;

        Ok(brief)
    }

    pub fn since_last_check(&self) -> Vec<String> {
        vec![
            "US 10Y yield crossed overnight pivot level".to_string(),
            "Semiconductor supply-chain narrative intensified".to_string(),
            "FX volatility picked up in EURUSD".to_string(),
        ]
    }
}
