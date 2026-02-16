use axum::{
    extract::{Path, State},
    Json,
};
use chrono::NaiveDate;
use imperium_infra::{error::AppError, SharedAppState};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::routes::context::AuthContext;

#[derive(Debug, Serialize, ToSchema)]
pub struct ThesisView {
    pub thesis_id: String,
    pub title: String,
    pub position: String,
    pub conviction_percent: f64,
    pub rationale: String,
    pub invalidation_criteria: String,
    pub review_date: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PlaybookView {
    pub playbook_id: String,
    pub title: String,
    pub trigger: String,
    pub response_steps: Vec<String>,
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ReminderView {
    pub thesis_id: String,
    pub title: String,
    pub review_date: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateThesisRequest {
    pub title: String,
    pub position: Option<String>,
    pub conviction_percent: Option<f64>,
    pub invalidation_criteria: Option<String>,
    pub review_date: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ThesisMutationResponse {
    pub thesis_id: String,
    pub archived: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreatePlaybookRequest {
    pub title: String,
    pub trigger: String,
    pub response_steps: Vec<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TogglePlaybookRequest {
    pub enabled: bool,
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/journal/theses",
    tag = "imperium",
    responses(
        (status = 200, description = "Decision journal theses", body = [ThesisView])
    )
)]
pub async fn theses(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<Vec<ThesisView>>, AppError> {
    let service = imperium_journal::JournalService;
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let mut theses = state.repository.list_theses(user_id).await?;
    if theses.is_empty() {
        theses = service.sample_theses(user_id);
    }

    Ok(Json(
        theses
            .into_iter()
            .map(|thesis| ThesisView {
                thesis_id: thesis.thesis_id.to_string(),
                title: thesis.title,
                position: thesis.position,
                conviction_percent: thesis.conviction_percent,
                rationale: thesis.rationale,
                invalidation_criteria: thesis.invalidation_criteria,
                review_date: thesis.review_date.to_string(),
                created_at: thesis.created_at.to_rfc3339(),
            })
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/journal/theses",
    tag = "imperium",
    request_body = CreateThesisRequest,
    responses(
        (status = 200, description = "Created thesis", body = ThesisView),
        (status = 400, description = "Invalid payload")
    )
)]
pub async fn create_thesis(
    State(state): State<SharedAppState>,
    auth: AuthContext,
    Json(payload): Json<CreateThesisRequest>,
) -> Result<Json<ThesisView>, AppError> {
    let user_id = auth.user_id;
    let title = payload.title.trim();

    if title.is_empty() {
        return Err(AppError::validation("title cannot be empty"));
    }

    let review_date = payload
        .review_date
        .as_deref()
        .map(parse_review_date)
        .transpose()?;

    let created = state
        .repository
        .create_thesis(
            user_id,
            title,
            payload.position.as_deref(),
            payload.conviction_percent,
            payload.invalidation_criteria.as_deref(),
            review_date,
        )
        .await?;

    Ok(Json(ThesisView {
        thesis_id: created.thesis_id.to_string(),
        title: created.title,
        position: created.position,
        conviction_percent: created.conviction_percent,
        rationale: created.rationale,
        invalidation_criteria: created.invalidation_criteria,
        review_date: created.review_date.to_string(),
        created_at: created.created_at.to_rfc3339(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/journal/theses/{thesis_id}/archive",
    tag = "imperium",
    params(("thesis_id" = String, Path, description = "Thesis id")),
    responses(
        (status = 200, description = "Archived thesis", body = ThesisMutationResponse),
        (status = 400, description = "Invalid thesis id")
    )
)]
pub async fn archive_thesis(
    State(state): State<SharedAppState>,
    auth: AuthContext,
    Path(thesis_id): Path<String>,
) -> Result<Json<ThesisMutationResponse>, AppError> {
    let user_id = auth.user_id;
    let thesis_uuid = Uuid::parse_str(&thesis_id)
        .map_err(|_| AppError::validation("invalid thesis_id: must be uuid"))?;

    let archived = state
        .repository
        .archive_thesis(user_id, thesis_uuid)
        .await?;

    Ok(Json(ThesisMutationResponse {
        thesis_id,
        archived,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/journal/playbooks",
    tag = "imperium",
    responses(
        (status = 200, description = "Playbooks", body = [PlaybookView])
    )
)]
pub async fn playbooks(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<Vec<PlaybookView>>, AppError> {
    let service = imperium_journal::JournalService;
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let mut playbooks = state.repository.list_playbooks(user_id).await?;
    if playbooks.is_empty() {
        playbooks = service.sample_playbooks(user_id);
    }

    Ok(Json(
        playbooks
            .into_iter()
            .map(|playbook| PlaybookView {
                playbook_id: playbook.playbook_id.to_string(),
                title: playbook.title,
                trigger: playbook.trigger,
                response_steps: playbook.response_steps,
                enabled: playbook.enabled,
                created_at: playbook.created_at.to_rfc3339(),
            })
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/journal/playbooks",
    tag = "imperium",
    request_body = CreatePlaybookRequest,
    responses(
        (status = 200, description = "Created playbook", body = PlaybookView),
        (status = 400, description = "Invalid payload")
    )
)]
pub async fn create_playbook(
    State(state): State<SharedAppState>,
    auth: AuthContext,
    Json(payload): Json<CreatePlaybookRequest>,
) -> Result<Json<PlaybookView>, AppError> {
    let user_id = auth.user_id;
    let title = payload.title.trim();
    let trigger = payload.trigger.trim();

    if title.is_empty() {
        return Err(AppError::validation("title cannot be empty"));
    }

    if trigger.is_empty() {
        return Err(AppError::validation("trigger cannot be empty"));
    }

    if payload.response_steps.is_empty() {
        return Err(AppError::validation("response_steps cannot be empty"));
    }

    let response_steps = payload
        .response_steps
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    if response_steps.is_empty() {
        return Err(AppError::validation(
            "response_steps must include at least one non-empty step",
        ));
    }

    let created = state
        .repository
        .create_playbook(
            user_id,
            title,
            trigger,
            &response_steps,
            payload.enabled.unwrap_or(true),
        )
        .await?;

    Ok(Json(PlaybookView {
        playbook_id: created.playbook_id.to_string(),
        title: created.title,
        trigger: created.trigger,
        response_steps: created.response_steps,
        enabled: created.enabled,
        created_at: created.created_at.to_rfc3339(),
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/journal/playbooks/{playbook_id}/toggle",
    tag = "imperium",
    params(("playbook_id" = String, Path, description = "Playbook id")),
    request_body = TogglePlaybookRequest,
    responses(
        (status = 200, description = "Playbook updated", body = PlaybookView),
        (status = 400, description = "Invalid payload")
    )
)]
pub async fn toggle_playbook(
    State(state): State<SharedAppState>,
    auth: AuthContext,
    Path(playbook_id): Path<String>,
    Json(payload): Json<TogglePlaybookRequest>,
) -> Result<Json<PlaybookView>, AppError> {
    let user_id = auth.user_id;
    let playbook_uuid = Uuid::parse_str(&playbook_id)
        .map_err(|_| AppError::validation("invalid playbook_id: must be uuid"))?;

    let Some(updated) = state
        .repository
        .set_playbook_enabled(user_id, playbook_uuid, payload.enabled)
        .await?
    else {
        return Err(AppError::validation("playbook not found"));
    };

    Ok(Json(PlaybookView {
        playbook_id: updated.playbook_id.to_string(),
        title: updated.title,
        trigger: updated.trigger,
        response_steps: updated.response_steps,
        enabled: updated.enabled,
        created_at: updated.created_at.to_rfc3339(),
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/journal/reminders",
    tag = "imperium",
    responses(
        (status = 200, description = "Review reminders", body = [ReminderView])
    )
)]
pub async fn reminders(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<Vec<ReminderView>>, AppError> {
    let service = imperium_journal::JournalService;
    let user_id = auth.user_id;
    state.repository.ensure_user(user_id).await?;

    let mut reminders = state.repository.list_review_reminders(user_id).await?;
    if reminders.is_empty() {
        reminders = service.review_reminders(user_id);
    }

    Ok(Json(
        reminders
            .into_iter()
            .map(|reminder| ReminderView {
                thesis_id: reminder.thesis_id.to_string(),
                title: reminder.title,
                review_date: reminder.review_date.to_string(),
            })
            .collect(),
    ))
}

fn parse_review_date(raw: &str) -> Result<NaiveDate, AppError> {
    NaiveDate::parse_from_str(raw, "%Y-%m-%d")
        .map_err(|_| AppError::validation("invalid review_date: expected YYYY-MM-DD"))
}
