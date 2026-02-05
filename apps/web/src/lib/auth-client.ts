/**
 * Auth Client Compatibility Layer
 *
 * Provides a compatible interface for components that used the old better-auth client.
 * This wraps the new Python backend auth (from ./auth.ts).
 */

import { useEffect, useState, useCallback } from "react";
import { authAPI, orgAPI, type OrgInvite, type OrgMember, type User } from "./api";
import { useAuthStore, initializeAuth } from "./auth";

// Re-export the auth store for convenience
export { useAuthStore, initializeAuth } from "./auth";

// =============================================================================
// SESSION HOOK (Compatible with old useSession)
// =============================================================================

interface SessionData {
  user: {
    id: string;
    email: string;
    name?: string;
    image?: string;
    role?: string;
  } | null;
}

interface SessionResult {
  data: SessionData | null;
  isPending: boolean;
  error: Error | null;
}

export function useSession(): SessionResult {
  const { user, isLoading, isAuthenticated, error, checkAuth } = useAuthStore();
  const [hasChecked, setHasChecked] = useState(false);

  // Check auth on first mount
  useEffect(() => {
    if (!hasChecked) {
      setHasChecked(true);
      checkAuth();
    }
  }, [hasChecked, checkAuth]);

  if (!isAuthenticated || !user) {
    return {
      data: null,
      isPending: isLoading,
      error: error ? new Error(error) : null,
    };
  }

  return {
    data: {
      user: {
        id: user.user_id,
        email: user.email,
        role: user.role,
      },
    },
    isPending: false,
    error: error ? new Error(error) : null,
  };
}

// =============================================================================
// ORGANIZATION HOOKS (Compatible with old organization hooks)
// =============================================================================

interface Organization {
  id: string;
  name: string;
  slug?: string;
}

interface ActiveOrgResult {
  data: Organization | null;
  isPending: boolean;
}

export function useActiveOrganization(): ActiveOrgResult {
  const { user, isLoading, isAuthenticated, checkAuth } = useAuthStore();

  // Trigger auth check on mount if needed
  useEffect(() => {
    if (isLoading && !isAuthenticated && user === null) {
      checkAuth();
    }
  }, [isLoading, isAuthenticated, user, checkAuth]);

  if (!user) {
    return { data: null, isPending: isLoading };
  }

  return {
    data: {
      id: user.org_id,
      name: user.org_name,
    },
    isPending: false,
  };
}

interface ListOrgsResult {
  data: Organization[] | null;
  isPending: boolean;
}

export function useListOrganizations(): ListOrgsResult {
  const { user, isLoading, isAuthenticated, checkAuth } = useAuthStore();

  // Trigger auth check on mount if needed
  useEffect(() => {
    if (isLoading && !isAuthenticated && user === null) {
      checkAuth();
    }
  }, [isLoading, isAuthenticated, user, checkAuth]);

  if (!user) {
    return { data: null, isPending: isLoading };
  }

  // Return single org (multi-org support can be added later)
  return {
    data: [
      {
        id: user.org_id,
        name: user.org_name,
      },
    ],
    isPending: false,
  };
}

// =============================================================================
// AUTH CLIENT OBJECT (Compatible with old authClient)
// =============================================================================

