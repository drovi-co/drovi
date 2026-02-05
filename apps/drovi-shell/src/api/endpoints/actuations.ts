import { apiClient } from "../client";
import {
  ActuationSchema,
  ActuationListResponseSchema,
  type Actuation,
  type ActuationListResponse,
  type CreateActuationRequest,
  type ActuationStatus,
} from "../schemas";

export const actuationEndpoints = {
  /**
   * List all actuations for an organization
   */
  async list(
    organizationId: string,
    status?: ActuationStatus,
    limit = 50
  ): Promise<ActuationListResponse> {
    const params = new URLSearchParams();
    params.set("organization_id", organizationId);
    if (status) params.set("status", status);
    params.set("limit", limit.toString());

    return apiClient.requestWithSchema(
      `/api/v1/actuations?${params}`,
      ActuationListResponseSchema,
      { method: "GET" }
    );
  },

  /**
   * Get a specific actuation
   */
  async get(actuationId: string, organizationId: string): Promise<Actuation> {
    return apiClient.requestWithSchema(
      `/api/v1/actuations/${actuationId}?organization_id=${organizationId}`,
      ActuationSchema,
      { method: "GET" }
    );
  },

  /**
   * Create a new actuation (draft)
   */
  async create(request: CreateActuationRequest): Promise<Actuation> {
    return apiClient.requestWithSchema(
      "/api/v1/actuations",
      ActuationSchema,
      {
        method: "POST",
        body: request,
      }
    );
  },

  /**
   * Approve an actuation
   */
  async approve(
    actuationId: string,
    organizationId: string,
    notes?: string
  ): Promise<Actuation> {
    return apiClient.requestWithSchema(
      `/api/v1/actuations/${actuationId}/approve?organization_id=${organizationId}`,
      ActuationSchema,
      {
        method: "POST",
        body: { notes },
      }
    );
  },

  /**
   * Execute an actuation
   */
  async execute(
    actuationId: string,
    organizationId: string,
    dryRun = false
  ): Promise<Actuation> {
    return apiClient.requestWithSchema(
      `/api/v1/actuations/${actuationId}/execute?organization_id=${organizationId}`,
      ActuationSchema,
      {
        method: "POST",
        body: { dry_run: dryRun },
      }
    );
  },

  /**
   * Cancel an actuation
   */
  async cancel(
    actuationId: string,
    organizationId: string,
    reason?: string
  ): Promise<Actuation> {
    return apiClient.requestWithSchema(
      `/api/v1/actuations/${actuationId}/cancel?organization_id=${organizationId}`,
      ActuationSchema,
      {
        method: "POST",
        body: { reason },
      }
    );
  },

  /**
   * Rollback a completed actuation
   */
  async rollback(
    actuationId: string,
    organizationId: string,
    reason?: string
  ): Promise<Actuation> {
    return apiClient.requestWithSchema(
      `/api/v1/actuations/${actuationId}/rollback?organization_id=${organizationId}`,
      ActuationSchema,
      {
        method: "POST",
        body: { reason },
      }
    );
  },
};
