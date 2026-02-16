use std::time::{Duration, Instant};

use chrono::Utc;
use imperium_brief::BriefService;
use imperium_business::BusinessCommandService;
use imperium_connectors::{ConnectorError, ConnectorRuntime};
use imperium_domain::security::new_audit_event;
use imperium_infra::{
    error::AppError,
    telemetry::{init_tracing, record_dead_letter_event, record_worker_cycle},
    AppState, SharedAppState,
};
use imperium_market::{stream::MARKET_CANDLE_SUBJECT, stream::MARKET_TICK_SUBJECT, MarketService};
use imperium_news::IntelligenceInboxService;
use imperium_portfolio::PortfolioService;
use imperium_risk::RiskRegimeService;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize)]
struct WorkerHeartbeat<'a> {
    role: &'a str,
    timestamp: String,
}

const ALERT_EVENT_SUBJECT: &str = "imperium.alert.event";
const NEWS_CLUSTER_SUBJECT: &str = "imperium.news.cluster";
const BUSINESS_SNAPSHOT_SUBJECT: &str = "imperium.business.snapshot";
const RISK_REGIME_SUBJECT: &str = "imperium.risk.regime";
const BRIEF_READY_SUBJECT: &str = "imperium.brief.ready";
const PORTFOLIO_SNAPSHOT_SUBJECT: &str = "imperium.portfolio.snapshot";

#[derive(Default)]
struct WorkerServices {
    market: MarketService,
    news: IntelligenceInboxService,
    business: BusinessCommandService,
    risk: RiskRegimeService,
    brief: BriefService,
    portfolio: PortfolioService,
}

#[tokio::main]
async fn main() {
    init_tracing("info,imperium_worker=debug");

    let state = match AppState::bootstrap().await {
        Ok(state) => state,
        Err(error) => {
            tracing::error!("failed to bootstrap worker state: {error}");
            std::process::exit(1);
        }
    };

    let role = std::env::var("IMPERIUM_WORKER_ROLE").unwrap_or_else(|_| "generic".to_string());
    let cadence_seconds = std::env::var("IMPERIUM_WORKER_CADENCE_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(30);

    tracing::info!(role = %role, cadence_seconds, "imperium-worker started");

    let mut ticker = tokio::time::interval(Duration::from_secs(cadence_seconds));
    let mut shutdown = Box::pin(shutdown_signal());
    let mut sequence = 0_u64;
    let mut services = WorkerServices::default();
    let connectors = match build_connector_runtime(&state) {
        Ok(connectors) => connectors,
        Err(error) => {
            tracing::error!(role = %role, "failed to initialize connector feed: {error}");
            std::process::exit(1);
        }
    };

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                sequence = sequence.saturating_add(1);

                if let Err(error) = publish_heartbeat(&state, &role).await {
                    tracing::warn!(role = %role, "failed to publish heartbeat: {error}");
                }

                let cycle_started = Instant::now();
                let cycle_result = run_role_cycle(
                    &state,
                    &role,
                    sequence,
                    &connectors,
                    &mut services,
                )
                .await;

                match cycle_result {
                    Ok(()) => record_worker_cycle(&role, "ok", cycle_started.elapsed()),
                    Err(error) => {
                        record_worker_cycle(&role, "error", cycle_started.elapsed());
                        tracing::warn!(role = %role, sequence, "role cycle failed: {error}");
                        if let Err(dlq_error) =
                            store_cycle_dead_letter(&state, &role, sequence, &error).await
                        {
                            tracing::warn!(
                                role = %role,
                                sequence,
                                "failed to record cycle failure in dead-letter queue: {dlq_error}"
                            );
                        }
                    }
                }
            }
            _ = &mut shutdown => {
                tracing::info!(role = %role, "shutdown signal received");
                break;
            }
        }
    }

    tracing::info!(role = %role, "worker stopped");
}

async fn publish_heartbeat(state: &SharedAppState, role: &str) -> Result<(), AppError> {
    let event = WorkerHeartbeat {
        role,
        timestamp: Utc::now().to_rfc3339(),
    };

    let subject = format!("imperium.worker.{role}.heartbeat");
    publish_with_dlq(state, role, &subject, &event).await
}

async fn run_role_cycle(
    state: &SharedAppState,
    role: &str,
    sequence: u64,
    connectors: &ConnectorRuntime,
    services: &mut WorkerServices,
) -> Result<(), AppError> {
    match role {
        "market" => run_market_cycle(state, sequence, connectors, &mut services.market).await,
        "news" => run_news_cycle(state, sequence, connectors, &services.news).await,
        "alerts" => run_alert_cycle(state, sequence, connectors).await,
        "business" => run_business_cycle(state, &services.business).await,
        "portfolio" => run_portfolio_cycle(state, connectors, &services.portfolio).await,
        "risk" => run_risk_cycle(state, &services.risk).await,
        "brief" => run_brief_cycle(state, &services.brief).await,
        _ => {
            tracing::debug!(role = %role, sequence, "no-op role cycle");
            Ok(())
        }
    }
}

