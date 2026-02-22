import { ApiError } from "../errors";
import type { ApiClient } from "../http/client";

import type {
  EmailAuthResponse,
  OrganizationsResponse,
  PasswordResetConfirmResponse,
  PasswordResetRequestResponse,
  SwitchOrganizationResponse,
} from "./models";
import type { User } from "./models/org";

export function createAuthApi(client: ApiClient) {
  return {
    async loginWithEmail(params: {
      email: string;
      password: string;
      inviteToken?: string;
    }): Promise<EmailAuthResponse> {
      return client.requestJson<EmailAuthResponse>("/auth/login/email", {
        method: "POST",
        body: {
          email: params.email,
          password: params.password,
          invite_token: params.inviteToken ?? null,
        },
        allowRetry: false,
      });
    },

    async signupWithEmail(params: {
      email: string;
      password: string;
      name?: string;
      organizationName?: string;
      inviteToken?: string;
    }): Promise<EmailAuthResponse> {
      return client.requestJson<EmailAuthResponse>("/auth/signup/email", {
        method: "POST",
        body: {
          email: params.email,
          password: params.password,
          name: params.name ?? null,
          organization_name: params.organizationName ?? null,
          invite_token: params.inviteToken ?? null,
        },
        allowRetry: false,
      });
    },

    async getMe(): Promise<User | null> {
      try {
        return await client.requestJson<User>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          return null;
        }
        throw e;
      }
    },

    async listOrganizations(): Promise<OrganizationsResponse> {
      return client.requestJson<OrganizationsResponse>("/auth/organizations");
    },

    async switchOrganization(
      organizationId: string
    ): Promise<SwitchOrganizationResponse> {
      return client.requestJson<SwitchOrganizationResponse>(
        "/auth/switch-organization",
        {
          method: "POST",
          body: { organization_id: organizationId },
          allowRetry: false,
        }
      );
    },

    async requestPasswordReset(
      email: string
    ): Promise<PasswordResetRequestResponse> {
      return client.requestJson<PasswordResetRequestResponse>(
        "/auth/password-reset/request",
        {
          method: "POST",
          body: { email },
          allowRetry: false,
        }
      );
    },

    async confirmPasswordReset(
      token: string,
      newPassword: string
    ): Promise<PasswordResetConfirmResponse> {
      return client.requestJson<PasswordResetConfirmResponse>(
        "/auth/password-reset/confirm",
        {
          method: "POST",
          body: { token, new_password: newPassword },
          allowRetry: false,
        }
      );
    },

    async updateMyLocale(
      locale: string | null
    ): Promise<{ ok: boolean; locale: string | null }> {
      return client.requestJson<{ ok: boolean; locale: string | null }>(
        "/auth/me/locale",
        {
          method: "PATCH",
          body: { locale },
        }
      );
    },

    async logout(): Promise<void> {
      await client.requestJson<{ success: boolean }>("/auth/logout", {
        method: "POST",
        allowRetry: false,
      });
    },
  };
}
