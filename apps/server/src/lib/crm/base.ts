// =============================================================================
// CRM SYNC PROVIDER BASE CLASS
// =============================================================================
//
// Abstract base class for CRM sync providers.
// Implements common functionality and defines the interface for providers.
//

import { db } from "@memorystack/db";
import {
  contact,
  contactIdentity,
  contactSourceLink,
  sourceAccount,
} from "@memorystack/db/schema";
import { and, eq } from "drizzle-orm";
import { log } from "../logger";
import type {
  CRMContactData,
  CRMContactUpdate,
  CRMCredentials,
  CRMProvider,
  CRMPushOptions,
  CRMPushResult,
  CRMRateLimitInfo,
  CRMSettings,
  CRMSyncError,
  CRMSyncOptions,
  CRMSyncResult,
} from "./types";

/**
 * Source account record with CRM settings.
 */
export interface CRMSourceAccount {
  id: string;
  organizationId: string;
  type: string;
  externalId: string;
  status: string;
  credentials: CRMCredentials | null;
  settings: CRMSettings | null;
  lastSyncAt: Date | null;
  lastSyncCursor: string | null;
}

/**
 * Abstract base class for CRM sync providers.
 * Each CRM (Salesforce, HubSpot, Pipedrive) implements this interface.
 */
export abstract class CRMSyncProvider {
  protected provider: CRMProvider;
  protected sourceAccount: CRMSourceAccount;
  protected credentials: CRMCredentials;
  protected settings: CRMSettings;

  constructor(sourceAccount: CRMSourceAccount) {
    this.sourceAccount = sourceAccount;
    this.provider = this.getProviderFromType(sourceAccount.type);

    if (!sourceAccount.credentials) {
      throw new Error(`No credentials found for source account ${sourceAccount.id}`);
    }
    this.credentials = sourceAccount.credentials;

    this.settings = sourceAccount.settings ?? {
      pushEnabled: false,
      fieldMapping: {},
      syncDirection: "pull",
    };
  }

  /**
   * Get provider type from source account type.
   */
  private getProviderFromType(type: string): CRMProvider {
    if (type === "crm_salesforce") return "salesforce";
    if (type === "crm_hubspot") return "hubspot";
    if (type === "crm_pipedrive") return "pipedrive";
    throw new Error(`Unknown CRM type: ${type}`);
  }

  // ===========================================================================
  // ABSTRACT METHODS (Provider-specific implementation required)
  // ===========================================================================

  /**
   * Fetch contacts from the CRM.
   * Each provider implements their specific API calls.
   */
  protected abstract fetchContacts(
    options: CRMSyncOptions
  ): Promise<{ contacts: CRMContactData[]; nextCursor?: string }>;

  /**
   * Push contact updates to the CRM.
   */
  protected abstract pushContactUpdates(
    updates: CRMContactUpdate[]
  ): Promise<{ success: string[]; failed: Array<{ id: string; error: string }> }>;

  /**
   * Refresh OAuth access token if expired.
   */
  protected abstract refreshToken(): Promise<CRMCredentials>;

  /**
   * Get current rate limit status.
   */
  protected abstract getRateLimitInfo(): Promise<CRMRateLimitInfo | null>;

  /**
   * Map CRM contact to Drovi contact format.
   * Override if provider needs special handling.
   */
  protected mapContactToInternal(crmContact: CRMContactData): Partial<typeof contact.$inferInsert> {
    return {
      displayName: crmContact.displayName ?? crmContact.primaryEmail,
      primaryEmail: crmContact.primaryEmail,
      company: crmContact.company,
      title: crmContact.title,
      linkedinUrl: crmContact.linkedinUrl,
      // Don't override these fields if pulling - they're computed by intelligence
    };
  }

