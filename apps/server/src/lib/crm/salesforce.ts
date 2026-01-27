// =============================================================================
// SALESFORCE SYNC PROVIDER
// =============================================================================
//
// Implements Salesforce-specific sync logic using Salesforce REST API.
// Supports Contact and Lead objects, with bi-directional sync.
//

import { log } from "../logger";
import { type CRMSourceAccount, CRMSyncProvider } from "./base";
import type {
  CRMContactData,
  CRMContactUpdate,
  CRMCredentials,
  CRMRateLimitInfo,
  CRMSyncOptions,
} from "./types";

// =============================================================================
// CONSTANTS
// =============================================================================

const SALESFORCE_API_VERSION = "v59.0";
const MAX_BATCH_SIZE = 200; // Salesforce composite limit

/**
 * Salesforce Contact fields to fetch.
 */
const CONTACT_FIELDS = [
  "Id",
  "FirstName",
  "LastName",
  "Name",
  "Email",
  "Phone",
  "MobilePhone",
  "Title",
  "Department",
  "Account.Name",
  "AccountId",
  "MailingStreet",
  "MailingCity",
  "MailingState",
  "MailingPostalCode",
  "MailingCountry",
  "OwnerId",
  "Owner.Email",
  "CreatedDate",
  "LastModifiedDate",
  "LastActivityDate",
].join(",");

/**
 * Salesforce Lead fields to fetch.
 */
const LEAD_FIELDS = [
  "Id",
  "FirstName",
  "LastName",
  "Name",
  "Email",
  "Phone",
  "MobilePhone",
  "Title",
  "Company",
  "Street",
  "City",
  "State",
  "PostalCode",
  "Country",
  "OwnerId",
  "Owner.Email",
  "CreatedDate",
  "LastModifiedDate",
  "LastActivityDate",
  "Status",
  "IsConverted",
].join(",");

// =============================================================================
// SALESFORCE SYNC PROVIDER
// =============================================================================

export class SalesforceSyncProvider extends CRMSyncProvider {
  private readonly instanceUrl: string;

  constructor(sourceAccount: CRMSourceAccount) {
    super(sourceAccount);
    this.instanceUrl =
      this.credentials.instanceUrl ?? this.settings.instanceUrl ?? "";

    if (!this.instanceUrl) {
      throw new Error("Salesforce instance URL not configured");
    }
  }

