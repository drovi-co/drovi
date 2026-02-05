import { apiClient } from "../client";
import {
  ContactListResponseSchema,
  ContactDetailSchema,
  RiskAssessmentResponseSchema,
  type ContactSummary,
  type ContactDetail,
  type ContactListResponse,
  type RiskAssessmentResponse,
} from "../schemas";

export interface ContactListParams {
  organization_id: string;
  is_vip?: boolean;
  is_at_risk?: boolean;
  lifecycle_stage?: string;
  limit?: number;
  offset?: number;
}

export const contactEndpoints = {
  /**
   * List contacts with filters
   */
  async list(params: ContactListParams): Promise<ContactListResponse> {
    const searchParams = new URLSearchParams();
    searchParams.set("organization_id", params.organization_id);
    if (params.is_vip !== undefined) searchParams.set("is_vip", String(params.is_vip));
    if (params.is_at_risk !== undefined) searchParams.set("is_at_risk", String(params.is_at_risk));
    if (params.lifecycle_stage) searchParams.set("lifecycle_stage", params.lifecycle_stage);
    if (params.limit) searchParams.set("limit", params.limit.toString());
    if (params.offset) searchParams.set("offset", params.offset.toString());

    return apiClient.requestWithSchema(
      `/api/v1/contacts?${searchParams}`,
      ContactListResponseSchema,
      { method: "GET" }
    );
  },

  /**
   * Get contact details
   */
  async get(contactId: string, organizationId: string): Promise<ContactDetail> {
    return apiClient.requestWithSchema(
      `/api/v1/contacts/${contactId}?organization_id=${organizationId}`,
      ContactDetailSchema,
      { method: "GET" }
    );
  },

  /**
   * Search contacts
   */
  async search(
    organizationId: string,
    query: string,
    limit: number = 20
  ): Promise<ContactListResponse> {
    return apiClient.requestWithSchema(
      `/api/v1/contacts/search?organization_id=${organizationId}&query=${encodeURIComponent(query)}&limit=${limit}`,
      ContactListResponseSchema,
      { method: "GET" }
    );
  },

  /**
   * Update VIP status
   */
  async updateVIPStatus(
    contactId: string,
    organizationId: string,
    isVip: boolean,
    reason?: string
  ): Promise<ContactDetail> {
    return apiClient.requestWithSchema(
      `/api/v1/contacts/${contactId}/vip-status?organization_id=${organizationId}`,
      ContactDetailSchema,
      {
        method: "POST",
        body: { is_vip: isVip, reason },
      }
    );
  },

  /**
   * Trigger risk assessment
   */
  async assessRisk(
    contactId: string,
    organizationId: string
  ): Promise<RiskAssessmentResponse> {
    return apiClient.requestWithSchema(
      `/api/v1/contacts/${contactId}/risk-assessment?organization_id=${organizationId}`,
      RiskAssessmentResponseSchema,
      {
        method: "POST",
        body: { reassess: true },
      }
    );
  },
};
