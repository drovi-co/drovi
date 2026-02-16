use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use imperium_domain::{
    alerts::{dedupe_key, AlertEvent, AlertRule},
    brief::{BriefCitation, BriefClaim, BriefSection, DailyBrief},
    business::{BusinessMetric, BusinessOverview},
    intelligence::{InboxItem, StoryCluster},
    market::{Candle, CandleInterval, MarketTick, SymbolQuote, WatchlistEntry},
    portfolio::{
        calculate_concentration_risk, Exposure, PortfolioAccountSummary, PortfolioOverview,
        PositionSummary,
    },
    risk::{MacroIndicator, MarketRegime, RegimeState, RiskSignal},
    security::AuditEvent,
    thesis::{Playbook, ThesisEntry, ThesisReviewReminder},
};
use sqlx::Row;
use uuid::Uuid;

use crate::{error::AppError, Database};

#[derive(Clone)]
pub struct ImperiumRepository {
    database: Database,
}

#[derive(Debug, Clone)]
pub struct StoredAlertEvent {
    pub alert_id: Uuid,
    pub category: String,
    pub title: String,
    pub what_happened: String,
    pub why_it_matters: String,
    pub what_to_watch_next: String,
    pub dedupe_key: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct StoredAuditEvent {
    pub event_id: Uuid,
    pub stream_key: String,
    pub actor_user_id: Option<Uuid>,
    pub action: String,
    pub target: String,
    pub metadata: serde_json::Value,
    pub payload_hash: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct DeadLetterEventRecord {
    pub event_id: Uuid,
    pub worker_role: String,
    pub subject: String,
    pub payload: serde_json::Value,
    pub error_message: String,
    pub retry_count: i32,
    pub status: String,
    pub first_failed_at: DateTime<Utc>,
    pub last_failed_at: DateTime<Utc>,
    pub replayed_at: Option<DateTime<Utc>>,
    pub replayed_by: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl ImperiumRepository {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub async fn ensure_user(&self, user_id: Uuid) -> Result<(), AppError> {
        sqlx::query("INSERT INTO imperium_user (id, timezone) VALUES ($1, 'UTC') ON CONFLICT (id) DO NOTHING")
            .bind(user_id)
            .execute(self.database.pool())
            .await
            .map(|_| ())
            .map_err(|error| map_sqlx(error, "failed to ensure user record"))
    }

    pub async fn ensure_watchlist_entries(
        &self,
        user_id: Uuid,
        entries: &[WatchlistEntry],
    ) -> Result<(), AppError> {
        self.ensure_user(user_id).await?;

        for (idx, entry) in entries.iter().enumerate() {
            let watchlist_id = sqlx::query(
                r#"
                INSERT INTO imperium_watchlist (user_id, name, kind)
                VALUES ($1, $2, 'core')
                ON CONFLICT (user_id, name) DO UPDATE SET updated_at = now()
                RETURNING id
                "#,
            )
            .bind(user_id)
            .bind(&entry.label)
            .fetch_one(self.database.pool())
            .await
            .and_then(|row| row.try_get::<Uuid, _>("id"))
            .map_err(|error| map_sqlx(error, "failed to upsert watchlist"))?;

            let symbol_id = self
                .upsert_market_symbol(&entry.symbol, infer_asset_class(&entry.symbol))
                .await?;

            sqlx::query(
                r#"
                INSERT INTO imperium_watchlist_symbol (watchlist_id, symbol_id, priority)
                VALUES ($1, $2, $3)
                ON CONFLICT (watchlist_id, symbol_id) DO UPDATE SET priority = EXCLUDED.priority
                "#,
            )
            .bind(watchlist_id)
            .bind(symbol_id)
            .bind(i16::try_from(idx + 1).unwrap_or(i16::MAX))
            .execute(self.database.pool())
            .await
            .map_err(|error| map_sqlx(error, "failed to upsert watchlist symbol"))?;
        }

        Ok(())
    }

    pub async fn list_watchlist_entries(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<WatchlistEntry>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT ms.symbol, w.name AS label
            FROM imperium_watchlist w
            JOIN imperium_watchlist_symbol ws ON ws.watchlist_id = w.id
            JOIN imperium_market_symbol ms ON ms.id = ws.symbol_id
            WHERE w.user_id = $1
            ORDER BY ws.priority ASC, ms.symbol ASC
            "#,
        )
        .bind(user_id)
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load watchlist entries"))?;

        rows.into_iter()
            .map(|row| {
                Ok(WatchlistEntry {
                    symbol: row
                        .try_get::<String, _>("symbol")
                        .map_err(|error| map_sqlx(error, "failed to decode watchlist symbol"))?,
                    label: row
                        .try_get::<String, _>("label")
                        .map_err(|error| map_sqlx(error, "failed to decode watchlist label"))?,
                })
            })
            .collect()
    }

    pub async fn add_watchlist_entry(
        &self,
        user_id: Uuid,
        entry: WatchlistEntry,
    ) -> Result<WatchlistEntry, AppError> {
        self.ensure_watchlist_entries(user_id, std::slice::from_ref(&entry))
            .await?;
        Ok(entry)
    }

    pub async fn remove_watchlist_entry(
        &self,
        user_id: Uuid,
        symbol: &str,
        label: Option<&str>,
    ) -> Result<bool, AppError> {
        let result = sqlx::query(
            r#"
            DELETE FROM imperium_watchlist_symbol ws
            USING imperium_watchlist w, imperium_market_symbol ms
            WHERE ws.watchlist_id = w.id
              AND ws.symbol_id = ms.id
              AND w.user_id = $1
              AND ms.symbol = UPPER($2)
              AND ($3::text IS NULL OR w.name = $3)
            "#,
        )
        .bind(user_id)
        .bind(symbol)
        .bind(label)
        .execute(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to remove watchlist entry"))?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn latest_quote(&self, symbol: &str) -> Result<Option<SymbolQuote>, AppError> {
        let row = sqlx::query(
            r#"
            SELECT
              ms.symbol AS symbol,
              t.price::float8 AS price,
              COALESCE(t.volume::float8, 0.0) AS volume,
              t.occurred_at AS occurred_at,
              COALESCE(
                ((t.price - prev.price) / NULLIF(prev.price, 0)) * 100.0,
                0.0
              )::float8 AS change_percent
            FROM imperium_market_symbol ms
            JOIN LATERAL (
              SELECT price, volume, occurred_at
              FROM imperium_market_tick
              WHERE symbol_id = ms.id
              ORDER BY occurred_at DESC
              LIMIT 1
            ) t ON true
            LEFT JOIN LATERAL (
              SELECT price
              FROM imperium_market_tick
              WHERE symbol_id = ms.id
                AND occurred_at < t.occurred_at
              ORDER BY occurred_at DESC
              LIMIT 1
            ) prev ON true
            WHERE ms.symbol = UPPER($1)
            LIMIT 1
            "#,
        )
        .bind(symbol)
        .fetch_optional(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load latest quote"))?;

        let Some(row) = row else {
            return Ok(None);
        };

        Ok(Some(SymbolQuote {
            symbol: row
                .try_get::<String, _>("symbol")
                .map_err(|error| map_sqlx(error, "failed to decode quote symbol"))?,
            price: row
                .try_get::<f64, _>("price")
                .map_err(|error| map_sqlx(error, "failed to decode quote price"))?,
            change_percent: row
                .try_get::<f64, _>("change_percent")
                .map_err(|error| map_sqlx(error, "failed to decode quote change"))?,
            volume: row
                .try_get::<f64, _>("volume")
                .map_err(|error| map_sqlx(error, "failed to decode quote volume"))?,
            timestamp: row
                .try_get::<DateTime<Utc>, _>("occurred_at")
                .map_err(|error| map_sqlx(error, "failed to decode quote timestamp"))?,
        }))
    }

    pub async fn list_candles(
        &self,
        symbol: &str,
        interval: CandleInterval,
        limit: usize,
    ) -> Result<Vec<Candle>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT
              ms.symbol AS symbol,
              c.interval_key AS interval_key,
              c.open::float8 AS open,
              c.high::float8 AS high,
              c.low::float8 AS low,
              c.close::float8 AS close,
              COALESCE(c.volume::float8, 0.0) AS volume,
              c.started_at AS started_at,
              c.ended_at AS ended_at
            FROM imperium_market_candle c
            JOIN imperium_market_symbol ms ON ms.id = c.symbol_id
            WHERE ms.symbol = UPPER($1)
              AND c.interval_key = $2
            ORDER BY c.started_at DESC
            LIMIT $3
            "#,
        )
        .bind(symbol)
        .bind(interval.as_key())
        .bind(i64::try_from(limit).unwrap_or(500))
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load candles"))?;

        let mut candles = rows
            .into_iter()
            .filter_map(|row| {
                let interval_key = row.try_get::<String, _>("interval_key").ok()?;
                let parsed_interval = CandleInterval::parse(interval_key.as_str())?;

                Some(Candle {
                    symbol: row.try_get::<String, _>("symbol").ok()?,
                    interval: parsed_interval,
                    open: row.try_get::<f64, _>("open").ok()?,
                    high: row.try_get::<f64, _>("high").ok()?,
                    low: row.try_get::<f64, _>("low").ok()?,
                    close: row.try_get::<f64, _>("close").ok()?,
                    volume: row.try_get::<f64, _>("volume").ok()?,
                    start_time: row.try_get::<DateTime<Utc>, _>("started_at").ok()?,
                    end_time: row.try_get::<DateTime<Utc>, _>("ended_at").ok()?,
                })
            })
            .collect::<Vec<_>>();

        candles.reverse();
        Ok(candles)
    }

    pub async fn upsert_market_tick(&self, tick: &MarketTick) -> Result<(), AppError> {
        let symbol_id = self
            .upsert_market_symbol(&tick.symbol, infer_asset_class(&tick.symbol))
            .await?;

        sqlx::query(
            r#"
            INSERT INTO imperium_market_tick (symbol_id, price, volume, venue, occurred_at)
            VALUES ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(symbol_id)
        .bind(tick.price)
        .bind(tick.volume)
        .bind(&tick.source)
        .bind(tick.timestamp)
        .execute(self.database.pool())
        .await
        .map(|_| ())
        .map_err(|error| map_sqlx(error, "failed to upsert market tick"))
    }

    pub async fn upsert_market_candle(&self, candle: &Candle) -> Result<(), AppError> {
        let symbol_id = self
            .upsert_market_symbol(&candle.symbol, infer_asset_class(&candle.symbol))
            .await?;

        sqlx::query(
            r#"
            INSERT INTO imperium_market_candle (
              symbol_id, interval_key, open, high, low, close, volume, started_at, ended_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (symbol_id, interval_key, started_at) DO UPDATE SET
              open = EXCLUDED.open,
              high = EXCLUDED.high,
              low = EXCLUDED.low,
              close = EXCLUDED.close,
              volume = EXCLUDED.volume,
              ended_at = EXCLUDED.ended_at
            "#,
        )
        .bind(symbol_id)
        .bind(candle.interval.as_key())
        .bind(candle.open)
        .bind(candle.high)
        .bind(candle.low)
        .bind(candle.close)
        .bind(candle.volume)
        .bind(candle.start_time)
        .bind(candle.end_time)
        .execute(self.database.pool())
        .await
        .map(|_| ())
        .map_err(|error| map_sqlx(error, "failed to upsert market candle"))
    }

    pub async fn upsert_story_clusters(&self, clusters: &[StoryCluster]) -> Result<(), AppError> {
        for cluster in clusters {
            let cluster_id = sqlx::query(
                r#"
                INSERT INTO imperium_article_cluster (cluster_key, headline, narrative_summary, impact_score)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (cluster_key) DO UPDATE SET
                  headline = EXCLUDED.headline,
                  narrative_summary = EXCLUDED.narrative_summary,
                  impact_score = EXCLUDED.impact_score,
                  updated_at = now()
                RETURNING id
                "#,
            )
            .bind(&cluster.cluster_key)
            .bind(&cluster.title)
            .bind(format!("Clustered narrative for {}", cluster.cluster_key))
            .bind(cluster.impact_score)
            .fetch_one(self.database.pool())
            .await
            .and_then(|row| row.try_get::<Uuid, _>("id"))
            .map_err(|error| map_sqlx(error, "failed to upsert story cluster"))?;

            let article_id = sqlx::query(
                r#"
                INSERT INTO imperium_article (
                  canonical_url, title, body_text, published_at, confidence_score
                )
                VALUES ($1, $2, NULL, $3, $4)
                ON CONFLICT (canonical_url) DO UPDATE SET
                  title = EXCLUDED.title,
                  updated_at = now()
                RETURNING id
                "#,
            )
            .bind(&cluster.canonical_url)
            .bind(&cluster.title)
            .bind(Utc::now())
            .bind(cluster.impact_score)
            .fetch_one(self.database.pool())
            .await
            .and_then(|row| row.try_get::<Uuid, _>("id"))
            .map_err(|error| map_sqlx(error, "failed to upsert canonical article"))?;

            sqlx::query(
                r#"
                INSERT INTO imperium_article_cluster_member (cluster_id, article_id, is_canonical)
                VALUES ($1, $2, true)
                ON CONFLICT (cluster_id, article_id) DO UPDATE SET is_canonical = true
                "#,
            )
            .bind(cluster_id)
            .bind(article_id)
            .execute(self.database.pool())
            .await
            .map_err(|error| map_sqlx(error, "failed to upsert cluster member"))?;
        }

        Ok(())
    }

    pub async fn list_story_clusters(&self, limit: usize) -> Result<Vec<StoryCluster>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT
              c.cluster_key AS cluster_key,
              COALESCE(c.headline, c.cluster_key) AS title,
              (
                SELECT COUNT(*)
                FROM imperium_article_cluster_member m
                WHERE m.cluster_id = c.id
              )::bigint AS article_count,
              COALESCE(
                (
                  SELECT a.canonical_url
                  FROM imperium_article_cluster_member m
                  JOIN imperium_article a ON a.id = m.article_id
                  WHERE m.cluster_id = c.id
                    AND m.is_canonical = true
                  ORDER BY m.created_at DESC
                  LIMIT 1
                ),
                ''
              ) AS canonical_url,
              COALESCE(c.impact_score::float8, 0.0) AS impact_score
            FROM imperium_article_cluster c
            ORDER BY c.impact_score DESC NULLS LAST, c.updated_at DESC
            LIMIT $1
            "#,
        )
        .bind(i64::try_from(limit).unwrap_or(50))
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load story clusters"))?;

        rows.into_iter()
            .map(|row| {
                let article_count = row
                    .try_get::<i64, _>("article_count")
                    .map_err(|error| map_sqlx(error, "failed to decode article count"))?;

                Ok(StoryCluster {
                    cluster_key: row
                        .try_get::<String, _>("cluster_key")
                        .map_err(|error| map_sqlx(error, "failed to decode cluster key"))?,
                    title: row
                        .try_get::<String, _>("title")
                        .map_err(|error| map_sqlx(error, "failed to decode cluster title"))?,
                    article_count: usize::try_from(article_count.max(0)).unwrap_or_default(),
                    canonical_url: row
                        .try_get::<String, _>("canonical_url")
                        .map_err(|error| map_sqlx(error, "failed to decode cluster url"))?,
                    impact_score: row
                        .try_get::<f64, _>("impact_score")
                        .map_err(|error| map_sqlx(error, "failed to decode cluster impact"))?,
                })
            })
            .collect()
    }

    pub async fn list_inbox_items(
        &self,
        user_id: Uuid,
        limit: usize,
    ) -> Result<Vec<InboxItem>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT
              c.cluster_key AS cluster_key,
              COALESCE(c.headline, c.cluster_key) AS title,
              COALESCE(c.narrative_summary, '') AS summary,
              COALESCE(MAX(ai.impact_score)::float8, c.impact_score::float8, 0.0) AS impact_score,
              COUNT(m.article_id)::bigint AS source_count,
              COALESCE(
                MAX(a.canonical_url) FILTER (WHERE m.is_canonical = true),
                MIN(a.canonical_url),
                ''
              ) AS canonical_url
            FROM imperium_article_cluster c
            LEFT JOIN imperium_article_cluster_member m ON m.cluster_id = c.id
            LEFT JOIN imperium_article a ON a.id = m.article_id
            LEFT JOIN imperium_article_impact ai
              ON ai.article_id = a.id
             AND ai.user_id = $1
            GROUP BY c.id, c.cluster_key, c.headline, c.narrative_summary, c.impact_score, c.updated_at
            ORDER BY impact_score DESC, c.updated_at DESC
            LIMIT $2
            "#,
        )
        .bind(user_id)
        .bind(i64::try_from(limit).unwrap_or(50))
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load inbox items"))?;

        rows.into_iter()
            .map(|row| {
                let source_count = row
                    .try_get::<i64, _>("source_count")
                    .map_err(|error| map_sqlx(error, "failed to decode source count"))?;

                Ok(InboxItem {
                    cluster_key: row
                        .try_get::<String, _>("cluster_key")
                        .map_err(|error| map_sqlx(error, "failed to decode inbox cluster key"))?,
                    title: row
                        .try_get::<String, _>("title")
                        .map_err(|error| map_sqlx(error, "failed to decode inbox title"))?,
                    summary: row
                        .try_get::<String, _>("summary")
                        .map_err(|error| map_sqlx(error, "failed to decode inbox summary"))?,
                    impact_score: row
                        .try_get::<f64, _>("impact_score")
                        .map_err(|error| map_sqlx(error, "failed to decode inbox impact"))?,
                    source_count: usize::try_from(source_count.max(0)).unwrap_or_default(),
                    canonical_url: row
                        .try_get::<String, _>("canonical_url")
                        .map_err(|error| map_sqlx(error, "failed to decode inbox url"))?,
                })
            })
            .collect()
    }

