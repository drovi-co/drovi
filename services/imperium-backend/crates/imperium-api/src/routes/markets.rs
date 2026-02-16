use axum::{
    extract::{Path, Query, State},
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use imperium_domain::market::CandleInterval;
use imperium_infra::{error::AppError, SharedAppState};
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, time::Duration};
use tokio_stream::StreamExt;
use utoipa::{IntoParams, ToSchema};

use crate::routes::context::AuthContext;

#[derive(Debug, Serialize, ToSchema)]
pub struct MarketWatchlistItemView {
    pub symbol: String,
    pub label: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MarketQuoteView {
    pub symbol: String,
    pub price: f64,
    pub change_percent: f64,
    pub volume: f64,
    pub timestamp: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CandleView {
    pub symbol: String,
    pub interval: String,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
    pub start_time: String,
    pub end_time: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StreamContractView {
    pub channel: String,
    pub subject: String,
    pub payload_schema: String,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct CandleQuery {
    pub interval: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct MarketStreamQuery {
    pub subject: Option<String>,
    pub event: Option<String>,
    pub heartbeat_seconds: Option<u64>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AddWatchlistEntryRequest {
    pub symbol: String,
    pub label: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct WatchlistMutationResponse {
    pub symbol: String,
    pub label: Option<String>,
    pub mutated: bool,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct RemoveWatchlistQuery {
    pub label: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/markets/watchlist",
    tag = "imperium",
    responses(
        (status = 200, description = "Watchlist entries", body = [MarketWatchlistItemView])
    )
)]
pub async fn watchlist(
    State(state): State<SharedAppState>,
    auth: AuthContext,
) -> Result<Json<Vec<MarketWatchlistItemView>>, AppError> {
    let user_id = auth.user_id;
    let service = imperium_market::MarketService::default();

    let mut entries = state.repository.list_watchlist_entries(user_id).await?;
    if entries.is_empty() {
        entries = service.sample_watchlist();
        state
            .repository
            .ensure_watchlist_entries(user_id, &entries)
            .await?;
    }

    let items = entries
        .into_iter()
        .map(|entry| MarketWatchlistItemView {
            symbol: entry.symbol,
            label: entry.label,
        })
        .collect();

    Ok(Json(items))
}

#[utoipa::path(
    post,
    path = "/api/v1/imperium/markets/watchlist",
    tag = "imperium",
    request_body = AddWatchlistEntryRequest,
    responses(
        (status = 200, description = "Watchlist entry added", body = WatchlistMutationResponse),
        (status = 400, description = "Invalid payload")
    )
)]
pub async fn add_watchlist_entry(
    State(state): State<SharedAppState>,
    auth: AuthContext,
    Json(payload): Json<AddWatchlistEntryRequest>,
) -> Result<Json<WatchlistMutationResponse>, AppError> {
    let user_id = auth.user_id;
    let symbol = payload.symbol.trim().to_uppercase();
    let label = payload.label.trim().to_string();

    if symbol.is_empty() {
        return Err(AppError::validation("symbol cannot be empty"));
    }

    if label.is_empty() {
        return Err(AppError::validation("label cannot be empty"));
    }

    let entry = imperium_domain::market::WatchlistEntry {
        symbol: symbol.clone(),
        label: label.clone(),
    };

    state.repository.add_watchlist_entry(user_id, entry).await?;

    Ok(Json(WatchlistMutationResponse {
        symbol,
        label: Some(label),
        mutated: true,
    }))
}

#[utoipa::path(
    delete,
    path = "/api/v1/imperium/markets/watchlist/{symbol}",
    tag = "imperium",
    params(
        ("symbol" = String, Path, description = "Ticker or symbol"),
        RemoveWatchlistQuery
    ),
    responses(
        (status = 200, description = "Watchlist entry removed", body = WatchlistMutationResponse)
    )
)]
pub async fn remove_watchlist_entry(
    State(state): State<SharedAppState>,
    auth: AuthContext,
    Path(symbol): Path<String>,
    Query(query): Query<RemoveWatchlistQuery>,
) -> Result<Json<WatchlistMutationResponse>, AppError> {
    let user_id = auth.user_id;
    let normalized_symbol = symbol.trim().to_uppercase();

    if normalized_symbol.is_empty() {
        return Err(AppError::validation("symbol cannot be empty"));
    }

    let mutated = state
        .repository
        .remove_watchlist_entry(user_id, &normalized_symbol, query.label.as_deref())
        .await?;

    Ok(Json(WatchlistMutationResponse {
        symbol: normalized_symbol,
        label: query.label,
        mutated,
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/markets/{symbol}/quote",
    tag = "imperium",
    params(("symbol" = String, Path, description = "Ticker or symbol")),
    responses(
        (status = 200, description = "Current quote", body = MarketQuoteView)
    )
)]
pub async fn quote(
    State(state): State<SharedAppState>,
    Path(symbol): Path<String>,
) -> Result<Json<MarketQuoteView>, AppError> {
    let service = imperium_market::MarketService::default();
    let quote = state
        .repository
        .latest_quote(&symbol)
        .await?
        .unwrap_or_else(|| service.sample_quote(&symbol));

    Ok(Json(MarketQuoteView {
        symbol: quote.symbol,
        price: quote.price,
        change_percent: quote.change_percent,
        volume: quote.volume,
        timestamp: quote.timestamp.to_rfc3339(),
    }))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/markets/{symbol}/candles",
    tag = "imperium",
    params(
        ("symbol" = String, Path, description = "Ticker or symbol"),
        CandleQuery
    ),
    responses(
        (status = 200, description = "Candle series", body = [CandleView])
    )
)]
pub async fn candles(
    State(state): State<SharedAppState>,
    Path(symbol): Path<String>,
    Query(query): Query<CandleQuery>,
) -> Result<Json<Vec<CandleView>>, AppError> {
    let service = imperium_market::MarketService::default();

    let interval = query
        .interval
        .as_deref()
        .and_then(CandleInterval::parse)
        .unwrap_or(CandleInterval::FiveMinutes);

    let limit = query.limit.unwrap_or(120).clamp(1, 500);

    let mut candles = state
        .repository
        .list_candles(&symbol, interval, limit)
        .await?;

    if candles.is_empty() {
        candles = service.sample_candles(&symbol, interval, limit);
    }

    let candles = candles
        .into_iter()
        .map(|candle| CandleView {
            symbol: candle.symbol,
            interval: candle.interval.as_key().to_string(),
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            start_time: candle.start_time.to_rfc3339(),
            end_time: candle.end_time.to_rfc3339(),
        })
        .collect();

    Ok(Json(candles))
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/markets/stream/contracts",
    tag = "imperium",
    responses(
        (status = 200, description = "Market stream contract catalog", body = [StreamContractView])
    )
)]
pub async fn stream_contracts() -> Json<Vec<StreamContractView>> {
    let service = imperium_market::MarketService::default();

    let contracts = service
        .stream_contracts()
        .into_iter()
        .map(|contract| StreamContractView {
            channel: contract.channel,
            subject: contract.subject,
            payload_schema: contract.payload_schema,
        })
        .collect();

    Json(contracts)
}

#[utoipa::path(
    get,
    path = "/api/v1/imperium/markets/stream/sse",
    tag = "imperium",
    params(MarketStreamQuery),
    responses(
        (status = 200, description = "Server-sent market stream")
    )
)]
pub async fn stream_sse(
    State(state): State<SharedAppState>,
    Query(query): Query<MarketStreamQuery>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>, AppError> {
    let subject = query
        .subject
        .unwrap_or_else(|| imperium_market::stream::MARKET_TICK_SUBJECT.to_string());
    let event_name = query.event.unwrap_or_else(|| "market_update".to_string());
    let heartbeat_seconds = query.heartbeat_seconds.unwrap_or(15).clamp(5, 120);

    let subscriber = state.nats.subscribe(&subject).await?;
    let stream = subscriber.map(move |message| {
        let payload = String::from_utf8_lossy(&message.payload).to_string();
        Ok::<Event, Infallible>(Event::default().event(event_name.clone()).data(payload))
    });

    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(heartbeat_seconds))
            .text("keepalive"),
    ))
}
