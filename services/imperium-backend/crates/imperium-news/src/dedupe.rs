use imperium_domain::intelligence::{NewsArticleInput, NormalizedArticle};

pub struct DedupeEngine;

impl DedupeEngine {
    pub fn normalize(article: &NewsArticleInput) -> NormalizedArticle {
        NormalizedArticle {
            source: article.source.clone(),
            url: article.url.clone(),
            title: article.title.clone(),
            normalized_title: normalize_title(&article.title),
            published_at: article.published_at,
        }
    }

    pub fn dedupe_key(article: &NormalizedArticle) -> String {
        article.normalized_title.clone()
    }
}

fn normalize_title(title: &str) -> String {
    title
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char.is_ascii_whitespace() {
                char.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn normalizes_title_for_dedupe() {
        let article = NewsArticleInput {
            source: "reuters".to_string(),
            url: "https://example.com/1".to_string(),
            title: "Fed Speakers Push Back on Early Cuts!!!".to_string(),
            body: None,
            published_at: Utc::now(),
        };

        let normalized = DedupeEngine::normalize(&article);
        assert_eq!(
            normalized.normalized_title,
            "fed speakers push back on early cuts"
        );
    }
}
