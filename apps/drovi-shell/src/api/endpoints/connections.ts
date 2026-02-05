import { apiClient } from "../client";
import {
  ConnectionListResponseSchema,
  ConnectionSchema,
  OAuthInitiateResponseSchema,
  SyncStatusResponseSchema,
  type Connection,
  type ConnectionListResponse,
  type ConnectorType,
  type OAuthInitiateResponse,
  type SyncStatusResponse,
} from "../schemas";

export const connectionEndpoints = {
  /**
   * List all connections for an organization
   */
  async list(organizationId: string): Promise<ConnectionListResponse> {
    return apiClient.requestWithSchema(
      `/api/v1/connections?organization_id=${organizationId}`,
      ConnectionListResponseSchema,
      { method: "GET" }
    );
  },

  /**
   * Get a specific connection
   */
  async get(connectionId: string, organizationId: string): Promise<Connection> {
    return apiClient.requestWithSchema(
      `/api/v1/connections/${connectionId}?organization_id=${organizationId}`,
      ConnectionSchema,
      { method: "GET" }
    );
  },

  /**
   * Initiate OAuth flow for a provider
   */
  async initiateOAuth(
    provider: ConnectorType,
    organizationId: string,
    redirectUri?: string
  ): Promise<OAuthInitiateResponse> {
    return apiClient.requestWithSchema(
      `/api/v1/connections/${provider}/oauth/initiate`,
      OAuthInitiateResponseSchema,
      {
        method: "POST",
        body: {
          organization_id: organizationId,
          redirect_uri: redirectUri,
        },
      }
    );
  },

  /**
   * Create a new connection
   */
  async create(
    connectorType: ConnectorType,
    name: string,
    organizationId: string,
    config?: Record<string, unknown>
  ): Promise<Connection> {
    return apiClient.requestWithSchema(
      "/api/v1/connections",
      ConnectionSchema,
      {
        method: "POST",
        body: {
          connector_type: connectorType,
          name,
          organization_id: organizationId,
          config,
        },
      }
    );
  },

  /**
   * Trigger sync for a connection
   */
  async triggerSync(connectionId: string, organizationId: string): Promise<void> {
    await apiClient.request(
      `/api/v1/connections/${connectionId}/sync?organization_id=${organizationId}`,
      { method: "POST" }
    );
  },

  /**
   * Get sync status for a connection
   */
  async getSyncStatus(
    connectionId: string,
    organizationId: string
  ): Promise<SyncStatusResponse> {
    return apiClient.requestWithSchema(
      `/api/v1/connections/${connectionId}/sync-status?organization_id=${organizationId}`,
      SyncStatusResponseSchema,
      { method: "GET" }
    );
  },

  /**
   * Delete a connection
   */
  async delete(connectionId: string, organizationId: string): Promise<void> {
    await apiClient.request(
      `/api/v1/connections/${connectionId}?organization_id=${organizationId}`,
      { method: "DELETE" }
    );
  },
};
