pub mod service;

pub use service::JournalService;

pub fn crate_name() -> &'static str {
    "imperium-journal"
}
