-- Migration: UIO Extension Tables
-- Adds type-specific extension tables for UIOs (1:1 relationship)
-- Adds new UIO types: claim, task, risk, brief

-- =============================================================================
-- STEP 1: Add new UIO types to enum
-- =============================================================================

-- Add new types to the enum (PostgreSQL allows adding values but not removing)
ALTER TYPE unified_object_type ADD VALUE IF NOT EXISTS 'claim';
ALTER TYPE unified_object_type ADD VALUE IF NOT EXISTS 'task';
ALTER TYPE unified_object_type ADD VALUE IF NOT EXISTS 'risk';
ALTER TYPE unified_object_type ADD VALUE IF NOT EXISTS 'brief';

-- =============================================================================
-- STEP 2: Create new enums for extension tables
-- =============================================================================

-- Task status enum
DO $$ BEGIN
    CREATE TYPE uio_task_status AS ENUM (
        'backlog',
        'todo',
        'in_progress',
        'in_review',
        'done',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Task priority enum
DO $$ BEGIN
    CREATE TYPE uio_task_priority AS ENUM (
        'no_priority',
        'low',
        'medium',
        'high',
        'urgent'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Risk type enum
DO $$ BEGIN
    CREATE TYPE uio_risk_type AS ENUM (
        'deadline_risk',
        'commitment_conflict',
        'unclear_ownership',
        'missing_information',
        'escalation_needed',
        'policy_violation',
        'financial_risk',
        'relationship_risk',
        'sensitive_data',
        'contradiction',
        'fraud_signal',
        'other'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Risk severity enum
DO $$ BEGIN
    CREATE TYPE uio_risk_severity AS ENUM (
        'low',
        'medium',
        'high',
        'critical'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Decision status enum
DO $$ BEGIN
    CREATE TYPE uio_decision_status AS ENUM (
        'made',
        'pending',
        'deferred',
        'reversed'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Brief suggested action enum
DO $$ BEGIN
    CREATE TYPE uio_brief_action AS ENUM (
        'respond',
        'review',
        'delegate',
        'schedule',
        'wait',
        'escalate',
        'archive',
        'follow_up',
        'none'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Brief priority tier enum
DO $$ BEGIN
    CREATE TYPE uio_brief_priority AS ENUM (
        'urgent',
        'high',
        'medium',
        'low'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =============================================================================
-- STEP 3: Create extension tables
-- =============================================================================

-- Commitment details table
CREATE TABLE IF NOT EXISTS uio_commitment_details (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    uio_id TEXT NOT NULL UNIQUE REFERENCES unified_intelligence_object(id) ON DELETE CASCADE,

    -- Direction - who owes whom
    direction TEXT NOT NULL, -- "owed_by_me" | "owed_to_me"

    -- Parties (resolved to Contact IDs)
    debtor_contact_id TEXT REFERENCES contact(id) ON DELETE SET NULL,
    creditor_contact_id TEXT REFERENCES contact(id) ON DELETE SET NULL,

    -- Due date sourcing
    due_date_source TEXT, -- "explicit" | "inferred" | "user_set"
    due_date_original_text TEXT,

    -- Priority and status
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'pending',

    -- Conditional commitments
    is_conditional BOOLEAN DEFAULT FALSE,
    condition TEXT,

    -- Completion tracking
    completed_at TIMESTAMP,
    completed_via TEXT,

    -- Snooze support
    snoozed_until TIMESTAMP,

    -- LLM extraction context
    extraction_context JSONB,

    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Decision details table
CREATE TABLE IF NOT EXISTS uio_decision_details (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    uio_id TEXT NOT NULL UNIQUE REFERENCES unified_intelligence_object(id) ON DELETE CASCADE,

    -- Decision content
    statement TEXT NOT NULL,
    rationale TEXT,

    -- Alternatives considered
    alternatives JSONB,

    -- Decision maker
    decision_maker_contact_id TEXT REFERENCES contact(id) ON DELETE SET NULL,

    -- Stakeholders
    stakeholder_contact_ids TEXT[] DEFAULT '{}',
    impact_areas TEXT[] DEFAULT '{}',

    -- Status
    status uio_decision_status NOT NULL DEFAULT 'made',

    -- When decided
    decided_at TIMESTAMP,

    -- Supersession chain
    supersedes_uio_id TEXT,
    superseded_by_uio_id TEXT,

    -- LLM extraction context
    extraction_context JSONB,

    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Claim details table
CREATE TABLE IF NOT EXISTS uio_claim_details (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    uio_id TEXT NOT NULL UNIQUE REFERENCES unified_intelligence_object(id) ON DELETE CASCADE,

    -- Claim type
    claim_type TEXT NOT NULL,

    -- Evidence
    quoted_text TEXT,
    quoted_text_start TEXT,
    quoted_text_end TEXT,
    normalized_text TEXT,

    -- Importance
    importance TEXT DEFAULT 'medium',

    -- Source tracking
    source_message_index TEXT,

    -- LLM extraction context
    extraction_context JSONB,

    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Task details table
CREATE TABLE IF NOT EXISTS uio_task_details (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    uio_id TEXT NOT NULL UNIQUE REFERENCES unified_intelligence_object(id) ON DELETE CASCADE,

    -- Status and priority
    status uio_task_status NOT NULL DEFAULT 'todo',
    priority uio_task_priority NOT NULL DEFAULT 'medium',

    -- Ownership
    assignee_contact_id TEXT REFERENCES contact(id) ON DELETE SET NULL,
    created_by_contact_id TEXT REFERENCES contact(id) ON DELETE SET NULL,

    -- Timeline
    estimated_effort TEXT,
    completed_at TIMESTAMP,

    -- Dependencies (UIO IDs)
    depends_on_uio_ids TEXT[] DEFAULT '{}',
    blocks_uio_ids TEXT[] DEFAULT '{}',

    -- Hierarchy
    parent_task_uio_id TEXT,
    commitment_uio_id TEXT,

    -- Organization
    project TEXT,
    tags TEXT[] DEFAULT '{}',

    -- User overrides
    user_overrides JSONB,

    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Risk details table
CREATE TABLE IF NOT EXISTS uio_risk_details (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    uio_id TEXT NOT NULL UNIQUE REFERENCES unified_intelligence_object(id) ON DELETE CASCADE,

    -- Risk classification
    risk_type uio_risk_type NOT NULL,
    severity uio_risk_severity NOT NULL,

    -- Related UIOs
    related_commitment_uio_ids TEXT[] DEFAULT '{}',
    related_decision_uio_ids TEXT[] DEFAULT '{}',

    -- Action
    suggested_action TEXT,

    -- Detailed findings
    findings JSONB,

    -- LLM extraction context
    extraction_context JSONB,

    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Brief details table
CREATE TABLE IF NOT EXISTS uio_brief_details (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    uio_id TEXT NOT NULL UNIQUE REFERENCES unified_intelligence_object(id) ON DELETE CASCADE,

    -- 3-line summary
    summary TEXT NOT NULL,

    -- Suggested action
    suggested_action uio_brief_action NOT NULL,
    action_reasoning TEXT,

    -- Open loops
    open_loops JSONB,

    -- Priority tier
    priority_tier uio_brief_priority NOT NULL,

    -- Classification scores
    urgency_score REAL DEFAULT 0,
    importance_score REAL DEFAULT 0,
    sentiment_score REAL DEFAULT 0,

    -- Intent
    intent_classification TEXT,

    -- Related conversation
    conversation_id TEXT REFERENCES conversation(id) ON DELETE SET NULL,

    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- =============================================================================
-- STEP 4: Create indexes
-- =============================================================================

-- Commitment details indexes
CREATE INDEX IF NOT EXISTS uio_commitment_details_uio_idx ON uio_commitment_details(uio_id);
CREATE INDEX IF NOT EXISTS uio_commitment_details_debtor_idx ON uio_commitment_details(debtor_contact_id);
CREATE INDEX IF NOT EXISTS uio_commitment_details_creditor_idx ON uio_commitment_details(creditor_contact_id);
CREATE INDEX IF NOT EXISTS uio_commitment_details_direction_idx ON uio_commitment_details(direction);
CREATE INDEX IF NOT EXISTS uio_commitment_details_status_idx ON uio_commitment_details(status);
CREATE INDEX IF NOT EXISTS uio_commitment_details_priority_idx ON uio_commitment_details(priority);

-- Decision details indexes
CREATE INDEX IF NOT EXISTS uio_decision_details_uio_idx ON uio_decision_details(uio_id);
CREATE INDEX IF NOT EXISTS uio_decision_details_maker_idx ON uio_decision_details(decision_maker_contact_id);
CREATE INDEX IF NOT EXISTS uio_decision_details_status_idx ON uio_decision_details(status);
CREATE INDEX IF NOT EXISTS uio_decision_details_supersedes_idx ON uio_decision_details(supersedes_uio_id);

-- Claim details indexes
CREATE INDEX IF NOT EXISTS uio_claim_details_uio_idx ON uio_claim_details(uio_id);
CREATE INDEX IF NOT EXISTS uio_claim_details_type_idx ON uio_claim_details(claim_type);
CREATE INDEX IF NOT EXISTS uio_claim_details_importance_idx ON uio_claim_details(importance);

-- Task details indexes
CREATE INDEX IF NOT EXISTS uio_task_details_uio_idx ON uio_task_details(uio_id);
CREATE INDEX IF NOT EXISTS uio_task_details_status_idx ON uio_task_details(status);
CREATE INDEX IF NOT EXISTS uio_task_details_priority_idx ON uio_task_details(priority);
CREATE INDEX IF NOT EXISTS uio_task_details_assignee_idx ON uio_task_details(assignee_contact_id);
CREATE INDEX IF NOT EXISTS uio_task_details_parent_idx ON uio_task_details(parent_task_uio_id);
CREATE INDEX IF NOT EXISTS uio_task_details_commitment_idx ON uio_task_details(commitment_uio_id);
CREATE INDEX IF NOT EXISTS uio_task_details_project_idx ON uio_task_details(project);

-- Risk details indexes
CREATE INDEX IF NOT EXISTS uio_risk_details_uio_idx ON uio_risk_details(uio_id);
CREATE INDEX IF NOT EXISTS uio_risk_details_type_idx ON uio_risk_details(risk_type);
CREATE INDEX IF NOT EXISTS uio_risk_details_severity_idx ON uio_risk_details(severity);

-- Brief details indexes
CREATE INDEX IF NOT EXISTS uio_brief_details_uio_idx ON uio_brief_details(uio_id);
CREATE INDEX IF NOT EXISTS uio_brief_details_action_idx ON uio_brief_details(suggested_action);
CREATE INDEX IF NOT EXISTS uio_brief_details_priority_idx ON uio_brief_details(priority_tier);
CREATE INDEX IF NOT EXISTS uio_brief_details_conversation_idx ON uio_brief_details(conversation_id);
CREATE INDEX IF NOT EXISTS uio_brief_details_urgency_idx ON uio_brief_details(urgency_score);
CREATE INDEX IF NOT EXISTS uio_brief_details_importance_idx ON uio_brief_details(importance_score);
