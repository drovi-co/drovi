/**
 * Admin API facade (Drovi Intelligence).
 *
 * Phase 7 goal:
 * - Use the shared API client/types packages to avoid duplicating request logic.
 * - Keep `apps/admin` call sites stable (`@/lib/api` exports).
 */

import {
  ApiError as APIError,
  ApiClient,
  createSupportApi,
} from "@memorystack/api-client";
import {
  type AdminMe,
  createAdminApi,
  createAdminAuthApi,
  type GovernanceOverviewResponse,
  type GovernanceSignal,
  type KPIBlock,
} from "@memorystack/api-client/admin";
import type {
  SupportTicketListItem,
  SupportTicketMessageItem,
} from "@memorystack/api-client/support";
import { env } from "@memorystack/env/web";

import { getAdminSessionToken } from "./admin-session-token";

export { APIError };
export type {
  AdminMe,
  GovernanceOverviewResponse,
  GovernanceSignal,
  KPIBlock,
  SupportTicketListItem,
  SupportTicketMessageItem,
};

const client = new ApiClient({
  baseUrl: env.VITE_SERVER_URL,
  auth: [
    { kind: "cookie" },
    { kind: "bearer", getToken: () => getAdminSessionToken() },
  ],
});

export const adminAuthAPI = createAdminAuthApi(client);
export const adminAPI = createAdminApi(client);
export const supportAPI = createSupportApi(client);
