use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewsArticleInput {
    pub source: String,
    pub url: String,
    pub title: String,
    pub body: Option<String>,
    pub published_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedArticle {
    pub source: String,
    pub url: String,
    pub title: String,
    pub normalized_title: String,
    pub published_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryCluster {
    pub cluster_key: String,
    pub title: String,
    pub article_count: usize,
    pub canonical_url: String,
    pub impact_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxItem {
    pub cluster_key: String,
    pub title: String,
    pub summary: String,
    pub impact_score: f64,
    pub source_count: usize,
    pub canonical_url: String,
}
