use chrono::{DateTime, Utc};
use imperium_domain::market::MarketTick;

#[derive(Debug, Clone)]
pub struct ProviderTick {
    pub provider: String,
    pub symbol: String,
    pub price: f64,
    pub volume: f64,
    pub timestamp: DateTime<Utc>,
}

pub fn normalize_provider_tick(tick: ProviderTick) -> MarketTick {
    MarketTick {
        symbol: tick.symbol.to_uppercase(),
        price: tick.price,
        volume: tick.volume,
        timestamp: tick.timestamp,
        source: tick.provider,
    }
}
