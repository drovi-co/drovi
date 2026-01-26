-- Migration: Archive Legacy Tables
-- Description: Rename legacy commitment/decision/claim tables to archived versions
-- WARNING: Only run this AFTER verifying all data has been migrated to UIOs
--
-- Pre-requisites:
-- 1. Run scripts/migrate-to-uio.ts to migrate all data
-- 2. Verify no unmigrated records: SELECT COUNT(*) FROM commitment WHERE unified_object_id IS NULL
-- 3. Verify UIO counts match legacy counts
--
-- This migration is REVERSIBLE - data is preserved in _archive tables

-- Safety check: Ensure no unmigrated commitments exist
DO $$
DECLARE
  unmigrated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO unmigrated_count FROM commitment WHERE unified_object_id IS NULL;
  IF unmigrated_count > 0 THEN
    RAISE EXCEPTION 'Cannot archive: % commitments have not been migrated to UIOs', unmigrated_count;
  END IF;
END $$;

-- Safety check: Ensure no unmigrated decisions exist
DO $$
DECLARE
  unmigrated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO unmigrated_count FROM decision WHERE unified_object_id IS NULL;
  IF unmigrated_count > 0 THEN
    RAISE EXCEPTION 'Cannot archive: % decisions have not been migrated to UIOs', unmigrated_count;
  END IF;
END $$;

-- Safety check: Ensure no unmigrated tasks exist
DO $$
DECLARE
  unmigrated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO unmigrated_count FROM task WHERE source_uio_id IS NULL;
  IF unmigrated_count > 0 THEN
    RAISE EXCEPTION 'Cannot archive: % tasks have not been migrated to UIOs', unmigrated_count;
  END IF;
END $$;

-- Archive commitment table
ALTER TABLE IF EXISTS commitment RENAME TO _archive_commitment;

-- Archive decision table
ALTER TABLE IF EXISTS decision RENAME TO _archive_decision;

-- Archive claim table (may not have unified_object_id column)
ALTER TABLE IF EXISTS claim RENAME TO _archive_claim;

-- Archive task table and related tables
ALTER TABLE IF EXISTS task RENAME TO _archive_task;
ALTER TABLE IF EXISTS task_activity RENAME TO _archive_task_activity;
ALTER TABLE IF EXISTS task_label RENAME TO _archive_task_label;
ALTER TABLE IF EXISTS task_label_junction RENAME TO _archive_task_label_junction;

-- Drop old indexes to avoid naming conflicts if tables are recreated
DROP INDEX IF EXISTS commitment_organization_idx;
DROP INDEX IF EXISTS commitment_direction_idx;
DROP INDEX IF EXISTS commitment_status_idx;
DROP INDEX IF EXISTS commitment_due_date_idx;
DROP INDEX IF EXISTS decision_organization_idx;
DROP INDEX IF EXISTS claim_organization_idx;
DROP INDEX IF EXISTS claim_conversation_idx;
DROP INDEX IF EXISTS task_organization_idx;
DROP INDEX IF EXISTS task_status_idx;
DROP INDEX IF EXISTS task_assignee_idx;
DROP INDEX IF EXISTS task_due_date_idx;

-- Add comment to archived tables
COMMENT ON TABLE _archive_commitment IS 'Archived legacy commitment table. Data migrated to unified_intelligence_object + uio_commitment_details';
COMMENT ON TABLE _archive_decision IS 'Archived legacy decision table. Data migrated to unified_intelligence_object + uio_decision_details';
COMMENT ON TABLE _archive_claim IS 'Archived legacy claim table. Data migrated to unified_intelligence_object + uio_claim_details';
COMMENT ON TABLE _archive_task IS 'Archived legacy task table. Data migrated to unified_intelligence_object + uio_task_details';
COMMENT ON TABLE _archive_task_activity IS 'Archived legacy task_activity table';
COMMENT ON TABLE _archive_task_label IS 'Archived legacy task_label table';
COMMENT ON TABLE _archive_task_label_junction IS 'Archived legacy task_label_junction table';

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Legacy tables archived successfully:';
  RAISE NOTICE '  - commitment -> _archive_commitment';
  RAISE NOTICE '  - decision -> _archive_decision';
  RAISE NOTICE '  - claim -> _archive_claim';
  RAISE NOTICE '  - task -> _archive_task';
  RAISE NOTICE '  - task_activity -> _archive_task_activity';
  RAISE NOTICE '  - task_label -> _archive_task_label';
  RAISE NOTICE '  - task_label_junction -> _archive_task_label_junction';
  RAISE NOTICE '';
  RAISE NOTICE 'To restore, run:';
  RAISE NOTICE '  ALTER TABLE _archive_commitment RENAME TO commitment;';
  RAISE NOTICE '  ALTER TABLE _archive_decision RENAME TO decision;';
  RAISE NOTICE '  ALTER TABLE _archive_claim RENAME TO claim;';
  RAISE NOTICE '  ALTER TABLE _archive_task RENAME TO task;';
  RAISE NOTICE '  ALTER TABLE _archive_task_activity RENAME TO task_activity;';
  RAISE NOTICE '  ALTER TABLE _archive_task_label RENAME TO task_label;';
  RAISE NOTICE '  ALTER TABLE _archive_task_label_junction RENAME TO task_label_junction;';
END $$;
