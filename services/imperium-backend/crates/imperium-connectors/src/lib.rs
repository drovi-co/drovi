pub mod runtime;
pub mod synthetic;

pub use runtime::{ConnectorError, ConnectorRuntime};
pub use synthetic::SyntheticConnectorFeed;

pub fn crate_name() -> &'static str {
    "imperium-connectors"
}
