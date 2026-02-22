/**
 * Auth Utilities for Python Backend
 *
 * Handles authentication state and OAuth flows.
 * Uses cookie-based session auth (httpOnly cookies).
 */

import { useEffect } from "react";
import { create } from "zustand";
import { authAPI, type User } from "./api";
import { clearSessionToken, setSessionToken } from "./session-token";

// Auth sequencing model:
// - "Interactive" ops (login/signup/logout) are user actions and must not be
//   invalidated by background `checkAuth()` calls.
// - `checkAuth()` can run in parallel across route guards and hooks, but only
//   the latest `checkAuth()` result should apply, and it must never overwrite a
//   newer interactive operation.
let interactiveAuthSeq = 0;
let checkAuthSeq = 0;

interface AuthOrganization {
  id: string;
  name: string;
  role: string;
  status: string;
  region: string | null;
  created_at: string | null;
}

function fallbackOrganizations(user: User | null): {
  organizations: AuthOrganization[];
  activeOrgId: string | null;
} {
  if (!user) {
    return {
      organizations: [],
      activeOrgId: null,
    };
  }
  return {
    organizations: [
      {
        id: user.org_id,
        name: user.org_name,
        role: user.role,
        status: "active",
        region: null,
        created_at: null,
      },
    ],
    activeOrgId: user.org_id,
  };
}

async function fetchAuthOrganizations(user: User | null): Promise<{
  organizations: AuthOrganization[];
  activeOrgId: string | null;
}> {
  const fallback = fallbackOrganizations(user);
  if (!user) {
    return fallback;
  }
  try {
    const result = await authAPI.listOrganizations();
    if (!(result.organizations?.length > 0)) {
      return fallback;
    }
    return {
      organizations: result.organizations.map((org) => ({
        id: org.id,
        name: org.name,
        role: org.role,
        status: org.status,
        region: org.region ?? null,
        created_at: org.created_at ?? null,
      })),
      activeOrgId: result.active_org_id || result.organizations[0]?.id || user.org_id,
    };
  } catch {
    return fallback;
  }
}

// =============================================================================
// AUTH STORE
// =============================================================================

interface AuthState {
  user: User | null;
  organizations: AuthOrganization[];
  activeOrgId: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;

  // Actions
  checkAuth: () => Promise<void>;
  loginWithEmail: (
    email: string,
    password: string,
    options?: { persist?: boolean; inviteToken?: string }
  ) => Promise<void>;
  signupWithEmail: (params: {
    email: string;
    password: string;
    name?: string;
    organizationName?: string;
    inviteToken?: string;
    options?: { persist?: boolean };
  }) => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  organizations: [],
  activeOrgId: null,
  isLoading: true,
  isAuthenticated: false,
  error: null,

  checkAuth: async () => {
    const seq = ++checkAuthSeq;
    const interactiveSeqAtStart = interactiveAuthSeq;
    const previousUser = get().user;
    const previousOrganizations = get().organizations;
    const previousActiveOrgId = get().activeOrgId;
    const previousAuthenticated = get().isAuthenticated;
    set({ isLoading: true, error: null });
    try {
      const user = await authAPI.getMe();
      const orgState = await fetchAuthOrganizations(user);
      // Only the latest checkAuth applies.
      if (seq !== checkAuthSeq) {
        return;
      }
      // If an interactive auth op occurred while we were waiting, ignore this
      // result to avoid overwriting the newer state.
      if (interactiveSeqAtStart !== interactiveAuthSeq) {
        return;
      }
      set({
        user,
        organizations: orgState.organizations,
        activeOrgId: orgState.activeOrgId,
        isAuthenticated: !!user,
        isLoading: false,
      });
      if (!user) {
        clearSessionToken();
      }
    } catch (e) {
      if (seq !== checkAuthSeq) {
        return;
      }
      if (interactiveSeqAtStart !== interactiveAuthSeq) {
        return;
      }
      set({
        // Do not destroy auth state on transient errors (API unreachable, 5xx).
        // Only a confirmed 401 in `authAPI.getMe()` should clear tokens.
        user: previousUser,
        organizations: previousOrganizations,
        activeOrgId: previousActiveOrgId,
        isAuthenticated: previousAuthenticated,
        isLoading: false,
        error: e instanceof Error ? e.message : "Failed to check auth",
      });
    }
  },

