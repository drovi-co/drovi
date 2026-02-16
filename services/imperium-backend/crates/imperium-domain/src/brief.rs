use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefCitation {
    pub source_url: String,
    pub source_snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefClaim {
    pub statement: String,
    pub impact_score: f64,
    pub confidence_score: f64,
    pub citations: Vec<BriefCitation>,
    pub recommended_action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BriefSection {
    pub section_key: String,
    pub title: String,
    pub summary: String,
    pub claims: Vec<BriefClaim>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyBrief {
    pub brief_id: Uuid,
    pub user_id: Uuid,
    pub brief_date: NaiveDate,
    pub generated_at: DateTime<Utc>,
    pub sections: Vec<BriefSection>,
    pub required_reads: Vec<String>,
}

#[derive(Debug, Error)]
pub enum BriefValidationError {
    #[error("brief claim in section '{section_key}' at index {claim_index} has no citations")]
    MissingCitation {
        section_key: String,
        claim_index: usize,
    },
    #[error("required reads exceeds max: {count} > 7")]
    RequiredReadsLimitExceeded { count: usize },
}

pub fn validate_daily_brief(brief: &DailyBrief) -> Result<(), BriefValidationError> {
    for section in &brief.sections {
        for (index, claim) in section.claims.iter().enumerate() {
            if claim.citations.is_empty() {
                return Err(BriefValidationError::MissingCitation {
                    section_key: section.section_key.clone(),
                    claim_index: index,
                });
            }
        }
    }

    if brief.required_reads.len() > 7 {
        return Err(BriefValidationError::RequiredReadsLimitExceeded {
            count: brief.required_reads.len(),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_claim_without_citation() {
        let brief = DailyBrief {
            brief_id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            brief_date: Utc::now().date_naive(),
            generated_at: Utc::now(),
            sections: vec![BriefSection {
                section_key: "macro".to_string(),
                title: "Macro".to_string(),
                summary: "summary".to_string(),
                claims: vec![BriefClaim {
                    statement: "statement".to_string(),
                    impact_score: 0.8,
                    confidence_score: 0.9,
                    citations: vec![],
                    recommended_action: None,
                }],
            }],
            required_reads: vec![],
        };

        assert!(matches!(
            validate_daily_brief(&brief),
            Err(BriefValidationError::MissingCitation { .. })
        ));
    }
}
