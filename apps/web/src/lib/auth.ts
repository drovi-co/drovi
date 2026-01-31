/**
 * Auth Utilities for Python Backend
 *
 * Handles authentication state and OAuth flows.
 * Uses cookie-based session auth (httpOnly cookies).
 */

import { create } from "zustand";
import { authAPI, type User } from "./api";

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
  login: (provider?: string) => Promise<void>;
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
    } catch (e) {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: e instanceof Error ? e.message : "Failed to check auth",
      });
    }
  },

  login: async (provider = "google") => {
    set({ isLoading: true, error: null });
    try {
      const { auth_url } = await authAPI.login(provider);
      // Redirect to OAuth provider
      window.location.href = auth_url;
    } catch (e) {
      set({
        isLoading: false,
        error: e instanceof Error ? e.message : "Failed to initiate login",
      });
    }
  },

  logout: async () => {
    set({ isLoading: true, error: null });
    try {
      await authAPI.logout();
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
      // Redirect to home
      window.location.href = "/";
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
    login: store.login,
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
  const { user, isLoading, isAuthenticated, checkAuth, login } = useAuth();

  // Check auth on mount if not already checked
  if (!isLoading && !isAuthenticated && user === null) {
    // Trigger login redirect
    login();
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
  return user.role === role || user.role === "owner";
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
