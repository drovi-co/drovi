use crate::{candle::CandleAggregator, provider::normalize_provider_tick, provider::ProviderTick};
use chrono::{Duration, Utc};
use imperium_domain::market::{
    Candle, CandleInterval, MarketStreamContract, MarketTick, SymbolQuote, WatchlistEntry,
};

pub struct MarketUpdate {
    pub tick: MarketTick,
    pub candle_1m: Option<Candle>,
}

#[derive(Default)]
pub struct MarketService {
    candle_aggregator: CandleAggregator,
}

impl MarketService {
    pub fn process_provider_tick(&mut self, provider_tick: ProviderTick) -> MarketUpdate {
        let tick = normalize_provider_tick(provider_tick);
        let candle_1m = self
            .candle_aggregator
            .ingest_tick(&tick, CandleInterval::OneMinute);

        MarketUpdate { tick, candle_1m }
    }

    pub fn sample_watchlist(&self) -> Vec<WatchlistEntry> {
        vec![
            WatchlistEntry {
                symbol: "SPY".to_string(),
                label: "Core".to_string(),
            },
            WatchlistEntry {
                symbol: "QQQ".to_string(),
                label: "Growth".to_string(),
            },
            WatchlistEntry {
                symbol: "NVDA".to_string(),
                label: "AI".to_string(),
            },
            WatchlistEntry {
                symbol: "BTCUSD".to_string(),
                label: "Crypto".to_string(),
            },
        ]
    }

    pub fn sample_quote(&self, symbol: &str) -> SymbolQuote {
        let normalized = symbol.to_uppercase();
        let baseline = deterministic_price_seed(&normalized);

        SymbolQuote {
            symbol: normalized,
            price: baseline,
            change_percent: (baseline % 7.0) - 3.0,
            volume: 1_000_000.0 + baseline * 500.0,
            timestamp: Utc::now(),
        }
    }

    pub fn sample_candles(
        &self,
        symbol: &str,
        interval: CandleInterval,
        limit: usize,
    ) -> Vec<Candle> {
        let normalized = symbol.to_uppercase();
        let now = Utc::now();
        let mut candles = Vec::with_capacity(limit);

        let base = deterministic_price_seed(&normalized);

        for idx in 0..limit {
            let step = i64::try_from(limit.saturating_sub(idx)).unwrap_or(0);
            let start_time = now - Duration::seconds(step * interval.seconds());
            let end_time = start_time + Duration::seconds(interval.seconds());
            let open = base + (idx as f64 * 0.6);
            let close = open + ((idx % 5) as f64 - 2.0) * 0.35;
            let high = open.max(close) + 0.8;
            let low = open.min(close) - 0.8;

            candles.push(Candle {
                symbol: normalized.clone(),
                interval,
                open,
                high,
                low,
                close,
                volume: 12_000.0 + (idx as f64 * 150.0),
                start_time,
                end_time,
            });
        }

        candles
    }

    pub fn stream_contracts(&self) -> Vec<MarketStreamContract> {
        crate::stream::stream_contracts()
    }
}

fn deterministic_price_seed(symbol: &str) -> f64 {
    let hash = symbol.bytes().fold(0_u64, |acc, byte| {
        acc.wrapping_mul(31).wrapping_add(byte as u64)
    });
    50.0 + (hash % 9000) as f64 / 10.0
}
