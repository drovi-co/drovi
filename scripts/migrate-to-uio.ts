#!/usr/bin/env npx tsx
/**
 * UIO Data Migration Script
 *
 * Migrates existing data from legacy tables (commitment, decision, claim, task)
 * to Unified Intelligence Objects (UIOs) with their extension tables.
 *
 * Run with: npx tsx scripts/migrate-to-uio.ts
 *
 * This script:
 * 1. Migrates commitments → unified_intelligence_object + uio_commitment_details
 * 2. Migrates decisions → unified_intelligence_object + uio_decision_details
 * 3. Migrates claims → unified_intelligence_object + uio_claim_details
 * 4. Links source conversations to UIOs
 * 5. Creates timeline events for migration
 */

import { db } from "@memorystack/db";
import { sql, eq, isNull, and } from "drizzle-orm";
import { randomUUID } from "crypto";

// Types for legacy data
interface LegacyCommitment {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  direction: string;
  status: string;
  priority: string | null;
  dueDate: Date | null;
  dueDateOriginalText: string | null;
  confidence: number;
  isUserVerified: boolean | null;
  isUserDismissed: boolean | null;
  debtorId: string | null;
  creditorId: string | null;
  sourceAccountId: string | null;
  sourceConversationId: string | null;
  unifiedObjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface LegacyDecision {
  id: string;
  organizationId: string;
  title: string;
  statement: string | null;
  rationale: string | null;
  confidence: number;
  sourceAccountId: string | null;
  sourceConversationId: string | null;
  unifiedObjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface LegacyClaim {
  id: string;
  organizationId: string;
  type: string;
  text: string;
  confidence: number;
  conversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface LegacyTask {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  dueDate: Date | null;
  assigneeContactId: string | null;
  sourceType: string | null;
  sourceUioId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Stats tracking
const stats = {
  commitments: { total: 0, migrated: 0, skipped: 0, errors: 0 },
  decisions: { total: 0, migrated: 0, skipped: 0, errors: 0 },
  claims: { total: 0, migrated: 0, skipped: 0, errors: 0 },
  tasks: { total: 0, migrated: 0, skipped: 0, errors: 0 },
};

async function migrateCommitments(): Promise<void> {
  console.log("\n=== Migrating Commitments ===");

  // Get all commitments without a UIO link
  const legacyCommitments = await db.execute<LegacyCommitment>(sql`
    SELECT * FROM commitment
    WHERE unified_object_id IS NULL
    ORDER BY created_at ASC
  `);

  stats.commitments.total = legacyCommitments.rows.length;
  console.log(`Found ${stats.commitments.total} commitments to migrate`);

  for (const legacy of legacyCommitments.rows) {
    try {
      const uioId = randomUUID();
      const detailsId = randomUUID();
      const sourceId = randomUUID();
      const timelineId = randomUUID();
      const now = new Date();

      // Create base UIO
      await db.execute(sql`
        INSERT INTO unified_intelligence_object (
          id, organization_id, type, status,
          canonical_title, canonical_description,
          due_date, due_date_confidence,
          owner_contact_id, overall_confidence,
          is_user_verified, is_user_dismissed,
          first_seen_at, last_updated_at,
          created_at, updated_at
        ) VALUES (
          ${uioId}, ${legacy.organizationId}, 'commitment', 'active',
          ${legacy.title}, ${legacy.description},
          ${legacy.dueDate}, ${legacy.confidence},
          ${legacy.direction === "owed_by_me" ? legacy.creditorId : legacy.debtorId},
          ${legacy.confidence},
          ${legacy.isUserVerified ?? false}, ${legacy.isUserDismissed ?? false},
          ${legacy.createdAt}, ${now},
          ${legacy.createdAt}, ${now}
        )
      `);

      // Create commitment details extension
      await db.execute(sql`
        INSERT INTO uio_commitment_details (
          id, uio_id, direction,
          debtor_contact_id, creditor_contact_id,
          due_date_source, due_date_original_text,
          priority, status,
          created_at, updated_at
        ) VALUES (
          ${detailsId}, ${uioId}, ${legacy.direction},
          ${legacy.debtorId}, ${legacy.creditorId},
          'explicit', ${legacy.dueDateOriginalText},
          ${legacy.priority ?? "medium"}, ${legacy.status},
          ${legacy.createdAt}, ${now}
        )
      `);

      // Link to source conversation if exists
      if (legacy.sourceConversationId) {
        await db.execute(sql`
          INSERT INTO unified_object_source (
            id, unified_object_id, source_type,
            source_account_id, role,
            conversation_id, extracted_title,
            confidence, added_at, source_timestamp,
            detection_method, created_at
          ) VALUES (
            ${sourceId}, ${uioId}, 'email',
            ${legacy.sourceAccountId}, 'origin',
            ${legacy.sourceConversationId}, ${legacy.title},
            ${legacy.confidence}, ${now}, ${legacy.createdAt},
            'migration', ${now}
          )
        `);
      }

      // Create migration timeline event
      await db.execute(sql`
        INSERT INTO unified_object_timeline (
          id, unified_object_id,
          event_type, event_description,
          triggered_by, confidence,
          event_at, created_at
        ) VALUES (
          ${timelineId}, ${uioId},
          'migrated', 'Migrated from legacy commitment table',
          'system', ${legacy.confidence},
          ${now}, ${now}
        )
      `);

      // Update legacy record with UIO link
      await db.execute(sql`
        UPDATE commitment
        SET unified_object_id = ${uioId}
        WHERE id = ${legacy.id}
      `);

      stats.commitments.migrated++;
      if (stats.commitments.migrated % 100 === 0) {
        console.log(`  Migrated ${stats.commitments.migrated} commitments...`);
      }
    } catch (error) {
      console.error(`  Error migrating commitment ${legacy.id}:`, error);
      stats.commitments.errors++;
    }
  }

  console.log(`Commitments migration complete: ${stats.commitments.migrated} migrated, ${stats.commitments.errors} errors`);
}

async function migrateDecisions(): Promise<void> {
  console.log("\n=== Migrating Decisions ===");

  // Get all decisions without a UIO link
  const legacyDecisions = await db.execute<LegacyDecision>(sql`
    SELECT * FROM decision
    WHERE unified_object_id IS NULL
    ORDER BY created_at ASC
  `);

  stats.decisions.total = legacyDecisions.rows.length;
  console.log(`Found ${stats.decisions.total} decisions to migrate`);

  for (const legacy of legacyDecisions.rows) {
    try {
      const uioId = randomUUID();
      const detailsId = randomUUID();
      const sourceId = randomUUID();
      const timelineId = randomUUID();
      const now = new Date();

      // Create base UIO
      await db.execute(sql`
        INSERT INTO unified_intelligence_object (
          id, organization_id, type, status,
          canonical_title, canonical_description,
          overall_confidence,
          first_seen_at, last_updated_at,
          created_at, updated_at
        ) VALUES (
          ${uioId}, ${legacy.organizationId}, 'decision', 'active',
          ${legacy.title}, ${legacy.statement || legacy.rationale},
          ${legacy.confidence},
          ${legacy.createdAt}, ${now},
          ${legacy.createdAt}, ${now}
        )
      `);

      // Create decision details extension
      await db.execute(sql`
        INSERT INTO uio_decision_details (
          id, uio_id, statement, rationale,
          status, decided_at,
          created_at, updated_at
        ) VALUES (
          ${detailsId}, ${uioId}, ${legacy.statement}, ${legacy.rationale},
          'made', ${legacy.createdAt},
          ${legacy.createdAt}, ${now}
        )
      `);

      // Link to source conversation if exists
      if (legacy.sourceConversationId) {
        await db.execute(sql`
          INSERT INTO unified_object_source (
            id, unified_object_id, source_type,
            source_account_id, role,
            conversation_id, extracted_title,
            confidence, added_at, source_timestamp,
            detection_method, created_at
          ) VALUES (
            ${sourceId}, ${uioId}, 'email',
            ${legacy.sourceAccountId}, 'origin',
            ${legacy.sourceConversationId}, ${legacy.title},
            ${legacy.confidence}, ${now}, ${legacy.createdAt},
            'migration', ${now}
          )
        `);
      }

      // Create migration timeline event
      await db.execute(sql`
        INSERT INTO unified_object_timeline (
          id, unified_object_id,
          event_type, event_description,
          triggered_by, confidence,
          event_at, created_at
        ) VALUES (
          ${timelineId}, ${uioId},
          'migrated', 'Migrated from legacy decision table',
          'system', ${legacy.confidence},
          ${now}, ${now}
        )
      `);

      // Update legacy record with UIO link
      await db.execute(sql`
        UPDATE decision
        SET unified_object_id = ${uioId}
        WHERE id = ${legacy.id}
      `);

      stats.decisions.migrated++;
      if (stats.decisions.migrated % 100 === 0) {
        console.log(`  Migrated ${stats.decisions.migrated} decisions...`);
      }
    } catch (error) {
      console.error(`  Error migrating decision ${legacy.id}:`, error);
      stats.decisions.errors++;
    }
  }

  console.log(`Decisions migration complete: ${stats.decisions.migrated} migrated, ${stats.decisions.errors} errors`);
}

async function migrateClaims(): Promise<void> {
  console.log("\n=== Migrating Claims ===");

  // Get all claims - check if unified_object_id column exists
  const legacyClaims = await db.execute<LegacyClaim>(sql`
    SELECT * FROM claim
    ORDER BY created_at ASC
  `);

  stats.claims.total = legacyClaims.rows.length;
  console.log(`Found ${stats.claims.total} claims to migrate`);

  for (const legacy of legacyClaims.rows) {
    try {
      const uioId = randomUUID();
      const detailsId = randomUUID();
      const sourceId = randomUUID();
      const timelineId = randomUUID();
      const now = new Date();

      // Create base UIO
      await db.execute(sql`
        INSERT INTO unified_intelligence_object (
          id, organization_id, type, status,
          canonical_title, canonical_description,
          overall_confidence,
          first_seen_at, last_updated_at,
          created_at, updated_at
        ) VALUES (
          ${uioId}, ${legacy.organizationId}, 'claim', 'active',
          ${legacy.text.substring(0, 200)}, ${legacy.text},
          ${legacy.confidence},
          ${legacy.createdAt}, ${now},
          ${legacy.createdAt}, ${now}
        )
      `);

      // Create claim details extension
      await db.execute(sql`
        INSERT INTO uio_claim_details (
          id, uio_id, claim_type,
          quoted_text, normalized_text,
          importance,
          created_at, updated_at
        ) VALUES (
          ${detailsId}, ${uioId}, ${legacy.type || 'fact'},
          ${legacy.text}, ${legacy.text},
          'medium',
          ${legacy.createdAt}, ${now}
        )
      `);

      // Link to source conversation if exists
      if (legacy.conversationId) {
        await db.execute(sql`
          INSERT INTO unified_object_source (
            id, unified_object_id, source_type,
            role, conversation_id,
            extracted_title, confidence,
            added_at, source_timestamp,
            detection_method, created_at
          ) VALUES (
            ${sourceId}, ${uioId}, 'email',
            'origin', ${legacy.conversationId},
            ${legacy.text.substring(0, 200)}, ${legacy.confidence},
            ${now}, ${legacy.createdAt},
            'migration', ${now}
          )
        `);
      }

      // Create migration timeline event
      await db.execute(sql`
        INSERT INTO unified_object_timeline (
          id, unified_object_id,
          event_type, event_description,
          triggered_by, confidence,
          event_at, created_at
        ) VALUES (
          ${timelineId}, ${uioId},
          'migrated', 'Migrated from legacy claim table',
          'system', ${legacy.confidence},
          ${now}, ${now}
        )
      `);

      stats.claims.migrated++;
      if (stats.claims.migrated % 100 === 0) {
        console.log(`  Migrated ${stats.claims.migrated} claims...`);
      }
    } catch (error) {
      console.error(`  Error migrating claim ${legacy.id}:`, error);
      stats.claims.errors++;
    }
  }

  console.log(`Claims migration complete: ${stats.claims.migrated} migrated, ${stats.claims.errors} errors`);
}

async function migrateTasks(): Promise<void> {
  console.log("\n=== Migrating Tasks ===");

  // Get all tasks that don't already have a source_uio_id (meaning they weren't created from a UIO)
  // Tasks with source_uio_id are already linked to UIOs from commitments
  const legacyTasks = await db.execute<LegacyTask>(sql`
    SELECT * FROM task
    WHERE source_uio_id IS NULL
    ORDER BY created_at ASC
  `);

  stats.tasks.total = legacyTasks.rows.length;
  console.log(`Found ${stats.tasks.total} standalone tasks to migrate`);

  for (const legacy of legacyTasks.rows) {
    try {
      const uioId = randomUUID();
      const detailsId = randomUUID();
      const timelineId = randomUUID();
      const now = new Date();

      // Create base UIO
      await db.execute(sql`
        INSERT INTO unified_intelligence_object (
          id, organization_id, type, status,
          canonical_title, canonical_description,
          due_date, owner_contact_id,
          overall_confidence,
          first_seen_at, last_updated_at,
          created_at, updated_at
        ) VALUES (
          ${uioId}, ${legacy.organizationId}, 'task', 'active',
          ${legacy.title}, ${legacy.description},
          ${legacy.dueDate}, ${legacy.assigneeContactId},
          0.9,
          ${legacy.createdAt}, ${now},
          ${legacy.createdAt}, ${now}
        )
      `);

      // Map status to valid enum
      const statusMap: Record<string, string> = {
        todo: "todo",
        backlog: "backlog",
        in_progress: "in_progress",
        in_review: "in_review",
        done: "done",
        cancelled: "cancelled",
        completed: "done",
        pending: "backlog",
      };
      const taskStatus = statusMap[legacy.status] || "backlog";

      // Map priority to valid enum
      const priorityMap: Record<string, string> = {
        no_priority: "no_priority",
        low: "low",
        medium: "medium",
        high: "high",
        urgent: "urgent",
      };
      const taskPriority = priorityMap[legacy.priority || ""] || "no_priority";

      // Create task details extension
      await db.execute(sql`
        INSERT INTO uio_task_details (
          id, uio_id, status, priority,
          assignee_contact_id,
          created_at, updated_at
        ) VALUES (
          ${detailsId}, ${uioId}, ${taskStatus}, ${taskPriority},
          ${legacy.assigneeContactId},
          ${legacy.createdAt}, ${now}
        )
      `);

      // Create migration timeline event
      await db.execute(sql`
        INSERT INTO unified_object_timeline (
          id, unified_object_id,
          event_type, event_description,
          triggered_by, confidence,
          event_at, created_at
        ) VALUES (
          ${timelineId}, ${uioId},
          'migrated', 'Migrated from legacy task table',
          'system', 0.9,
          ${now}, ${now}
        )
      `);

      // Update legacy task with UIO link
      await db.execute(sql`
        UPDATE task
        SET source_uio_id = ${uioId}
        WHERE id = ${legacy.id}
      `);

      stats.tasks.migrated++;
      if (stats.tasks.migrated % 100 === 0) {
        console.log(`  Migrated ${stats.tasks.migrated} tasks...`);
      }
    } catch (error) {
      console.error(`  Error migrating task ${legacy.id}:`, error);
      stats.tasks.errors++;
    }
  }

  console.log(`Tasks migration complete: ${stats.tasks.migrated} migrated, ${stats.tasks.errors} errors`);
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("UIO DATA MIGRATION");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}`);

  try {
    // Run migrations
    await migrateCommitments();
    await migrateDecisions();
    await migrateClaims();
    await migrateTasks();

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("MIGRATION SUMMARY");
    console.log("=".repeat(60));
    console.log(`Commitments: ${stats.commitments.migrated}/${stats.commitments.total} (${stats.commitments.errors} errors)`);
    console.log(`Decisions: ${stats.decisions.migrated}/${stats.decisions.total} (${stats.decisions.errors} errors)`);
    console.log(`Claims: ${stats.claims.migrated}/${stats.claims.total} (${stats.claims.errors} errors)`);
    console.log(`Tasks: ${stats.tasks.migrated}/${stats.tasks.total} (${stats.tasks.errors} errors)`);

    const totalMigrated = stats.commitments.migrated + stats.decisions.migrated + stats.claims.migrated + stats.tasks.migrated;
    const totalErrors = stats.commitments.errors + stats.decisions.errors + stats.claims.errors + stats.tasks.errors;

    console.log(`\nTotal: ${totalMigrated} migrated, ${totalErrors} errors`);
    console.log(`Completed at: ${new Date().toISOString()}`);

    // Verification queries
    console.log("\n" + "=".repeat(60));
    console.log("VERIFICATION");
    console.log("=".repeat(60));

    const uioCount = await db.execute(sql`SELECT COUNT(*) as count FROM unified_intelligence_object`);
    console.log(`Total UIOs in database: ${uioCount.rows[0]?.count ?? 0}`);

    const unmigrated = await db.execute(sql`SELECT COUNT(*) as count FROM commitment WHERE unified_object_id IS NULL`);
    console.log(`Unmigrated commitments: ${unmigrated.rows[0]?.count ?? 0}`);

  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

main();
