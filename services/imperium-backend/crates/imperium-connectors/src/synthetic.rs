use chrono::Utc;
use imperium_domain::{alerts::AlertEvent, intelligence::NewsArticleInput};
use imperium_market::provider::ProviderTick;
use uuid::Uuid;

#[derive(Clone)]
pub struct SyntheticConnectorFeed {
    symbols: Vec<&'static str>,
    narratives: Vec<&'static str>,
}

impl Default for SyntheticConnectorFeed {
    fn default() -> Self {
        Self {
            symbols: vec!["SPY", "QQQ", "NVDA", "MSFT", "BTCUSD", "ETHUSD"],
            narratives: vec![
                "Fed speakers lean cautious on early cuts",
                "Semiconductor lead times tighten across foundries",
                "Energy complex reprices after inventory surprise",
                "Mega-cap earnings revisions remain mixed",
                "Dollar strength pressures risk assets into Europe open",
            ],
        }
    }
}

impl SyntheticConnectorFeed {
    pub fn market_provider_tick(&self, sequence: u64) -> ProviderTick {
        let symbol = self.symbols[(sequence as usize) % self.symbols.len()];
        let base = deterministic_price(symbol);
        let drift = ((sequence % 13) as f64 - 6.0) * 0.37;
        let volume = 5_000.0 + ((sequence * 257) % 20_000) as f64;

        ProviderTick {
            provider: "synthetic".to_string(),
            symbol: symbol.to_string(),
            price: (base + drift).max(1.0),
            volume,
            timestamp: Utc::now(),
        }
    }

    pub fn news_articles(&self, sequence: u64) -> Vec<NewsArticleInput> {
        let headline = self.narratives[(sequence as usize) % self.narratives.len()];
        let source = match sequence % 5 {
            0 => "reuters",
            1 => "bloomberg",
            2 => "ft",
            3 => "wsj",
            _ => "sec",
        };

        let slug = slugify(headline);

        vec![NewsArticleInput {
            source: source.to_string(),
            url: format!("https://imperium.local/news/{slug}-{sequence}"),
            title: headline.to_string(),
            body: Some(format!(
                "Synthetic ingest payload {} generated for development pipelines.",
                sequence
            )),
            published_at: Utc::now(),
        }]
    }

    pub fn alert_event(&self, sequence: u64) -> AlertEvent {
        match sequence % 3 {
            0 => AlertEvent {
                alert_id: Uuid::new_v4(),
                rule_id: None,
                category: "market".to_string(),
                title: "BTC moved 2% within ten minutes".to_string(),
                what_happened: "Synthetic volatility burst detected on crypto watchlist."
                    .to_string(),
                why_it_matters: "Rapid moves can spill into correlated high-beta names."
                    .to_string(),
                what_to_watch_next: "Track funding skew and cross-asset volatility expansion."
                    .to_string(),
                created_at: Utc::now(),
            },
            1 => AlertEvent {
                alert_id: Uuid::new_v4(),
                rule_id: None,
                category: "portfolio".to_string(),
                title: "Concentration threshold breached on top position".to_string(),
                what_happened: "Largest synthetic holding now exceeds configured allocation."
                    .to_string(),
                why_it_matters: "Single-name concentration amplifies drawdown sensitivity."
                    .to_string(),
                what_to_watch_next: "Rebalance exposure or define hedging triggers.".to_string(),
                created_at: Utc::now(),
            },
            _ => AlertEvent {
                alert_id: Uuid::new_v4(),
                rule_id: None,
                category: "business".to_string(),
                title: "Runway estimate dropped below strategic threshold".to_string(),
                what_happened: "Synthetic burn trend tightened projected cash runway.".to_string(),
                why_it_matters: "Operating buffer is now below pre-defined risk appetite."
                    .to_string(),
                what_to_watch_next: "Escalate collections and review discretionary spend controls."
                    .to_string(),
                created_at: Utc::now(),
            },
        }
    }
}

fn deterministic_price(symbol: &str) -> f64 {
    let hash = symbol.bytes().fold(0_u64, |acc, byte| {
        acc.wrapping_mul(37).wrapping_add(byte as u64)
    });
    80.0 + (hash % 12_500) as f64 / 20.0
}

fn slugify(value: &str) -> String {
    value
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() {
                char.to_ascii_lowercase()
            } else if char.is_ascii_whitespace() || char == '-' {
                '-'
            } else {
                '\0'
            }
        })
        .filter(|char| *char != '\0')
        .collect::<String>()
        .split('-')
        .filter(|chunk| !chunk.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}
