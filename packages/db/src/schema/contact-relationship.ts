import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { contact } from "./intelligence";
import { organization } from "./organization";

// =============================================================================
// ENUMS
// =============================================================================

export const contactRelationshipTypeEnum = pgEnum("contact_relationship_type", [
  "communicates_with", // Inferred from email/message exchanges
  "works_with", // Same company/team
  "reports_to", // Organizational hierarchy
  "introduced_by", // Introduction chain
  "collaborates_with", // Project collaboration
]);

export const contactRelationshipSourceEnum = pgEnum(
  "contact_relationship_source",
  [
    "inferred", // Auto-detected from communication patterns
    "user_defined", // User explicitly created
    "imported", // From external source (CRM, LinkedIn, etc.)
  ]
);

// =============================================================================
// CONTACT RELATIONSHIP TABLE
// =============================================================================

/**
 * Facebook-style social graph for contacts.
 * Tracks explicit and inferred relationships between contacts.
 */
export const contactRelationship = pgTable(
  "contact_relationship",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),

    // The two contacts in the relationship
    contactAId: text("contact_a_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),
    contactBId: text("contact_b_id")
      .notNull()
      .references(() => contact.id, { onDelete: "cascade" }),

    // Relationship metadata
    relationshipType: contactRelationshipTypeEnum("relationship_type")
      .notNull()
      .default("communicates_with"),
    strength: real("strength").notNull().default(0.5), // 0.0 to 1.0

    // Computed from interactions
    messageCount: integer("message_count").notNull().default(0),
    lastInteractionAt: timestamp("last_interaction_at"),
    firstInteractionAt: timestamp("first_interaction_at"),
    avgResponseTimeMinutes: real("avg_response_time_minutes"),
    sentimentScore: real("sentiment_score"), // -1.0 to 1.0

    // Topics they discuss together
    sharedTopics: text("shared_topics").array().default([]),

    // Source of relationship
    source: contactRelationshipSourceEnum("source").notNull().default("inferred"),
    confidence: real("confidence").notNull().default(0.5),

    // Graph sync tracking
    lastSyncedToGraphAt: timestamp("last_synced_to_graph_at"),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // Indexes for fast lookups
    index("contact_rel_org_idx").on(table.organizationId),
    index("contact_rel_a_idx").on(table.contactAId),
    index("contact_rel_b_idx").on(table.contactBId),
    index("contact_rel_strength_idx").on(table.strength),
    index("contact_rel_type_idx").on(table.relationshipType),
    index("contact_rel_last_interaction_idx").on(table.lastInteractionAt),
    // Unique constraint: one relationship type per contact pair per org
    unique("contact_rel_unique").on(
      table.organizationId,
      table.contactAId,
      table.contactBId,
      table.relationshipType
    ),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const contactRelationshipRelations = relations(
  contactRelationship,
  ({ one }) => ({
    organization: one(organization, {
      fields: [contactRelationship.organizationId],
      references: [organization.id],
    }),
    contactA: one(contact, {
      fields: [contactRelationship.contactAId],
      references: [contact.id],
      relationName: "contactARelationships",
    }),
    contactB: one(contact, {
      fields: [contactRelationship.contactBId],
      references: [contact.id],
      relationName: "contactBRelationships",
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type ContactRelationship = typeof contactRelationship.$inferSelect;
export type NewContactRelationship = typeof contactRelationship.$inferInsert;
