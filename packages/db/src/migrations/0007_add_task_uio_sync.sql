-- Migration: Add UIO sync fields to task table
-- This migration adds support for linking tasks directly to Unified Intelligence Objects
-- and tracking bidirectional sync state.

-- Add sourceUIOId column for direct UIO link
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "source_uio_id" text;

-- Add sync metadata columns
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "last_synced_from_uio" timestamp with time zone;
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "sync_enabled" boolean DEFAULT true;
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "user_overrides" jsonb DEFAULT '{}';

-- Add foreign key constraint for source_uio_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'task_source_uio_id_unified_intelligence_object_id_fk'
        AND table_name = 'task'
    ) THEN
        ALTER TABLE "task" ADD CONSTRAINT "task_source_uio_id_unified_intelligence_object_id_fk"
        FOREIGN KEY ("source_uio_id") REFERENCES "unified_intelligence_object"("id")
        ON DELETE CASCADE;
    END IF;
END $$;

-- Create index for source_uio_id
CREATE INDEX IF NOT EXISTS "task_source_uio_idx" ON "task" ("source_uio_id");

-- Create unique constraint for one task per UIO
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'task_uio_unique'
        AND table_name = 'task'
    ) THEN
        ALTER TABLE "task" ADD CONSTRAINT "task_uio_unique" UNIQUE ("source_uio_id");
    END IF;
END $$;
