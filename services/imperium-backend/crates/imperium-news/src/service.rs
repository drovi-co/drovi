use chrono::Utc;
use imperium_domain::intelligence::{InboxItem, NewsArticleInput, StoryCluster};

use crate::{cluster::ClusterEngine, dedupe::DedupeEngine, source::SourceRegistry};

pub struct IngestionPreview {
    pub accepted_articles: usize,
    pub rejected_articles: usize,
    pub clusters: Vec<StoryCluster>,
}

pub struct IntelligenceInboxService {
    sources: SourceRegistry,
}

impl Default for IntelligenceInboxService {
    fn default() -> Self {
        Self {
            sources: SourceRegistry::with_defaults(),
        }
    }
}

impl IntelligenceInboxService {
    pub fn preview_ingestion(&self, articles: Vec<NewsArticleInput>) -> IngestionPreview {
        let mut accepted = Vec::new();
        let mut rejected_articles = 0_usize;

        for article in articles {
            if self.sources.is_allowed(&article.source) {
                accepted.push(DedupeEngine::normalize(&article));
            } else {
                rejected_articles += 1;
            }
        }

        let clusters = ClusterEngine::cluster(&accepted);

        IngestionPreview {
            accepted_articles: accepted.len(),
            rejected_articles,
            clusters,
        }
    }

    pub fn default_inbox(&self) -> Vec<InboxItem> {
        vec![
            InboxItem {
                cluster_key: "fed-rates-path".to_string(),
                title: "Rates path repriced after payroll surprise".to_string(),
                summary: "Bond yields moved higher and growth multiples compressed. Watch duration risk in high-beta holdings.".to_string(),
                impact_score: 0.92,
                source_count: 6,
                canonical_url: "https://example.com/fed-rates-path".to_string(),
            },
            InboxItem {
                cluster_key: "chip-supply-chain".to_string(),
                title: "New semiconductor supply guidance tightens".to_string(),
                summary: "Lead-time revisions may affect AI infrastructure names and gross margin assumptions.".to_string(),
                impact_score: 0.87,
                source_count: 4,
                canonical_url: "https://example.com/chip-supply-chain".to_string(),
            },
            InboxItem {
                cluster_key: format!("market-open-{}", Utc::now().format("%Y%m%d")),
                title: "Europe open breadth turns defensive".to_string(),
                summary: "Defensives outperformed into the session open while cyclicals lagged.".to_string(),
                impact_score: 0.73,
                source_count: 3,
                canonical_url: "https://example.com/europe-open-breadth".to_string(),
            },
        ]
    }
}
