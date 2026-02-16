# Imperium Provider Stack

## Current Runtime Status

- Current ingestion runtime is `synthetic` by default.
- Provider selection is still configured and exposed through:
  - `GET /api/v1/imperium/meta`
  - `GET /api/v1/imperium/providers`
  - `GET /api/v1/imperium/providers/health` (active probe for market/news/banking adapters)
- Switching to real providers is controlled by `IMPERIUM_DATA_MODE`:
  - `synthetic`: synthetic feeds only.
  - `hybrid`: real adapters first, synthetic fallback if a provider call fails.
  - `live`: real providers only, required credentials enforced at startup.
- Runtime resilience knobs:
  - `IMPERIUM_PROVIDER_MAX_RETRIES` (default `2`)
  - `IMPERIUM_PROVIDER_BACKOFF_MS` (default `300`)
  - `IMPERIUM_SEC_USER_AGENT` (default `imperium-connectors/0.1 (ops@imperium.local)`)
- Provider telemetry now emits Prometheus series:
  - `imperium_connector_requests_total`
  - `imperium_connector_request_duration_seconds_*`
  - `imperium_connector_estimated_cost_usd_total`
- Implemented real adapters in worker pipeline:
  - markets: Polygon + Coinbase
  - news: Benzinga
  - banking sync: Plaid

## Production Provider Choices

### Markets (Stocks / ETFs / Indices)

- Primary: `polygon`
- Fallbacks: `finnhub`, `twelvedata`
- Why:
  - Low-latency equities and aggregates.
  - Good realtime + historical coverage for candles and watchlists.

### Crypto

- Primary: `coinbase`
- Fallbacks: `coingecko`
- Why:
  - Realtime crypto market data and exchange-native coverage.
  - Coingecko fallback for broad symbol metadata and redundancy.

### News

- Primary: `benzinga`
- Fallbacks: `newsapi`, `sec-rss`
- Why:
  - Market-moving finance/news flow for decision-focused alerts.
  - Broader long-tail coverage via NewsAPI + filings via SEC RSS.

### Banking Accounts

- Primary: `plaid`
- Fallbacks: `truelayer`
- Why:
  - Strong US account aggregation and transaction sync.
  - TrueLayer option for multi-region expansion.

### Brokerage Accounts

- Primary: `snaptrade`
- Fallbacks: `alpaca`
- Why:
  - Aggregation across brokerages for holdings normalization.
  - Direct brokerage fallback where required.

### Business Metrics

- Primary: `stripe`
- Fallbacks: `quickbooks`, `polar`
- Why:
  - Revenue and subscription event telemetry from Stripe.
  - Accounting and billing secondary sources.

## Required Environment Variables by Provider

- `polygon`: `POLYGON_API_KEY`
- `finnhub`: `FINNHUB_API_KEY`
- `twelvedata`: `TWELVEDATA_API_KEY`
- `coinbase`: `COINBASE_API_KEY`, `COINBASE_API_SECRET`
- `coingecko`: `COINGECKO_API_KEY`
- `kraken`: `KRAKEN_API_KEY`, `KRAKEN_API_SECRET`
- `benzinga`: `BENZINGA_API_KEY`
- `newsapi`: `NEWSAPI_API_KEY`
- `fmp`: `FMP_API_KEY`
- `plaid`: `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ACCESS_TOKEN`
  - optional: `PLAID_ENV` = `sandbox|development|production` (default `sandbox`)
- `truelayer`: `TRUELAYER_CLIENT_ID`, `TRUELAYER_CLIENT_SECRET`
- `tink`: `TINK_CLIENT_ID`, `TINK_CLIENT_SECRET`
- `snaptrade`: `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`
- `alpaca`: `ALPACA_API_KEY`, `ALPACA_API_SECRET`
- `ibkr-flex`: `IBKR_FLEX_TOKEN`, `IBKR_FLEX_QUERY_ID`
- `stripe`: `STRIPE_SECRET_KEY`
- `quickbooks`: `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REALM_ID`
- `polar`: `POLAR_ACCESS_TOKEN`
- `xero`: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`
