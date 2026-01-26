// =============================================================================
// CONTACT IDENTITY SCHEMA
// =============================================================================
//
// Cross-source identity linking for unified contact resolution.
// Enables linking the same person across email, Slack, phone, CRM, etc.
//

import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { contact } from "./intelligence";
import { organization } from "./organization";
import { sourceAccount } from "./sources";

// =============================================================================
// ENUMS
// =============================================================================

/**
 * Types of identities that can be linked to a contact.
 * Extensible for future source integrations.
 */
export const identityTypeEnum = pgEnum("identity_type", [
  // Email-based
  "email",
  "email_alias",
  // Slack identifiers
  "slack_id",
  "slack_handle",
  // Phone numbers
  "phone",
  "whatsapp_id",
  // CRM identifiers
  "crm_salesforce",
  "crm_hubspot",
  "crm_pipedrive",
  "crm_zoho",
  // Social/Professional
  "linkedin_url",
  "twitter_handle",
  "github_username",
  // Internal IDs
  "notion_user_id",
  "google_id",
  "calendar_attendee_id",
  // Generic external
  "external_id",
]);

/**
 * How the identity link was discovered/created.
 */
export const identitySourceEnum = pgEnum("identity_source", [
  "email_header", // Extracted from email headers
  "slack_profile", // From Slack user profile
  "crm_sync", // Synced from CRM
  "calendar_invite", // From calendar attendee info
  "manual", // User manually linked
  "ai_inference", // AI-suggested match
  "oauth_profile", // From OAuth profile data
  "api_enrichment", // From enrichment API
]);

// =============================================================================
// CONTACT IDENTITY TABLE
// =============================================================================

/**
 * Links various identifiers (email, Slack ID, phone, CRM ID) to unified contacts.
 * Enables cross-source identity resolution.
 *
 * Example: John Doe might have:
 * - email: john@acme.com
 * - slack_id: U123ABC
 * - crm_salesforce: 003xxxx
 * - phone: +1-555-123-4567
 *
 * All link to the same contact record.
 */
export const contactIdentity = pgTable(
  "contact_identity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Which contact this identity belongs to
    contactId: text("contact_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),

    // Organization scope (multi-tenancy)
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // Identity details
    identityType: identityTypeEnum("identity_type").notNull(),
    identityValue: text("identity_value").notNull(),

    // Confidence and verification
    confidence: real("confidence").notNull().default(1.0),
    isVerified: boolean("is_verified").default(false),
    verifiedAt: timestamp("verified_at"),
    verifiedBy: text("verified_by"), // user ID who verified

    // Provenance
    source: identitySourceEnum("source"),
    sourceAccountId: text("source_account_id").references(
      () => sourceAccount.id,
      { onDelete: "set null" }
    ),

    // For tracking when identity was last seen active
    lastSeenAt: timestamp("last_seen_at"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Fast lookup by organization + type + value (primary resolution path)
    unique("contact_identity_org_type_value_unique").on(
      table.organizationId,
      table.identityType,
      table.identityValue
    ),
    // Find all identities for a contact
    index("contact_identity_contact_idx").on(table.contactId),
    // Organization filter
    index("contact_identity_org_idx").on(table.organizationId),
    // Type-based lookups
    index("contact_identity_type_idx").on(table.identityType),
    // Confidence filtering (for merge suggestions)
    index("contact_identity_confidence_idx").on(table.confidence),
    // Source account tracking
    index("contact_identity_source_account_idx").on(table.sourceAccountId),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const contactIdentityRelations = relations(
  contactIdentity,
  ({ one }) => ({
    contact: one(contact, {
      fields: [contactIdentity.contactId],
      references: [contact.id],
    }),
    organization: one(organization, {
      fields: [contactIdentity.organizationId],
      references: [organization.id],
    }),
    sourceAccount: one(sourceAccount, {
      fields: [contactIdentity.sourceAccountId],
      references: [sourceAccount.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ContactIdentity = typeof contactIdentity.$inferSelect;
export type NewContactIdentity = typeof contactIdentity.$inferInsert;