fn build_connector_runtime(state: &SharedAppState) -> Result<ConnectorRuntime, AppError> {
    ConnectorRuntime::from_config(&state.config).map_err(map_connector_error)
}

async fn run_market_cycle(
    state: &SharedAppState,
    sequence: u64,
    connectors: &ConnectorRuntime,
    market_service: &mut MarketService,
) -> Result<(), AppError> {
    let provider_tick = connectors
        .market_provider_tick(sequence)
        .await
        .map_err(map_connector_error)?;
    let update = market_service.process_provider_tick(provider_tick);

    state.repository.upsert_market_tick(&update.tick).await?;
    publish_with_dlq(state, "market", MARKET_TICK_SUBJECT, &update.tick).await?;

    if let Some(candle) = update.candle_1m {
        state.repository.upsert_market_candle(&candle).await?;
        publish_with_dlq(state, "market", MARKET_CANDLE_SUBJECT, &candle).await?;
    }

    Ok(())
}

async fn run_news_cycle(
    state: &SharedAppState,
    sequence: u64,
    connectors: &ConnectorRuntime,
    news_service: &IntelligenceInboxService,
) -> Result<(), AppError> {
    let articles = connectors
        .news_articles(sequence)
        .await
        .map_err(map_connector_error)?;
    let preview = news_service.preview_ingestion(articles);

    if preview.clusters.is_empty() {
        return Ok(());
    }

    state
        .repository
        .upsert_story_clusters(&preview.clusters)
        .await?;
    publish_with_dlq(state, "news", NEWS_CLUSTER_SUBJECT, &preview.clusters).await?;

    Ok(())
}

async fn run_alert_cycle(
    state: &SharedAppState,
    sequence: u64,
    connectors: &ConnectorRuntime,
) -> Result<(), AppError> {
    let user_id = seeded_user_id();
    let event = connectors.alert_event(sequence);
    let dedupe_key = state.repository.store_alert_event(user_id, &event).await?;

    let payload = serde_json::json!({
        "alert_id": event.alert_id,
        "category": event.category,
        "title": event.title,
        "what_happened": event.what_happened,
        "why_it_matters": event.why_it_matters,
        "what_to_watch_next": event.what_to_watch_next,
        "dedupe_key": dedupe_key,
        "created_at": event.created_at,
    });

    publish_with_dlq(state, "alerts", ALERT_EVENT_SUBJECT, &payload).await?;

    Ok(())
}

async fn run_portfolio_cycle(
    state: &SharedAppState,
    connectors: &ConnectorRuntime,
    portfolio_service: &PortfolioService,
) -> Result<(), AppError> {
    let user_id = seeded_user_id();
    let overview = match connectors
        .portfolio_overview()
        .await
        .map_err(map_connector_error)?
    {
        Some(overview) => overview,
        None => portfolio_service.sample_overview(),
    };

    state
        .repository
        .upsert_portfolio_overview(user_id, &overview)
        .await?;

    let payload = serde_json::json!({
        "as_of": overview.as_of,
        "net_worth": overview.net_worth,
        "account_count": overview.accounts.len(),
        "source_mode": state.config.providers.mode.as_str(),
    });
    publish_with_dlq(state, "portfolio", PORTFOLIO_SNAPSHOT_SUBJECT, &payload).await?;

    Ok(())
}

async fn run_business_cycle(
    state: &SharedAppState,
    business_service: &BusinessCommandService,
) -> Result<(), AppError> {
    let user_id = seeded_user_id();
    let overview = business_service.current_overview();
    let metrics = business_service.metric_snapshot();

    state
        .repository
        .upsert_business_snapshot(user_id, &overview, &metrics)
        .await?;

    let payload = serde_json::json!({
        "entity_name": overview.entity_name,
        "as_of": overview.as_of,
        "mrr": overview.mrr,
        "burn": overview.burn,
        "runway_months": overview.runway_months,
    });
    publish_with_dlq(state, "business", BUSINESS_SNAPSHOT_SUBJECT, &payload).await?;

    Ok(())
}

async fn run_risk_cycle(
    state: &SharedAppState,
    risk_service: &RiskRegimeService,
) -> Result<(), AppError> {
    let user_id = seeded_user_id();
    let regime = risk_service.regime_state();
    let indicators = risk_service.macro_indicators();
    let signals = risk_service.risk_signals();

    state
        .repository
        .upsert_regime_state(user_id, &regime)
        .await?;
    state
        .repository
        .upsert_risk_observations(user_id, &signals, &indicators)
        .await?;

    publish_with_dlq(state, "risk", RISK_REGIME_SUBJECT, &regime).await?;
    Ok(())
}

