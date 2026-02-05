import { apiClient } from "../client";
import {
  AuthMeResponseSchema,
  LoginInitiateResponseSchema,
  EmailAuthResponseSchema,
  OrgInfoResponseSchema,
  type AuthMeResponse,
  type LoginInitiateResponse,
  type EmailAuthResponse,
  type OrgInfoResponse,
} from "../schemas";

export const authEndpoints = {
  /**
   * Initiate OAuth login flow
   */
  async initiateLogin(provider: string = "google"): Promise<LoginInitiateResponse> {
    return apiClient.requestWithSchema(
      `/api/v1/auth/login?provider=${provider}`,
      LoginInitiateResponseSchema,
      { method: "GET" }
    );
  },

  /**
   * Login with email and password
   */
  async loginWithEmail(email: string, password: string): Promise<EmailAuthResponse> {
    return apiClient.requestWithSchema(
      "/api/v1/auth/login/email",
      EmailAuthResponseSchema,
      {
        method: "POST",
        body: { email, password },
      }
    );
  },

  /**
   * Sign up with email and password
   */
  async signupWithEmail(email: string, password: string, name?: string): Promise<EmailAuthResponse> {
    return apiClient.requestWithSchema(
      "/api/v1/auth/signup/email",
      EmailAuthResponseSchema,
      {
        method: "POST",
        body: { email, password, name },
      }
    );
  },

  /**
   * Get current authenticated user
   */
  async getMe(): Promise<AuthMeResponse> {
    return apiClient.requestWithSchema(
      "/api/v1/auth/me",
      AuthMeResponseSchema,
      { method: "GET" }
    );
  },

  /**
   * Logout current session
   */
  async logout(): Promise<void> {
    await apiClient.request("/api/v1/auth/logout", { method: "POST" });
    apiClient.clearSession();
  },

  /**
   * Get organization info
   */
  async getOrgInfo(organizationId: string): Promise<OrgInfoResponse> {
    return apiClient.requestWithSchema(
      `/api/v1/org/info?organization_id=${organizationId}`,
      OrgInfoResponseSchema,
      { method: "GET" }
    );
  },

  /**
   * Set session token (after OAuth callback)
   */
  setSession(token: string): void {
    apiClient.setSession(token);
  },

  /**
   * Clear session
   */
  clearSession(): void {
    apiClient.clearSession();
  },
};
