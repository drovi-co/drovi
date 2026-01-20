// =============================================================================
// WHATSAPP SCHEMA
// =============================================================================
//
// Tables specific to WhatsApp Business API integration. These complement the
// generic source tables (source_account, conversation, message) with
// WhatsApp-specific data like phone numbers, contacts, and media.
//

import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sourceAccount } from "./sources";

// =============================================================================
// WHATSAPP BUSINESS ACCOUNT TABLE
// =============================================================================

/**
 * WhatsApp Business Account (WABA) information.
 * A WABA can have multiple phone numbers.
 */
export const whatsappBusinessAccount = pgTable(
  "whatsapp_business_account",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to source account
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // WhatsApp Business Account identifiers
    wabaId: text("waba_id").notNull(), // WhatsApp Business Account ID from Meta

    // Account info
    name: text("name").notNull(),
    timezoneId: text("timezone_id"),
    messageTemplateNamespace: text("message_template_namespace"),

    // Verification status
    accountReviewStatus: text("account_review_status"), // PENDING, APPROVED, REJECTED

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("whatsapp_waba_source_idx").on(table.sourceAccountId),
    unique("whatsapp_waba_source_waba_unique").on(
      table.sourceAccountId,
      table.wabaId
    ),
  ]
);

// =============================================================================
// WHATSAPP PHONE NUMBER TABLE
// =============================================================================

/**
 * WhatsApp phone numbers associated with a Business Account.
 * Each phone number can send/receive messages.
 */
export const whatsappPhoneNumber = pgTable(
  "whatsapp_phone_number",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to WABA
    wabaId: text("waba_id")
      .notNull()
      .references(() => whatsappBusinessAccount.id, { onDelete: "cascade" }),

    // Phone number identifiers
    phoneNumberId: text("phone_number_id").notNull(), // Meta's phone number ID
    displayPhoneNumber: text("display_phone_number").notNull(), // e.g., "+1 555 123 4567"

    // Verification
    verifiedName: text("verified_name"), // Business display name
    codeVerificationStatus: text("code_verification_status"), // VERIFIED, PENDING, etc.

    // Quality
    qualityRating: text("quality_rating"), // GREEN, YELLOW, RED
    messagingLimit: text("messaging_limit"), // TIER_1K, TIER_10K, etc.

    // Status
    isActive: boolean("is_active").notNull().default(true),

    // Sync tracking
    lastSyncAt: timestamp("last_sync_at"),

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("whatsapp_phone_waba_idx").on(table.wabaId),
    unique("whatsapp_phone_waba_number_unique").on(
      table.wabaId,
      table.phoneNumberId
    ),
  ]
);

// =============================================================================
// WHATSAPP CONTACT CACHE TABLE
// =============================================================================

/**
 * Cached WhatsApp contact information.
 * Stores contact details from messages for quick lookup.
 */
export const whatsappContactCache = pgTable(
  "whatsapp_contact_cache",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to source account
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // WhatsApp identifiers
    waId: text("wa_id").notNull(), // WhatsApp ID (phone number without +)
    phoneNumber: text("phone_number").notNull(), // Full phone number with country code

    // Contact info from profile
    profileName: text("profile_name"),

    // Pushed name (name from contact's phone)
    pushName: text("push_name"),

    // Profile picture
    profilePictureUrl: text("profile_picture_url"),

    // Stats
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at"),

    // Cache management
    lastFetchedAt: timestamp("last_fetched_at").defaultNow().notNull(),

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("whatsapp_contact_source_idx").on(table.sourceAccountId),
    index("whatsapp_contact_wa_id_idx").on(table.waId),
    unique("whatsapp_contact_source_wa_unique").on(
      table.sourceAccountId,
      table.waId
    ),
  ]
);

// =============================================================================
// WHATSAPP MESSAGE METADATA TABLE
// =============================================================================

/**
 * WhatsApp-specific message metadata.
 * Stores additional data that doesn't fit in the generic message table.
 */
