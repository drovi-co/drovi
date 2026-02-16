use axum::{extract::State, Json};
use imperium_domain::brief::DailyBrief;
use imperium_infra::{error::AppError, SharedAppState};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::routes::context::AuthContext;

#[derive(Debug, Serialize, ToSchema)]
pub struct BriefCitationView {
    pub source_url: String,
    pub source_snippet: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BriefClaimView {
    pub statement: String,
    pub impact_score: f64,
    pub confidence_score: f64,
    pub citations: Vec<BriefCitationView>,
    pub recommended_action: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BriefSectionView {
    pub section_key: String,
    pub title: String,
    pub summary: String,
    pub claims: Vec<BriefClaimView>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DailyBriefView {
    pub brief_id: String,
    pub user_id: String,
    pub brief_date: String,
    pub generated_at: String,
    pub required_reads: Vec<String>,
    pub sections: Vec<BriefSectionView>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SinceLastView {
    pub items: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct BriefPreviewRequest {
    pub user_id: Option<String>,
    pub watchlist: Option<Vec<String>>,
    pub key_events: Option<Vec<String>>,
    pub timezone: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/brief/today",
    tag = "imperium",
    responses(
        (status = 200, description = "Daily brief", body = DailyBriefView)
    )
)]
pub async fn today(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<DailyBriefView>, AppError> {
    let service = imperium_brief::BriefService;
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let brief = match state.repository.load_latest_daily_brief(user_id).await? {
        Some(brief) => brief,
        None => {
            let context = imperium_brief::BriefContext {
                user_id,
                watchlist: vec!["SPY".to_string(), "QQQ".to_string(), "NVDA".to_string()],
                key_events: vec!["CPI".to_string(), "FOMC minutes".to_string()],
                timezone: "America/New_York".to_string(),
            };

            let generated = service
                .generate_daily_brief(context)
                .map_err(|error| AppError::internal(format!("brief generation failed: {error}")))?;
            state.repository.store_daily_brief(&generated).await?;
            generated
        }
    };

    Ok(Json(map_daily_brief(brief)))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/brief/preview",
    tag = "imperium",
    request_body = BriefPreviewRequest,
    responses(
        (status = 200, description = "Daily brief preview", body = DailyBriefView)
    )
)]
pub async fn preview(
    auth: AuthContext,
    Json(payload): Json<BriefPreviewRequest>,
) -> Json<DailyBriefView> {
    let service = imperium_brief::BriefService;
    let context = imperium_brief::BriefContext {
        user_id: payload
            .user_id
            .as_deref()
            .and_then(|raw| Uuid::parse_str(raw).ok())
            .unwrap_or(auth.user_id),
        watchlist: payload.watchlist.unwrap_or_default(),
        key_events: payload.key_events.unwrap_or_default(),
        timezone: payload
            .timezone
            .unwrap_or_else(|| "America/New_York".to_string()),
    };

    let brief = service
        .generate_daily_brief(context)
        .expect("sample brief generation should always succeed");

    Json(map_daily_brief(brief))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/brief/since-last",
    tag = "imperium",
    responses(
        (status = 200, description = "Delta updates since last check", body = SinceLastView)
    )
)]
pub async fn since_last(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<SinceLastView>, AppError> {
    let service = imperium_brief::BriefService;
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let mut items = state.repository.list_brief_delta_items(user_id, 10).await?;
    if items.is_empty() {
        items = service.since_last_check();
    }

    Ok(Json(SinceLastView { items }))
}

fn map_daily_brief(brief: DailyBrief) -> DailyBriefView {
    DailyBriefView {
        brief_id: brief.brief_id.to_string(),
        user_id: brief.user_id.to_string(),
        brief_date: brief.brief_date.to_string(),
        generated_at: brief.generated_at.to_rfc3339(),
        required_reads: brief.required_reads,
        sections: brief
            .sections
            .into_iter()
            .map(|section| BriefSectionView {
                section_key: section.section_key,
                title: section.title,
                summary: section.summary,
                claims: section
                    .claims
                    .into_iter()
                    .map(|claim| BriefClaimView {
                        statement: claim.statement,
                        impact_score: claim.impact_score,
                        confidence_score: claim.confidence_score,
                        citations: claim
                            .citations
                            .into_iter()
                            .map(|citation| BriefCitationView {
                                source_url: citation.source_url,
                                source_snippet: citation.source_snippet,
                            })
                            .collect(),
                        recommended_action: claim.recommended_action,
                    })
                    .collect(),
            })
            .collect(),
    }
}
