use axum::{extract::State, Json};
use chrono::{DateTime, Utc};
use imperium_domain::intelligence::NewsArticleInput;
use imperium_infra::{error::AppError, SharedAppState};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::routes::context::AuthContext;

#[derive(Debug, Serialize, ToSchema)]
pub struct StoryClusterView {
    pub cluster_key: String,
    pub title: String,
    pub article_count: usize,
    pub canonical_url: String,
    pub impact_score: f64,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct InboxItemView {
    pub cluster_key: String,
    pub title: String,
    pub summary: String,
    pub impact_score: f64,
    pub source_count: usize,
    pub canonical_url: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct IngestPreviewArticleInput {
    pub source: String,
    pub url: String,
    pub title: String,
    pub body: Option<String>,
    pub published_at: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct IngestPreviewRequest {
    pub articles: Vec<IngestPreviewArticleInput>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct IngestPreviewResponse {
    pub accepted_articles: usize,
    pub rejected_articles: usize,
    pub clusters: Vec<StoryClusterView>,
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/intelligence/inbox",
    tag = "imperium",
    responses(
        (status = 200, description = "Intelligence inbox", body = [InboxItemView])
    )
)]
pub async fn inbox(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<Vec<InboxItemView>>, AppError> {
    let user_id = auth.user_id;
    let service = imperium_news::IntelligenceInboxService::default();
    state.repository.ensure_user(user_id).await?;

    let mut items = state.repository.list_inbox_items(user_id, 30).await?;
    if items.is_empty() {
        items = service.default_inbox();
    }

    let inbox_items = items
        .into_iter()
        .map(|item| InboxItemView {
            cluster_key: item.cluster_key,
            title: item.title,
            summary: item.summary,
            impact_score: item.impact_score,
            source_count: item.source_count,
            canonical_url: item.canonical_url,
        })
        .collect();

    Ok(Json(inbox_items))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/intelligence/clusters",
    tag = "imperium",
    responses(
        (status = 200, description = "Clustered intelligence stories", body = [StoryClusterView])
    )
)]
pub async fn clusters(
    State(state): State<SharedAppState>,
) -> Result<Json<Vec<StoryClusterView>>, AppError> {
    let service = imperium_news::IntelligenceInboxService::default();
    let mut clusters = state.repository.list_story_clusters(50).await?;
    if clusters.is_empty() {
        let preview = service.preview_ingestion(sample_articles());
        clusters = preview.clusters;
    }

    Ok(Json(
        clusters
            .into_iter()
            .map(|cluster| StoryClusterView {
                cluster_key: cluster.cluster_key,
                title: cluster.title,
                article_count: cluster.article_count,
                canonical_url: cluster.canonical_url,
                impact_score: cluster.impact_score,
            })
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/intelligence/ingest/preview",
    tag = "imperium",
    request_body = IngestPreviewRequest,
    responses(
        (status = 200, description = "Preview dedupe/clustering output", body = IngestPreviewResponse)
    )
)]
pub async fn ingest_preview(
    Json(payload): Json<IngestPreviewRequest>,
) -> Json<IngestPreviewResponse> {
    let service = imperium_news::IntelligenceInboxService::default();

    let articles = payload
        .articles
        .into_iter()
        .map(|article| NewsArticleInput {
            source: article.source,
            url: article.url,
            title: article.title,
            body: article.body,
            published_at: parse_datetime(&article.published_at),
        })
        .collect::<Vec<_>>();

    let preview = service.preview_ingestion(articles);

    Json(IngestPreviewResponse {
        accepted_articles: preview.accepted_articles,
        rejected_articles: preview.rejected_articles,
        clusters: preview
            .clusters
            .into_iter()
            .map(|cluster| StoryClusterView {
                cluster_key: cluster.cluster_key,
                title: cluster.title,
                article_count: cluster.article_count,
                canonical_url: cluster.canonical_url,
                impact_score: cluster.impact_score,
            })
            .collect(),
    })
}

fn parse_datetime(raw: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(raw)
        .map(|value| value.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now())
}

fn sample_articles() -> Vec<NewsArticleInput> {
    vec![
        NewsArticleInput {
            source: "reuters".to_string(),
            url: "https://example.com/reuters-fed-rates".to_string(),
            title: "Fed speakers push back on early cuts".to_string(),
            body: None,
            published_at: Utc::now(),
        },
        NewsArticleInput {
            source: "bloomberg".to_string(),
            url: "https://example.com/bloomberg-fed-rates".to_string(),
            title: "Fed speakers push back on early cuts".to_string(),
            body: None,
            published_at: Utc::now(),
        },
        NewsArticleInput {
            source: "ft".to_string(),
            url: "https://example.com/ft-chip-supply".to_string(),
            title: "Semiconductor lead times tighten again".to_string(),
            body: None,
            published_at: Utc::now(),
        },
    ]
}