  loginWithEmail: async (email: string, password: string, options) => {
    const opSeq = ++interactiveAuthSeq;
    set({ isLoading: true, error: null });
    try {
      const response = await authAPI.loginWithEmail({
        email,
        password,
        inviteToken: options?.inviteToken,
      });
      setSessionToken(response.session_token, {
        persist: options?.persist ?? true,
      });
      const user = await authAPI.getMe();
      if (!user) {
        throw new Error("Unable to verify session after login");
      }
      const orgState = await fetchAuthOrganizations(user);
      if (opSeq !== interactiveAuthSeq) {
        return;
      }
      set({
        user,
        organizations: orgState.organizations,
        activeOrgId: orgState.activeOrgId,
        isAuthenticated: !!user,
        isLoading: false,
      });
      return;
    } catch (e) {
      if (opSeq !== interactiveAuthSeq) {
        return;
      }
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : "Failed to sign in",
      });
      clearSessionToken();
      throw e instanceof Error ? e : new Error("Failed to sign in");
    }
  },

  signupWithEmail: async (params) => {
    const opSeq = ++interactiveAuthSeq;
    set({ isLoading: true, error: null });
    try {
      const { options, ...request } = params;
      const response = await authAPI.signupWithEmail(request);
      setSessionToken(response.session_token, {
        persist: options?.persist ?? true,
      });
      const user = await authAPI.getMe();
      if (!user) {
        throw new Error("Unable to verify session after signup");
      }
      const orgState = await fetchAuthOrganizations(user);
      if (opSeq !== interactiveAuthSeq) {
        return;
      }
      set({
        user,
        organizations: orgState.organizations,
        activeOrgId: orgState.activeOrgId,
        isAuthenticated: !!user,
        isLoading: false,
      });
      return;
    } catch (e) {
      if (opSeq !== interactiveAuthSeq) {
        return;
      }
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : "Failed to sign up",
      });
      clearSessionToken();
      throw e instanceof Error ? e : new Error("Failed to sign up");
    }
  },

  switchOrganization: async (organizationId: string) => {
    const current = get();
    if (current.user?.org_id === organizationId) {
      return;
    }

    const opSeq = ++interactiveAuthSeq;
    const previousUser = current.user;
    const previousOrganizations = current.organizations;
    const previousActiveOrgId = current.activeOrgId;
    const previousAuthenticated = current.isAuthenticated;
    set({ isLoading: true, error: null });

    try {
      const switchResult = await authAPI.switchOrganization(organizationId);
      setSessionToken(switchResult.session_token, { persist: true });

      const user = await authAPI.getMe();
      if (!user) {
        throw new Error("Unable to verify session after switching organization");
      }
      const orgState = await fetchAuthOrganizations(user);

      if (opSeq !== interactiveAuthSeq) {
        return;
      }

      set({
        user,
        organizations: orgState.organizations,
        activeOrgId: orgState.activeOrgId ?? switchResult.active_org_id,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (e) {
      if (opSeq !== interactiveAuthSeq) {
        return;
      }
      set({
        user: previousUser,
        organizations: previousOrganizations,
        activeOrgId: previousActiveOrgId,
        isAuthenticated: previousAuthenticated,
        isLoading: false,
        error: e instanceof Error ? e.message : "Failed to switch organization",
      });
      throw e instanceof Error
        ? e
        : new Error("Failed to switch organization");
    }
  },

  logout: async () => {
    const opSeq = ++interactiveAuthSeq;
    set({ isLoading: true, error: null });
    try {
      await authAPI.logout();
      clearSessionToken();
      if (opSeq !== interactiveAuthSeq) {
        return;
      }
      set({
        user: null,
        organizations: [],
        activeOrgId: null,
        isAuthenticated: false,
        isLoading: false,
      });
    } catch (e) {
      if (opSeq !== interactiveAuthSeq) {
        return;
      }
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : "Failed to logout",
      });
    }
  },

  clearError: () => set({ error: null }),
}));

// =============================================================================
// AUTH HOOKS
// =============================================================================

/**
 * Hook to get auth state and actions
 */
export function useAuth() {
  const store = useAuthStore();
  return {
    user: store.user,
    organizations: store.organizations,
    activeOrgId: store.activeOrgId,
    isLoading: store.isLoading,
    isAuthenticated: store.isAuthenticated,
    error: store.error,
    loginWithEmail: store.loginWithEmail,
    signupWithEmail: store.signupWithEmail,
    switchOrganization: store.switchOrganization,
    logout: store.logout,
    checkAuth: store.checkAuth,
    clearError: store.clearError,
  };
}

/**
 * Hook to require authentication
 * Returns user if authenticated, redirects to login if not
 */
export function useRequireAuth() {
  const { user, isLoading, isAuthenticated, checkAuth } = useAuth();

  // Check auth on mount if not already checked.
  // Avoid triggering async effects during render.
  useEffect(() => {
    if (!(isLoading || isAuthenticated) && user === null) {
      checkAuth().catch(() => undefined);
    }
  }, [checkAuth, isAuthenticated, isLoading, user]);

  return { user, isLoading };
}

// =============================================================================
// AUTH INITIALIZATION
// =============================================================================

/**
 * Initialize auth state from session cookie
 * Call this early in app initialization
 */
export async function initializeAuth(): Promise<User | null> {
  const store = useAuthStore.getState();
  await store.checkAuth();
  return store.user;
}

// =============================================================================
// AUTH GUARD COMPONENT HELPER
// =============================================================================

/**
 * Check if current user has required role
 */
export function hasRole(user: User | null, role: string): boolean {
  if (!user) return false;
  const normalized = user.role?.replace("pilot_", "") ?? user.role;
  return normalized === role || normalized === "owner";
}

/**
 * Check if user is owner of the organization
 */
export function isOwner(user: User | null): boolean {
  return hasRole(user, "owner");
}

/**
 * Check if user is admin or owner
 */
export function isAdmin(user: User | null): boolean {
  return hasRole(user, "admin") || hasRole(user, "owner");
}