  /**
   * Make authenticated request to Salesforce API.
   */
  private async sfRequest<T>(
    endpoint: string,
    method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
    body?: unknown
  ): Promise<T> {
    const url = `${this.instanceUrl}/services/data/${SALESFORCE_API_VERSION}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.credentials.accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error("Salesforce API error", new Error(errorText), {
        endpoint,
        status: response.status,
      });
      throw new Error(
        `Salesforce API error: ${response.status} - ${errorText}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch contacts from Salesforce.
   */
  protected async fetchContacts(
    options: CRMSyncOptions
  ): Promise<{ contacts: CRMContactData[]; nextCursor?: string }> {
    const contacts: CRMContactData[] = [];

    // Build SOQL query for Contacts
    let contactQuery = `SELECT ${CONTACT_FIELDS} FROM Contact`;
    const conditions: string[] = [];

    if (options.since) {
      conditions.push(`LastModifiedDate > ${options.since.toISOString()}`);
    }

    if (conditions.length > 0) {
      contactQuery += ` WHERE ${conditions.join(" AND ")}`;
    }

    contactQuery += " ORDER BY LastModifiedDate ASC";

    if (options.limit) {
      contactQuery += ` LIMIT ${options.limit}`;
    }

    // Fetch contacts
    const contactResult = await this.sfRequest<SalesforceQueryResult>(
      `/query?q=${encodeURIComponent(contactQuery)}`
    );

    for (const record of contactResult.records) {
      contacts.push(this.mapSalesforceContact(record, "contact"));
    }

    // Build SOQL query for Leads (non-converted)
    let leadQuery = `SELECT ${LEAD_FIELDS} FROM Lead WHERE IsConverted = false`;

    if (options.since) {
      leadQuery += ` AND LastModifiedDate > ${options.since.toISOString()}`;
    }

    leadQuery += " ORDER BY LastModifiedDate ASC";

    if (options.limit) {
      const remainingLimit = Math.max(0, options.limit - contacts.length);
      leadQuery += ` LIMIT ${remainingLimit}`;
    }

    // Fetch leads
    const leadResult = await this.sfRequest<SalesforceQueryResult>(
      `/query?q=${encodeURIComponent(leadQuery)}`
    );

    for (const record of leadResult.records) {
      contacts.push(this.mapSalesforceContact(record, "lead"));
    }

    // Determine next cursor (use latest LastModifiedDate)
    let nextCursor: string | undefined;
    if (contacts.length > 0) {
      const lastContact = contacts.at(-1);
      if (lastContact?.metadata?.updatedAt) {
        nextCursor = lastContact.metadata.updatedAt.toISOString();
      }
    }

    return { contacts, nextCursor };
  }

  /**
   * Push contact updates to Salesforce.
   */
  protected async pushContactUpdates(updates: CRMContactUpdate[]): Promise<{
    success: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const success: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    // Use Salesforce Composite API for batch updates
    for (let i = 0; i < updates.length; i += MAX_BATCH_SIZE) {
      const batch = updates.slice(i, i + MAX_BATCH_SIZE);

      const compositeRequest = {
        allOrNone: false,
        compositeRequest: batch.map((update, idx) => {
          // Determine if it's a Contact or Lead based on ID prefix
          const objectType = update.externalId.startsWith("003")
            ? "Contact"
            : "Lead";

          return {
            method: "PATCH",
            url: `/services/data/${SALESFORCE_API_VERSION}/sobjects/${objectType}/${update.externalId}`,
            referenceId: `ref${idx}`,
            body: update.fields,
          };
        }),
      };

      try {
        const result = await this.sfRequest<SalesforceCompositeResult>(
          "/composite",
          "POST",
          compositeRequest
        );

        for (let j = 0; j < result.compositeResponse.length; j++) {
          const response = result.compositeResponse[j];
          const updateItem = batch[j];

          if (!updateItem) {
            continue;
          }

          if (
            response &&
            response.httpStatusCode >= 200 &&
            response.httpStatusCode < 300
          ) {
            success.push(updateItem.externalId);
          } else {
            const errorMsg = Array.isArray(response?.body)
              ? (response.body[0]?.message ?? "Unknown error")
              : "Unknown error";
            failed.push({
              id: updateItem.externalId,
              error: errorMsg,
            });
          }
        }
      } catch (error) {
        // If batch fails, mark all as failed
        for (const update of batch) {
          failed.push({
            id: update.externalId,
            error: error instanceof Error ? error.message : "Batch failed",
          });
        }
      }
    }

    return { success, failed };
  }

  /**
   * Refresh Salesforce OAuth token.
   */
  protected async refreshToken(): Promise<CRMCredentials> {
    if (!this.credentials.refreshToken) {
      throw new Error("No refresh token available");
    }

    const tokenUrl = `${this.instanceUrl}/services/oauth2/token`;
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.credentials.refreshToken,
      client_id: process.env.SALESFORCE_CLIENT_ID ?? "",
      client_secret: process.env.SALESFORCE_CLIENT_SECRET ?? "",
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh Salesforce token: ${response.status}`);
    }

    const data = (await response.json()) as SalesforceTokenResponse;

    return {
      accessToken: data.access_token,
      refreshToken: this.credentials.refreshToken, // Salesforce doesn't return new refresh token
      instanceUrl: data.instance_url,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
    };
  }

  /**
   * Get Salesforce rate limit info.
   */
  protected async getRateLimitInfo(): Promise<CRMRateLimitInfo | null> {
    try {
      const limits = await this.sfRequest<SalesforceLimits>("/limits");
      const dailyApiRequests = limits.DailyApiRequests;

      return {
        remaining: dailyApiRequests.Remaining,
        limit: dailyApiRequests.Max,
        resetAt: new Date(new Date().setHours(24, 0, 0, 0)), // Resets at midnight
      };
    } catch {
      return null;
    }
  }

  /**
   * Map Salesforce record to CRMContactData.
   */
  private mapSalesforceContact(
    record: SalesforceRecord,
    type: "contact" | "lead"
  ): CRMContactData {
    const displayName =
      record.Name ??
      [record.FirstName, record.LastName].filter(Boolean).join(" ");

    const phones: Array<{ type: string; number: string }> = [];
    if (record.Phone) {
      phones.push({ type: "work", number: record.Phone });
    }
    if (record.MobilePhone) {
      phones.push({ type: "mobile", number: record.MobilePhone });
    }

    return {
      externalId: record.Id,
      externalType: type,
      displayName: displayName || undefined,
      primaryEmail: record.Email ?? undefined,
      company:
        type === "contact"
          ? (record.Account?.Name ?? undefined)
          : (record.Company ?? undefined),
      title: record.Title ?? undefined,
      phones: phones.length > 0 ? phones : undefined,
      address: {
        street:
          type === "contact"
            ? record.MailingStreet
            : (record.Street ?? undefined),
        city:
          type === "contact" ? record.MailingCity : (record.City ?? undefined),
        state:
          type === "contact"
            ? record.MailingState
            : (record.State ?? undefined),
        postalCode:
          type === "contact"
            ? record.MailingPostalCode
            : (record.PostalCode ?? undefined),
        country:
          type === "contact"
            ? record.MailingCountry
            : (record.Country ?? undefined),
      },
      ownerId: record.OwnerId ?? undefined,
      ownerEmail: record.Owner?.Email ?? undefined,
      metadata: {
        createdAt: record.CreatedDate
          ? new Date(record.CreatedDate)
          : undefined,
        updatedAt: record.LastModifiedDate
          ? new Date(record.LastModifiedDate)
          : undefined,
        lastActivityAt: record.LastActivityDate
          ? new Date(record.LastActivityDate)
          : undefined,
      },
    };
  }
}

// =============================================================================
// SALESFORCE API TYPES
// =============================================================================

interface SalesforceQueryResult {
  totalSize: number;
  done: boolean;
  records: SalesforceRecord[];
  nextRecordsUrl?: string;
}

interface SalesforceRecord {
  Id: string;
  FirstName?: string;
  LastName?: string;
  Name?: string;
  Email?: string;
  Phone?: string;
  MobilePhone?: string;
  Title?: string;
  Department?: string;
  Company?: string;
  Account?: { Name: string };
  AccountId?: string;
  MailingStreet?: string;
  MailingCity?: string;
  MailingState?: string;
  MailingPostalCode?: string;
  MailingCountry?: string;
  Street?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  Country?: string;
  OwnerId?: string;
  Owner?: { Email: string };
  CreatedDate?: string;
  LastModifiedDate?: string;
  LastActivityDate?: string;
  Status?: string;
  IsConverted?: boolean;
}

interface SalesforceCompositeResult {
  compositeResponse: Array<{
    httpStatusCode: number;
    body: unknown;
    referenceId: string;
  }>;
}

interface SalesforceTokenResponse {
  access_token: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
  signature: string;
}

interface SalesforceLimits {
  DailyApiRequests: {
    Max: number;
    Remaining: number;
  };
  [key: string]: unknown;
}
