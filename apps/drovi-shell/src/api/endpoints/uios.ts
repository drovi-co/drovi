import { apiClient } from "../client";
import {
  UIODetailSchema,
  UIOListResponseSchema,
  TrustScoresResponseSchema,
  type UIOBase,
  type UIODetail,
  type UIOListResponse,
  type UIOStatus,
  type UIOType,
  type TrustIndicator,
} from "../schemas";

export interface UIOListParams {
  organization_id: string;
  type?: UIOType;
  status?: UIOStatus;
  source_type?: string;
  limit?: number;
  offset?: number;
}

export const uioEndpoints = {
  /**
   * List UIOs with filters
   */
  async list(params: UIOListParams): Promise<UIOListResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set("organization_id", params.organization_id);
    if (params.type) searchParams.set("type", params.type);
    if (params.status) searchParams.set("status", params.status);
    if (params.source_type) searchParams.set("source_type", params.source_type);
    if (params.limit) searchParams.set("limit", params.limit.toString());
    if (params.offset) searchParams.set("offset", params.offset.toString());

    return apiClient.requestWithSchema(
      `/api/v1/uios?${searchParams}`,
      UIOListResponseSchema,
      { method: "GET" }
    );
  },

  /**
   * Get UIO details
   */
  async get(uioId: string, organizationId: string): Promise<UIODetail> {
    return apiClient.requestWithSchema(
      `/api/v1/uios/${uioId}?organization_id=${organizationId}`,
      UIODetailSchema,
      { method: "GET" }
    );
  },

  /**
   * Update UIO status
   */
  async updateStatus(
    uioId: string,
    organizationId: string,
    status: UIOStatus,
    userId?: string
  ): Promise<UIODetail> {
    return apiClient.requestWithSchema(
      `/api/v1/uios/${uioId}/status?organization_id=${organizationId}`,
      UIODetailSchema,
      {
        method: "POST",
        body: { status, user_id: userId },
      }
    );
  },

  /**
   * Correct a UIO field
   */
  async correct(
    uioId: string,
    organizationId: string,
    field: string,
    value: unknown,
    reason?: string
  ): Promise<UIODetail> {
    return apiClient.requestWithSchema(
      `/api/v1/uios/${uioId}/correct?organization_id=${organizationId}`,
      UIODetailSchema,
      {
        method: "POST",
        body: { field, value, reason },
      }
    );
  },

  /**
   * Verify a UIO (mark as user-verified)
   */
  async verify(uioId: string, organizationId: string): Promise<UIODetail> {
    return apiClient.requestWithSchema(
      `/api/v1/uios/${uioId}/verify?organization_id=${organizationId}`,
      UIODetailSchema,
      { method: "POST" }
    );
  },

  /**
   * Snooze a UIO
   */
  async snooze(
    uioId: string,
    organizationId: string,
    until: string
  ): Promise<UIODetail> {
    return apiClient.requestWithSchema(
      `/api/v1/uios/${uioId}/snooze?organization_id=${organizationId}`,
      UIODetailSchema,
      {
        method: "POST",
        body: { until },
      }
    );
  },

  /**
   * Merge duplicate UIOs
   */
  async merge(
    primaryUioId: string,
    targetUioId: string,
    organizationId: string,
    strategy: "keep_first" | "keep_latest" | "manual" = "keep_latest"
  ): Promise<UIODetail> {
    return apiClient.requestWithSchema(
      `/api/v1/uios/${primaryUioId}/merge/${targetUioId}?organization_id=${organizationId}`,
      UIODetailSchema,
      {
        method: "POST",
        body: { strategy },
      }
    );
  },

  /**
   * Get trust scores for UIOs
   */
  async getTrustScores(
    organizationId: string,
    uioIds: string[],
    evidenceLimit: number = 3
  ): Promise<TrustIndicator[]> {
    const response = await apiClient.requestWithSchema(
      "/api/v1/trust/uios",
      TrustScoresResponseSchema,
      {
        method: "POST",
        body: {
          organization_id: organizationId,
          uio_ids: uioIds,
          evidence_limit: evidenceLimit,
        },
      }
    );
    return response.indicators;
  },
};
