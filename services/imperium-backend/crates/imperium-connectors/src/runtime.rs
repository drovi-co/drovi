use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

use chrono::{DateTime, Utc};
use imperium_domain::{
    alerts::AlertEvent,
    intelligence::NewsArticleInput,
    portfolio::{Exposure, PortfolioAccountSummary, PortfolioOverview, PositionSummary},
};
use imperium_infra::{
    config::{DataMode, ProviderBinding},
    telemetry::record_connector_request,
    ImperiumConfig,
};
use imperium_market::provider::ProviderTick;
use reqwest::StatusCode;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::synthetic::SyntheticConnectorFeed;

const EQUITY_SYMBOLS: &[&str] = &["SPY", "QQQ", "NVDA", "MSFT"];
const CRYPTO_PRODUCTS: &[&str] = &["BTC-USD", "ETH-USD", "SOL-USD"];

#[derive(Debug, Error)]
pub enum ConnectorError {
    #[error("failed to build connector http client: {0}")]
    ClientBuild(String),
    #[error("missing required credential: {0}")]
    MissingCredential(&'static str),
    #[error("unsupported provider `{provider}` for domain `{domain}`")]
    UnsupportedProvider { domain: String, provider: String },
    #[error("provider `{provider}` request failed: {message}")]
    ProviderRequest { provider: String, message: String },
    #[error("provider `{provider}` returned invalid payload: {message}")]
    ProviderPayload { provider: String, message: String },
}

#[derive(Clone)]
pub struct ConnectorRuntime {
    mode: DataMode,
    providers: ProviderBindings,
    http: reqwest::Client,
    synthetic: SyntheticConnectorFeed,
    max_retries: u8,
    backoff_ms: u64,
    sec_user_agent: String,
}

#[derive(Clone)]
struct ProviderBindings {
    markets: ProviderBinding,
    crypto: ProviderBinding,
    news: ProviderBinding,
    banking: ProviderBinding,
}

impl ConnectorRuntime {
    pub fn from_config(config: &ImperiumConfig) -> Result<Self, ConnectorError> {
        let max_retries = std::env::var("IMPERIUM_PROVIDER_MAX_RETRIES")
            .ok()
            .and_then(|value| value.parse::<u8>().ok())
            .unwrap_or(2)
            .min(6);
        let backoff_ms = std::env::var("IMPERIUM_PROVIDER_BACKOFF_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(300)
            .clamp(50, 5_000);
        let sec_user_agent = std::env::var("IMPERIUM_SEC_USER_AGENT")
            .unwrap_or_else(|_| "imperium-connectors/0.1 (ops@imperium.local)".to_string());

        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(3))
            .timeout(std::time::Duration::from_secs(8))
            .user_agent("imperium-connectors/0.1")
            .build()
            .map_err(|error| ConnectorError::ClientBuild(error.to_string()))?;

        Ok(Self {
            mode: config.providers.mode.clone(),
            providers: ProviderBindings {
                markets: config.providers.markets.clone(),
                crypto: config.providers.crypto.clone(),
                news: config.providers.news.clone(),
                banking: config.providers.banking.clone(),
            },
            http,
            synthetic: SyntheticConnectorFeed::default(),
            max_retries,
            backoff_ms,
            sec_user_agent,
        })
    }

    pub async fn market_provider_tick(
        &self,
        sequence: u64,
    ) -> Result<ProviderTick, ConnectorError> {
        match self.mode {
            DataMode::Synthetic => Ok(self.synthetic.market_provider_tick(sequence)),
            DataMode::Hybrid => match self.fetch_market_tick_real(sequence).await {
                Ok(tick) => Ok(tick),
                Err(error) => {
                    tracing::warn!(
                        "hybrid market adapter fell back to synthetic feed: {}",
                        error
                    );
                    Ok(self.synthetic.market_provider_tick(sequence))
                }
            },
            DataMode::Live => self.fetch_market_tick_real(sequence).await,
        }
    }

    pub async fn news_articles(
        &self,
        sequence: u64,
    ) -> Result<Vec<NewsArticleInput>, ConnectorError> {
        match self.mode {
            DataMode::Synthetic => Ok(self.synthetic.news_articles(sequence)),
            DataMode::Hybrid => match self.fetch_news_articles_real().await {
                Ok(articles) if !articles.is_empty() => Ok(articles),
                Ok(_) => Ok(self.synthetic.news_articles(sequence)),
                Err(error) => {
                    tracing::warn!("hybrid news adapter fell back to synthetic feed: {}", error);
                    Ok(self.synthetic.news_articles(sequence))
                }
            },
            DataMode::Live => self.fetch_news_articles_real().await,
        }
    }