export const authClient = {
  /**
   * Get current session (async version)
   */
  async getSession(): Promise<{ data: SessionData | null }> {
    try {
      const user = await authAPI.getMe();
      if (!user) {
        return { data: null };
      }
      return {
        data: {
          user: {
            id: user.user_id,
            email: user.email,
            role: user.role,
          },
        },
      };
    } catch {
      return { data: null };
    }
  },

  /**
   * useSession hook
   */
  useSession,

  /**
   * useActiveOrganization hook
   */
  useActiveOrganization,

  /**
   * useListOrganizations hook
   */
  useListOrganizations,

  /**
   * Sign in with email/password
   */
  signIn: {
    async email(
      params: { email: string; password: string; rememberMe?: boolean },
      callbacks?: {
        onSuccess?: () => void;
        onError?: (error: { error: { message: string; status?: number; statusText?: string } }) => void;
      }
    ) {
      const store = useAuthStore.getState();
      try {
        await store.loginWithEmail(params.email, params.password);
        callbacks?.onSuccess?.();
        return { data: true };
      } catch (error) {
        callbacks?.onError?.({
          error: {
            message: error instanceof Error ? error.message : "Sign in failed",
          },
        });
        return { error: { message: "Sign in failed" } };
      }
    },
  },

  /**
   * Sign up with email/password
   */
  signUp: {
    async email(
      params: {
        email: string;
        password: string;
        name?: string;
        organizationName?: string;
        inviteToken?: string;
      },
      callbacks?: {
        onSuccess?: () => void;
        onError?: (error: { error: { message: string; status?: number; statusText?: string } }) => void;
      }
    ) {
      const store = useAuthStore.getState();
      try {
        await store.signupWithEmail({
          email: params.email,
          password: params.password,
          name: params.name,
          organizationName: params.organizationName,
          inviteToken: params.inviteToken,
        });
        callbacks?.onSuccess?.();
        return { data: true };
      } catch (error) {
        callbacks?.onError?.({
          error: {
            message: error instanceof Error ? error.message : "Sign up failed",
          },
        });
        return { error: { message: "Sign up failed" } };
      }
    },
  },

  /**
   * Sign out
   */
  async signOut(): Promise<void> {
    const store = useAuthStore.getState();
    await store.logout();
  },

  /**
   * Reset password
   */
  async resetPassword(_email: string): Promise<{ error?: { message: string } }> {
    // TODO: Implement when Python backend supports password reset
    return { error: { message: "Password reset not yet implemented" } };
  },

  /**
   * Organization namespace (for compatibility)
   */
  organization: {
    async getActiveMember(): Promise<{ data: { organizationId: string } | null }> {
      const store = useAuthStore.getState();
      if (!store.user) {
        await store.checkAuth();
      }
      const user = useAuthStore.getState().user;
      if (!user) {
        return { data: null };
      }
      return { data: { organizationId: user.org_id } };
    },

    async list(): Promise<{ data: Organization[] | null }> {
      const store = useAuthStore.getState();
      const user = store.user;
      if (!user) {
        return { data: null };
      }
      return {
        data: [
          {
            id: user.org_id,
            name: user.org_name,
          },
        ],
      };
    },

    async setActive(_opts: { organizationId: string }): Promise<void> {
      // TODO: Implement when Python backend supports multiple orgs
    },

    async listMembers(): Promise<{ data: { members: OrgMember[] } | null }> {
      const members = await orgAPI.listMembers();
      return { data: { members } };
    },

    async updateMemberRole(params: { memberId: string; role: "admin" | "member"; organizationId: string }) {
      await orgAPI.updateMemberRole({
        userId: params.memberId,
        role: params.role === "admin" ? "pilot_admin" : "pilot_member",
      });
      return { data: true };
    },

    async removeMember(params: { memberIdOrEmail: string; organizationId: string }) {
      await orgAPI.removeMember(params.memberIdOrEmail);
      return { data: true };
    },

    async listInvitations(): Promise<{ data: OrgInvite[] | null }> {
      const invites = await orgAPI.listInvites();
      return { data: invites };
    },

    async inviteMember(params: { email: string; role: "admin" | "member"; organizationId: string }) {
      await orgAPI.createInvite({
        email: params.email,
        role: params.role === "admin" ? "pilot_admin" : "pilot_member",
      });
      return { data: true };
    },

    async cancelInvitation(params: { invitationId: string }) {
      await orgAPI.revokeInvite(params.invitationId);
      return { data: true };
    },

    async update(params: {
      organizationId: string;
      name?: string;
      allowedDomains?: string[];
      notificationEmails?: string[];
      region?: string;
    }) {
      const updated = await orgAPI.updateOrgInfo({
        name: params.name,
        allowedDomains: params.allowedDomains,
        notificationEmails: params.notificationEmails,
        region: params.region,
      });
      return { data: updated };
    },
  },
};

// =============================================================================
// SIGN IN/UP/OUT FUNCTIONS (Compatible with old exports)
// =============================================================================

export async function signIn() {
  throw new Error("Use authClient.signIn.email instead.");
}

export async function signUp() {
  throw new Error("Use authClient.signUp.email instead.");
}

export async function signOut() {
  const store = useAuthStore.getState();
  await store.logout();
}
