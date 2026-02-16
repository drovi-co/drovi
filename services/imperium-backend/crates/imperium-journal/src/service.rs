use chrono::Utc;
use imperium_domain::thesis::{Playbook, ThesisEntry, ThesisReviewReminder};
use uuid::Uuid;

#[derive(Default)]
pub struct JournalService;

impl JournalService {
    pub fn sample_theses(&self, user_id: Uuid) -> Vec<ThesisEntry> {
        vec![
            ThesisEntry {
                thesis_id: Uuid::new_v4(),
                user_id,
                title: "Semiconductor cycle remains structurally tight".to_string(),
                position: "Long NVDA, hedge via QQQ put spread".to_string(),
                conviction_percent: 74.0,
                rationale: "Demand for AI compute continues to outpace near-term supply."
                    .to_string(),
                invalidation_criteria: "Gross margin guidance or order-book revisions break trend."
                    .to_string(),
                review_date: (Utc::now() + chrono::Duration::days(30)).date_naive(),
                created_at: Utc::now(),
            },
            ThesisEntry {
                thesis_id: Uuid::new_v4(),
                user_id,
                title: "Rates remain restrictive longer than consensus".to_string(),
                position: "Neutral duration, selective cyclicals".to_string(),
                conviction_percent: 68.0,
                rationale: "Labor and services inflation remain sticky.".to_string(),
                invalidation_criteria: "Core disinflation accelerates for multiple prints."
                    .to_string(),
                review_date: (Utc::now() + chrono::Duration::days(21)).date_naive(),
                created_at: Utc::now(),
            },
        ]
    }

    pub fn sample_playbooks(&self, user_id: Uuid) -> Vec<Playbook> {
        vec![
            Playbook {
                playbook_id: Uuid::new_v4(),
                user_id,
                title: "If market drops 3% intraday".to_string(),
                trigger: "SPX intraday drawdown <= -3%".to_string(),
                response_steps: vec![
                    "Reduce high-beta exposure by 20%".to_string(),
                    "Reassess liquidity buffers".to_string(),
                    "Publish board-risk snapshot".to_string(),
                ],
                enabled: true,
                created_at: Utc::now(),
            },
            Playbook {
                playbook_id: Uuid::new_v4(),
                user_id,
                title: "If runway < 4 months".to_string(),
                trigger: "Business runway_months < 4".to_string(),
                response_steps: vec![
                    "Freeze discretionary hiring".to_string(),
                    "Accelerate receivables collection".to_string(),
                    "Review bridge financing options".to_string(),
                ],
                enabled: true,
                created_at: Utc::now(),
            },
        ]
    }

    pub fn review_reminders(&self, user_id: Uuid) -> Vec<ThesisReviewReminder> {
        self.sample_theses(user_id)
            .into_iter()
            .map(|thesis| ThesisReviewReminder {
                thesis_id: thesis.thesis_id,
                title: thesis.title,
                review_date: thesis.review_date,
            })
            .collect()
    }
}
