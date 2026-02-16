use chrono::{DateTime, TimeZone, Utc};
use imperium_domain::market::{Candle, CandleInterval, MarketTick};
use std::collections::HashMap;

#[derive(Debug, Clone)]
struct CandleState {
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: f64,
}

#[derive(Default)]
pub struct CandleAggregator {
    buckets: HashMap<(String, CandleInterval, i64), CandleState>,
}

impl CandleAggregator {
    pub fn ingest_tick(&mut self, tick: &MarketTick, interval: CandleInterval) -> Option<Candle> {
        let bucket_start_epoch = bucket_start_epoch(tick.timestamp, interval);
        let key = (tick.symbol.clone(), interval, bucket_start_epoch);

        let state = self
            .buckets
            .entry(key.clone())
            .or_insert_with(|| CandleState {
                open: tick.price,
                high: tick.price,
                low: tick.price,
                close: tick.price,
                volume: tick.volume,
            });

        state.high = state.high.max(tick.price);
        state.low = state.low.min(tick.price);
        state.close = tick.price;
        state.volume += tick.volume;

        let start_time = Utc.timestamp_opt(bucket_start_epoch, 0).single()?;
        let end_time = start_time + chrono::Duration::seconds(interval.seconds());

        Some(Candle {
            symbol: key.0,
            interval,
            open: state.open,
            high: state.high,
            low: state.low,
            close: state.close,
            volume: state.volume,
            start_time,
            end_time,
        })
    }
}

fn bucket_start_epoch(timestamp: DateTime<Utc>, interval: CandleInterval) -> i64 {
    let seconds = interval.seconds();
    (timestamp.timestamp() / seconds) * seconds
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updates_candle_ohlc_and_volume() {
        let mut aggregator = CandleAggregator::default();
        let now = Utc
            .with_ymd_and_hms(2026, 1, 2, 14, 30, 5)
            .single()
            .expect("fixed timestamp must be valid");

        let first = MarketTick {
            symbol: "NVDA".to_string(),
            price: 100.0,
            volume: 10.0,
            timestamp: now,
            source: "test".to_string(),
        };

        let second = MarketTick {
            symbol: "NVDA".to_string(),
            price: 103.0,
            volume: 8.0,
            timestamp: now + chrono::Duration::seconds(10),
            source: "test".to_string(),
        };

        let candle_a = aggregator
            .ingest_tick(&first, CandleInterval::OneMinute)
            .expect("candle must exist");
        let candle_b = aggregator
            .ingest_tick(&second, CandleInterval::OneMinute)
            .expect("candle must exist");

        assert_eq!(candle_a.open, 100.0);
        assert_eq!(candle_b.open, 100.0);
        assert_eq!(candle_b.high, 103.0);
        assert_eq!(candle_b.close, 103.0);
        assert!(candle_b.volume >= 18.0);
    }
}
