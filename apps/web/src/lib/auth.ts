/**
 * Auth Utilities for Python Backend
 *
 * Handles authentication state and OAuth flows.
 * Uses cookie-based session auth (httpOnly cookies).
 */

import { create } from "zustand";
import { authAPI, type User } from "./api";
import { clearSessionToken, setSessionToken } from "./session-token";

// =============================================================================
// AUTH STORE
// =============================================================================

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;

  // Actions
  checkAuth: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  signupWithEmail: (params: {
    email: string;
    password: string;
    name?: string;
    organizationName?: string;
    inviteToken?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  error: null,

  checkAuth: async () => {
    set({ isLoading: true, error: null });
    try {
      const user = await authAPI.getMe();
      set({
        user,
        isAuthenticated: !!user,
        isLoading: false,
      });
      if (!user) {
        clearSessionToken();
      }
    } catch (e) {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: e instanceof Error ? e.message : "Failed to check auth",
      });
      clearSessionToken();
    }
  },

  loginWithEmail: async (email: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authAPI.loginWithEmail({ email, password });
      setSessionToken(response.session_token);
      const user = await authAPI.getMe();
      if (!user) {
        throw new Error("Unable to verify session after login");
      }
      set({
        user,
        isAuthenticated: !!user,
        isLoading: false,
      });
      return;
    } catch (e) {
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : "Failed to sign in",
      });
      clearSessionToken();
      throw e instanceof Error ? e : new Error("Failed to sign in");
    }
  },

  signupWithEmail: async (params) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authAPI.signupWithEmail(params);
      setSessionToken(response.session_token);
      const user = await authAPI.getMe();
      if (!user) {
        throw new Error("Unable to verify session after signup");
      }
      set({
        user,
        isAuthenticated: !!user,
        isLoading: false,
      });
      return;
    } catch (e) {
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : "Failed to sign up",
      });
      clearSessionToken();
      throw e instanceof Error ? e : new Error("Failed to sign up");
    }
  },

  logout: async () => {
    set({ isLoading: true, error: null });
    try {
      await authAPI.logout();
      clearSessionToken();
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    } catch (e) {
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
    isLoading: store.isLoading,
    isAuthenticated: store.isAuthenticated,
    error: store.error,
    loginWithEmail: store.loginWithEmail,
    signupWithEmail: store.signupWithEmail,
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

  // Check auth on mount if not already checked
  if (!isLoading && !isAuthenticated && user === null) {
    // Trigger auth check for email login flow
    checkAuth();
  }

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
