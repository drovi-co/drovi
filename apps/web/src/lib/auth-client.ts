/**
 * Auth Client Compatibility Layer
 *
 * Provides a compatible interface for components that used the old better-auth client.
 * This wraps the new Python backend auth (from ./auth.ts).
 */

import { useEffect, useState, useCallback } from "react";
import { authAPI, type User } from "./api";
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
   * Sign in with email/password or OAuth
   */
  async signIn(
    _credentials: { email: string; password: string } | { provider: "google" | "github" },
    _options?: { callbackURL?: string }
  ): Promise<{ error?: { message: string } }> {
    // For now, redirect to OAuth
    const store = useAuthStore.getState();
    try {
      await store.login("google");
      return {};
    } catch (error) {
      return { error: { message: error instanceof Error ? error.message : "Sign in failed" } };
    }
  },

  /**
   * Sign up with email/password
   */
  async signUp(
    _data: { email: string; password: string; name?: string },
    _options?: { callbackURL?: string }
  ): Promise<{ error?: { message: string } }> {
    // For now, redirect to OAuth - the Python backend handles user creation
    const store = useAuthStore.getState();
    try {
      await store.login("google");
      return {};
    } catch (error) {
      return { error: { message: error instanceof Error ? error.message : "Sign up failed" } };
    }
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
  },
};

// =============================================================================
// SIGN IN/UP/OUT FUNCTIONS (Compatible with old exports)
// =============================================================================

export async function signIn(
  provider: "google" | "credentials" = "google",
  _credentials?: { email: string; password: string }
) {
  const store = useAuthStore.getState();
  await store.login(provider);
}

export async function signUp(
  _data: { email: string; password: string; name?: string }
) {
  // For now, redirect to OAuth - the Python backend handles user creation
  const store = useAuthStore.getState();
  await store.login("google");
}

export async function signOut() {
  const store = useAuthStore.getState();
  await store.logout();
}
