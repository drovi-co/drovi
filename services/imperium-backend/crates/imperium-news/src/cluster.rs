use std::collections::HashMap;

use imperium_domain::intelligence::{NormalizedArticle, StoryCluster};

use crate::dedupe::DedupeEngine;

pub struct ClusterEngine;

impl ClusterEngine {
    pub fn cluster(articles: &[NormalizedArticle]) -> Vec<StoryCluster> {
        let mut groups: HashMap<String, Vec<&NormalizedArticle>> = HashMap::new();

        for article in articles {
            groups
                .entry(DedupeEngine::dedupe_key(article))
                .or_default()
                .push(article);
        }

        let mut clusters = groups
            .into_iter()
            .map(|(cluster_key, items)| {
                let canonical = items
                    .iter()
                    .min_by_key(|item| item.published_at)
                    .copied()
                    .expect("cluster cannot be empty");

                StoryCluster {
                    cluster_key,
                    title: canonical.title.clone(),
                    article_count: items.len(),
                    canonical_url: canonical.url.clone(),
                    impact_score: estimate_impact(items.len()),
                }
            })
            .collect::<Vec<_>>();

        clusters.sort_by(|left, right| {
            right
                .impact_score
                .partial_cmp(&left.impact_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        clusters
    }
}

fn estimate_impact(source_count: usize) -> f64 {
    let scaled = (source_count as f64 / 10.0).min(1.0);
    0.35 + scaled * 0.65
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn clusters_duplicate_titles_together() {
        let articles = vec![
            NormalizedArticle {
                source: "reuters".to_string(),
                url: "https://example.com/a".to_string(),
                title: "Fed holds rates".to_string(),
                normalized_title: "fed holds rates".to_string(),
                published_at: Utc::now(),
            },
            NormalizedArticle {
                source: "bloomberg".to_string(),
                url: "https://example.com/b".to_string(),
                title: "Fed holds rates".to_string(),
                normalized_title: "fed holds rates".to_string(),
                published_at: Utc::now(),
            },
        ];

        let clusters = ClusterEngine::cluster(&articles);
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0].article_count, 2);
    }
}
