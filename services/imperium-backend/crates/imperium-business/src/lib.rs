pub mod service;

pub use service::BusinessCommandService;

pub fn crate_name() -> &'static str {
    "imperium-business"
}
