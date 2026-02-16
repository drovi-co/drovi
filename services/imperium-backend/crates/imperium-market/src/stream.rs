use imperium_domain::market::MarketStreamContract;

pub const MARKET_TICK_SUBJECT: &str = "imperium.market.tick";
pub const MARKET_CANDLE_SUBJECT: &str = "imperium.market.candle";
pub const MARKET_ALERT_SUBJECT: &str = "imperium.market.alert";

pub fn stream_contracts() -> Vec<MarketStreamContract> {
    vec![
        MarketStreamContract {
            channel: "tick".to_string(),
            subject: MARKET_TICK_SUBJECT.to_string(),
            payload_schema: "MarketTick".to_string(),
        },
        MarketStreamContract {
            channel: "candle".to_string(),
            subject: MARKET_CANDLE_SUBJECT.to_string(),
            payload_schema: "Candle".to_string(),
        },
        MarketStreamContract {
            channel: "alert".to_string(),
            subject: MARKET_ALERT_SUBJECT.to_string(),
            payload_schema: "MarketAlertEvent".to_string(),
        },
    ]
}