    pub fn alert_event(&self, sequence: u64) -> AlertEvent {
        self.synthetic.alert_event(sequence)
    }

    pub async fn portfolio_overview(&self) -> Result<Option<PortfolioOverview>, ConnectorError> {
        match self.mode {
            DataMode::Synthetic => Ok(None),
            DataMode::Hybrid => match self.fetch_portfolio_overview_real().await {
                Ok(overview) => Ok(Some(overview)),
                Err(error) => {
                    tracing::warn!(
                        "hybrid banking adapter unavailable, portfolio sync skipped: {}",
                        error
                    );
                    Ok(None)
                }
            },
            DataMode::Live => self.fetch_portfolio_overview_real().await.map(Some),
        }
    }

    async fn fetch_market_tick_real(&self, sequence: u64) -> Result<ProviderTick, ConnectorError> {
        if sequence.is_multiple_of(2) {
            self.fetch_equity_tick(sequence).await
        } else {
            self.fetch_crypto_tick(sequence).await
        }
    }

    async fn fetch_equity_tick(&self, sequence: u64) -> Result<ProviderTick, ConnectorError> {
        let symbol = EQUITY_SYMBOLS[(sequence as usize) % EQUITY_SYMBOLS.len()];

        let mut last_error: Option<ConnectorError> = None;
        for provider in provider_chain(&self.providers.markets) {
            let result = match provider.as_str() {
                "polygon" => self.fetch_polygon_tick(symbol).await,
                "finnhub" => self.fetch_finnhub_tick(symbol).await,
                "twelvedata" => self.fetch_twelvedata_tick(symbol).await,
                "synthetic" => Ok(self.synthetic.market_provider_tick(sequence)),
                other => Err(ConnectorError::UnsupportedProvider {
                    domain: "markets".to_string(),
                    provider: other.to_string(),
                }),
            };

            match result {
                Ok(tick) => return Ok(tick),
                Err(error) => {
                    tracing::warn!(provider = %provider, "equity adapter failed: {}", error);
                    last_error = Some(error);
                }
            }
        }

        Err(
            last_error.unwrap_or_else(|| ConnectorError::ProviderRequest {
                provider: "markets".to_string(),
                message: "no market provider was available".to_string(),
            }),
        )
    }

    async fn fetch_crypto_tick(&self, sequence: u64) -> Result<ProviderTick, ConnectorError> {
        let product = CRYPTO_PRODUCTS[(sequence as usize) % CRYPTO_PRODUCTS.len()];

        let mut last_error: Option<ConnectorError> = None;
        for provider in provider_chain(&self.providers.crypto) {
            let result = match provider.as_str() {
                "coinbase" => self.fetch_coinbase_tick(product).await,
                "coingecko" => self.fetch_coingecko_tick(product).await,
                "synthetic" => Ok(self.synthetic.market_provider_tick(sequence)),
                other => Err(ConnectorError::UnsupportedProvider {
                    domain: "crypto".to_string(),
                    provider: other.to_string(),
                }),
            };

            match result {
                Ok(tick) => return Ok(tick),
                Err(error) => {
                    tracing::warn!(provider = %provider, "crypto adapter failed: {}", error);
                    last_error = Some(error);
                }
            }
        }

        Err(
            last_error.unwrap_or_else(|| ConnectorError::ProviderRequest {
                provider: "crypto".to_string(),
                message: "no crypto provider was available".to_string(),
            }),
        )
    }

    async fn fetch_news_articles_real(&self) -> Result<Vec<NewsArticleInput>, ConnectorError> {
        let mut last_error: Option<ConnectorError> = None;
        for provider in provider_chain(&self.providers.news) {
            let result = match provider.as_str() {
                "benzinga" => self.fetch_benzinga_news().await,
                "newsapi" => self.fetch_newsapi_articles().await,
                "sec-rss" => self.fetch_sec_rss().await,
                "synthetic" => Ok(self.synthetic.news_articles(0)),
                other => Err(ConnectorError::UnsupportedProvider {
                    domain: "news".to_string(),
                    provider: other.to_string(),
                }),
            };

            match result {
                Ok(articles) if !articles.is_empty() => return Ok(articles),
                Ok(_) => continue,
                Err(error) => {
                    tracing::warn!(provider = %provider, "news adapter failed: {}", error);
                    last_error = Some(error);
                }
            }
        }

        Err(
            last_error.unwrap_or_else(|| ConnectorError::ProviderRequest {
                provider: "news".to_string(),
                message: "no news provider returned articles".to_string(),
            }),
        )
    }

