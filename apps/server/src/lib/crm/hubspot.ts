// =============================================================================
// HUBSPOT SYNC PROVIDER
// =============================================================================
//
// Implements HubSpot-specific sync logic using HubSpot CRM API v3.
// Supports Contacts object with bi-directional sync.
//

import { log } from "../logger";
import { CRMSyncProvider } from "./base";
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

const HUBSPOT_API_BASE = "https://api.hubapi.com";
const MAX_BATCH_SIZE = 100; // HubSpot batch limit

/**
 * HubSpot Contact properties to fetch.
 */
const CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "mobilephone",
  "jobtitle",
  "company",
  "address",
  "city",
  "state",
  "zip",
  "country",
  "hubspot_owner_id",
  "createdate",
  "lastmodifieddate",
  "hs_lead_status",
  "lifecyclestage",
  "linkedin_url",
  "twitter_handle",
].join(",");

// =============================================================================
// HUBSPOT SYNC PROVIDER
// =============================================================================

export class HubSpotSyncProvider extends CRMSyncProvider {
  /**
   * Make authenticated request to HubSpot API.
   */
  private async hsRequest<T>(
    endpoint: string,
    method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
    body?: unknown,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${HUBSPOT_API_BASE}${endpoint}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.credentials.accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error("HubSpot API error", new Error(errorText), {
        endpoint,
        status: response.status,
      });
      throw new Error(`HubSpot API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch contacts from HubSpot.
   */
  protected async fetchContacts(
    options: CRMSyncOptions
  ): Promise<{ contacts: CRMContactData[]; nextCursor?: string }> {
    const contacts: CRMContactData[] = [];
    let nextCursor: string | undefined = options.cursor;

    // Use search API for incremental sync with lastmodifieddate filter
    if (options.since && !options.cursor) {
      const searchRequest = {
        filterGroups: [
          {
            filters: [
              {
                propertyName: "lastmodifieddate",
                operator: "GTE",
                value: options.since.getTime().toString(),
              },
            ],
          },
        ],
        sorts: [
          {
            propertyName: "lastmodifieddate",
            direction: "ASCENDING",
          },
        ],
        properties: CONTACT_PROPERTIES.split(","),
        limit: options.limit ?? 100,
        after: options.cursor,
      };

      const result = await this.hsRequest<HubSpotSearchResult>(
        "/crm/v3/objects/contacts/search",
        "POST",
        searchRequest
      );

      for (const record of result.results) {
        contacts.push(this.mapHubSpotContact(record));
      }

      nextCursor = result.paging?.next?.after;
    } else {
      // Full sync or pagination
      const params: Record<string, string> = {
        properties: CONTACT_PROPERTIES,
        limit: (options.limit ?? 100).toString(),
      };

      if (options.cursor) {
        params.after = options.cursor;
      }

      const result = await this.hsRequest<HubSpotListResult>(
        "/crm/v3/objects/contacts",
        "GET",
        undefined,
        params
      );

      for (const record of result.results) {
        contacts.push(this.mapHubSpotContact(record));
      }

      nextCursor = result.paging?.next?.after;
    }

    return { contacts, nextCursor };
  }

  /**
   * Push contact updates to HubSpot.
   */
  protected async pushContactUpdates(updates: CRMContactUpdate[]): Promise<{
    success: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const success: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    // Use HubSpot batch update API
    for (let i = 0; i < updates.length; i += MAX_BATCH_SIZE) {
      const batch = updates.slice(i, i + MAX_BATCH_SIZE);

      const batchRequest = {
        inputs: batch.map((update) => ({
          id: update.externalId,
          properties: update.fields,
        })),
      };

      try {
        const result = await this.hsRequest<HubSpotBatchResult>(
          "/crm/v3/objects/contacts/batch/update",
          "POST",
          batchRequest
        );

        // All successful in batch
        for (const record of result.results) {
          success.push(record.id);
        }

        // Handle errors if any
        if (result.errors) {
          for (const error of result.errors) {
            const contactId = error.context?.ids?.[0];
            if (contactId) {
              failed.push({
                id: contactId,
                error: error.message,
              });
            }
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
   * Refresh HubSpot OAuth token.
   */
  protected async refreshToken(): Promise<CRMCredentials> {
    if (!this.credentials.refreshToken) {
      throw new Error("No refresh token available");
    }

    const tokenUrl = "https://api.hubapi.com/oauth/v1/token";
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.credentials.refreshToken,
      client_id: process.env.HUBSPOT_CLIENT_ID ?? "",
      client_secret: process.env.HUBSPOT_CLIENT_SECRET ?? "",
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh HubSpot token: ${response.status}`);
    }

    const data = (await response.json()) as HubSpotTokenResponse;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  /**
   * Get HubSpot rate limit info.
   */
  protected async getRateLimitInfo(): Promise<CRMRateLimitInfo | null> {
    // HubSpot returns rate limit info in response headers
    // For now, return null as we'd need to track headers from requests
    return null;
  }

  /**
   * Map HubSpot record to CRMContactData.
   */
  private mapHubSpotContact(record: HubSpotContact): CRMContactData {
    const props = record.properties;
    const displayName =
      [props.firstname, props.lastname].filter(Boolean).join(" ") || undefined;

    const phones: Array<{ type: string; number: string }> = [];
    if (props.phone) {
      phones.push({ type: "work", number: props.phone });
    }
    if (props.mobilephone) {
      phones.push({ type: "mobile", number: props.mobilephone });
    }

    return {
      externalId: record.id,
      externalType: "contact",
      displayName,
      primaryEmail: props.email ?? undefined,
      company: props.company ?? undefined,
      title: props.jobtitle ?? undefined,
      phones: phones.length > 0 ? phones : undefined,
      address: {
        street: props.address ?? undefined,
        city: props.city ?? undefined,
        state: props.state ?? undefined,
        postalCode: props.zip ?? undefined,
        country: props.country ?? undefined,
      },
      ownerId: props.hubspot_owner_id ?? undefined,
      linkedinUrl: props.linkedin_url ?? undefined,
      twitterHandle: props.twitter_handle ?? undefined,
      metadata: {
        createdAt: props.createdate ? new Date(props.createdate) : undefined,
        updatedAt: props.lastmodifieddate
          ? new Date(props.lastmodifieddate)
          : undefined,
        source: props.lifecyclestage ?? undefined,
      },
    };
  }
}

// =============================================================================
// HUBSPOT API TYPES
// =============================================================================

interface HubSpotContact {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    phone?: string;
    mobilephone?: string;
    jobtitle?: string;
    company?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    hubspot_owner_id?: string;
    createdate?: string;
    lastmodifieddate?: string;
    hs_lead_status?: string;
    lifecyclestage?: string;
    linkedin_url?: string;
    twitter_handle?: string;
    [key: string]: string | undefined;
  };
  createdAt: string;
  updatedAt: string;
}

interface HubSpotListResult {
  results: HubSpotContact[];
  paging?: {
    next?: {
      after: string;
      link: string;
    };
  };
}

interface HubSpotSearchResult extends HubSpotListResult {
  total: number;
}

interface HubSpotBatchResult {
  status: string;
  results: HubSpotContact[];
  errors?: Array<{
    message: string;
    context?: {
      ids?: string[];
    };
  }>;
}

interface HubSpotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}
