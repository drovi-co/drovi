/**
 * Admin Auth Store
 *
 * - Email/password login via `/api/v1/admin/login`
 * - Stores admin JWT in sessionStorage + optional localStorage
 * - Uses Authorization header for all requests (cookie included as fallback)
 */

import { useEffect } from "react";
import { create } from "zustand";
import {
  clearAdminSessionToken,
  setAdminSessionToken,
} from "./admin-session-token";
import { type AdminMe, APIError, adminAuthAPI } from "./api";

let interactiveAuthSeq = 0;
let checkAuthSeq = 0;

interface AdminAuthState {
  me: AdminMe | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;

  checkAuth: () => Promise<void>;
  loginWithEmail: (
    email: string,
    password: string,
    options?: { persist?: boolean }
  ) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAdminAuthStore = create<AdminAuthState>((set, get) => ({
  me: null,
  isLoading: true,
  isAuthenticated: false,
  error: null,

  checkAuth: async () => {
    const seq = ++checkAuthSeq;
    const interactiveSeqAtStart = interactiveAuthSeq;
    const previousMe = get().me;
    const previousAuthenticated = get().isAuthenticated;
    set({ isLoading: true, error: null });
    try {
      const me = await adminAuthAPI.me();
      if (seq !== checkAuthSeq) return;
      if (interactiveSeqAtStart !== interactiveAuthSeq) return;
      set({ me, isAuthenticated: true, isLoading: false });
    } catch (e) {
      if (seq !== checkAuthSeq) return;
      if (interactiveSeqAtStart !== interactiveAuthSeq) return;

      // Clear tokens on confirmed auth failure (401 or 403).
      // A 403 on /admin/me means the caller has no ADMIN scope, which
      // happens when the web app's session cookie is picked up instead
      // of the admin Bearer token.
      const message = e instanceof Error ? e.message : "Failed to check auth";
      const isAuthFailure =
        e instanceof APIError
          ? e.status === 401 || e.status === 403
          : message.toLowerCase().includes("not authenticated");
      if (isAuthFailure) {
        clearAdminSessionToken();
        set({
          me: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });
        return;
      }

      set({
        me: previousMe,
        isAuthenticated: previousAuthenticated,
        isLoading: false,
        error: message,
      });
    }
  },

  loginWithEmail: async (email: string, password: string, options) => {
    const opSeq = ++interactiveAuthSeq;
    set({ isLoading: true, error: null });
    try {
      const response = await adminAuthAPI.loginWithEmail({
        email: email.trim().toLowerCase(),
        password,
      });
      setAdminSessionToken(response.session_token, {
        persist: options?.persist ?? true,
      });
      const me = await adminAuthAPI.me();
      if (opSeq !== interactiveAuthSeq) return;
      set({ me, isAuthenticated: true, isLoading: false });
    } catch (e) {
      if (opSeq !== interactiveAuthSeq) return;
      clearAdminSessionToken();
      set({
        me: null,
        isAuthenticated: false,
        isLoading: false,
        error: e instanceof Error ? e.message : "Login failed",
      });
      throw e instanceof Error ? e : new Error("Login failed");
    }
  },

  logout: async () => {
    const opSeq = ++interactiveAuthSeq;
    set({ isLoading: true, error: null });
    try {
      await adminAuthAPI.logout();
    } catch {
      // Best-effort; continue to clear local state.
    } finally {
      clearAdminSessionToken();
      if (opSeq === interactiveAuthSeq) {
        set({ me: null, isAuthenticated: false, isLoading: false });
      }
    }
  },

  clearError: () => set({ error: null }),
}));

export function useAdminAuth() {
  const store = useAdminAuthStore();
  return {
    me: store.me,
    isLoading: store.isLoading,
    isAuthenticated: store.isAuthenticated,
    error: store.error,
    loginWithEmail: store.loginWithEmail,
    logout: store.logout,
    checkAuth: store.checkAuth,
    clearError: store.clearError,
  };
}

export async function initializeAdminAuth() {
  await useAdminAuthStore.getState().checkAuth();
}

export function useRequireAdminAuth() {
  const { me, isLoading, isAuthenticated, checkAuth } = useAdminAuth();
  useEffect(() => {
    if (!(isLoading || isAuthenticated) && me === null) {
      checkAuth().catch(() => {
        // Best-effort. The auth store tracks errors for display.
      });
    }
  }, [checkAuth, isAuthenticated, isLoading, me]);
  return { me, isLoading, isAuthenticated };
}