    async fn fetch_portfolio_overview_real(&self) -> Result<PortfolioOverview, ConnectorError> {
        let mut last_error: Option<ConnectorError> = None;

        for provider in provider_chain(&self.providers.banking) {
            let result = match provider.as_str() {
                "plaid" => self.fetch_plaid_overview().await,
                "synthetic" => Err(ConnectorError::UnsupportedProvider {
                    domain: "banking".to_string(),
                    provider: "synthetic".to_string(),
                }),
                other => Err(ConnectorError::UnsupportedProvider {
                    domain: "banking".to_string(),
                    provider: other.to_string(),
                }),
            };

            match result {
                Ok(overview) => return Ok(overview),
                Err(error) => {
                    tracing::warn!(provider = %provider, "banking adapter failed: {}", error);
                    last_error = Some(error);
                }
            }
        }

        Err(
            last_error.unwrap_or_else(|| ConnectorError::ProviderRequest {
                provider: "banking".to_string(),
                message: "no banking provider returned account balances".to_string(),
            }),
        )
    }

    async fn fetch_polygon_tick(&self, symbol: &str) -> Result<ProviderTick, ConnectorError> {
        let api_key = required_env("POLYGON_API_KEY")?;
        let endpoint = format!("https://api.polygon.io/v2/last/trade/{symbol}");
        let payload: PolygonLastTradeResponse = self
            .request_json("polygon", |http| {
                http.get(&endpoint).query(&[("apiKey", api_key.as_str())])
            })
            .await?;

        let trade = payload
            .results
            .ok_or_else(|| ConnectorError::ProviderPayload {
                provider: "polygon".to_string(),
                message: "missing `results` in polygon response".to_string(),
            })?;

        let timestamp = ts_nanos_to_utc(trade.timestamp_ns).unwrap_or_else(Utc::now);

        Ok(ProviderTick {
            provider: "polygon".to_string(),
            symbol: symbol.to_string(),
            price: trade.price.max(0.0),
            volume: trade.size.unwrap_or_default(),
            timestamp,
        })
    }

    async fn fetch_finnhub_tick(&self, symbol: &str) -> Result<ProviderTick, ConnectorError> {
        let token = required_env("FINNHUB_API_KEY")?;
        let endpoint = "https://finnhub.io/api/v1/quote";
        let payload: FinnhubQuoteResponse = self
            .request_json("finnhub", |http| {
                http.get(endpoint)
                    .query(&[("symbol", symbol), ("token", token.as_str())])
            })
            .await?;

        if payload.current <= 0.0 {
            return Err(ConnectorError::ProviderPayload {
                provider: "finnhub".to_string(),
                message: "quote payload did not include positive `c` price".to_string(),
            });
        }

        let timestamp =
            chrono::DateTime::<Utc>::from_timestamp(payload.timestamp, 0).unwrap_or_else(Utc::now);

        Ok(ProviderTick {
            provider: "finnhub".to_string(),
            symbol: symbol.to_string(),
            price: payload.current,
            volume: payload.volume.unwrap_or_default(),
            timestamp,
        })
    }

    async fn fetch_twelvedata_tick(&self, symbol: &str) -> Result<ProviderTick, ConnectorError> {
        let api_key = required_env("TWELVEDATA_API_KEY")?;
        let endpoint = "https://api.twelvedata.com/price";
        let payload: TwelveDataPriceResponse = self
            .request_json("twelvedata", |http| {
                http.get(endpoint)
                    .query(&[("symbol", symbol), ("apikey", api_key.as_str())])
            })
            .await?;

        let price =
            payload
                .price
                .parse::<f64>()
                .map_err(|error| ConnectorError::ProviderPayload {
                    provider: "twelvedata".to_string(),
                    message: format!("invalid price `{}`: {error}", payload.price),
                })?;

        Ok(ProviderTick {
            provider: "twelvedata".to_string(),
            symbol: symbol.to_string(),
            price,
            volume: 0.0,
            timestamp: Utc::now(),
        })
    }

