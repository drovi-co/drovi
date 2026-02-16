pub mod service;

pub use service::{BriefContext, BriefService, BriefServiceError};

pub fn crate_name() -> &'static str {
    "imperium-brief"
}
