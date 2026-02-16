pub mod service;

pub use service::{AlertEngineService, AlertEventView};

pub fn crate_name() -> &'static str {
    "imperium-alerts"
}
