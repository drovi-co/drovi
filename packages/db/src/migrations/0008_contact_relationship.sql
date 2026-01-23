-- Contact Relationship Table
-- Facebook-style social graph for contacts

-- Create enums
DO $$ BEGIN
    CREATE TYPE "contact_relationship_type" AS ENUM (
        'communicates_with',
        'works_with',
        'reports_to',
        'introduced_by',
        'collaborates_with'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "contact_relationship_source" AS ENUM (
        'inferred',
        'user_defined',
        'imported'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create table
CREATE TABLE IF NOT EXISTS "contact_relationship" (
    "id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
    "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
    "contact_a_id" text NOT NULL REFERENCES "contact"("id") ON DELETE CASCADE,
    "contact_b_id" text NOT NULL REFERENCES "contact"("id") ON DELETE CASCADE,
    "relationship_type" "contact_relationship_type" NOT NULL DEFAULT 'communicates_with',
    "strength" real NOT NULL DEFAULT 0.5,
    "message_count" integer NOT NULL DEFAULT 0,
    "last_interaction_at" timestamp,
    "first_interaction_at" timestamp,
    "avg_response_time_minutes" real,
    "sentiment_score" real,
    "shared_topics" text[] DEFAULT '{}',
    "source" "contact_relationship_source" NOT NULL DEFAULT 'inferred',
    "confidence" real NOT NULL DEFAULT 0.5,
    "last_synced_to_graph_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "contact_rel_org_idx" ON "contact_relationship" ("organization_id");
CREATE INDEX IF NOT EXISTS "contact_rel_a_idx" ON "contact_relationship" ("contact_a_id");
CREATE INDEX IF NOT EXISTS "contact_rel_b_idx" ON "contact_relationship" ("contact_b_id");
CREATE INDEX IF NOT EXISTS "contact_rel_strength_idx" ON "contact_relationship" ("strength" DESC);
CREATE INDEX IF NOT EXISTS "contact_rel_type_idx" ON "contact_relationship" ("relationship_type");
CREATE INDEX IF NOT EXISTS "contact_rel_last_interaction_idx" ON "contact_relationship" ("last_interaction_at");

-- Unique constraint: one relationship type per contact pair per org
CREATE UNIQUE INDEX IF NOT EXISTS "contact_rel_unique" ON "contact_relationship" (
    "organization_id",
    "contact_a_id",
    "contact_b_id",
    "relationship_type"
);
