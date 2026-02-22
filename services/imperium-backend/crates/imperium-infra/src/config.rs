use crate::error::AppError;
use std::{collections::HashSet, time::Duration};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DataMode {
    Synthetic,
    Hybrid,
    Live,
}

impl DataMode {
    fn parse(value: &str) -> Result<Self, AppError> {
        match value.trim().to_ascii_lowercase().as_str() {
            "synthetic" => Ok(Self::Synthetic),
            "hybrid" => Ok(Self::Hybrid),
            "live" => Ok(Self::Live),
            other => Err(AppError::configuration(format!(
                "invalid IMPERIUM_DATA_MODE={other}; expected synthetic|hybrid|live"
            ))),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Synthetic => "synthetic",
            Self::Hybrid => "hybrid",
            Self::Live => "live",
        }
    }
}

#[derive(Clone, Debug, Copy)]
pub enum ProviderDomain {
    Markets,
    Crypto,
    News,
    Banking,
    Brokerage,
    Business,
}

impl ProviderDomain {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Markets => "markets",
            Self::Crypto => "crypto",
            Self::News => "news",
            Self::Banking => "banking",
            Self::Brokerage => "brokerage",
            Self::Business => "business",
        }
    }
}

#[derive(Clone, Debug)]
pub struct ProviderBinding {
    pub domain: ProviderDomain,
    pub primary: String,
    pub fallbacks: Vec<String>,
    pub required_credentials: Vec<String>,
    pub configured: bool,
}

#[derive(Clone, Debug)]
pub struct ProviderCatalog {
    pub mode: DataMode,
    pub markets: ProviderBinding,
    pub crypto: ProviderBinding,
    pub news: ProviderBinding,
    pub banking: ProviderBinding,
    pub brokerage: ProviderBinding,
    pub business: ProviderBinding,
}

impl ProviderCatalog {
    fn from_env() -> Result<Self, AppError> {
        let mode = DataMode::parse(&env_or_default("IMPERIUM_DATA_MODE", "synthetic"))?;

        let markets = parse_provider_binding(
            ProviderDomain::Markets,
            "IMPERIUM_MARKETS_PROVIDER",
            "polygon",
            "IMPERIUM_MARKETS_FALLBACKS",
            "finnhub,twelvedata",
        )?;
        let crypto = parse_provider_binding(
            ProviderDomain::Crypto,
            "IMPERIUM_CRYPTO_PROVIDER",
            "coinbase",
            "IMPERIUM_CRYPTO_FALLBACKS",
            "coingecko",
        )?;
        let news = parse_provider_binding(
            ProviderDomain::News,
            "IMPERIUM_NEWS_PROVIDER",
            "benzinga",
            "IMPERIUM_NEWS_FALLBACKS",
            "newsapi,sec-rss",
        )?;
        let banking = parse_provider_binding(
            ProviderDomain::Banking,
            "IMPERIUM_BANKING_PROVIDER",
            "plaid",
            "IMPERIUM_BANKING_FALLBACKS",
            "truelayer",
        )?;
        let brokerage = parse_provider_binding(
            ProviderDomain::Brokerage,
            "IMPERIUM_BROKERAGE_PROVIDER",
            "snaptrade",
            "IMPERIUM_BROKERAGE_FALLBACKS",
            "alpaca",
        )?;
        let business = parse_provider_binding(
            ProviderDomain::Business,
            "IMPERIUM_BUSINESS_PROVIDER",
            "stripe",
            "IMPERIUM_BUSINESS_FALLBACKS",
            "quickbooks,polar",
        )?;

        let catalog = Self {
            mode,
            markets,
            crypto,
            news,
            banking,
            brokerage,
            business,
        };

        if matches!(catalog.mode, DataMode::Live) {
            let missing = catalog.missing_requirements();
            if !missing.is_empty() {
                return Err(AppError::configuration(format!(
                    "IMPERIUM_DATA_MODE=live requires configured providers: {}",
                    missing.join("; ")
                )));
            }
        }

        Ok(catalog)
    }

    pub fn bindings(&self) -> Vec<&ProviderBinding> {
        vec![
            &self.markets,
            &self.crypto,
            &self.news,
            &self.banking,
            &self.brokerage,
            &self.business,
        ]
    }

    pub fn missing_requirements(&self) -> Vec<String> {
        self.bindings()
            .into_iter()
            .filter(|binding| !binding.configured)
            .map(|binding| {
                format!(
                    "{}:{} -> {}",
                    binding.domain.as_str(),
                    binding.primary,
                    binding.required_credentials.join(", ")
                )
            })
            .collect()
    }
}

