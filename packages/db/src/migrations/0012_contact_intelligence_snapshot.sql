-- =============================================================================
-- CONTACT INTELLIGENCE SNAPSHOT TABLE
-- =============================================================================
--
-- Migration: 0012_contact_intelligence_snapshot.sql
-- Purpose: Create table for storing historical contact intelligence snapshots
-- This enables trend analysis, anomaly detection, and historical reporting.
--

-- =============================================================================
-- CREATE TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS contact_intelligence_snapshot (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,

    -- When this snapshot was taken
    snapshot_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Snapshot period type
    period_type TEXT NOT NULL DEFAULT 'daily',

    -- Core scores (denormalized for fast queries)
    health_score REAL,
    importance_score REAL,
    engagement_score REAL,
    sentiment_score REAL,

    -- Relationship metrics
    interaction_count REAL,
    inbound_count REAL,
    outbound_count REAL,
    avg_response_time_minutes REAL,
    response_rate REAL,
    interactions_per_week REAL,

    -- Graph analytics
    pagerank_score REAL,
    bridging_score REAL,
    influence_score REAL,

    -- Lifecycle & Role
    lifecycle_stage TEXT,
    churn_risk_score REAL,
    role_type TEXT,

    -- Full intelligence data (JSONB)
    relationship_metrics JSONB,
    communication_profile JSONB,
    role_detection JSONB,
    lifecycle_detection JSONB,
    graph_analytics JSONB,
    brief JSONB,

    -- Analysis metadata
    analysis_id TEXT,
    analysis_duration_ms REAL,

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Fast lookup by contact + time range
CREATE INDEX IF NOT EXISTS contact_intelligence_snapshot_contact_time_idx
    ON contact_intelligence_snapshot(contact_id, snapshot_at);

-- Organization filter + time
CREATE INDEX IF NOT EXISTS contact_intelligence_snapshot_org_time_idx
    ON contact_intelligence_snapshot(organization_id, snapshot_at);

-- Period type filtering
CREATE INDEX IF NOT EXISTS contact_intelligence_snapshot_period_idx
    ON contact_intelligence_snapshot(period_type);

-- Health score trends
CREATE INDEX IF NOT EXISTS contact_intelligence_snapshot_health_idx
    ON contact_intelligence_snapshot(health_score);

-- Churn risk monitoring
CREATE INDEX IF NOT EXISTS contact_intelligence_snapshot_churn_idx
    ON contact_intelligence_snapshot(churn_risk_score);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE contact_intelligence_snapshot IS 'Historical snapshots of contact intelligence for trend analysis';
COMMENT ON COLUMN contact_intelligence_snapshot.period_type IS 'Snapshot period: daily, weekly, or monthly';
COMMENT ON COLUMN contact_intelligence_snapshot.relationship_metrics IS 'Full relationship metrics JSONB snapshot';
COMMENT ON COLUMN contact_intelligence_snapshot.brief IS 'Generated contact brief at time of snapshot';