  /**
   * Map Drovi contact to CRM update format.
   * Override if provider needs special handling.
   */
  protected mapContactToCRM(
    internalContact: typeof contact.$inferSelect
  ): Record<string, unknown> {
    const mapping = this.settings.fieldMapping;
    const fields: Record<string, unknown> = {};

    // Map intelligence fields if configured
    if (mapping.healthScore && internalContact.healthScore !== null) {
      fields[mapping.healthScore] = Math.round(internalContact.healthScore * 100);
    }
    if (mapping.importanceScore && internalContact.importanceScore !== null) {
      fields[mapping.importanceScore] = Math.round(internalContact.importanceScore * 100);
    }
    if (mapping.engagementScore && internalContact.engagementScore !== null) {
      fields[mapping.engagementScore] = Math.round(internalContact.engagementScore * 100);
    }
    if (mapping.sentimentScore && internalContact.sentimentScore !== null) {
      fields[mapping.sentimentScore] = Math.round(internalContact.sentimentScore * 100);
    }
    if (mapping.lastInteractionAt && internalContact.lastInteractionAt) {
      fields[mapping.lastInteractionAt] = internalContact.lastInteractionAt.toISOString();
    }
    if (mapping.daysSinceLastContact && internalContact.daysSinceLastContact !== null) {
      fields[mapping.daysSinceLastContact] = internalContact.daysSinceLastContact;
    }
    if (mapping.isVip !== undefined) {
      fields[mapping.isVip] = internalContact.isVip;
    }
    if (mapping.isAtRisk !== undefined) {
      fields[mapping.isAtRisk] = internalContact.isAtRisk;
    }
    if (mapping.lifecycleStage && internalContact.lifecycleStage) {
      fields[mapping.lifecycleStage] = internalContact.lifecycleStage;
    }
    if (mapping.roleType && internalContact.roleType) {
      fields[mapping.roleType] = internalContact.roleType;
    }

    return fields;
  }

  // ===========================================================================
  // PUBLIC METHODS
  // ===========================================================================