#[derive(Clone, Debug)]
pub struct ImperiumConfig {
    pub environment: String,
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub redis_url: String,
    pub nats_url: String,
    pub redis_namespace: String,
    pub shutdown_grace_period: Duration,
    pub apple_client_id: Option<String>,
    pub providers: ProviderCatalog,
}

impl ImperiumConfig {
    pub fn from_env() -> Result<Self, AppError> {
        let environment = env_or_default("ENVIRONMENT", "development");
        let host = env_or_default("IMPERIUM_HOST", "0.0.0.0");
        let port = parse_u16_with_default("IMPERIUM_PORT", 8010)?;
        let database_url = required("DATABASE_URL")?;
        let redis_url = required("REDIS_URL")?;
        let nats_url = required("NATS_URL")?;
        let redis_namespace = env_or_default("IMPERIUM_REDIS_NAMESPACE", "imperium");
        let shutdown_grace_period = Duration::from_secs(parse_u64_with_default(
            "IMPERIUM_SHUTDOWN_GRACE_SECONDS",
            20,
        )?);
        let apple_client_id = optional("IMPERIUM_APPLE_CLIENT_ID");
        let providers = ProviderCatalog::from_env()?;

        Ok(Self {
            environment,
            host,
            port,
            database_url,
            redis_url,
            nats_url,
            redis_namespace,
            shutdown_grace_period,
            apple_client_id,
            providers,
        })
    }

    pub fn socket_addr(&self) -> Result<std::net::SocketAddr, AppError> {
        format!("{}:{}", self.host, self.port)
            .parse()
            .map_err(|error| {
                AppError::configuration(format!("invalid IMPERIUM_HOST/IMPERIUM_PORT: {error}"))
            })
    }
}

fn required(key: &str) -> Result<String, AppError> {
    std::env::var(key).map_err(|_| AppError::configuration(format!("missing {key}")))
}

fn optional(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_or_default(key: &str, default_value: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default_value.to_string())
}

fn parse_u16_with_default(key: &str, default_value: u16) -> Result<u16, AppError> {
    match std::env::var(key) {
        Ok(value) => value
            .parse::<u16>()
            .map_err(|error| AppError::configuration(format!("invalid {key}={value}: {error}"))),
        Err(_) => Ok(default_value),
    }
}

fn parse_u64_with_default(key: &str, default_value: u64) -> Result<u64, AppError> {
    match std::env::var(key) {
        Ok(value) => value
            .parse::<u64>()
            .map_err(|error| AppError::configuration(format!("invalid {key}={value}: {error}"))),
        Err(_) => Ok(default_value),
    }
}

fn parse_provider_binding(
    domain: ProviderDomain,
    primary_key: &str,
    default_primary: &str,
    fallback_key: &str,
    default_fallbacks: &str,
) -> Result<ProviderBinding, AppError> {
    let primary = normalize_provider_name(&env_or_default(primary_key, default_primary));
    validate_provider(domain, &primary, primary_key)?;

    let mut seen = HashSet::new();
    let mut fallbacks = Vec::new();
    for raw in csv_or_default(fallback_key, default_fallbacks) {
        let fallback = normalize_provider_name(&raw);
        validate_provider(domain, &fallback, fallback_key)?;

        if fallback == primary || seen.contains(&fallback) {
            continue;
        }

        seen.insert(fallback.clone());
        fallbacks.push(fallback);
    }

    let required_credentials = required_credentials_for(domain, &primary)
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let configured = credentials_present(&required_credentials);

    Ok(ProviderBinding {
        domain,
        primary,
        fallbacks,
        required_credentials,
        configured,
    })
}

fn credentials_present(required_credentials: &[String]) -> bool {
    required_credentials.iter().all(|key| env_is_set(key))
}

fn env_is_set(key: &str) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn normalize_provider_name(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace('_', "-")
}

fn csv_or_default(key: &str, default_value: &str) -> Vec<String> {
    env_or_default(key, default_value)
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>()
}

fn validate_provider(domain: ProviderDomain, provider: &str, key: &str) -> Result<(), AppError> {
    let allowed = allowed_providers(domain);
    if allowed.contains(&provider) {
        Ok(())
    } else {
        Err(AppError::configuration(format!(
            "invalid {key}={provider}; expected one of: {}",
            allowed.join(", ")
        )))
    }
}

