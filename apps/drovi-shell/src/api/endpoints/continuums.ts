import { apiClient } from "../client";
import {
  ContinuumListResponseSchema,
  ContinuumSchema,
  RunHistoryResponseSchema,
  ContinuumPreviewResponseSchema,
  type Continuum,
  type ContinuumListResponse,
  type ContinuumRun,
  type ContinuumPreviewResponse,
} from "../schemas";

export const continuumEndpoints = {
  /**
   * List all continuums for an organization
   */
  async list(organizationId: string): Promise<ContinuumListResponse> {
    return apiClient.requestWithSchema(
      `/api/v1/continuums?organization_id=${organizationId}`,
      ContinuumListResponseSchema,
      { method: "GET" }
    );
  },

  /**
   * Get a specific continuum
   */
  async get(continuumId: string, organizationId: string): Promise<Continuum> {
    return apiClient.requestWithSchema(
      `/api/v1/continuums/${continuumId}?organization_id=${organizationId}`,
      ContinuumSchema,
      { method: "GET" }
    );
  },

  /**
   * Trigger a manual run
   */
  async run(
    continuumId: string,
    organizationId: string,
    triggeredBy?: string
  ): Promise<ContinuumRun> {
    const response = await apiClient.request<ContinuumRun>(
      `/api/v1/continuums/${continuumId}/run`,
      {
        method: "POST",
        body: {
          organization_id: organizationId,
          triggered_by: triggeredBy ?? "shell",
        },
      }
    );
    return response;
  },

  /**
   * Pause a continuum
   */
  async pause(continuumId: string, organizationId: string): Promise<Continuum> {
    return apiClient.requestWithSchema(
      `/api/v1/continuums/${continuumId}/pause?organization_id=${organizationId}`,
      ContinuumSchema,
      { method: "POST" }
    );
  },

  /**
   * Activate a paused continuum
   */
  async activate(continuumId: string, organizationId: string): Promise<Continuum> {
    return apiClient.requestWithSchema(
      `/api/v1/continuums/${continuumId}/activate?organization_id=${organizationId}`,
      ContinuumSchema,
      { method: "POST" }
    );
  },

  /**
   * Rollback to a previous version
   */
  async rollback(
    continuumId: string,
    organizationId: string,
    targetVersion: number
  ): Promise<Continuum> {
    return apiClient.requestWithSchema(
      `/api/v1/continuums/${continuumId}/rollback?organization_id=${organizationId}`,
      ContinuumSchema,
      {
        method: "POST",
        body: { target_version: targetVersion },
      }
    );
  },

  /**
   * Override an alert
   */
  async override(
    continuumId: string,
    organizationId: string,
    alertId: string,
    resolvedBy: string,
    resolutionNotes?: string
  ): Promise<void> {
    await apiClient.request(
      `/api/v1/continuums/${continuumId}/override?organization_id=${organizationId}`,
      {
        method: "POST",
        body: {
          alert_id: alertId,
          resolved_by: resolvedBy,
          resolution_notes: resolutionNotes,
        },
      }
    );
  },

  /**
   * Preview/simulate a continuum execution
   */
  async preview(
    continuumId: string,
    organizationId: string,
    horizonDays: number
  ): Promise<ContinuumPreviewResponse> {
    return apiClient.requestWithSchema(
      `/api/v1/continuums/${continuumId}/preview?organization_id=${organizationId}`,
      ContinuumPreviewResponseSchema,
      {
        method: "POST",
        body: { horizon_days: horizonDays },
      }
    );
  },

  /**
   * Get run history
   */
  async getRunHistory(
    continuumId: string,
    organizationId: string
  ): Promise<ContinuumRun[]> {
    const response = await apiClient.requestWithSchema(
      `/api/v1/continuums/${continuumId}/runs?organization_id=${organizationId}`,
      RunHistoryResponseSchema,
      { method: "GET" }
    );
    return response.runs;
  },
};