  /**
   * Perform a sync operation (pull contacts from CRM).
   */
  async syncContacts(options: CRMSyncOptions = {}): Promise<CRMSyncResult> {
    const startTime = Date.now();
    const jobId = crypto.randomUUID();
    const errors: CRMSyncError[] = [];

    let contactsProcessed = 0;
    let contactsCreated = 0;
    let contactsUpdated = 0;
    let contactsMerged = 0;
    let contactsSkipped = 0;
    let newCursor: string | undefined;

    log.info("Starting CRM sync", {
      provider: this.provider,
      sourceAccountId: this.sourceAccount.id,
      options,
    });

    try {
      // Check and refresh token if needed
      await this.ensureValidToken();

      // Determine starting point
      const syncOptions: CRMSyncOptions = {
        ...options,
        cursor: options.cursor ?? this.sourceAccount.lastSyncCursor ?? undefined,
        since: options.since ?? this.sourceAccount.lastSyncAt ?? undefined,
      };

      // Fetch contacts from CRM
      const { contacts: crmContacts, nextCursor } = await this.fetchContacts(syncOptions);
      newCursor = nextCursor;

      log.info("Fetched contacts from CRM", {
        provider: this.provider,
        count: crmContacts.length,
        hasNextPage: !!nextCursor,
      });

      // Process each contact
      for (const crmContact of crmContacts) {
        contactsProcessed++;

        try {
          const result = await this.processContact(crmContact);

          if (result.action === "created") {
            contactsCreated++;
          } else if (result.action === "updated") {
            contactsUpdated++;
          } else if (result.action === "merged") {
            contactsMerged++;
          } else {
            contactsSkipped++;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          log.error("Failed to process CRM contact", error, {
            externalId: crmContact.externalId,
            provider: this.provider,
          });
          errors.push({
            code: "PROCESS_ERROR",
            message: errorMessage,
            externalId: crmContact.externalId,
            retryable: true,
          });
        }
      }

      // Update sync cursor
      if (newCursor) {
        await db
          .update(sourceAccount)
          .set({
            lastSyncCursor: newCursor,
            lastSyncAt: new Date(),
          })
          .where(eq(sourceAccount.id, this.sourceAccount.id));
      }

      log.info("CRM sync completed", {
        provider: this.provider,
        contactsProcessed,
        contactsCreated,
        contactsUpdated,
        contactsMerged,
        contactsSkipped,
        errors: errors.length,
        duration: Date.now() - startTime,
      });

      return {
        success: errors.length === 0,
        jobId,
        sourceAccountId: this.sourceAccount.id,
        provider: this.provider,
        direction: "pull",
        contactsProcessed,
        contactsCreated,
        contactsUpdated,
        contactsMerged,
        contactsSkipped,
        errors,
        duration: Date.now() - startTime,
        newCursor,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      log.error("CRM sync failed", error, {
        provider: this.provider,
        sourceAccountId: this.sourceAccount.id,
      });

      return {
        success: false,
        jobId,
        sourceAccountId: this.sourceAccount.id,
        provider: this.provider,
        direction: "pull",
        contactsProcessed,
        contactsCreated,
        contactsUpdated,
        contactsMerged,
        contactsSkipped,
        errors: [
          ...errors,
          {
            code: "SYNC_FAILED",
            message: errorMessage,
            retryable: true,
          },
        ],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Push intelligence data back to CRM.
   */
  async pushIntelligence(options: CRMPushOptions = {}): Promise<CRMPushResult> {
    const startTime = Date.now();
    const jobId = crypto.randomUUID();
    const errors: CRMSyncError[] = [];

    let contactsPushed = 0;
    let contactsFailed = 0;

    log.info("Starting CRM push", {
      provider: this.provider,
      sourceAccountId: this.sourceAccount.id,
      options,
    });

    if (!this.settings.pushEnabled) {
      return {
        success: false,
        jobId,
        sourceAccountId: this.sourceAccount.id,
        provider: this.provider,
        contactsPushed: 0,
        contactsFailed: 0,
        errors: [
          {
            code: "PUSH_DISABLED",
            message: "Push is not enabled for this CRM connection",
            retryable: false,
          },
        ],
        duration: Date.now() - startTime,
      };
    }

    try {
      // Check and refresh token if needed
      await this.ensureValidToken();

      // Get contacts linked to this CRM
      const linkedContacts = await this.getLinkedContacts(options.contactIds);

      log.info("Found linked contacts for push", {
        provider: this.provider,
        count: linkedContacts.length,
      });

      // Prepare updates
      const updates: CRMContactUpdate[] = [];
      for (const linked of linkedContacts) {
        const fields = this.mapContactToCRM(linked.contact);
        if (Object.keys(fields).length > 0) {
          updates.push({
            externalId: linked.externalId,
            fields,
          });
        }
      }

      // Push to CRM in batches
      const BATCH_SIZE = 100;
      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        const result = await this.pushContactUpdates(batch);

        contactsPushed += result.success.length;

        for (const failed of result.failed) {
          contactsFailed++;
          errors.push({
            code: "PUSH_ERROR",
            message: failed.error,
            externalId: failed.id,
            retryable: true,
          });
        }

        // Update last pushed timestamp for successful contacts
        for (const externalId of result.success) {
          await db
            .update(contactSourceLink)
            .set({ lastPushedAt: new Date() })
            .where(
              and(
                eq(contactSourceLink.sourceAccountId, this.sourceAccount.id),
                eq(contactSourceLink.externalId, externalId)
              )
            );
        }
      }

      log.info("CRM push completed", {
        provider: this.provider,
        contactsPushed,
        contactsFailed,
        duration: Date.now() - startTime,
      });

      return {
        success: errors.length === 0,
        jobId,
        sourceAccountId: this.sourceAccount.id,
        provider: this.provider,
        contactsPushed,
        contactsFailed,
        errors,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      log.error("CRM push failed", error, {
        provider: this.provider,
        sourceAccountId: this.sourceAccount.id,
      });

      return {
        success: false,
        jobId,
        sourceAccountId: this.sourceAccount.id,
        provider: this.provider,
        contactsPushed,
        contactsFailed,
        errors: [
          ...errors,
          {
            code: "PUSH_FAILED",
            message: errorMessage,
            retryable: true,
          },
        ],
        duration: Date.now() - startTime,
      };
    }
  }

  // ===========================================================================
  // PRIVATE HELPER METHODS
  // ===========================================================================

  /**
   * Ensure OAuth token is valid, refresh if needed.
   */
  private async ensureValidToken(): Promise<void> {
    if (
      this.credentials.expiresAt &&
      this.credentials.expiresAt <= new Date()
    ) {
      log.info("Refreshing CRM token", {
        provider: this.provider,
        sourceAccountId: this.sourceAccount.id,
      });

      const newCredentials = await this.refreshToken();
      this.credentials = newCredentials;

      // Save new credentials
      await db
        .update(sourceAccount)
        .set({ credentials: newCredentials })
        .where(eq(sourceAccount.id, this.sourceAccount.id));
    }
  }

  /**
   * Process a single CRM contact - find/create/update in Drovi.
   */
  private async processContact(
    crmContact: CRMContactData
  ): Promise<{
    action: "created" | "updated" | "merged" | "skipped";
    contactId: string;
  }> {
    const organizationId = this.sourceAccount.organizationId;

    // Check if we already have a link to this CRM contact
    const existingLink = await db.query.contactSourceLink.findFirst({
      where: and(
        eq(contactSourceLink.sourceAccountId, this.sourceAccount.id),
        eq(contactSourceLink.externalId, crmContact.externalId)
      ),
    });

    if (existingLink) {
      // Update existing contact
      const contactData = this.mapContactToInternal(crmContact);
      await db
        .update(contact)
        .set({
          ...contactData,
          updatedAt: new Date(),
        })
        .where(eq(contact.id, existingLink.contactId));

      // Update link timestamp
      await db
        .update(contactSourceLink)
        .set({ lastPulledAt: new Date() })
        .where(eq(contactSourceLink.id, existingLink.id));

      return { action: "updated", contactId: existingLink.contactId };
    }

    // Try to find existing contact by email
    if (crmContact.primaryEmail) {
      const existingContact = await db.query.contact.findFirst({
        where: and(
          eq(contact.organizationId, organizationId),
          eq(contact.primaryEmail, crmContact.primaryEmail)
        ),
      });

      if (existingContact) {
        // Link existing contact to CRM
        await this.createContactLink(existingContact.id, crmContact);

        // Update contact with CRM data
        const contactData = this.mapContactToInternal(crmContact);
        await db
          .update(contact)
          .set({
            ...contactData,
            updatedAt: new Date(),
          })
          .where(eq(contact.id, existingContact.id));

        return { action: "merged", contactId: existingContact.id };
      }
    }

    // Create new contact
    const contactData = this.mapContactToInternal(crmContact);
    const [newContact] = await db
      .insert(contact)
      .values({
        ...contactData,
        organizationId,
        primaryEmail: crmContact.primaryEmail,
        sourceType: this.provider,
      })
      .returning({ id: contact.id });

    if (!newContact) {
      throw new Error("Failed to create contact");
    }

    // Create link and identities
    await this.createContactLink(newContact.id, crmContact);

    return { action: "created", contactId: newContact.id };
  }

  /**
   * Create link between Drovi contact and CRM record.
   */
  private async createContactLink(
    contactId: string,
    crmContact: CRMContactData
  ): Promise<void> {
    const organizationId = this.sourceAccount.organizationId;

    // Create source link
    await db.insert(contactSourceLink).values({
      contactId,
      sourceAccountId: this.sourceAccount.id,
      externalId: crmContact.externalId,
      externalType: crmContact.externalType,
      lastPulledAt: new Date(),
    });

    // Create identity for CRM ID
    const identityType = `crm_${this.provider}`;
    await db
      .insert(contactIdentity)
      .values({
        contactId,
        organizationId,
        identityType,
        identityValue: crmContact.externalId,
        confidence: 1.0,
        isVerified: true,
        source: `${this.provider}_sync`,
      })
      .onConflictDoNothing();
  }

  /**
   * Get contacts that are linked to this CRM for push operations.
   */
  private async getLinkedContacts(
    contactIds?: string[]
  ): Promise<Array<{ contact: typeof contact.$inferSelect; externalId: string }>> {
    const links = await db.query.contactSourceLink.findMany({
      where: contactIds
        ? and(
            eq(contactSourceLink.sourceAccountId, this.sourceAccount.id),
            // Filter by specific contact IDs if provided
            // Note: This would need proper SQL IN clause handling
          )
        : eq(contactSourceLink.sourceAccountId, this.sourceAccount.id),
      with: {
        contact: true,
      },
    });

    return links
      .filter((link) => link.contact)
      .map((link) => ({
        contact: link.contact!,
        externalId: link.externalId,
      }));
  }
}

/**
 * Factory function to create the appropriate CRM provider.
 */
export async function createCRMProvider(
  sourceAccountId: string
): Promise<CRMSyncProvider> {
  const account = await db.query.sourceAccount.findFirst({
    where: eq(sourceAccount.id, sourceAccountId),
  });

  if (!account) {
    throw new Error(`Source account not found: ${sourceAccountId}`);
  }

  // Dynamic import to avoid circular dependencies
  switch (account.type) {
    case "crm_salesforce": {
      const { SalesforceSyncProvider } = await import("./salesforce.js");
      return new SalesforceSyncProvider(account as CRMSourceAccount);
    }
    case "crm_hubspot": {
      const { HubSpotSyncProvider } = await import("./hubspot.js");
      return new HubSpotSyncProvider(account as CRMSourceAccount);
    }
    case "crm_pipedrive": {
      const { PipedriveSyncProvider } = await import("./pipedrive.js");
      return new PipedriveSyncProvider(account as CRMSourceAccount);
    }
    default:
      throw new Error(`Unsupported CRM type: ${account.type}`);
  }
}
