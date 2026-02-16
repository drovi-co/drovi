pub mod candle;
pub mod provider;
pub mod service;
pub mod stream;

pub use service::MarketService;

pub fn crate_name() -> &'static str {
    "imperium-market"
}