async fn run_brief_cycle(
    state: &SharedAppState,
    brief_service: &BriefService,
) -> Result<(), AppError> {
    let user_id = seeded_user_id();
    let watchlist = state
        .repository
        .list_watchlist_entries(user_id)
        .await?
        .into_iter()
        .map(|entry| entry.symbol)
        .collect::<Vec<_>>();

    let context = imperium_brief::BriefContext {
        user_id,
        watchlist,
        key_events: vec!["CPI".to_string(), "FOMC minutes".to_string()],
        timezone: "America/New_York".to_string(),
    };

    let brief = brief_service
        .generate_daily_brief(context)
        .map_err(|error| AppError::internal(format!("brief generation failed: {error}")))?;

    state.repository.store_daily_brief(&brief).await?;

    let payload = serde_json::json!({
        "brief_id": brief.brief_id,
        "user_id": brief.user_id,
        "brief_date": brief.brief_date,
        "generated_at": brief.generated_at,
    });

    publish_with_dlq(state, "brief", BRIEF_READY_SUBJECT, &payload).await?;

    Ok(())
}

fn seeded_user_id() -> Uuid {
    Uuid::from_u128(1)
}

fn map_connector_error(error: ConnectorError) -> AppError {
    match error {
        ConnectorError::MissingCredential(missing) => {
            AppError::configuration(format!("missing connector credential: {missing}"))
        }
        ConnectorError::UnsupportedProvider { domain, provider } => AppError::configuration(
            format!("unsupported connector provider for {domain}: {provider}"),
        ),
        ConnectorError::ProviderRequest { provider, message } => {
            AppError::dependency(format!("{provider} request failed: {message}"))
        }
        ConnectorError::ProviderPayload { provider, message } => {
            AppError::dependency(format!("{provider} payload invalid: {message}"))
        }
        ConnectorError::ClientBuild(message) => {
            AppError::internal(format!("connector runtime init failed: {message}"))
        }
    }
}

async fn publish_with_dlq<T: Serialize>(
    state: &SharedAppState,
    role: &str,
    subject: &str,
    payload: &T,
) -> Result<(), AppError> {
    match state.nats.publish_json(subject, payload).await {
        Ok(()) => Ok(()),
        Err(error) => {
            let payload_value = serde_json::to_value(payload).unwrap_or_else(|serialize_error| {
                serde_json::json!({
                    "serialization_error": serialize_error.to_string()
                })
            });

            if let Err(dlq_error) = state
                .repository
                .store_dead_letter_event(
                    role,
                    subject,
                    &payload_value,
                    &error.to_string(),
                    Utc::now(),
                )
                .await
            {
                tracing::warn!(role = %role, subject = %subject, "failed to store publish DLQ event: {dlq_error}");
            } else {
                record_dead_letter_event(role, subject, "store");
            }

            emit_worker_audit(
                state,
                "worker.publish.failed",
                subject.to_string(),
                serde_json::json!({
                    "role": role,
                    "error": error.to_string(),
                }),
            )
            .await;

            Err(error)
        }
    }
}

async fn store_cycle_dead_letter(
    state: &SharedAppState,
    role: &str,
    sequence: u64,
    error: &AppError,
) -> Result<(), AppError> {
    let subject = format!("imperium.worker.{role}.cycle");
    let payload = serde_json::json!({
        "role": role,
        "sequence": sequence,
        "error_code": format!("{:?}", error.code),
        "error_message": error.message.as_str(),
        "timestamp": Utc::now().to_rfc3339(),
    });

    let event_id = state
        .repository
        .store_dead_letter_event(role, &subject, &payload, &error.to_string(), Utc::now())
        .await?;
    record_dead_letter_event(role, &subject, "store");

    emit_worker_audit(
        state,
        "worker.cycle.failed",
        subject,
        serde_json::json!({
            "role": role,
            "sequence": sequence,
            "error": error.to_string(),
            "dead_letter_event_id": event_id,
        }),
    )
    .await;

    Ok(())
}

async fn emit_worker_audit(
    state: &SharedAppState,
    action: impl Into<String>,
    target: impl Into<String>,
    metadata: serde_json::Value,
) {
    let event = new_audit_event(None, action, target, metadata);
    if let Err(error) = state
        .repository
        .append_audit_event("imperium.worker.audit", &event)
        .await
    {
        tracing::warn!("failed to persist worker audit event: {error}");
    }
}

async fn shutdown_signal() {
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut stream) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            stream.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        result = tokio::signal::ctrl_c() => {
            if let Err(error) = result {
                tracing::error!("failed to listen for ctrl-c signal: {error}");
            }
        }
        _ = terminate => {}
    }
}
