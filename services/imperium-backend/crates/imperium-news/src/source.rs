use std::collections::HashSet;

#[derive(Default)]
pub struct SourceRegistry {
    allowlist: HashSet<String>,
}

impl SourceRegistry {
    pub fn with_defaults() -> Self {
        let mut allowlist = HashSet::new();
        allowlist.insert("reuters".to_string());
        allowlist.insert("bloomberg".to_string());
        allowlist.insert("ft".to_string());
        allowlist.insert("sec".to_string());
        allowlist.insert("sec-rss".to_string());
        allowlist.insert("wsj".to_string());
        allowlist.insert("benzinga".to_string());
        allowlist.insert("newsapi".to_string());

        Self { allowlist }
    }

    pub fn is_allowed(&self, source: &str) -> bool {
        self.allowlist.contains(&source.to_lowercase())
    }
}
