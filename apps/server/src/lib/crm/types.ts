// =============================================================================
// CRM SYNC TYPES
// =============================================================================
//
// Type definitions for CRM integration (Salesforce, HubSpot, Pipedrive).
// CRMs sync to contact directly, not through conversation → message flow.
//

/**
 * Supported CRM providers.
 */
export type CRMProvider = "salesforce" | "hubspot" | "pipedrive";

/**
 * CRM sync job types.
 */
export type CRMSyncJobType = "full" | "incremental" | "push";

/**
 * CRM sync job status.
 */
export type CRMSyncJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * CRM sync direction.
 */
export type CRMSyncDirection = "pull" | "push" | "bidirectional";

/**
 * Field mapping from Drovi to CRM.
 */
export interface CRMFieldMapping {
  // Core contact fields
  displayName?: string;
  primaryEmail?: string;
  company?: string;
  title?: string;
  phone?: string;

  // Intelligence fields (for push)
  healthScore?: string;
  importanceScore?: string;
  engagementScore?: string;
  sentimentScore?: string;
  lastInteractionAt?: string;
  daysSinceLastContact?: string;
  isVip?: string;
  isAtRisk?: string;
  lifecycleStage?: string;
  roleType?: string;
}

/**
 * CRM source account settings (stored in sourceAccount.settings).
 */
export interface CRMSettings {
  /** Enable push of intelligence back to CRM */
  pushEnabled: boolean;
  /** Field mapping: Drovi field -> CRM field */
  fieldMapping: CRMFieldMapping;
  /** Sync direction */
  syncDirection: CRMSyncDirection;
  /** Last sync cursor/timestamp */
  lastSyncCursor?: string;
  /** Salesforce-specific: instance URL */
  instanceUrl?: string;
  /** HubSpot-specific: portal ID */
  portalId?: string;
  /** Custom object mappings */
  customMappings?: Record<string, string>;
}

/**
 * Raw contact data from CRM (normalized across providers).
 */
export interface CRMContactData {
  /** External ID in the CRM */
  externalId: string;
  /** Contact type in the CRM (contact, lead, account, etc.) */
  externalType: "contact" | "lead" | "account" | "person";
  /** Display name */
  displayName?: string;
  /** Primary email */
  primaryEmail?: string;
  /** Additional emails */
  additionalEmails?: string[];
  /** Company/Account name */
  company?: string;
  /** Job title */
  title?: string;
  /** Phone numbers */
  phones?: Array<{ type: string; number: string }>;
  /** Address */
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  /** Owner/assigned user in CRM */
  ownerId?: string;
  ownerEmail?: string;
  /** Social profiles */
  linkedinUrl?: string;
  twitterHandle?: string;
  /** Custom fields from CRM */
  customFields?: Record<string, unknown>;
  /** CRM-specific metadata */
  metadata?: {
    createdAt?: Date;
    updatedAt?: Date;
    lastActivityAt?: Date;
    source?: string;
    tags?: string[];
  };
}

/**
 * CRM sync result.
 */
export interface CRMSyncResult {
  success: boolean;
  jobId: string;
  sourceAccountId: string;
  provider: CRMProvider;
  direction: "pull" | "push";
  /** Number of contacts processed */
  contactsProcessed: number;
  /** New contacts created in Drovi */
  contactsCreated: number;
  /** Existing contacts updated */
  contactsUpdated: number;
  /** Contacts merged (duplicates resolved) */
  contactsMerged: number;
  /** Contacts skipped (no changes) */
  contactsSkipped: number;
  /** Errors encountered */
  errors: CRMSyncError[];
  /** Duration in milliseconds */
  duration: number;
  /** New cursor for incremental sync */
  newCursor?: string;
}

/**
 * CRM sync error.
 */
export interface CRMSyncError {
  code: string;
  message: string;
  contactId?: string;
  externalId?: string;
  retryable: boolean;
}

/**
 * CRM push result (pushing intelligence back to CRM).
 */
export interface CRMPushResult {
  success: boolean;
  jobId: string;
  sourceAccountId: string;
  provider: CRMProvider;
  /** Contacts pushed to CRM */
  contactsPushed: number;
  /** Contacts with errors */
  contactsFailed: number;
  /** Errors encountered */
  errors: CRMSyncError[];
  /** Duration in milliseconds */
  duration: number;
}

/**
 * CRM API rate limit info.
 */
export interface CRMRateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: Date;
}

/**
 * CRM OAuth credentials (stored encrypted).
 */
export interface CRMCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  instanceUrl?: string; // Salesforce
  scope?: string;
}

/**
 * CRM contact update payload (for push operations).
 */
export interface CRMContactUpdate {
  externalId: string;
  fields: Record<string, unknown>;
}

/**
 * CRM webhook event types.
 */
export type CRMWebhookEvent =
  | "contact.created"
  | "contact.updated"
  | "contact.deleted"
  | "lead.created"
  | "lead.updated"
  | "lead.converted";

/**
 * CRM webhook payload.
 */
export interface CRMWebhookPayload {
  event: CRMWebhookEvent;
  provider: CRMProvider;
  externalId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

/**
 * Options for CRM sync operations.
 */
export interface CRMSyncOptions {
  /** Only sync contacts modified since this date */
  since?: Date;
  /** Maximum contacts to sync (for pagination/limits) */
  limit?: number;
  /** Starting cursor for pagination */
  cursor?: string;
  /** Force full sync (ignore last sync timestamp) */
  forceFull?: boolean;
  /** Include deleted contacts */
  includeDeleted?: boolean;
}

/**
 * Options for CRM push operations.
 */
export interface CRMPushOptions {
  /** Only push contacts that have changed since last push */
  changedOnly?: boolean;
  /** Specific contact IDs to push */
  contactIds?: string[];
  /** Fields to push (if not specified, uses fieldMapping) */
  fields?: string[];
}