export const whatsappMessageMeta = pgTable(
  "whatsapp_message_meta",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to source account
    sourceAccountId: text("source_account_id")
      .notNull()
      .references(() => sourceAccount.id, { onDelete: "cascade" }),

    // WhatsApp message identifiers
    wamId: text("wam_id").notNull(), // WhatsApp Message ID
    phoneNumberId: text("phone_number_id").notNull(), // Which phone number received/sent

    // Sender/Recipient
    fromWaId: text("from_wa_id").notNull(),
    toWaId: text("to_wa_id"),

    // Message type
    messageType: text("message_type").notNull(), // text, image, audio, video, document, etc.

    // Status tracking
    status: text("status"), // sent, delivered, read, failed
    statusTimestamp: timestamp("status_timestamp"),

    // Media info (if applicable)
    mediaId: text("media_id"),
    mediaMimeType: text("media_mime_type"),
    mediaSha256: text("media_sha256"),
    mediaUrl: text("media_url"), // Downloaded/cached URL

    // Context (for replies)
    contextMessageId: text("context_message_id"), // ID of message being replied to
    isForwarded: boolean("is_forwarded").default(false),
    forwardingScore: integer("forwarding_score"), // How many times forwarded

    // Reactions
    reactions:
      jsonb("reactions").$type<
        Array<{
          emoji: string;
          reactorWaId: string;
          timestamp: string;
        }>
      >(),

    // Errors
    errorCode: integer("error_code"),
    errorMessage: text("error_message"),

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("whatsapp_msg_source_idx").on(table.sourceAccountId),
    index("whatsapp_msg_wam_idx").on(table.wamId),
    index("whatsapp_msg_from_idx").on(table.fromWaId),
    index("whatsapp_msg_to_idx").on(table.toWaId),
    index("whatsapp_msg_status_idx").on(table.status),
    unique("whatsapp_msg_source_wam_unique").on(
      table.sourceAccountId,
      table.wamId
    ),
  ]
);

// =============================================================================
// WHATSAPP TEMPLATE TABLE
// =============================================================================

/**
 * WhatsApp message templates.
 * Required for sending business-initiated messages outside 24-hour window.
 */
export const whatsappTemplate = pgTable(
  "whatsapp_template",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),

    // Link to WABA
    wabaId: text("waba_id")
      .notNull()
      .references(() => whatsappBusinessAccount.id, { onDelete: "cascade" }),

    // Template identifiers
    templateId: text("template_id").notNull(), // Meta's template ID
    name: text("name").notNull(),
    language: text("language").notNull(), // e.g., "en_US"

    // Template content
    category: text("category").notNull(), // UTILITY, MARKETING, AUTHENTICATION
    status: text("status").notNull(), // APPROVED, PENDING, REJECTED

    // Components (header, body, footer, buttons)
    components:
      jsonb("components").$type<
        Array<{
          type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
          format?: string;
          text?: string;
          example?: { header_text?: string[]; body_text?: string[][] };
          buttons?: Array<{
            type: string;
            text: string;
            url?: string;
            phone_number?: string;
          }>;
        }>
      >(),

    // Local timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("whatsapp_template_waba_idx").on(table.wabaId),
    unique("whatsapp_template_waba_name_lang_unique").on(
      table.wabaId,
      table.name,
      table.language
    ),
  ]
);

// =============================================================================
// RELATIONS
// =============================================================================

export const whatsappBusinessAccountRelations = relations(
  whatsappBusinessAccount,
  ({ one, many }) => ({
    sourceAccount: one(sourceAccount, {
      fields: [whatsappBusinessAccount.sourceAccountId],
      references: [sourceAccount.id],
    }),
    phoneNumbers: many(whatsappPhoneNumber),
    templates: many(whatsappTemplate),
  })
);

export const whatsappPhoneNumberRelations = relations(
  whatsappPhoneNumber,
  ({ one }) => ({
    waba: one(whatsappBusinessAccount, {
      fields: [whatsappPhoneNumber.wabaId],
      references: [whatsappBusinessAccount.id],
    }),
  })
);

export const whatsappContactCacheRelations = relations(
  whatsappContactCache,
  ({ one }) => ({
    sourceAccount: one(sourceAccount, {
      fields: [whatsappContactCache.sourceAccountId],
      references: [sourceAccount.id],
    }),
  })
);

export const whatsappMessageMetaRelations = relations(
  whatsappMessageMeta,
  ({ one }) => ({
    sourceAccount: one(sourceAccount, {
      fields: [whatsappMessageMeta.sourceAccountId],
      references: [sourceAccount.id],
    }),
  })
);

export const whatsappTemplateRelations = relations(
  whatsappTemplate,
  ({ one }) => ({
    waba: one(whatsappBusinessAccount, {
      fields: [whatsappTemplate.wabaId],
      references: [whatsappBusinessAccount.id],
    }),
  })
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type WhatsAppBusinessAccount =
  typeof whatsappBusinessAccount.$inferSelect;
export type NewWhatsAppBusinessAccount =
  typeof whatsappBusinessAccount.$inferInsert;
export type WhatsAppPhoneNumber = typeof whatsappPhoneNumber.$inferSelect;
export type NewWhatsAppPhoneNumber = typeof whatsappPhoneNumber.$inferInsert;
export type WhatsAppContactCache = typeof whatsappContactCache.$inferSelect;
export type NewWhatsAppContactCache = typeof whatsappContactCache.$inferInsert;
export type WhatsAppMessageMeta = typeof whatsappMessageMeta.$inferSelect;
export type NewWhatsAppMessageMeta = typeof whatsappMessageMeta.$inferInsert;
export type WhatsAppTemplate = typeof whatsappTemplate.$inferSelect;
export type NewWhatsAppTemplate = typeof whatsappTemplate.$inferInsert;