    pub async fn list_alert_rules(&self, user_id: Uuid) -> Result<Vec<AlertRule>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT
              id,
              category,
              name,
              COALESCE((condition_json->>'threshold')::float8, 0.0) AS threshold,
              cooldown_seconds,
              is_enabled
            FROM imperium_alert_rule
            WHERE user_id = $1
            ORDER BY updated_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load alert rules"))?;

        rows.into_iter()
            .map(|row| {
                let cooldown_seconds = row
                    .try_get::<i32, _>("cooldown_seconds")
                    .map_err(|error| map_sqlx(error, "failed to decode cooldown"))?;

                Ok(AlertRule {
                    rule_id: row
                        .try_get::<Uuid, _>("id")
                        .map_err(|error| map_sqlx(error, "failed to decode rule id"))?,
                    user_id,
                    category: row
                        .try_get::<String, _>("category")
                        .map_err(|error| map_sqlx(error, "failed to decode rule category"))?,
                    name: row
                        .try_get::<String, _>("name")
                        .map_err(|error| map_sqlx(error, "failed to decode rule name"))?,
                    threshold: row
                        .try_get::<f64, _>("threshold")
                        .map_err(|error| map_sqlx(error, "failed to decode rule threshold"))?,
                    cooldown_seconds: u64::try_from(cooldown_seconds.max(0)).unwrap_or_default(),
                    enabled: row
                        .try_get::<bool, _>("is_enabled")
                        .map_err(|error| map_sqlx(error, "failed to decode rule status"))?,
                })
            })
            .collect()
    }

    pub async fn list_alert_events(
        &self,
        user_id: Uuid,
        limit: usize,
    ) -> Result<Vec<StoredAlertEvent>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT
              e.id,
              COALESCE(e.payload->>'category', r.category, 'market') AS category,
              e.title,
              e.what_happened,
              e.why_it_matters,
              e.what_to_watch_next,
              e.dedupe_key,
              e.triggered_at
            FROM imperium_alert_event e
            LEFT JOIN imperium_alert_rule r ON r.id = e.rule_id
            WHERE e.user_id = $1
            ORDER BY e.triggered_at DESC
            LIMIT $2
            "#,
        )
        .bind(user_id)
        .bind(i64::try_from(limit).unwrap_or(50))
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load alert events"))?;

        rows.into_iter()
            .map(|row| {
                Ok(StoredAlertEvent {
                    alert_id: row
                        .try_get::<Uuid, _>("id")
                        .map_err(|error| map_sqlx(error, "failed to decode alert id"))?,
                    category: row
                        .try_get::<String, _>("category")
                        .map_err(|error| map_sqlx(error, "failed to decode alert category"))?,
                    title: row
                        .try_get::<String, _>("title")
                        .map_err(|error| map_sqlx(error, "failed to decode alert title"))?,
                    what_happened: row
                        .try_get::<String, _>("what_happened")
                        .map_err(|error| map_sqlx(error, "failed to decode alert detail"))?,
                    why_it_matters: row
                        .try_get::<String, _>("why_it_matters")
                        .map_err(|error| map_sqlx(error, "failed to decode alert rationale"))?,
                    what_to_watch_next: row
                        .try_get::<String, _>("what_to_watch_next")
                        .map_err(|error| map_sqlx(error, "failed to decode alert next action"))?,
                    dedupe_key: row
                        .try_get::<String, _>("dedupe_key")
                        .map_err(|error| map_sqlx(error, "failed to decode alert dedupe key"))?,
                    created_at: row
                        .try_get::<DateTime<Utc>, _>("triggered_at")
                        .map_err(|error| map_sqlx(error, "failed to decode alert timestamp"))?,
                })
            })
            .collect()
    }

    pub async fn store_alert_event(
        &self,
        user_id: Uuid,
        event: &AlertEvent,
    ) -> Result<String, AppError> {
        self.ensure_user(user_id).await?;

        let bucket = event.created_at.format("%Y%m%d%H").to_string();
        let dedupe = dedupe_key(&event.category, &event.title, bucket.as_str());
        let payload = serde_json::json!({
            "category": &event.category,
            "rule_id": event.rule_id,
        });

        sqlx::query(
            r#"
            INSERT INTO imperium_alert_event (
              id,
              rule_id,
              user_id,
              dedupe_key,
              title,
              what_happened,
              why_it_matters,
              what_to_watch_next,
              payload,
              triggered_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (user_id, dedupe_key) DO UPDATE SET
              rule_id = EXCLUDED.rule_id,
              title = EXCLUDED.title,
              what_happened = EXCLUDED.what_happened,
              why_it_matters = EXCLUDED.why_it_matters,
              what_to_watch_next = EXCLUDED.what_to_watch_next,
              payload = EXCLUDED.payload,
              triggered_at = EXCLUDED.triggered_at
            "#,
        )
        .bind(event.alert_id)
        .bind(event.rule_id)
        .bind(user_id)
        .bind(&dedupe)
        .bind(&event.title)
        .bind(&event.what_happened)
        .bind(&event.why_it_matters)
        .bind(&event.what_to_watch_next)
        .bind(payload)
        .bind(event.created_at)
        .execute(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to store alert event"))?;

        Ok(dedupe)
    }

    pub async fn append_audit_event(
        &self,
        stream_key: &str,
        event: &AuditEvent,
    ) -> Result<(), AppError> {
        let payload_signature = format!(
            "{}|{}|{}|{}|{}|{}",
            event.event_id,
            stream_key,
            event
                .actor_user_id
                .map(|id| id.to_string())
                .unwrap_or_default(),
            event.action,
            event.target,
            event.metadata
        );

        sqlx::query(
            r#"
            INSERT INTO imperium_audit_event (
              id,
              stream_key,
              actor_user_id,
              action,
              target,
              metadata,
              payload_hash,
              created_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              encode(digest($7, 'sha256'), 'hex'),
              $8
            )
            "#,
        )
        .bind(event.event_id)
        .bind(stream_key)
        .bind(event.actor_user_id)
        .bind(&event.action)
        .bind(&event.target)
        .bind(&event.metadata)
        .bind(payload_signature)
        .bind(event.timestamp)
        .execute(self.database.pool())
        .await
        .map(|_| ())
        .map_err(|error| map_sqlx(error, "failed to append audit event"))
    }

    pub async fn list_audit_events(&self, limit: usize) -> Result<Vec<StoredAuditEvent>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT
              id,
              stream_key,
              actor_user_id,
              action,
              target,
              metadata,
              payload_hash,
              created_at
            FROM imperium_audit_event
            ORDER BY created_at DESC
            LIMIT $1
            "#,
        )
        .bind(i64::try_from(limit).unwrap_or(100))
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load audit events"))?;

        rows.into_iter()
            .map(|row| {
                Ok(StoredAuditEvent {
                    event_id: row
                        .try_get::<Uuid, _>("id")
                        .map_err(|error| map_sqlx(error, "failed to decode audit id"))?,
                    stream_key: row
                        .try_get::<String, _>("stream_key")
                        .map_err(|error| map_sqlx(error, "failed to decode audit stream"))?,
                    actor_user_id: row
                        .try_get::<Option<Uuid>, _>("actor_user_id")
                        .map_err(|error| map_sqlx(error, "failed to decode audit actor"))?,
                    action: row
                        .try_get::<String, _>("action")
                        .map_err(|error| map_sqlx(error, "failed to decode audit action"))?,
                    target: row
                        .try_get::<String, _>("target")
                        .map_err(|error| map_sqlx(error, "failed to decode audit target"))?,
                    metadata: row
                        .try_get::<serde_json::Value, _>("metadata")
                        .map_err(|error| map_sqlx(error, "failed to decode audit metadata"))?,
                    payload_hash: row
                        .try_get::<String, _>("payload_hash")
                        .map_err(|error| map_sqlx(error, "failed to decode audit hash"))?,
                    created_at: row
                        .try_get::<DateTime<Utc>, _>("created_at")
                        .map_err(|error| map_sqlx(error, "failed to decode audit timestamp"))?,
                })
            })
            .collect()
    }

    pub async fn store_dead_letter_event(
        &self,
        worker_role: &str,
        subject: &str,
        payload: &serde_json::Value,
        error_message: &str,
        failed_at: DateTime<Utc>,
    ) -> Result<Uuid, AppError> {
        sqlx::query(
            r#"
            INSERT INTO imperium_dead_letter_event (
              worker_role,
              subject,
              payload,
              error_message,
              first_failed_at,
              last_failed_at
            )
            VALUES ($1, $2, $3, $4, $5, $5)
            RETURNING id
            "#,
        )
        .bind(worker_role)
        .bind(subject)
        .bind(payload)
        .bind(error_message)
        .bind(failed_at)
        .fetch_one(self.database.pool())
        .await
        .and_then(|row| row.try_get::<Uuid, _>("id"))
        .map_err(|error| map_sqlx(error, "failed to store dead-letter event"))
    }

    pub async fn list_dead_letter_events(
        &self,
        limit: usize,
        status: Option<&str>,
    ) -> Result<Vec<DeadLetterEventRecord>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT
              id,
              worker_role,
              subject,
              payload,
              error_message,
              retry_count,
              status,
              first_failed_at,
              last_failed_at,
              replayed_at,
              replayed_by,
              created_at,
              updated_at
            FROM imperium_dead_letter_event
            WHERE ($1::text IS NULL OR status = $1)
            ORDER BY last_failed_at DESC
            LIMIT $2
            "#,
        )
        .bind(status)
        .bind(i64::try_from(limit).unwrap_or(100))
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to list dead-letter events"))?;

        rows.into_iter().map(map_dead_letter_row).collect()
    }

    pub async fn get_dead_letter_event(
        &self,
        event_id: Uuid,
    ) -> Result<Option<DeadLetterEventRecord>, AppError> {
        let row = sqlx::query(
            r#"
            SELECT
              id,
              worker_role,
              subject,
              payload,
              error_message,
              retry_count,
              status,
              first_failed_at,
              last_failed_at,
              replayed_at,
              replayed_by,
              created_at,
              updated_at
            FROM imperium_dead_letter_event
            WHERE id = $1
            LIMIT 1
            "#,
        )
        .bind(event_id)
        .fetch_optional(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load dead-letter event"))?;

        row.map(map_dead_letter_row).transpose()
    }

    pub async fn mark_dead_letter_replayed(
        &self,
        event_id: Uuid,
        replayed_by: &str,
    ) -> Result<(), AppError> {
        let updated = sqlx::query(
            r#"
            UPDATE imperium_dead_letter_event
            SET
              status = 'replayed',
              replayed_at = now(),
              replayed_by = $2
            WHERE id = $1
            "#,
        )
        .bind(event_id)
        .bind(replayed_by)
        .execute(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to mark dead-letter replayed"))?;

        if updated.rows_affected() == 0 {
            return Err(AppError::validation(format!(
                "dead-letter event {event_id} not found"
            )));
        }

        Ok(())
    }

    pub async fn record_dead_letter_retry_failure(
        &self,
        event_id: Uuid,
        error_message: &str,
    ) -> Result<(), AppError> {
        let updated = sqlx::query(
            r#"
            UPDATE imperium_dead_letter_event
            SET
              retry_count = retry_count + 1,
              status = 'pending',
              error_message = $2,
              last_failed_at = now()
            WHERE id = $1
            "#,
        )
        .bind(event_id)
        .bind(error_message)
        .execute(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to update dead-letter retry failure"))?;

        if updated.rows_affected() == 0 {
            return Err(AppError::validation(format!(
                "dead-letter event {event_id} not found"
            )));
        }

        Ok(())
    }

    pub async fn list_theses(&self, user_id: Uuid) -> Result<Vec<ThesisEntry>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT
              id,
              title,
              position_summary,
              conviction_percent::float8 AS conviction_percent,
              invalidation_criteria,
              review_date,
              created_at
            FROM imperium_decision_thesis
            WHERE user_id = $1
              AND status = 'active'
            ORDER BY created_at DESC
            LIMIT 100
            "#,
        )
        .bind(user_id)
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load theses"))?;

        rows.into_iter()
            .map(|row| {
                let position = row
                    .try_get::<Option<String>, _>("position_summary")
                    .map_err(|error| map_sqlx(error, "failed to decode thesis position"))?
                    .unwrap_or_default();

                let review_date = row
                    .try_get::<Option<NaiveDate>, _>("review_date")
                    .map_err(|error| map_sqlx(error, "failed to decode thesis review date"))?
                    .unwrap_or_else(|| Utc::now().date_naive());

                Ok(ThesisEntry {
                    thesis_id: row
                        .try_get::<Uuid, _>("id")
                        .map_err(|error| map_sqlx(error, "failed to decode thesis id"))?,
                    user_id,
                    title: row
                        .try_get::<String, _>("title")
                        .map_err(|error| map_sqlx(error, "failed to decode thesis title"))?,
                    position: position.clone(),
                    conviction_percent: row
                        .try_get::<Option<f64>, _>("conviction_percent")
                        .map_err(|error| map_sqlx(error, "failed to decode thesis conviction"))?
                        .unwrap_or(50.0),
                    rationale: if position.is_empty() {
                        "Stored thesis context.".to_string()
                    } else {
                        format!("Stored thesis context: {position}")
                    },
                    invalidation_criteria: row
                        .try_get::<Option<String>, _>("invalidation_criteria")
                        .map_err(|error| map_sqlx(error, "failed to decode thesis invalidation"))?
                        .unwrap_or_else(|| "No invalidation criteria specified.".to_string()),
                    review_date,
                    created_at: row
                        .try_get::<DateTime<Utc>, _>("created_at")
                        .map_err(|error| map_sqlx(error, "failed to decode thesis created_at"))?,
                })
            })
            .collect()
    }

    pub async fn create_thesis(
        &self,
        user_id: Uuid,
        title: &str,
        position_summary: Option<&str>,
        conviction_percent: Option<f64>,
        invalidation_criteria: Option<&str>,
        review_date: Option<NaiveDate>,
    ) -> Result<ThesisEntry, AppError> {
        self.ensure_user(user_id).await?;

        let row = sqlx::query(
            r#"
            INSERT INTO imperium_decision_thesis (
              user_id, title, position_summary, conviction_percent, invalidation_criteria, review_date, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'active')
            RETURNING id, title, position_summary, conviction_percent::float8 AS conviction_percent,
                      invalidation_criteria, review_date, created_at
            "#,
        )
        .bind(user_id)
        .bind(title)
        .bind(position_summary)
        .bind(conviction_percent)
        .bind(invalidation_criteria)
        .bind(review_date)
        .fetch_one(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to create thesis"))?;

        let position = row
            .try_get::<Option<String>, _>("position_summary")
            .map_err(|error| map_sqlx(error, "failed to decode thesis position"))?
            .unwrap_or_default();

        Ok(ThesisEntry {
            thesis_id: row
                .try_get::<Uuid, _>("id")
                .map_err(|error| map_sqlx(error, "failed to decode thesis id"))?,
            user_id,
            title: row
                .try_get::<String, _>("title")
                .map_err(|error| map_sqlx(error, "failed to decode thesis title"))?,
            position: position.clone(),
            conviction_percent: row
                .try_get::<Option<f64>, _>("conviction_percent")
                .map_err(|error| map_sqlx(error, "failed to decode thesis conviction"))?
                .unwrap_or(50.0),
            rationale: if position.is_empty() {
                "Stored thesis context.".to_string()
            } else {
                format!("Stored thesis context: {position}")
            },
            invalidation_criteria: row
                .try_get::<Option<String>, _>("invalidation_criteria")
                .map_err(|error| map_sqlx(error, "failed to decode thesis invalidation"))?
                .unwrap_or_else(|| "No invalidation criteria specified.".to_string()),
            review_date: row
                .try_get::<Option<NaiveDate>, _>("review_date")
                .map_err(|error| map_sqlx(error, "failed to decode thesis review date"))?
                .unwrap_or_else(|| Utc::now().date_naive()),
            created_at: row
                .try_get::<DateTime<Utc>, _>("created_at")
                .map_err(|error| map_sqlx(error, "failed to decode thesis created_at"))?,
        })
    }

    pub async fn archive_thesis(&self, user_id: Uuid, thesis_id: Uuid) -> Result<bool, AppError> {
        let result = sqlx::query(
            r#"
            UPDATE imperium_decision_thesis
            SET status = 'archived', updated_at = now()
            WHERE id = $1
              AND user_id = $2
              AND status <> 'archived'
            "#,
        )
        .bind(thesis_id)
        .bind(user_id)
        .execute(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to archive thesis"))?;

        Ok(result.rows_affected() > 0)
    }

    pub async fn create_playbook(
        &self,
        user_id: Uuid,
        title: &str,
        trigger_expression: &str,
        response_steps: &[String],
        enabled: bool,
    ) -> Result<Playbook, AppError> {
        self.ensure_user(user_id).await?;

        let row = sqlx::query(
            r#"
            INSERT INTO imperium_playbook (
              user_id, title, trigger_definition, response_steps, is_enabled
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, title, trigger_definition, response_steps, is_enabled, created_at
            "#,
        )
        .bind(user_id)
        .bind(title)
        .bind(serde_json::json!({"expression": trigger_expression}))
        .bind(serde_json::Value::Array(
            response_steps
                .iter()
                .map(|value| serde_json::Value::String(value.clone()))
                .collect(),
        ))
        .bind(enabled)
        .fetch_one(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to create playbook"))?;

        map_playbook_row(user_id, row)
    }

    pub async fn set_playbook_enabled(
        &self,
        user_id: Uuid,
        playbook_id: Uuid,
        enabled: bool,
    ) -> Result<Option<Playbook>, AppError> {
        let row = sqlx::query(
            r#"
            UPDATE imperium_playbook
            SET is_enabled = $3, updated_at = now()
            WHERE id = $1
              AND user_id = $2
            RETURNING id, title, trigger_definition, response_steps, is_enabled, created_at
            "#,
        )
        .bind(playbook_id)
        .bind(user_id)
        .bind(enabled)
        .fetch_optional(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to update playbook status"))?;

        row.map(|row| map_playbook_row(user_id, row)).transpose()
    }

    pub async fn list_playbooks(&self, user_id: Uuid) -> Result<Vec<Playbook>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT
              id,
              title,
              trigger_definition,
              response_steps,
              is_enabled,
              created_at
            FROM imperium_playbook
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 100
            "#,
        )
        .bind(user_id)
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load playbooks"))?;

        rows.into_iter()
            .map(|row| map_playbook_row(user_id, row))
            .collect()
    }

    pub async fn list_review_reminders(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<ThesisReviewReminder>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT id, title, review_date
            FROM imperium_decision_thesis
            WHERE user_id = $1
              AND status = 'active'
              AND review_date IS NOT NULL
            ORDER BY review_date ASC
            LIMIT 100
            "#,
        )
        .bind(user_id)
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load reminders"))?;

        rows.into_iter()
            .map(|row| {
                Ok(ThesisReviewReminder {
                    thesis_id: row
                        .try_get::<Uuid, _>("id")
                        .map_err(|error| map_sqlx(error, "failed to decode reminder thesis id"))?,
                    title: row
                        .try_get::<String, _>("title")
                        .map_err(|error| map_sqlx(error, "failed to decode reminder title"))?,
                    review_date: row
                        .try_get::<NaiveDate, _>("review_date")
                        .map_err(|error| map_sqlx(error, "failed to decode reminder date"))?,
                })
            })
            .collect()
    }

    pub async fn upsert_portfolio_overview(
        &self,
        user_id: Uuid,
        overview: &PortfolioOverview,
    ) -> Result<(), AppError> {
        self.ensure_user(user_id).await?;

        let mut accounts = overview.accounts.clone();
        if accounts.is_empty() {
            accounts.push(PortfolioAccountSummary {
                account_id: "acct-default-synthetic".to_string(),
                name: "Default Account".to_string(),
                account_type: "brokerage".to_string(),
                balance: overview.net_worth,
            });
        }

        let mut account_ids = Vec::with_capacity(accounts.len());
        for account in &accounts {
            let account_id = sqlx::query(
                r#"
                INSERT INTO imperium_portfolio_account (
                  user_id, provider_key, provider_account_id, account_name, account_type, currency, is_manual
                )
                VALUES ($1, 'synthetic', $2, $3, $4, 'USD', true)
                ON CONFLICT (user_id, provider_key, provider_account_id) DO UPDATE SET
                  account_name = EXCLUDED.account_name,
                  account_type = EXCLUDED.account_type,
                  updated_at = now()
                RETURNING id
                "#,
            )
            .bind(user_id)
            .bind(&account.account_id)
            .bind(&account.name)
            .bind(&account.account_type)
            .fetch_one(self.database.pool())
            .await
            .and_then(|row| row.try_get::<Uuid, _>("id"))
            .map_err(|error| map_sqlx(error, "failed to upsert portfolio account"))?;

            account_ids.push(account_id);
        }

        sqlx::query(
            r#"
            DELETE FROM imperium_portfolio_position p
            USING imperium_portfolio_account a
            WHERE p.account_id = a.id
              AND a.user_id = $1
              AND a.provider_key = 'synthetic'
            "#,
        )
        .bind(user_id)
        .execute(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to clear synthetic portfolio positions"))?;

        for (idx, position) in overview.top_positions.iter().enumerate() {
            let target_account = account_ids[idx % account_ids.len()];
            let symbol_id = self
                .upsert_market_symbol(&position.symbol, &position.asset_class)
                .await?;

            let average_cost = if position.quantity.abs() > f64::EPSILON {
                Some(position.market_value / position.quantity)
            } else {
                None
            };

            sqlx::query(
                r#"
                INSERT INTO imperium_portfolio_position (
                  account_id, symbol_id, symbol_text, quantity, average_cost, market_value, updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, now())
                "#,
            )
            .bind(target_account)
            .bind(symbol_id)
            .bind(&position.symbol)
            .bind(position.quantity)
            .bind(average_cost)
            .bind(position.market_value)
            .execute(self.database.pool())
            .await
            .map_err(|error| map_sqlx(error, "failed to insert portfolio position"))?;
        }

        sqlx::query(
            r#"
            INSERT INTO imperium_portfolio_snapshot (
              user_id, total_net_worth, daily_change, ytd_change, captured_at
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, captured_at) DO UPDATE SET
              total_net_worth = EXCLUDED.total_net_worth,
              daily_change = EXCLUDED.daily_change,
              ytd_change = EXCLUDED.ytd_change
            "#,
        )
        .bind(user_id)
        .bind(overview.net_worth)
        .bind(overview.daily_change)
        .bind(overview.ytd_change)
        .bind(overview.as_of)
        .execute(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to upsert portfolio snapshot"))?;

        Ok(())
    }

    pub async fn load_portfolio_accounts(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<PortfolioAccountSummary>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT
              COALESCE(provider_account_id, id::text) AS account_id,
              account_name,
              account_type,
              COALESCE(
                (
                  SELECT SUM(COALESCE(p.market_value, 0))::float8
                  FROM imperium_portfolio_position p
                  WHERE p.account_id = a.id
                ),
                0.0
              ) AS balance
            FROM imperium_portfolio_account a
            WHERE user_id = $1
            ORDER BY updated_at DESC, account_name ASC
            "#,
        )
        .bind(user_id)
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load portfolio accounts"))?;

        rows.into_iter()
            .map(|row| {
                Ok(PortfolioAccountSummary {
                    account_id: row.try_get::<String, _>("account_id").map_err(|error| {
                        map_sqlx(error, "failed to decode portfolio account id")
                    })?,
                    name: row.try_get::<String, _>("account_name").map_err(|error| {
                        map_sqlx(error, "failed to decode portfolio account name")
                    })?,
                    account_type: row.try_get::<String, _>("account_type").map_err(|error| {
                        map_sqlx(error, "failed to decode portfolio account type")
                    })?,
                    balance: row.try_get::<f64, _>("balance").map_err(|error| {
                        map_sqlx(error, "failed to decode portfolio account balance")
                    })?,
                })
            })
            .collect()
    }

    pub async fn load_portfolio_overview(
        &self,
        user_id: Uuid,
    ) -> Result<Option<PortfolioOverview>, AppError> {
        let snapshot_row = sqlx::query(
            r#"
            SELECT
              captured_at,
              total_net_worth::float8 AS total_net_worth,
              COALESCE(daily_change::float8, 0.0) AS daily_change,
              COALESCE(ytd_change::float8, 0.0) AS ytd_change
            FROM imperium_portfolio_snapshot
            WHERE user_id = $1
            ORDER BY captured_at DESC
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .fetch_optional(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load portfolio snapshot"))?;

        let Some(snapshot_row) = snapshot_row else {
            return Ok(None);
        };

        let accounts = self.load_portfolio_accounts(user_id).await?;

        let position_rows = sqlx::query(
            r#"
            SELECT
              COALESCE(ms.symbol, p.symbol_text, 'UNKNOWN') AS symbol,
              p.quantity::float8 AS quantity,
              COALESCE(p.market_value::float8, 0.0) AS market_value,
              COALESCE(ms.asset_class, 'other') AS asset_class
            FROM imperium_portfolio_position p
            JOIN imperium_portfolio_account a ON a.id = p.account_id
            LEFT JOIN imperium_market_symbol ms ON ms.id = p.symbol_id
            WHERE a.user_id = $1
            ORDER BY p.market_value DESC NULLS LAST, symbol ASC
            LIMIT 20
            "#,
        )
        .bind(user_id)
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load top positions"))?;

        let top_positions = position_rows
            .into_iter()
            .map(|row| {
                Ok(PositionSummary {
                    symbol: row
                        .try_get::<String, _>("symbol")
                        .map_err(|error| map_sqlx(error, "failed to decode position symbol"))?,
                    quantity: row
                        .try_get::<f64, _>("quantity")
                        .map_err(|error| map_sqlx(error, "failed to decode position quantity"))?,
                    market_value: row
                        .try_get::<f64, _>("market_value")
                        .map_err(|error| map_sqlx(error, "failed to decode position value"))?,
                    asset_class: row.try_get::<String, _>("asset_class").map_err(|error| {
                        map_sqlx(error, "failed to decode position asset class")
                    })?,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;

        let exposure_rows = sqlx::query(
            r#"
            SELECT
              COALESCE(ms.asset_class, 'other') AS bucket,
              COALESCE(SUM(p.market_value)::float8, 0.0) AS market_value
            FROM imperium_portfolio_position p
            JOIN imperium_portfolio_account a ON a.id = p.account_id
            LEFT JOIN imperium_market_symbol ms ON ms.id = p.symbol_id
            WHERE a.user_id = $1
            GROUP BY bucket
            ORDER BY market_value DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load portfolio exposures"))?;

        let mut exposure_buckets = Vec::new();
        for row in exposure_rows {
            let bucket = row
                .try_get::<String, _>("bucket")
                .map_err(|error| map_sqlx(error, "failed to decode exposure bucket"))?;
            let market_value = row
                .try_get::<f64, _>("market_value")
                .map_err(|error| map_sqlx(error, "failed to decode exposure market value"))?;
            exposure_buckets.push((bucket, market_value));
        }

        let total_exposure: f64 = exposure_buckets.iter().map(|(_, value)| *value).sum();
        let exposures = exposure_buckets
            .into_iter()
            .map(|(bucket, value)| Exposure {
                bucket,
                weight_percent: if total_exposure > 0.0 {
                    (value / total_exposure) * 100.0
                } else {
                    0.0
                },
            })
            .collect::<Vec<_>>();

        let concentration = calculate_concentration_risk(&top_positions);
        let risk_score = (concentration * 0.62).min(100.0);

        Ok(Some(PortfolioOverview {
            as_of: snapshot_row
                .try_get::<DateTime<Utc>, _>("captured_at")
                .map_err(|error| map_sqlx(error, "failed to decode portfolio as_of"))?,
            net_worth: snapshot_row
                .try_get::<f64, _>("total_net_worth")
                .map_err(|error| map_sqlx(error, "failed to decode portfolio net worth"))?,
            daily_change: snapshot_row
                .try_get::<f64, _>("daily_change")
                .map_err(|error| map_sqlx(error, "failed to decode portfolio daily change"))?,
            ytd_change: snapshot_row
                .try_get::<f64, _>("ytd_change")
                .map_err(|error| map_sqlx(error, "failed to decode portfolio ytd change"))?,
            risk_score,
            accounts,
            top_positions,
            exposures,
        }))
    }

    pub async fn upsert_business_snapshot(
        &self,
        user_id: Uuid,
        overview: &BusinessOverview,
        metrics: &[BusinessMetric],
    ) -> Result<(), AppError> {
        self.ensure_user(user_id).await?;
        let entity_id = self
            .ensure_business_entity(user_id, &overview.entity_name)
            .await?;
        let metric_date = overview.as_of.date_naive();

        let mut merged = std::collections::BTreeMap::<String, f64>::new();
        merged.insert("mrr".to_string(), overview.mrr);
        merged.insert("burn".to_string(), overview.burn);
        merged.insert("runway_months".to_string(), overview.runway_months);
        merged.insert("cash_balance".to_string(), overview.cash_balance);
        merged.insert(
            "overdue_invoices".to_string(),
            overview.overdue_invoices as f64,
        );
        for metric in metrics {
            merged.insert(metric.key.clone(), metric.value);
        }

        for (key, value) in merged {
            sqlx::query(
                r#"
                INSERT INTO imperium_business_metric (entity_id, metric_key, metric_value, metric_date)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (entity_id, metric_key, metric_date) DO UPDATE SET
                  metric_value = EXCLUDED.metric_value
                "#,
            )
            .bind(entity_id)
            .bind(key)
            .bind(value)
            .bind(metric_date)
            .execute(self.database.pool())
            .await
            .map_err(|error| map_sqlx(error, "failed to upsert business metric"))?;
        }

        Ok(())
    }

    pub async fn load_business_overview(
        &self,
        user_id: Uuid,
    ) -> Result<Option<BusinessOverview>, AppError> {
        self.load_business_overview_with_offset(user_id, 0).await
    }

    pub async fn load_previous_business_overview(
        &self,
        user_id: Uuid,
    ) -> Result<Option<BusinessOverview>, AppError> {
        self.load_business_overview_with_offset(user_id, 1).await
    }

    pub async fn list_business_metric_snapshot(
        &self,
        user_id: Uuid,
    ) -> Result<Vec<BusinessMetric>, AppError> {
        let Some((entity_id, _entity_name)) = self.latest_business_entity(user_id).await? else {
            return Ok(Vec::new());
        };

        let metric_date_row = sqlx::query(
            r#"
            SELECT metric_date
            FROM imperium_business_metric
            WHERE entity_id = $1
            GROUP BY metric_date
            ORDER BY metric_date DESC
            LIMIT 1
            "#,
        )
        .bind(entity_id)
        .fetch_optional(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load latest business metric date"))?;

        let Some(metric_date_row) = metric_date_row else {
            return Ok(Vec::new());
        };

        let metric_date = metric_date_row
            .try_get::<NaiveDate, _>("metric_date")
            .map_err(|error| map_sqlx(error, "failed to decode business metric date"))?;

        let rows = sqlx::query(
            r#"
            SELECT metric_key, metric_value::float8 AS metric_value
            FROM imperium_business_metric
            WHERE entity_id = $1
              AND metric_date = $2
            ORDER BY metric_key ASC
            "#,
        )
        .bind(entity_id)
        .bind(metric_date)
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load business metric snapshot"))?;

        rows.into_iter()
            .map(|row| {
                Ok(BusinessMetric {
                    key: row
                        .try_get::<String, _>("metric_key")
                        .map_err(|error| map_sqlx(error, "failed to decode business metric key"))?,
                    value: row.try_get::<f64, _>("metric_value").map_err(|error| {
                        map_sqlx(error, "failed to decode business metric value")
                    })?,
                    window: "current".to_string(),
                })
            })
            .collect()
    }

    pub async fn upsert_regime_state(
        &self,
        user_id: Uuid,
        regime_state: &RegimeState,
    ) -> Result<(), AppError> {
        self.ensure_user(user_id).await?;

        sqlx::query(
            r#"
            INSERT INTO imperium_regime_state (
              user_id, regime, confidence_score, explanation, as_of
            )
            VALUES ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(user_id)
        .bind(regime_to_db_key(regime_state.regime.clone()))
        .bind(regime_state.confidence)
        .bind(&regime_state.explanation)
        .bind(regime_state.updated_at)
        .execute(self.database.pool())
        .await
        .map(|_| ())
        .map_err(|error| map_sqlx(error, "failed to upsert regime state"))
    }

    pub async fn upsert_risk_observations(
        &self,
        user_id: Uuid,
        signals: &[RiskSignal],
        indicators: &[MacroIndicator],
    ) -> Result<(), AppError> {
        self.ensure_user(user_id).await?;

        for signal in signals {
            let details = serde_json::json!({
                "kind": "risk",
                "description": signal.description,
            });

            sqlx::query(
                r#"
                INSERT INTO imperium_risk_signal (
                  user_id, signal_key, severity, details, detected_at
                )
                VALUES ($1, $2, $3, $4, $5)
                "#,
            )
            .bind(user_id)
            .bind(&signal.key)
            .bind(&signal.severity)
            .bind(details)
            .bind(signal.created_at)
            .execute(self.database.pool())
            .await
            .map_err(|error| map_sqlx(error, "failed to insert risk signal"))?;
        }

        for indicator in indicators {
            let details = serde_json::json!({
                "kind": "macro",
                "value": indicator.value,
                "change": indicator.change,
            });

            sqlx::query(
                r#"
                INSERT INTO imperium_risk_signal (
                  user_id, signal_key, severity, details, detected_at
                )
                VALUES ($1, $2, 'info', $3, $4)
                "#,
            )
            .bind(user_id)
            .bind(format!("macro:{}", indicator.key))
            .bind(details)
            .bind(indicator.updated_at)
            .execute(self.database.pool())
            .await
            .map_err(|error| map_sqlx(error, "failed to insert macro indicator signal"))?;
        }

        Ok(())
    }

    pub async fn load_regime_state(&self, user_id: Uuid) -> Result<Option<RegimeState>, AppError> {
        let row = sqlx::query(
            r#"
            SELECT regime, confidence_score::float8 AS confidence_score, COALESCE(explanation, '') AS explanation, as_of
            FROM imperium_regime_state
            WHERE user_id = $1
            ORDER BY as_of DESC
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .fetch_optional(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load regime state"))?;

        let Some(row) = row else {
            return Ok(None);
        };

        let regime = row
            .try_get::<String, _>("regime")
            .map_err(|error| map_sqlx(error, "failed to decode regime"))?;

        Ok(Some(RegimeState {
            regime: regime_from_db_key(&regime),
            confidence: row
                .try_get::<f64, _>("confidence_score")
                .map_err(|error| map_sqlx(error, "failed to decode regime confidence"))?,
            explanation: row
                .try_get::<String, _>("explanation")
                .map_err(|error| map_sqlx(error, "failed to decode regime explanation"))?,
            updated_at: row
                .try_get::<DateTime<Utc>, _>("as_of")
                .map_err(|error| map_sqlx(error, "failed to decode regime timestamp"))?,
        }))
    }

    pub async fn list_macro_indicators(
        &self,
        user_id: Uuid,
        limit: usize,
    ) -> Result<Vec<MacroIndicator>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT signal_key, details, detected_at
            FROM (
              SELECT
                signal_key,
                details,
                detected_at,
                ROW_NUMBER() OVER (PARTITION BY signal_key ORDER BY detected_at DESC) AS rn
              FROM imperium_risk_signal
              WHERE user_id = $1
                AND signal_key LIKE 'macro:%'
            ) ranked
            WHERE rn = 1
            ORDER BY detected_at DESC
            LIMIT $2
            "#,
        )
        .bind(user_id)
        .bind(i64::try_from(limit).unwrap_or(50))
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load macro indicators"))?;

        rows.into_iter()
            .map(|row| {
                let signal_key = row
                    .try_get::<String, _>("signal_key")
                    .map_err(|error| map_sqlx(error, "failed to decode macro key"))?;
                let details = row
                    .try_get::<serde_json::Value, _>("details")
                    .map_err(|error| map_sqlx(error, "failed to decode macro details"))?;

                Ok(MacroIndicator {
                    key: signal_key.trim_start_matches("macro:").to_string(),
                    value: details
                        .get("value")
                        .and_then(serde_json::Value::as_f64)
                        .unwrap_or(0.0),
                    change: details
                        .get("change")
                        .and_then(serde_json::Value::as_f64)
                        .unwrap_or(0.0),
                    updated_at: row
                        .try_get::<DateTime<Utc>, _>("detected_at")
                        .map_err(|error| map_sqlx(error, "failed to decode macro timestamp"))?,
                })
            })
            .collect()
    }

    pub async fn list_risk_signals(
        &self,
        user_id: Uuid,
        limit: usize,
    ) -> Result<Vec<RiskSignal>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT signal_key, severity, details, detected_at
            FROM imperium_risk_signal
            WHERE user_id = $1
              AND signal_key NOT LIKE 'macro:%'
            ORDER BY detected_at DESC
            LIMIT $2
            "#,
        )
        .bind(user_id)
        .bind(i64::try_from(limit).unwrap_or(50))
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load risk signals"))?;

        rows.into_iter()
            .map(|row| {
                let signal_key = row
                    .try_get::<String, _>("signal_key")
                    .map_err(|error| map_sqlx(error, "failed to decode risk signal key"))?;
                let details = row
                    .try_get::<serde_json::Value, _>("details")
                    .map_err(|error| map_sqlx(error, "failed to decode risk signal details"))?;

                Ok(RiskSignal {
                    key: signal_key,
                    severity: row.try_get::<String, _>("severity").map_err(|error| {
                        map_sqlx(error, "failed to decode risk signal severity")
                    })?,
                    description: details
                        .get("description")
                        .and_then(serde_json::Value::as_str)
                        .map(ToString::to_string)
                        .unwrap_or_else(|| "Risk signal detected.".to_string()),
                    created_at: row.try_get::<DateTime<Utc>, _>("detected_at").map_err(
                        |error| map_sqlx(error, "failed to decode risk signal timestamp"),
                    )?,
                })
            })
            .collect()
    }

    pub async fn store_daily_brief(&self, brief: &DailyBrief) -> Result<(), AppError> {
        self.ensure_user(brief.user_id).await?;

        let mut confidence_sum = 0.0;
        let mut confidence_count = 0_u64;
        for section in &brief.sections {
            for claim in &section.claims {
                confidence_sum += claim.confidence_score;
                confidence_count += 1;
            }
        }

        let confidence_score = if confidence_count > 0 {
            Some(confidence_sum / confidence_count as f64)
        } else {
            None
        };

        let brief_id = sqlx::query(
            r#"
            INSERT INTO imperium_daily_brief (id, user_id, brief_date, confidence_score, generated_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, brief_date) DO UPDATE SET
              confidence_score = EXCLUDED.confidence_score,
              generated_at = EXCLUDED.generated_at
            RETURNING id
            "#,
        )
        .bind(brief.brief_id)
        .bind(brief.user_id)
        .bind(brief.brief_date)
        .bind(confidence_score)
        .bind(brief.generated_at)
        .fetch_one(self.database.pool())
        .await
        .and_then(|row| row.try_get::<Uuid, _>("id"))
        .map_err(|error| map_sqlx(error, "failed to upsert daily brief"))?;

        sqlx::query("DELETE FROM imperium_brief_section WHERE brief_id = $1")
            .bind(brief_id)
            .execute(self.database.pool())
            .await
            .map_err(|error| map_sqlx(error, "failed to clear existing brief sections"))?;

        for (section_idx, section) in brief.sections.iter().enumerate() {
            let section_id = sqlx::query(
                r#"
                INSERT INTO imperium_brief_section (
                  brief_id, section_key, title, summary, display_order
                )
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
                "#,
            )
            .bind(brief_id)
            .bind(&section.section_key)
            .bind(&section.title)
            .bind(&section.summary)
            .bind(i32::try_from(section_idx + 1).unwrap_or(i32::MAX))
            .fetch_one(self.database.pool())
            .await
            .and_then(|row| row.try_get::<Uuid, _>("id"))
            .map_err(|error| map_sqlx(error, "failed to insert brief section"))?;

            for claim in &section.claims {
                let claim_id = sqlx::query(
                    r#"
                    INSERT INTO imperium_brief_claim (
                      section_id, statement, impact_score, confidence_score, is_published
                    )
                    VALUES ($1, $2, $3, $4, true)
                    RETURNING id
                    "#,
                )
                .bind(section_id)
                .bind(&claim.statement)
                .bind(claim.impact_score)
                .bind(claim.confidence_score)
                .fetch_one(self.database.pool())
                .await
                .and_then(|row| row.try_get::<Uuid, _>("id"))
                .map_err(|error| map_sqlx(error, "failed to insert brief claim"))?;

                for citation in &claim.citations {
                    sqlx::query(
                        r#"
                        INSERT INTO imperium_brief_citation (claim_id, source_url, source_snippet)
                        VALUES ($1, $2, $3)
                        "#,
                    )
                    .bind(claim_id)
                    .bind(&citation.source_url)
                    .bind(&citation.source_snippet)
                    .execute(self.database.pool())
                    .await
                    .map_err(|error| map_sqlx(error, "failed to insert brief citation"))?;
                }
            }
        }

        Ok(())
    }

    pub async fn load_latest_daily_brief(
        &self,
        user_id: Uuid,
    ) -> Result<Option<DailyBrief>, AppError> {
        let brief_row = sqlx::query(
            r#"
            SELECT id, user_id, brief_date, generated_at
            FROM imperium_daily_brief
            WHERE user_id = $1
            ORDER BY brief_date DESC, generated_at DESC
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .fetch_optional(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load latest daily brief"))?;

        let Some(brief_row) = brief_row else {
            return Ok(None);
        };

        let brief_id = brief_row
            .try_get::<Uuid, _>("id")
            .map_err(|error| map_sqlx(error, "failed to decode brief id"))?;

        let section_rows = sqlx::query(
            r#"
            SELECT id, section_key, title, COALESCE(summary, '') AS summary
            FROM imperium_brief_section
            WHERE brief_id = $1
            ORDER BY display_order ASC, created_at ASC
            "#,
        )
        .bind(brief_id)
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load brief sections"))?;

        let mut sections = Vec::new();
        let mut required_reads = std::collections::BTreeSet::<String>::new();

        for section_row in section_rows {
            let section_id = section_row
                .try_get::<Uuid, _>("id")
                .map_err(|error| map_sqlx(error, "failed to decode section id"))?;

            let claim_rows = sqlx::query(
                r#"
                SELECT id, statement, COALESCE(impact_score::float8, 0.0) AS impact_score,
                       COALESCE(confidence_score::float8, 0.0) AS confidence_score
                FROM imperium_brief_claim
                WHERE section_id = $1
                ORDER BY created_at ASC
                "#,
            )
            .bind(section_id)
            .fetch_all(self.database.pool())
            .await
            .map_err(|error| map_sqlx(error, "failed to load brief claims"))?;

            let mut claims = Vec::new();
            for claim_row in claim_rows {
                let claim_id = claim_row
                    .try_get::<Uuid, _>("id")
                    .map_err(|error| map_sqlx(error, "failed to decode claim id"))?;

                let citation_rows = sqlx::query(
                    r#"
                    SELECT COALESCE(source_url, '') AS source_url, COALESCE(source_snippet, '') AS source_snippet
                    FROM imperium_brief_citation
                    WHERE claim_id = $1
                    ORDER BY created_at ASC
                    "#,
                )
                .bind(claim_id)
                .fetch_all(self.database.pool())
                .await
                .map_err(|error| map_sqlx(error, "failed to load brief citations"))?;

                let citations = citation_rows
                    .into_iter()
                    .map(|citation_row| {
                        let source_url = citation_row
                            .try_get::<String, _>("source_url")
                            .map_err(|error| map_sqlx(error, "failed to decode citation source"))?;
                        if !source_url.is_empty() {
                            required_reads.insert(source_url.clone());
                        }

                        Ok(BriefCitation {
                            source_url,
                            source_snippet: citation_row
                                .try_get::<String, _>("source_snippet")
                                .map_err(|error| {
                                    map_sqlx(error, "failed to decode citation snippet")
                                })?,
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?;

                claims.push(BriefClaim {
                    statement: claim_row
                        .try_get::<String, _>("statement")
                        .map_err(|error| map_sqlx(error, "failed to decode claim statement"))?,
                    impact_score: claim_row
                        .try_get::<f64, _>("impact_score")
                        .map_err(|error| map_sqlx(error, "failed to decode claim impact"))?,
                    confidence_score: claim_row
                        .try_get::<f64, _>("confidence_score")
                        .map_err(|error| map_sqlx(error, "failed to decode claim confidence"))?,
                    citations,
                    recommended_action: None,
                });
            }

            sections.push(BriefSection {
                section_key: section_row
                    .try_get::<String, _>("section_key")
                    .map_err(|error| map_sqlx(error, "failed to decode section key"))?,
                title: section_row
                    .try_get::<String, _>("title")
                    .map_err(|error| map_sqlx(error, "failed to decode section title"))?,
                summary: section_row
                    .try_get::<String, _>("summary")
                    .map_err(|error| map_sqlx(error, "failed to decode section summary"))?,
                claims,
            });
        }

        Ok(Some(DailyBrief {
            brief_id,
            user_id: brief_row
                .try_get::<Uuid, _>("user_id")
                .map_err(|error| map_sqlx(error, "failed to decode brief user"))?,
            brief_date: brief_row
                .try_get::<NaiveDate, _>("brief_date")
                .map_err(|error| map_sqlx(error, "failed to decode brief date"))?,
            generated_at: brief_row
                .try_get::<DateTime<Utc>, _>("generated_at")
                .map_err(|error| map_sqlx(error, "failed to decode brief generated_at"))?,
            sections,
            required_reads: required_reads.into_iter().take(7).collect(),
        }))
    }

    pub async fn list_brief_delta_items(
        &self,
        user_id: Uuid,
        limit: usize,
    ) -> Result<Vec<String>, AppError> {
        let rows = sqlx::query(
            r#"
            SELECT c.statement
            FROM imperium_brief_claim c
            JOIN imperium_brief_section s ON s.id = c.section_id
            JOIN imperium_daily_brief b ON b.id = s.brief_id
            WHERE b.user_id = $1
            ORDER BY b.generated_at DESC, s.display_order ASC, c.created_at DESC
            LIMIT $2
            "#,
        )
        .bind(user_id)
        .bind(i64::try_from(limit).unwrap_or(20))
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load brief delta items"))?;

        rows.into_iter()
            .map(|row| {
                row.try_get::<String, _>("statement")
                    .map_err(|error| map_sqlx(error, "failed to decode brief delta statement"))
            })
            .collect()
    }

    async fn load_business_overview_with_offset(
        &self,
        user_id: Uuid,
        offset: usize,
    ) -> Result<Option<BusinessOverview>, AppError> {
        let Some((entity_id, entity_name)) = self.latest_business_entity(user_id).await? else {
            return Ok(None);
        };

        let metric_date_row = sqlx::query(
            r#"
            SELECT metric_date
            FROM imperium_business_metric
            WHERE entity_id = $1
            GROUP BY metric_date
            ORDER BY metric_date DESC
            OFFSET $2
            LIMIT 1
            "#,
        )
        .bind(entity_id)
        .bind(i64::try_from(offset).unwrap_or(0))
        .fetch_optional(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load business overview date"))?;

        let Some(metric_date_row) = metric_date_row else {
            return Ok(None);
        };

        let metric_date = metric_date_row
            .try_get::<NaiveDate, _>("metric_date")
            .map_err(|error| map_sqlx(error, "failed to decode overview metric date"))?;

        let metric_rows = sqlx::query(
            r#"
            SELECT metric_key, metric_value::float8 AS metric_value
            FROM imperium_business_metric
            WHERE entity_id = $1
              AND metric_date = $2
            "#,
        )
        .bind(entity_id)
        .bind(metric_date)
        .fetch_all(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load business overview metrics"))?;

        let metrics_map = metric_rows
            .into_iter()
            .map(|row| {
                let key = row
                    .try_get::<String, _>("metric_key")
                    .map_err(|error| map_sqlx(error, "failed to decode business metric key"))?;
                let value = row
                    .try_get::<f64, _>("metric_value")
                    .map_err(|error| map_sqlx(error, "failed to decode business metric value"))?;
                Ok((key, value))
            })
            .collect::<Result<std::collections::HashMap<_, _>, AppError>>()?;

        let as_of = metric_date
            .and_hms_opt(0, 0, 0)
            .map(|naive| Utc.from_utc_datetime(&naive))
            .unwrap_or_else(Utc::now);

        Ok(Some(BusinessOverview {
            as_of,
            entity_name,
            mrr: *metrics_map.get("mrr").unwrap_or(&0.0),
            burn: *metrics_map.get("burn").unwrap_or(&0.0),
            runway_months: *metrics_map.get("runway_months").unwrap_or(&0.0),
            cash_balance: *metrics_map.get("cash_balance").unwrap_or(&0.0),
            overdue_invoices: metrics_map
                .get("overdue_invoices")
                .copied()
                .unwrap_or(0.0)
                .max(0.0)
                .round() as usize,
        }))
    }

    async fn latest_business_entity(
        &self,
        user_id: Uuid,
    ) -> Result<Option<(Uuid, String)>, AppError> {
        let row = sqlx::query(
            r#"
            SELECT id, name
            FROM imperium_business_entity
            WHERE user_id = $1
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 1
            "#,
        )
        .bind(user_id)
        .fetch_optional(self.database.pool())
        .await
        .map_err(|error| map_sqlx(error, "failed to load business entity"))?;

        let Some(row) = row else {
            return Ok(None);
        };

        Ok(Some((
            row.try_get::<Uuid, _>("id")
                .map_err(|error| map_sqlx(error, "failed to decode business entity id"))?,
            row.try_get::<String, _>("name")
                .map_err(|error| map_sqlx(error, "failed to decode business entity name"))?,
        )))
    }

    async fn ensure_business_entity(
        &self,
        user_id: Uuid,
        entity_name: &str,
    ) -> Result<Uuid, AppError> {
        if let Some((entity_id, _)) = self.latest_business_entity(user_id).await? {
            return Ok(entity_id);
        }

        sqlx::query(
            r#"
            INSERT INTO imperium_business_entity (user_id, name, currency)
            VALUES ($1, $2, 'USD')
            RETURNING id
            "#,
        )
        .bind(user_id)
        .bind(entity_name)
        .fetch_one(self.database.pool())
        .await
        .and_then(|row| row.try_get::<Uuid, _>("id"))
        .map_err(|error| map_sqlx(error, "failed to create business entity"))
    }

    async fn upsert_market_symbol(
        &self,
        symbol: &str,
        asset_class: &str,
    ) -> Result<Uuid, AppError> {
        sqlx::query(
            r#"
            INSERT INTO imperium_market_symbol (symbol, asset_class, is_active)
            VALUES (UPPER($1), $2, true)
            ON CONFLICT (symbol) DO UPDATE SET
              asset_class = EXCLUDED.asset_class,
              updated_at = now()
            RETURNING id
            "#,
        )
        .bind(symbol)
        .bind(asset_class)
        .fetch_one(self.database.pool())
        .await
        .and_then(|row| row.try_get::<Uuid, _>("id"))
        .map_err(|error| map_sqlx(error, "failed to upsert market symbol"))
    }
}

fn map_sqlx(error: sqlx::Error, context: &str) -> AppError {
    AppError::dependency(format!("{context}: {error}"))
}

fn map_dead_letter_row(row: sqlx::postgres::PgRow) -> Result<DeadLetterEventRecord, AppError> {
    Ok(DeadLetterEventRecord {
        event_id: row
            .try_get::<Uuid, _>("id")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter id"))?,
        worker_role: row
            .try_get::<String, _>("worker_role")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter role"))?,
        subject: row
            .try_get::<String, _>("subject")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter subject"))?,
        payload: row
            .try_get::<serde_json::Value, _>("payload")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter payload"))?,
        error_message: row
            .try_get::<String, _>("error_message")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter error"))?,
        retry_count: row
            .try_get::<i32, _>("retry_count")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter retries"))?,
        status: row
            .try_get::<String, _>("status")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter status"))?,
        first_failed_at: row
            .try_get::<DateTime<Utc>, _>("first_failed_at")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter first_failed_at"))?,
        last_failed_at: row
            .try_get::<DateTime<Utc>, _>("last_failed_at")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter last_failed_at"))?,
        replayed_at: row
            .try_get::<Option<DateTime<Utc>>, _>("replayed_at")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter replayed_at"))?,
        replayed_by: row
            .try_get::<Option<String>, _>("replayed_by")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter replayed_by"))?,
        created_at: row
            .try_get::<DateTime<Utc>, _>("created_at")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter created_at"))?,
        updated_at: row
            .try_get::<DateTime<Utc>, _>("updated_at")
            .map_err(|error| map_sqlx(error, "failed to decode dead-letter updated_at"))?,
    })
}

fn infer_asset_class(symbol: &str) -> &'static str {
    if symbol.ends_with("USD") && symbol.len() >= 6 {
        return "crypto";
    }

    if symbol.contains('/') {
        return "fx";
    }

    "equity"
}

fn regime_to_db_key(regime: MarketRegime) -> &'static str {
    match regime {
        MarketRegime::RiskOn => "risk_on",
        MarketRegime::RiskOff => "risk_off",
        MarketRegime::Neutral => "neutral",
    }
}

fn regime_from_db_key(key: &str) -> MarketRegime {
    match key {
        "risk_on" => MarketRegime::RiskOn,
        "risk_off" => MarketRegime::RiskOff,
        _ => MarketRegime::Neutral,
    }
}

fn map_playbook_row(user_id: Uuid, row: sqlx::postgres::PgRow) -> Result<Playbook, AppError> {
    let trigger_definition = row
        .try_get::<serde_json::Value, _>("trigger_definition")
        .map_err(|error| map_sqlx(error, "failed to decode playbook trigger"))?;
    let response_steps = row
        .try_get::<serde_json::Value, _>("response_steps")
        .map_err(|error| map_sqlx(error, "failed to decode playbook steps"))?;

    let trigger = trigger_definition
        .get("expression")
        .and_then(serde_json::Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| trigger_definition.to_string());

    let response_steps = response_steps
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(Playbook {
        playbook_id: row
            .try_get::<Uuid, _>("id")
            .map_err(|error| map_sqlx(error, "failed to decode playbook id"))?,
        user_id,
        title: row
            .try_get::<String, _>("title")
            .map_err(|error| map_sqlx(error, "failed to decode playbook title"))?,
        trigger,
        response_steps,
        enabled: row
            .try_get::<bool, _>("is_enabled")
            .map_err(|error| map_sqlx(error, "failed to decode playbook status"))?,
        created_at: row
            .try_get::<DateTime<Utc>, _>("created_at")
            .map_err(|error| map_sqlx(error, "failed to decode playbook timestamp"))?,
    })
}
