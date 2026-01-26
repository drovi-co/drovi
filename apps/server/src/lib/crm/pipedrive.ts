// =============================================================================
// PIPEDRIVE SYNC PROVIDER
// =============================================================================
//
// Implements Pipedrive-specific sync logic using Pipedrive REST API v1.
// Supports Persons (contacts) and Organizations with bi-directional sync.
//

import { log } from "../logger";
import { CRMSyncProvider, type CRMSourceAccount } from "./base";
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

const PIPEDRIVE_API_BASE = "https://api.pipedrive.com/v1";
const MAX_BATCH_SIZE = 100;

// =============================================================================
// PIPEDRIVE SYNC PROVIDER
// =============================================================================

export class PipedriveSyncProvider extends CRMSyncProvider {
  constructor(sourceAccount: CRMSourceAccount) {
    super(sourceAccount);
  }

  /**
   * Make authenticated request to Pipedrive API.
   */
  private async pdRequest<T>(
    endpoint: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    body?: unknown,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${PIPEDRIVE_API_BASE}${endpoint}`);

    // Pipedrive uses API token as query param
    url.searchParams.set("api_token", this.credentials.accessToken);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error("Pipedrive API error", new Error(errorText), {
        endpoint,
        status: response.status,
      });
      throw new Error(`Pipedrive API error: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch contacts (persons) from Pipedrive.
   */
  protected async fetchContacts(
    options: CRMSyncOptions
  ): Promise<{ contacts: CRMContactData[]; nextCursor?: string }> {
    const contacts: CRMContactData[] = [];

    const params: Record<string, string> = {
      limit: (options.limit ?? 100).toString(),
      sort: "update_time ASC",
    };

    // Pipedrive uses start offset for pagination
    if (options.cursor) {
      params.start = options.cursor;
    }

    // Filter by update time for incremental sync
    if (options.since) {
      params.filter_id = ""; // Would need to create a filter or use recent changes endpoint
    }

    // Fetch persons
    const result = await this.pdRequest<PipedriveListResult<PipedrivePerson>>(
      "/persons",
      "GET",
      undefined,
      params
    );

    if (result.data) {
      // Also fetch organizations for company info
      const orgIds = new Set(
        result.data
          .filter((p) => p.org_id?.value)
          .map((p) => p.org_id?.value)
      );

      const orgsMap = new Map<number, PipedriveOrg>();
      if (orgIds.size > 0) {
        for (const orgId of orgIds) {
          if (!orgId) continue;
          try {
            const orgResult = await this.pdRequest<PipedriveItemResult<PipedriveOrg>>(
              `/organizations/${orgId}`
            );
            if (orgResult.data) {
              orgsMap.set(orgId, orgResult.data);
            }
          } catch {
            // Ignore org fetch errors
          }
        }
      }

      for (const person of result.data) {
        const org = person.org_id?.value ? orgsMap.get(person.org_id.value) : undefined;
        contacts.push(this.mapPipedrivePerson(person, org));
      }
    }

    // Calculate next cursor
    let nextCursor: string | undefined;
    if (
      result.additional_data?.pagination?.more_items_in_collection
    ) {
      const nextStart =
        (result.additional_data.pagination.start ?? 0) +
        (result.additional_data.pagination.limit ?? 100);
      nextCursor = nextStart.toString();
    }

    return { contacts, nextCursor };
  }

  /**
   * Push contact updates to Pipedrive.
   */
  protected async pushContactUpdates(
    updates: CRMContactUpdate[]
  ): Promise<{
    success: string[];
    failed: Array<{ id: string; error: string }>;
  }> {
    const success: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    // Pipedrive doesn't have a batch update API, so we update one by one
    // But we can parallelize with rate limiting
    const CONCURRENT_LIMIT = 5;

    for (let i = 0; i < updates.length; i += CONCURRENT_LIMIT) {
      const batch = updates.slice(i, i + CONCURRENT_LIMIT);

      const results = await Promise.allSettled(
        batch.map(async (update) => {
          try {
            await this.pdRequest<PipedriveItemResult<PipedrivePerson>>(
              `/persons/${update.externalId}`,
              "PUT",
              update.fields
            );
            return { success: true, id: update.externalId };
          } catch (error) {
            return {
              success: false,
              id: update.externalId,
              error: error instanceof Error ? error.message : "Unknown error",
            };
          }
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          if (result.value.success) {
            success.push(result.value.id);
          } else {
            failed.push({
              id: result.value.id,
              error: result.value.error ?? "Unknown error",
            });
          }
        } else {
          // Promise rejected - shouldn't happen with our try/catch
          log.error("Pipedrive update promise rejected", result.reason);
        }
      }
    }

    return { success, failed };
  }

  /**
   * Refresh Pipedrive OAuth token.
   */
  protected async refreshToken(): Promise<CRMCredentials> {
    if (!this.credentials.refreshToken) {
      throw new Error("No refresh token available");
    }

    const tokenUrl = "https://oauth.pipedrive.com/oauth/token";
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.credentials.refreshToken,
      client_id: process.env.PIPEDRIVE_CLIENT_ID ?? "",
      client_secret: process.env.PIPEDRIVE_CLIENT_SECRET ?? "",
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh Pipedrive token: ${response.status}`);
    }

    const data = (await response.json()) as PipedriveTokenResponse;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  /**
   * Get Pipedrive rate limit info.
   */
  protected async getRateLimitInfo(): Promise<CRMRateLimitInfo | null> {
    // Pipedrive returns rate limit in headers (X-RateLimit-Remaining, X-RateLimit-Limit)
    // Would need to track from actual responses
    return null;
  }

  /**
   * Map Pipedrive person to CRMContactData.
   */
  private mapPipedrivePerson(
    person: PipedrivePerson,
    org?: PipedriveOrg
  ): CRMContactData {
    const phones: Array<{ type: string; number: string }> = [];
    if (person.phone) {
      for (const phone of person.phone) {
        if (phone.value) {
          phones.push({
            type: phone.label ?? "other",
            number: phone.value,
          });
        }
      }
    }

    const emails: string[] = [];
    let primaryEmail: string | undefined;
    if (person.email) {
      for (const email of person.email) {
        if (email.value) {
          if (email.primary || !primaryEmail) {
            primaryEmail = email.value;
          } else {
            emails.push(email.value);
          }
        }
      }
    }

    return {
      externalId: person.id.toString(),
      externalType: "person",
      displayName: person.name ?? undefined,
      primaryEmail,
      additionalEmails: emails.length > 0 ? emails : undefined,
      company: org?.name ?? person.org_name ?? undefined,
      title: person.job_title ?? undefined,
      phones: phones.length > 0 ? phones : undefined,
      ownerId: person.owner_id?.id?.toString() ?? undefined,
      metadata: {
        createdAt: person.add_time
          ? new Date(person.add_time)
          : undefined,
        updatedAt: person.update_time
          ? new Date(person.update_time)
          : undefined,
        lastActivityAt: person.last_activity_date
          ? new Date(person.last_activity_date)
          : undefined,
        tags: person.label_ids?.map((id) => id.toString()),
      },
    };
  }
}

// =============================================================================
// PIPEDRIVE API TYPES
// =============================================================================

interface PipedriveListResult<T> {
  success: boolean;
  data: T[] | null;
  additional_data?: {
    pagination?: {
      start?: number;
      limit?: number;
      more_items_in_collection?: boolean;
    };
  };
}

interface PipedriveItemResult<T> {
  success: boolean;
  data: T | null;
}

interface PipedrivePerson {
  id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: Array<{
    value?: string;
    label?: string;
    primary?: boolean;
  }>;
  phone?: Array<{
    value?: string;
    label?: string;
    primary?: boolean;
  }>;
  job_title?: string;
  org_id?: {
    value?: number;
    name?: string;
  };
  org_name?: string;
  owner_id?: {
    id?: number;
    name?: string;
    email?: string;
  };
  add_time?: string;
  update_time?: string;
  last_activity_date?: string;
  label_ids?: number[];
  visible_to?: number;
  active_flag?: boolean;
}

interface PipedriveOrg {
  id: number;
  name?: string;
  address?: string;
  owner_id?: {
    id?: number;
    name?: string;
  };
}

interface PipedriveTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}
