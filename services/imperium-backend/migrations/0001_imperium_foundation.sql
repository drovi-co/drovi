CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS imperium_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE,
  email TEXT UNIQUE,
  full_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_device (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  push_token TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imperium_device_user ON imperium_device(user_id);

-- ---------------------------------------------------------------------------
-- Watchlists and market symbols
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS imperium_watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS imperium_market_symbol (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL UNIQUE,
  asset_class TEXT NOT NULL,
  exchange TEXT,
  currency TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_watchlist_symbol (
  watchlist_id UUID NOT NULL REFERENCES imperium_watchlist(id) ON DELETE CASCADE,
  symbol_id UUID NOT NULL REFERENCES imperium_market_symbol(id) ON DELETE CASCADE,
  priority SMALLINT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (watchlist_id, symbol_id)
);

CREATE TABLE IF NOT EXISTS imperium_market_tick (
  id BIGSERIAL PRIMARY KEY,
  symbol_id UUID NOT NULL REFERENCES imperium_market_symbol(id) ON DELETE CASCADE,
  price NUMERIC(20, 8) NOT NULL,
  volume NUMERIC(20, 8),
  venue TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imperium_market_tick_symbol_time
  ON imperium_market_tick(symbol_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS imperium_market_candle (
  id BIGSERIAL PRIMARY KEY,
  symbol_id UUID NOT NULL REFERENCES imperium_market_symbol(id) ON DELETE CASCADE,
  interval_key TEXT NOT NULL,
  open NUMERIC(20, 8) NOT NULL,
  high NUMERIC(20, 8) NOT NULL,
  low NUMERIC(20, 8) NOT NULL,
  close NUMERIC(20, 8) NOT NULL,
  volume NUMERIC(20, 8),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol_id, interval_key, started_at)
);

CREATE INDEX IF NOT EXISTS idx_imperium_market_candle_symbol_interval_time
  ON imperium_market_candle(symbol_id, interval_key, started_at DESC);

CREATE TABLE IF NOT EXISTS imperium_market_indicator_snapshot (
  id BIGSERIAL PRIMARY KEY,
  symbol_id UUID NOT NULL REFERENCES imperium_market_symbol(id) ON DELETE CASCADE,
  interval_key TEXT NOT NULL,
  ema_20 NUMERIC(20, 8),
  ema_50 NUMERIC(20, 8),
  ema_200 NUMERIC(20, 8),
  rsi NUMERIC(10, 4),
  macd NUMERIC(20, 8),
  vwap NUMERIC(20, 8),
  as_of TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (symbol_id, interval_key, as_of)
);

-- ---------------------------------------------------------------------------
-- News and intelligence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS imperium_news_source (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  base_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_article (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES imperium_news_source(id) ON DELETE SET NULL,
  external_id TEXT,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  body_text TEXT,
  published_at TIMESTAMPTZ,
  confidence_score NUMERIC(5, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (canonical_url)
);

CREATE TABLE IF NOT EXISTS imperium_article_cluster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_key TEXT NOT NULL UNIQUE,
  headline TEXT,
  narrative_summary TEXT,
  impact_score NUMERIC(5, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_article_cluster_member (
  cluster_id UUID NOT NULL REFERENCES imperium_article_cluster(id) ON DELETE CASCADE,
  article_id UUID NOT NULL REFERENCES imperium_article(id) ON DELETE CASCADE,
  is_canonical BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cluster_id, article_id)
);

CREATE TABLE IF NOT EXISTS imperium_article_embedding (
  article_id UUID PRIMARY KEY REFERENCES imperium_article(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  model_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_article_impact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID NOT NULL REFERENCES imperium_article(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  impact_score NUMERIC(5, 4) NOT NULL,
  relevance_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_imperium_article_impact_user_score
  ON imperium_article_impact(user_id, impact_score DESC);

-- ---------------------------------------------------------------------------
-- Portfolio and business command
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS imperium_portfolio_account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  provider_key TEXT,
  provider_account_id TEXT,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  currency TEXT,
  is_manual BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider_key, provider_account_id)
);

CREATE TABLE IF NOT EXISTS imperium_portfolio_position (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES imperium_portfolio_account(id) ON DELETE CASCADE,
  symbol_id UUID REFERENCES imperium_market_symbol(id) ON DELETE SET NULL,
  symbol_text TEXT,
  quantity NUMERIC(24, 8) NOT NULL,
  average_cost NUMERIC(20, 8),
  market_value NUMERIC(20, 8),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imperium_portfolio_position_account
  ON imperium_portfolio_position(account_id);

CREATE TABLE IF NOT EXISTS imperium_portfolio_transaction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES imperium_portfolio_account(id) ON DELETE CASCADE,
  symbol_id UUID REFERENCES imperium_market_symbol(id) ON DELETE SET NULL,
  txn_type TEXT NOT NULL,
  quantity NUMERIC(24, 8),
  price NUMERIC(20, 8),
  amount NUMERIC(20, 8),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imperium_portfolio_txn_account_time
  ON imperium_portfolio_transaction(account_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS imperium_portfolio_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  total_net_worth NUMERIC(20, 8) NOT NULL,
  daily_change NUMERIC(20, 8),
  ytd_change NUMERIC(20, 8),
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, captured_at)
);

CREATE TABLE IF NOT EXISTS imperium_business_entity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  legal_structure TEXT,
  currency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_business_metric (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES imperium_business_entity(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  metric_value NUMERIC(20, 8) NOT NULL,
  metric_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_id, metric_key, metric_date)
);

CREATE TABLE IF NOT EXISTS imperium_invoice (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES imperium_business_entity(id) ON DELETE CASCADE,
  external_id TEXT,
  customer_name TEXT,
  amount_due NUMERIC(20, 8) NOT NULL,
  due_date DATE,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Alerts, briefing, journal, and risk
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS imperium_alert_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  condition_json JSONB NOT NULL,
  cooldown_seconds INTEGER NOT NULL DEFAULT 300,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_alert_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID REFERENCES imperium_alert_rule(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  what_happened TEXT NOT NULL,
  why_it_matters TEXT NOT NULL,
  what_to_watch_next TEXT NOT NULL,
  payload JSONB NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_imperium_alert_event_user_time
  ON imperium_alert_event(user_id, triggered_at DESC);

CREATE TABLE IF NOT EXISTS imperium_alert_delivery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_event_id UUID NOT NULL REFERENCES imperium_alert_event(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  delivery_status TEXT NOT NULL,
  delivered_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_daily_brief (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  brief_date DATE NOT NULL,
  confidence_score NUMERIC(5, 4),
  generated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, brief_date)
);

CREATE TABLE IF NOT EXISTS imperium_brief_section (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id UUID NOT NULL REFERENCES imperium_daily_brief(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  display_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brief_id, section_key)
);

CREATE TABLE IF NOT EXISTS imperium_brief_claim (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES imperium_brief_section(id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  impact_score NUMERIC(5, 4),
  confidence_score NUMERIC(5, 4),
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_brief_citation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID NOT NULL REFERENCES imperium_brief_claim(id) ON DELETE CASCADE,
  article_id UUID REFERENCES imperium_article(id) ON DELETE SET NULL,
  source_url TEXT,
  source_snippet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imperium_brief_citation_claim ON imperium_brief_citation(claim_id);

CREATE TABLE IF NOT EXISTS imperium_decision_thesis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position_summary TEXT,
  conviction_percent NUMERIC(5, 2),
  invalidation_criteria TEXT,
  review_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_playbook (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  trigger_definition JSONB NOT NULL,
  response_steps JSONB NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_regime_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  regime TEXT NOT NULL,
  confidence_score NUMERIC(5, 4) NOT NULL,
  explanation TEXT,
  as_of TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_risk_signal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  signal_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  details JSONB NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imperium_scenario_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES imperium_user(id) ON DELETE CASCADE,
  scenario_name TEXT NOT NULL,
  input_payload JSONB NOT NULL,
  output_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce citation requirement before publication.
CREATE OR REPLACE FUNCTION imperium_validate_published_claim_citations()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_published = true THEN
    IF NOT EXISTS (
      SELECT 1
      FROM imperium_brief_citation c
      WHERE c.claim_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'published claim % must have at least one citation', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_imperium_claim_citations ON imperium_brief_claim;
CREATE TRIGGER trg_imperium_claim_citations
  BEFORE UPDATE OF is_published
  ON imperium_brief_claim
  FOR EACH ROW
  EXECUTE FUNCTION imperium_validate_published_claim_citations();