    async fn fetch_coinbase_tick(&self, product: &str) -> Result<ProviderTick, ConnectorError> {
        let _api_secret = required_env("COINBASE_API_SECRET")?;
        let api_key = required_env("COINBASE_API_KEY")?;
        let endpoint = format!("https://api.coinbase.com/v2/prices/{product}/spot");
        let payload: CoinbaseSpotResponse = self
            .request_json("coinbase", |http| {
                http.get(&endpoint)
                    .header("CB-ACCESS-KEY", api_key.as_str())
            })
            .await?;

        let price = payload.data.amount.parse::<f64>().map_err(|error| {
            ConnectorError::ProviderPayload {
                provider: "coinbase".to_string(),
                message: format!("invalid amount `{}`: {error}", payload.data.amount),
            }
        })?;

        Ok(ProviderTick {
            provider: "coinbase".to_string(),
            symbol: product.replace('-', ""),
            price,
            volume: 0.0,
            timestamp: Utc::now(),
        })
    }

    async fn fetch_coingecko_tick(&self, product: &str) -> Result<ProviderTick, ConnectorError> {
        let Some(coin_id) = coingecko_id_for_product(product) else {
            return Err(ConnectorError::ProviderPayload {
                provider: "coingecko".to_string(),
                message: format!("unsupported product `{product}`"),
            });
        };

        let endpoint = "https://api.coingecko.com/api/v3/simple/price";
        let payload: Value = self
            .request_json("coingecko", |http| {
                http.get(endpoint).query(&[
                    ("ids", coin_id),
                    ("vs_currencies", "usd"),
                    ("include_24hr_vol", "true"),
                ])
            })
            .await?;

        let coin = payload
            .get(coin_id)
            .ok_or_else(|| ConnectorError::ProviderPayload {
                provider: "coingecko".to_string(),
                message: format!("missing object for id `{coin_id}`"),
            })?;
        let price = coin.get("usd").and_then(Value::as_f64).ok_or_else(|| {
            ConnectorError::ProviderPayload {
                provider: "coingecko".to_string(),
                message: "missing usd price".to_string(),
            }
        })?;
        let volume = coin
            .get("usd_24h_vol")
            .and_then(Value::as_f64)
            .unwrap_or_default();

        Ok(ProviderTick {
            provider: "coingecko".to_string(),
            symbol: product.replace('-', ""),
            price,
            volume,
            timestamp: Utc::now(),
        })
    }

    async fn fetch_benzinga_news(&self) -> Result<Vec<NewsArticleInput>, ConnectorError> {
        let token = required_env("BENZINGA_API_KEY")?;
        let endpoint = "https://api.benzinga.com/api/v2/news";
        let payload: Value = self
            .request_json("benzinga", |http| {
                http.get(endpoint).query(&[
                    ("token", token.as_str()),
                    ("displayOutput", "full"),
                    ("pageSize", "7"),
                    ("channels", "general"),
                    ("sort", "updated:desc"),
                ])
            })
            .await?;

        Ok(extract_articles_from_json(payload, "benzinga", 7))
    }

    async fn fetch_newsapi_articles(&self) -> Result<Vec<NewsArticleInput>, ConnectorError> {
        let api_key = required_env("NEWSAPI_API_KEY")?;
        let endpoint = "https://newsapi.org/v2/top-headlines";
        let payload: NewsApiResponse = self
            .request_json("newsapi", |http| {
                http.get(endpoint).query(&[
                    ("apiKey", api_key.as_str()),
                    ("category", "business"),
                    ("language", "en"),
                    ("pageSize", "7"),
                ])
            })
            .await?;

        let articles = payload
            .articles
            .into_iter()
            .filter(|article| !article.title.trim().is_empty() && !article.url.trim().is_empty())
            .map(|article| NewsArticleInput {
                source: "newsapi".to_string(),
                url: article.url,
                title: article.title,
                body: article.description,
                published_at: article
                    .published_at
                    .as_deref()
                    .and_then(parse_datetime_str)
                    .unwrap_or_else(Utc::now),
            })
            .collect::<Vec<_>>();

        Ok(articles)
    }

