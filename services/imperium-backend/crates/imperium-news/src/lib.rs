pub mod cluster;
pub mod dedupe;
pub mod service;
pub mod source;

pub use service::IntelligenceInboxService;

pub fn crate_name() -> &'static str {
    "imperium-news"
}