fn allowed_providers(domain: ProviderDomain) -> &'static [&'static str] {
    match domain {
        ProviderDomain::Markets => &["synthetic", "polygon", "finnhub", "twelvedata"],
        ProviderDomain::Crypto => &["synthetic", "coinbase", "coingecko", "kraken"],
        ProviderDomain::News => &["synthetic", "benzinga", "newsapi", "fmp", "sec-rss"],
        ProviderDomain::Banking => &["synthetic", "plaid", "truelayer", "tink"],
        ProviderDomain::Brokerage => &["synthetic", "snaptrade", "alpaca", "ibkr-flex"],
        ProviderDomain::Business => &["synthetic", "stripe", "quickbooks", "polar", "xero"],
    }
}

fn required_credentials_for(domain: ProviderDomain, provider: &str) -> &'static [&'static str] {
    match (domain, provider) {
        (_, "synthetic") => &[],
        (ProviderDomain::Markets, "polygon") => &["POLYGON_API_KEY"],
        (ProviderDomain::Markets, "finnhub") => &["FINNHUB_API_KEY"],
        (ProviderDomain::Markets, "twelvedata") => &["TWELVEDATA_API_KEY"],
        (ProviderDomain::Crypto, "coinbase") => &["COINBASE_API_KEY", "COINBASE_API_SECRET"],
        (ProviderDomain::Crypto, "coingecko") => &["COINGECKO_API_KEY"],
        (ProviderDomain::Crypto, "kraken") => &["KRAKEN_API_KEY", "KRAKEN_API_SECRET"],
        (ProviderDomain::News, "benzinga") => &["BENZINGA_API_KEY"],
        (ProviderDomain::News, "newsapi") => &["NEWSAPI_API_KEY"],
        (ProviderDomain::News, "fmp") => &["FMP_API_KEY"],
        (ProviderDomain::News, "sec-rss") => &[],
        (ProviderDomain::Banking, "plaid") => {
            &["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ACCESS_TOKEN"]
        }
        (ProviderDomain::Banking, "truelayer") => {
            &["TRUELAYER_CLIENT_ID", "TRUELAYER_CLIENT_SECRET"]
        }
        (ProviderDomain::Banking, "tink") => &["TINK_CLIENT_ID", "TINK_CLIENT_SECRET"],
        (ProviderDomain::Brokerage, "snaptrade") => {
            &["SNAPTRADE_CLIENT_ID", "SNAPTRADE_CONSUMER_KEY"]
        }
        (ProviderDomain::Brokerage, "alpaca") => &["ALPACA_API_KEY", "ALPACA_API_SECRET"],
        (ProviderDomain::Brokerage, "ibkr-flex") => &["IBKR_FLEX_TOKEN", "IBKR_FLEX_QUERY_ID"],
        (ProviderDomain::Business, "stripe") => &["STRIPE_SECRET_KEY"],
        (ProviderDomain::Business, "quickbooks") => &[
            "QUICKBOOKS_CLIENT_ID",
            "QUICKBOOKS_CLIENT_SECRET",
            "QUICKBOOKS_REALM_ID",
        ],
        (ProviderDomain::Business, "polar") => &["POLAR_ACCESS_TOKEN"],
        (ProviderDomain::Business, "xero") => &["XERO_CLIENT_ID", "XERO_CLIENT_SECRET"],
        _ => &[],
    }
}

#[cfg(test)]
mod tests {
    use super::{required_credentials_for, DataMode, ProviderDomain};

    #[test]
    fn parses_valid_data_modes() {
        assert_eq!(
            DataMode::parse("synthetic").expect("synthetic should parse"),
            DataMode::Synthetic
        );
        assert_eq!(
            DataMode::parse("hybrid").expect("hybrid should parse"),
            DataMode::Hybrid
        );
        assert_eq!(
            DataMode::parse("live").expect("live should parse"),
            DataMode::Live
        );
    }

    #[test]
    fn maps_provider_requirements() {
        assert_eq!(
            required_credentials_for(ProviderDomain::Markets, "polygon"),
            ["POLYGON_API_KEY"]
        );
        assert_eq!(
            required_credentials_for(ProviderDomain::Banking, "plaid"),
            ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_ACCESS_TOKEN"]
        );
        assert!(
            required_credentials_for(ProviderDomain::News, "sec-rss").is_empty(),
            "sec-rss should not require credentials"
        );
    }
}