    async fn fetch_sec_rss(&self) -> Result<Vec<NewsArticleInput>, ConnectorError> {
        let endpoint = "https://www.sec.gov/news/pressreleases.rss";
        let payload = self
            .request_text("sec-rss", |http| {
                http.get(endpoint)
                    .header(reqwest::header::USER_AGENT, self.sec_user_agent.as_str())
            })
            .await?;

        let Some(item_start) = payload.find("<item>") else {
            return Ok(Vec::new());
        };
        let Some(item_end) = payload[item_start..].find("</item>") else {
            return Ok(Vec::new());
        };
        let item = &payload[item_start..item_start + item_end];

        let title =
            extract_xml_tag(item, "title").unwrap_or_else(|| "SEC press release".to_string());
        let url = extract_xml_tag(item, "link")
            .unwrap_or_else(|| "https://www.sec.gov/news/pressreleases".to_string());
        let published_at = extract_xml_tag(item, "pubDate")
            .as_deref()
            .and_then(parse_rfc2822)
            .unwrap_or_else(Utc::now);

        Ok(vec![NewsArticleInput {
            source: "sec-rss".to_string(),
            url,
            title,
            body: None,
            published_at,
        }])
    }

    async fn fetch_plaid_overview(&self) -> Result<PortfolioOverview, ConnectorError> {
        let client_id = required_env("PLAID_CLIENT_ID")?;
        let secret = required_env("PLAID_SECRET")?;
        let access_token = required_env("PLAID_ACCESS_TOKEN")?;
        let env = std::env::var("PLAID_ENV").unwrap_or_else(|_| "sandbox".to_string());
        let endpoint = match env.to_ascii_lowercase().as_str() {
            "production" => "https://production.plaid.com/accounts/balance/get",
            "development" => "https://development.plaid.com/accounts/balance/get",
            _ => "https://sandbox.plaid.com/accounts/balance/get",
        };

        let request_body = PlaidBalanceRequest {
            client_id: &client_id,
            secret: &secret,
            access_token: &access_token,
        };

        let response = self
            .request_json("plaid", |http| http.post(endpoint).json(&request_body))
            .await?;
        let payload: PlaidBalanceResponse = response;

        let mut accounts = Vec::new();
        let mut top_positions = Vec::new();
        let mut exposure_totals = BTreeMap::<String, f64>::new();
        let mut net_worth = 0.0_f64;

        for account in payload.accounts {
            let balance = account
                .balances
                .current
                .or(account.balances.available)
                .unwrap_or(0.0);
            let account_type = account.subtype.unwrap_or(account.account_type);

            net_worth += balance;
            *exposure_totals.entry(account_type.clone()).or_insert(0.0) += balance.abs();

            accounts.push(PortfolioAccountSummary {
                account_id: account.account_id.clone(),
                name: account.name.clone(),
                account_type: account_type.clone(),
                balance,
            });

            top_positions.push(PositionSummary {
                symbol: format!("CASH-{}", account_type.to_ascii_uppercase()),
                quantity: 1.0,
                market_value: balance,
                asset_class: "cash".to_string(),
            });
        }

        if accounts.is_empty() {
            return Err(ConnectorError::ProviderPayload {
                provider: "plaid".to_string(),
                message: "response did not include accounts".to_string(),
            });
        }

        top_positions.sort_by(|left, right| {
            right
                .market_value
                .abs()
                .partial_cmp(&left.market_value.abs())
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        top_positions.truncate(6);

        let total_exposure = exposure_totals.values().sum::<f64>();
        let exposures = if total_exposure <= 0.0 {
            Vec::new()
        } else {
            exposure_totals
                .into_iter()
                .map(|(bucket, value)| Exposure {
                    bucket,
                    weight_percent: (value / total_exposure) * 100.0,
                })
                .collect::<Vec<_>>()
        };

        Ok(PortfolioOverview {
            as_of: Utc::now(),
            net_worth,
            daily_change: 0.0,
            ytd_change: 0.0,
            risk_score: 18.0,
            accounts,
            top_positions,
            exposures,
        })
    }

    async fn request_json<T, F>(&self, provider: &str, mut build: F) -> Result<T, ConnectorError>
    where
        T: DeserializeOwned,
        F: FnMut(&reqwest::Client) -> reqwest::RequestBuilder,
    {
        let mut attempt = 0_u8;

        loop {
            let started = Instant::now();
            let response =
                build(&self.http)
                    .send()
                    .await
                    .map_err(|error| ConnectorError::ProviderRequest {
                        provider: provider.to_string(),
                        message: error.to_string(),
                    });

            let result = match response {
                Ok(response) => {
                    let status = response.status();
                    let body = response.bytes().await.map_err(|error| {
                        ConnectorError::ProviderRequest {
                            provider: provider.to_string(),
                            message: error.to_string(),
                        }
                    })?;

                    if !status.is_success() {
                        let message = format!(
                            "http {}: {}",
                            status.as_u16(),
                            truncate_for_log(String::from_utf8_lossy(&body).as_ref())
                        );
                        Err(ConnectorError::ProviderRequest {
                            provider: provider.to_string(),
                            message,
                        })
                    } else {
                        serde_json::from_slice::<T>(&body).map_err(|error| {
                            ConnectorError::ProviderPayload {
                                provider: provider.to_string(),
                                message: error.to_string(),
                            }
                        })
                    }
                }
                Err(error) => Err(error),
            };

            match result {
                Ok(payload) => {
                    record_connector_request(
                        domain_for_provider(provider),
                        provider,
                        "ok",
                        started.elapsed(),
                        estimated_provider_call_cost(provider),
                    );
                    return Ok(payload);
                }
                Err(error) => {
                    record_connector_request(
                        domain_for_provider(provider),
                        provider,
                        connector_status_label(&error),
                        started.elapsed(),
                        0.0,
                    );

                    if !self.should_retry(attempt, &error) {
                        return Err(error);
                    }

                    let wait = self.backoff_duration(attempt);
                    attempt = attempt.saturating_add(1);
                    tracing::warn!(
                        provider = %provider,
                        attempt,
                        wait_ms = wait.as_millis(),
                        "retrying provider request after transient failure: {}",
                        error
                    );
                    tokio::time::sleep(wait).await;
                }
            }
        }
    }

    async fn request_text<F>(&self, provider: &str, mut build: F) -> Result<String, ConnectorError>
    where
        F: FnMut(&reqwest::Client) -> reqwest::RequestBuilder,
    {
        let mut attempt = 0_u8;

        loop {
            let started = Instant::now();
            let response =
                build(&self.http)
                    .send()
                    .await
                    .map_err(|error| ConnectorError::ProviderRequest {
                        provider: provider.to_string(),
                        message: error.to_string(),
                    });

            let result =
                match response {
                    Ok(response) => {
                        let status = response.status();
                        let text = response.text().await.map_err(|error| {
                            ConnectorError::ProviderRequest {
                                provider: provider.to_string(),
                                message: error.to_string(),
                            }
                        })?;

                        if !status.is_success() {
                            Err(ConnectorError::ProviderRequest {
                                provider: provider.to_string(),
                                message: format!(
                                    "http {}: {}",
                                    status.as_u16(),
                                    truncate_for_log(&text)
                                ),
                            })
                        } else {
                            Ok(text)
                        }
                    }
                    Err(error) => Err(error),
                };

            match result {
                Ok(payload) => {
                    record_connector_request(
                        domain_for_provider(provider),
                        provider,
                        "ok",
                        started.elapsed(),
                        estimated_provider_call_cost(provider),
                    );
                    return Ok(payload);
                }
                Err(error) => {
                    record_connector_request(
                        domain_for_provider(provider),
                        provider,
                        connector_status_label(&error),
                        started.elapsed(),
                        0.0,
                    );

                    if !self.should_retry(attempt, &error) {
                        return Err(error);
                    }

                    let wait = self.backoff_duration(attempt);
                    attempt = attempt.saturating_add(1);
                    tracing::warn!(
                        provider = %provider,
                        attempt,
                        wait_ms = wait.as_millis(),
                        "retrying text request after transient failure: {}",
                        error
                    );
                    tokio::time::sleep(wait).await;
                }
            }
        }
    }

    fn should_retry(&self, attempt: u8, error: &ConnectorError) -> bool {
        if attempt >= self.max_retries {
            return false;
        }

        match error {
            ConnectorError::ProviderRequest { message, .. } => {
                if let Some(status) = extract_status_code(message) {
                    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
                } else {
                    true
                }
            }
            ConnectorError::ProviderPayload { .. }
            | ConnectorError::MissingCredential(_)
            | ConnectorError::UnsupportedProvider { .. }
            | ConnectorError::ClientBuild(_) => false,
        }
    }

    fn backoff_duration(&self, attempt: u8) -> Duration {
        let factor = 2_u64.saturating_pow(attempt as u32);
        let millis = self.backoff_ms.saturating_mul(factor).min(30_000);
        Duration::from_millis(millis)
    }
}

fn domain_for_provider(provider: &str) -> &'static str {
    match provider {
        "polygon" | "finnhub" | "twelvedata" => "markets",
        "coinbase" | "coingecko" | "kraken" => "crypto",
        "benzinga" | "newsapi" | "sec-rss" | "fmp" => "news",
        "plaid" | "truelayer" | "tink" => "banking",
        "snaptrade" | "alpaca" | "ibkr-flex" => "brokerage",
        "stripe" | "quickbooks" | "polar" | "xero" => "business",
        _ => "unknown",
    }
}

fn connector_status_label(error: &ConnectorError) -> &'static str {
    match error {
        ConnectorError::ProviderRequest { message, .. } => {
            if let Some(status) = extract_status_code(message) {
                if status == StatusCode::TOO_MANY_REQUESTS {
                    return "rate_limited";
                }
                if status.is_server_error() {
                    return "upstream_5xx";
                }
                if status.is_client_error() {
                    return "upstream_4xx";
                }
            }

            "request_error"
        }
        ConnectorError::ProviderPayload { .. } => "payload_error",
        ConnectorError::MissingCredential(_) => "missing_credential",
        ConnectorError::UnsupportedProvider { .. } => "unsupported_provider",
        ConnectorError::ClientBuild(_) => "client_error",
    }
}

fn estimated_provider_call_cost(provider: &str) -> f64 {
    match provider {
        "polygon" => 0.0008,
        "finnhub" => 0.0007,
        "twelvedata" => 0.0005,
        "coinbase" => 0.0002,
        "coingecko" => 0.0001,
        "benzinga" => 0.0012,
        "newsapi" => 0.0009,
        "sec-rss" => 0.0,
        "plaid" => 0.0100,
        "truelayer" => 0.0080,
        "snaptrade" => 0.0060,
        "alpaca" => 0.0010,
        "stripe" => 0.0030,
        "quickbooks" => 0.0025,
        _ => 0.0,
    }
}

fn provider_chain(binding: &ProviderBinding) -> Vec<String> {
    let mut providers = Vec::with_capacity(binding.fallbacks.len() + 1);
    providers.push(binding.primary.clone());
    providers.extend(binding.fallbacks.iter().cloned());
    providers
}

fn required_env(key: &'static str) -> Result<String, ConnectorError> {
    let value = std::env::var(key).unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(ConnectorError::MissingCredential(key))
    } else {
        Ok(trimmed.to_string())
    }
}

