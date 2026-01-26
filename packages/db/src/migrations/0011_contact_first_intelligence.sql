-- =============================================================================
-- Contact-First Intelligence System Migration
-- =============================================================================
-- Enables cross-source identity linking, CRM integration, and proactive alerts.
-- Part of the Contact-First Intelligence paradigm shift.
-- =============================================================================

-- =============================================================================
-- PART 1: NEW ENUMS
-- =============================================================================

-- Identity types for cross-source linking
DO $$ BEGIN
    CREATE TYPE "identity_type" AS ENUM (
        'email',
        'email_alias',
        'slack_id',
        'slack_handle',
        'phone',
        'whatsapp_id',
        'crm_salesforce',
        'crm_hubspot',
        'crm_pipedrive',
        'crm_zoho',
        'linkedin_url',
        'twitter_handle',
        'github_username',
        'notion_user_id',
        'google_id',
        'calendar_attendee_id',
        'external_id'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- How identities are discovered
DO $$ BEGIN
    CREATE TYPE "identity_source" AS ENUM (
        'email_header',
        'slack_profile',
        'crm_sync',
        'calendar_invite',
        'manual',
        'ai_inference',
        'oauth_profile',
        'api_enrichment'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Contact sync status
DO $$ BEGIN
    CREATE TYPE "contact_sync_status" AS ENUM (
        'synced',
        'pending_push',
        'pending_pull',
        'conflict',
        'error',
        'disconnected'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- External record types (for CRM)
DO $$ BEGIN
    CREATE TYPE "external_record_type" AS ENUM (
        'contact',
        'lead',
        'account',
        'person',
        'user',
        'participant',
        'member'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Alert types
DO $$ BEGIN
    CREATE TYPE "contact_alert_type" AS ENUM (
        'vip_silence',
        'relationship_degradation',
        'long_silence',
        'engagement_spike',
        'commitment_breach_pattern',
        'pending_commitment_risk',
        'decision_reversal',
        'decision_delay',
        'reengagement_opportunity',
        'introduction_opportunity',
        'deal_risk',
        'duplicate_detected',
        'missing_data',
        'stale_data'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Alert severity
DO $$ BEGIN
    CREATE TYPE "alert_severity" AS ENUM (
        'low',
        'medium',
        'high',
        'critical'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Alert status
DO $$ BEGIN
    CREATE TYPE "alert_status" AS ENUM (
        'active',
        'acknowledged',
        'snoozed',
        'resolved',
        'dismissed',
        'auto_resolved'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Contact lifecycle stage
DO $$ BEGIN
    CREATE TYPE "lifecycle_stage" AS ENUM (
        'unknown',
        'lead',
        'prospect',
        'opportunity',
        'customer',
        'churned',
        'partner',
        'vendor',
        'colleague'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Contact role type
DO $$ BEGIN
    CREATE TYPE "role_type" AS ENUM (
        'unknown',
        'decision_maker',
        'influencer',
        'gatekeeper',
        'champion',
        'end_user',
        'evaluator',
        'blocker'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Seniority level
DO $$ BEGIN
    CREATE TYPE "seniority_level" AS ENUM (
        'unknown',
        'intern',
        'ic',
        'manager',
        'senior_manager',
        'director',
        'vp',
        'c_level',
        'founder'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- PART 2: EXTEND SOURCE_TYPE ENUM FOR CRM
-- =============================================================================

-- Add CRM source types (if not already present)
DO $$ BEGIN
    ALTER TYPE "source_type" ADD VALUE IF NOT EXISTS 'crm_salesforce';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "source_type" ADD VALUE IF NOT EXISTS 'crm_hubspot';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "source_type" ADD VALUE IF NOT EXISTS 'crm_pipedrive';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TYPE "source_type" ADD VALUE IF NOT EXISTS 'crm_zoho';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- PART 3: CONTACT IDENTITY TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "contact_identity" (
    "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
    "contact_id" text NOT NULL REFERENCES "contact"("id") ON DELETE CASCADE,
    "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "identity_type" "identity_type" NOT NULL,
    "identity_value" text NOT NULL,
    "confidence" real NOT NULL DEFAULT 1.0,
    "is_verified" boolean DEFAULT false,
    "verified_at" timestamp,
    "verified_by" text,
    "source" "identity_source",
    "source_account_id" text REFERENCES "source_account"("id") ON DELETE SET NULL,
    "last_seen_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes for contact_identity
CREATE UNIQUE INDEX IF NOT EXISTS "contact_identity_org_type_value_unique"
    ON "contact_identity" ("organization_id", "identity_type", "identity_value");
CREATE INDEX IF NOT EXISTS "contact_identity_contact_idx"
    ON "contact_identity" ("contact_id");
CREATE INDEX IF NOT EXISTS "contact_identity_org_idx"
    ON "contact_identity" ("organization_id");
CREATE INDEX IF NOT EXISTS "contact_identity_type_idx"
    ON "contact_identity" ("identity_type");
CREATE INDEX IF NOT EXISTS "contact_identity_confidence_idx"
    ON "contact_identity" ("confidence");
CREATE INDEX IF NOT EXISTS "contact_identity_source_account_idx"
    ON "contact_identity" ("source_account_id");

-- =============================================================================
-- PART 4: CONTACT SOURCE LINK TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "contact_source_link" (
    "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
    "contact_id" text NOT NULL REFERENCES "contact"("id") ON DELETE CASCADE,
    "source_account_id" text NOT NULL REFERENCES "source_account"("id") ON DELETE CASCADE,
    "external_id" text NOT NULL,
    "external_type" "external_record_type" DEFAULT 'contact',
    "external_url" text,
    "sync_status" "contact_sync_status" DEFAULT 'synced',
    "last_pulled_at" timestamp,
    "last_pushed_at" timestamp,
    "last_sync_error" text,
    "field_mapping" jsonb,
    "external_snapshot" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes for contact_source_link
CREATE UNIQUE INDEX IF NOT EXISTS "contact_source_link_unique"
    ON "contact_source_link" ("source_account_id", "external_id");
CREATE INDEX IF NOT EXISTS "contact_source_link_contact_idx"
    ON "contact_source_link" ("contact_id");
CREATE INDEX IF NOT EXISTS "contact_source_link_source_idx"
    ON "contact_source_link" ("source_account_id");
CREATE INDEX IF NOT EXISTS "contact_source_link_sync_status_idx"
    ON "contact_source_link" ("sync_status");
CREATE INDEX IF NOT EXISTS "contact_source_link_external_id_idx"
    ON "contact_source_link" ("external_id");

-- =============================================================================
-- PART 5: CONTACT ALERT TABLE
-- =============================================================================

CREATE TABLE IF NOT EXISTS "contact_alert" (
    "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
    "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "contact_id" text NOT NULL REFERENCES "contact"("id") ON DELETE CASCADE,
    "alert_type" "contact_alert_type" NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "message" text NOT NULL,
    "description" text,
    "status" "alert_status" NOT NULL DEFAULT 'active',
    "acknowledged_at" timestamp,
    "acknowledged_by" text REFERENCES "user"("id") ON DELETE SET NULL,
    "resolved_at" timestamp,
    "resolved_by" text REFERENCES "user"("id") ON DELETE SET NULL,
    "dismissed_at" timestamp,
    "dismissed_by" text REFERENCES "user"("id") ON DELETE SET NULL,
    "dismiss_reason" text,
    "snooze_config" jsonb,
    "context" jsonb,
    "alert_key" text,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "expires_at" timestamp
);

-- Indexes for contact_alert
CREATE INDEX IF NOT EXISTS "contact_alert_org_idx"
    ON "contact_alert" ("organization_id");
CREATE INDEX IF NOT EXISTS "contact_alert_contact_idx"
    ON "contact_alert" ("contact_id");
CREATE INDEX IF NOT EXISTS "contact_alert_type_idx"
    ON "contact_alert" ("alert_type");
CREATE INDEX IF NOT EXISTS "contact_alert_severity_idx"
    ON "contact_alert" ("severity");
CREATE INDEX IF NOT EXISTS "contact_alert_status_idx"
    ON "contact_alert" ("status");
CREATE INDEX IF NOT EXISTS "contact_alert_org_status_severity_idx"
    ON "contact_alert" ("organization_id", "status", "severity");
CREATE INDEX IF NOT EXISTS "contact_alert_key_idx"
    ON "contact_alert" ("alert_key");
CREATE INDEX IF NOT EXISTS "contact_alert_expires_idx"
    ON "contact_alert" ("expires_at");

-- =============================================================================
-- PART 6: EXTEND CONTACT TABLE WITH INTELLIGENCE FIELDS
-- =============================================================================

-- Add lifecycle and role columns
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "lifecycle_stage" "lifecycle_stage" DEFAULT 'unknown';
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "lifecycle_stage_confidence" real;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "role_type" "role_type" DEFAULT 'unknown';
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "role_type_confidence" real;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "seniority_level" "seniority_level" DEFAULT 'unknown';
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "seniority_confidence" real;

-- Add graph analytics columns
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "influence_score" real;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "bridging_score" real;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "community_ids" text[] DEFAULT '{}';

-- Add communication profile
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "communication_profile" jsonb;

-- Add intelligence tracking
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "last_intelligence_at" timestamp;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "intelligence_version" text;

-- Add indexes for new contact columns
CREATE INDEX IF NOT EXISTS "contact_lifecycle_stage_idx" ON "contact" ("lifecycle_stage");
CREATE INDEX IF NOT EXISTS "contact_role_type_idx" ON "contact" ("role_type");
CREATE INDEX IF NOT EXISTS "contact_influence_score_idx" ON "contact" ("influence_score");
CREATE INDEX IF NOT EXISTS "contact_bridging_score_idx" ON "contact" ("bridging_score");
CREATE INDEX IF NOT EXISTS "contact_last_intelligence_idx" ON "contact" ("last_intelligence_at");

-- =============================================================================
-- PART 7: HELPER FUNCTION FOR IDENTITY RESOLUTION
-- =============================================================================

-- Function to resolve an identity to a contact ID
CREATE OR REPLACE FUNCTION resolve_contact_identity(
    p_org_id text,
    p_identity_type "identity_type",
    p_identity_value text
) RETURNS text AS $$
DECLARE
    v_contact_id text;
BEGIN
    SELECT contact_id INTO v_contact_id
    FROM contact_identity
    WHERE organization_id = p_org_id
      AND identity_type = p_identity_type
      AND identity_value = p_identity_value
    ORDER BY confidence DESC
    LIMIT 1;

    RETURN v_contact_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get all identities for a contact
CREATE OR REPLACE FUNCTION get_contact_identities(p_contact_id text)
RETURNS TABLE (
    identity_type "identity_type",
    identity_value text,
    confidence real,
    is_verified boolean
) AS $$
BEGIN
    RETURN QUERY
    SELECT ci.identity_type, ci.identity_value, ci.confidence, ci.is_verified
    FROM contact_identity ci
    WHERE ci.contact_id = p_contact_id
    ORDER BY ci.confidence DESC;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
