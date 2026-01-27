// =============================================================================
// CONTACT SOURCE LINK SCHEMA
// =============================================================================
//
// Tracks the relationship between contacts and their source records.
// Enables bidirectional sync between Drovi and external systems (CRM, etc.).
//

import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { contact } from "./intelligence";
import { sourceAccount } from "./sources";

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Sync status for contact-source links.
 */
export const contactSyncStatusEnum = pgEnum("contact_sync_status", [
  "synced", // In sync with external system
  "pending_push", // Drovi changes need to push to external
  "pending_pull", // External changes need to pull to Drovi
  "conflict", // Changes on both sides need resolution
  "error", // Sync failed
  "disconnected", // Source account disconnected
]);

/**
 * Type of record in the external system (primarily for CRM sources).
 */
export const externalRecordTypeEnum = pgEnum("external_record_type", [
  // CRM record types
  "contact", // CRM contact
  "lead", // CRM lead
  "account", // CRM account/company
  "person", // Generic person record
  // Other source types
  "user", // Slack user, Notion user, etc.
  "participant", // Calendar participant
  "member", // Team/channel member
]);

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Field mapping for CRM sync - maps Drovi fields to external fields.
 */
export interface ContactSourceFieldMapping {
  // Which Drovi fields to push to external
  pushFields?: {
    healthScore?: string; // e.g., "Drovi_Health_Score__c"
    importanceScore?: string;
    engagementScore?: string;
    lastInteractionAt?: string;
    isVip?: string;
    isAtRisk?: string;
  };
  // Custom field mappings
  customMappings?: Record<string, string>;
}

/**
 * External record data snapshot for conflict detection.
 */
export interface ExternalRecordSnapshot {
  pulledAt: string;
  data: Record<string, unknown>;
  hash?: string; // For quick change detection
}

// =============================================================================
// CONTACT SOURCE LINK TABLE
// =============================================================================

/**
 * Links Drovi contacts to records in external systems (CRM, Slack, etc.).
 * Enables bidirectional sync and tracks sync state.
 *
 * Example use cases:
 * - Link contact to Salesforce Contact record for intelligence push
 * - Link contact to HubSpot Lead for deal tracking
 * - Track which Slack user ID corresponds to which contact
 * - Know where a contact was originally imported from
 */
export const contactSourceLink = pgTable(
  "contact_source_link",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Which Drovi contact
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),

    // Which source account (email, Slack, CRM, etc.)
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // External system identification
    externalId: text("external_id").notNull(), // ID in external system
    externalType: externalRecordTypeEnum("external_type").default("contact"),
    externalUrl: text("external_url"), // Direct link to record in external system

    // Sync state
    syncStatus: contactSyncStatusEnum("sync_status").default("synced"),
    lastPulledAt: timestamp("last_pulled_at"),
    lastPushedAt: timestamp("last_pushed_at"),
    lastSyncError: text("last_sync_error"),

    // Field mapping configuration (primarily for CRM)
    fieldMapping: jsonb("field_mapping").$type<ContactSourceFieldMapping>(),

    // Snapshot of external data (for conflict detection)
    externalSnapshot:
      jsonb("external_snapshot").$type<ExternalRecordSnapshot>(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Unique: one contact per external record per source account
    unique("contact_source_link_unique").on(
      table.sourceAccountId,
      table.externalId
    ),
    // Find all source links for a contact
    index("contact_source_link_contact_idx").on(table.contactId),
    // Find all contacts linked to a source account
    index("contact_source_link_source_idx").on(table.sourceAccountId),
    // Filter by sync status (for batch processing)
    index("contact_source_link_sync_status_idx").on(table.syncStatus),
    // Find by external ID
    index("contact_source_link_external_id_idx").on(table.externalId),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const contactSourceLinkRelations = relations(
  contactSourceLink,
  ({ one }) => ({
    contact: one(contact, {
      fields: [contactSourceLink.contactId],
      references: [contact.id],
    }),
    sourceAccount: one(sourceAccount, {
      fields: [contactSourceLink.sourceAccountId],
      references: [sourceAccount.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ContactSourceLink = typeof contactSourceLink.$inferSelect;
export type NewContactSourceLink = typeof contactSourceLink.$inferInsert;