fn ts_nanos_to_utc(nanos: i64) -> Option<DateTime<Utc>> {
    let millis = nanos / 1_000_000;
    DateTime::<Utc>::from_timestamp_millis(millis)
}

fn coingecko_id_for_product(product: &str) -> Option<&'static str> {
    match product {
        "BTC-USD" => Some("bitcoin"),
        "ETH-USD" => Some("ethereum"),
        "SOL-USD" => Some("solana"),
        _ => None,
    }
}

fn extract_articles_from_json(payload: Value, source: &str, limit: usize) -> Vec<NewsArticleInput> {
    let candidates = payload
        .as_array()
        .cloned()
        .or_else(|| {
            payload
                .get("news")
                .and_then(Value::as_array)
                .map(|items| items.to_vec())
        })
        .or_else(|| {
            payload
                .get("data")
                .and_then(Value::as_array)
                .map(|items| items.to_vec())
        })
        .unwrap_or_default();

    let mut articles = Vec::new();
    for item in candidates.into_iter().take(limit) {
        let title = item
            .get("title")
            .or_else(|| item.get("headline"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let url = item
            .get("url")
            .or_else(|| item.get("link"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let body = item
            .get("body")
            .or_else(|| item.get("teaser"))
            .or_else(|| item.get("summary"))
            .and_then(Value::as_str)
            .map(|value| value.to_string());
        let published_at = item
            .get("created")
            .or_else(|| item.get("updated"))
            .or_else(|| item.get("published_at"))
            .and_then(parse_datetime_value)
            .unwrap_or_else(Utc::now);

        if title.is_empty() || url.is_empty() {
            continue;
        }

        articles.push(NewsArticleInput {
            source: source.to_string(),
            url,
            title,
            body,
            published_at,
        });
    }

    articles
}

fn parse_datetime_value(value: &Value) -> Option<DateTime<Utc>> {
    if let Some(raw) = value.as_str() {
        return parse_datetime_str(raw);
    }

    if let Some(epoch) = value.as_i64() {
        if epoch > 10_000_000_000 {
            return DateTime::<Utc>::from_timestamp_millis(epoch);
        }
        return DateTime::<Utc>::from_timestamp(epoch, 0);
    }

    None
}

fn parse_datetime_str(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw)
        .map(|value| value.with_timezone(&Utc))
        .or_else(|_| DateTime::parse_from_rfc2822(raw).map(|value| value.with_timezone(&Utc)))
        .ok()
}

fn parse_rfc2822(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc2822(raw)
        .map(|value| value.with_timezone(&Utc))
        .ok()
}

fn extract_xml_tag(content: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = content.find(&open)?;
    let end = content[start + open.len()..].find(&close)?;
    Some(
        content[start + open.len()..start + open.len() + end]
            .trim()
            .to_string(),
    )
}

fn extract_status_code(message: &str) -> Option<StatusCode> {
    let code = message
        .split_whitespace()
        .nth(1)
        .map(|segment| segment.trim_end_matches(':'))
        .and_then(|segment| segment.parse::<u16>().ok())?;
    StatusCode::from_u16(code).ok()
}

fn truncate_for_log(value: &str) -> String {
    const LIMIT: usize = 240;
    if value.len() <= LIMIT {
        value.to_string()
    } else {
        let mut output = value[..LIMIT].to_string();
        output.push_str("...");
        output
    }
}

#[derive(Debug, Deserialize)]
struct PolygonLastTradeResponse {
    results: Option<PolygonLastTrade>,
}

#[derive(Debug, Deserialize)]
struct PolygonLastTrade {
    #[serde(rename = "p")]
    price: f64,
    #[serde(rename = "s")]
    size: Option<f64>,
    #[serde(rename = "t")]
    timestamp_ns: i64,
}

#[derive(Debug, Deserialize)]
struct FinnhubQuoteResponse {
    #[serde(rename = "c")]
    current: f64,
    #[serde(rename = "v")]
    volume: Option<f64>,
    #[serde(rename = "t")]
    timestamp: i64,
}

#[derive(Debug, Deserialize)]
struct TwelveDataPriceResponse {
    price: String,
}

#[derive(Debug, Deserialize)]
struct CoinbaseSpotResponse {
    data: CoinbaseSpotData,
}

#[derive(Debug, Deserialize)]
struct CoinbaseSpotData {
    amount: String,
}

#[derive(Debug, Deserialize)]
struct NewsApiResponse {
    #[serde(default)]
    articles: Vec<NewsApiArticle>,
}

#[derive(Debug, Deserialize)]
struct NewsApiArticle {
    title: String,
    url: String,
    description: Option<String>,
    #[serde(rename = "publishedAt")]
    published_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct PlaidBalanceRequest<'a> {
    client_id: &'a str,
    secret: &'a str,
    access_token: &'a str,
}

#[derive(Debug, Deserialize)]
struct PlaidBalanceResponse {
    #[serde(default)]
    accounts: Vec<PlaidAccount>,
}

#[derive(Debug, Deserialize)]
struct PlaidAccount {
    account_id: String,
    name: String,
    #[serde(rename = "type")]
    account_type: String,
    subtype: Option<String>,
    balances: PlaidBalances,
}

#[derive(Debug, Deserialize)]
struct PlaidBalances {
    current: Option<f64>,
    available: Option<f64>,
}

#[cfg(test)]
mod tests {
    use super::{coingecko_id_for_product, extract_xml_tag, parse_datetime_str};

    #[test]
    fn maps_known_products_to_coingecko_ids() {
        assert_eq!(coingecko_id_for_product("BTC-USD"), Some("bitcoin"));
        assert_eq!(coingecko_id_for_product("ETH-USD"), Some("ethereum"));
        assert_eq!(coingecko_id_for_product("UNKNOWN"), None);
    }

    #[test]
    fn extracts_xml_tag_value() {
        let xml = "<item><title>Sample</title><link>https://x</link></item>";
        assert_eq!(extract_xml_tag(xml, "title"), Some("Sample".to_string()));
        assert_eq!(extract_xml_tag(xml, "link"), Some("https://x".to_string()));
        assert_eq!(extract_xml_tag(xml, "pubDate"), None);
    }

    #[test]
    fn parses_rfc3339_timestamp() {
        let parsed = parse_datetime_str("2026-02-15T05:00:00Z");
        assert!(parsed.is_some());
    }
}
