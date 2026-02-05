import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { authEndpoints } from "../api";
import type { User, Organization } from "../api/schemas";

interface AuthState {
  // State
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  organization: Organization | null;
  organizations: Organization[];
  sessionToken: string | null;
  error: string | null;

  // Actions
  setUser: (user: User | null) => void;
  setOrganization: (org: Organization | null) => void;
  setOrganizations: (orgs: Organization[]) => void;
  setSessionToken: (token: string | null) => void;
  setError: (error: string | null) => void;
  setLoading: (loading: boolean) => void;

  // Async actions
  login: (provider?: string) => Promise<{ authUrl: string; state: string }>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  signupWithEmail: (email: string, password: string, name?: string) => Promise<void>;
  handleCallback: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<boolean>;
  switchOrganization: (orgId: string) => void;
  reset: () => void;
}

const initialState = {
  isAuthenticated: false,
  isLoading: false,
  user: null,
  organization: null,
  organizations: [],
  sessionToken: null,
  error: null,
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setUser: (user) => set({ user, isAuthenticated: !!user }),
      setOrganization: (organization) => set({ organization }),
      setOrganizations: (organizations) => set({ organizations }),
      setSessionToken: (sessionToken) => {
        set({ sessionToken });
        if (sessionToken) {
          authEndpoints.setSession(sessionToken);
        } else {
          authEndpoints.clearSession();
        }
      },
      setError: (error) => set({ error }),
      setLoading: (isLoading) => set({ isLoading }),

      login: async (provider = "google") => {
        try {
          set({ isLoading: true, error: null });
          const response = await authEndpoints.initiateLogin(provider);
          return {
            authUrl: response.auth_url,
            state: response.state,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Login failed";
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      loginWithEmail: async (email, password) => {
        try {
          set({ isLoading: true, error: null });
          const response = await authEndpoints.loginWithEmail(email, password);
          get().setSessionToken(response.session_token);
          set({
            isAuthenticated: true,
            user: response.user,
            organization: response.organization ?? null,
            organizations: response.organizations ?? [],
            isLoading: false,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Login failed";
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      signupWithEmail: async (email, password, name) => {
        try {
          set({ isLoading: true, error: null });
          const response = await authEndpoints.signupWithEmail(email, password, name);
          get().setSessionToken(response.session_token);
          set({
            isAuthenticated: true,
            user: response.user,
            organization: response.organization ?? null,
            organizations: response.organizations ?? [],
            isLoading: false,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Signup failed";
          set({ error: message, isLoading: false });
          throw error;
        }
      },

      handleCallback: async (token) => {
        try {
          set({ isLoading: true, error: null });
          get().setSessionToken(token);

          const response = await authEndpoints.getMe();
          set({
            isAuthenticated: true,
            user: response.user,
            organization: response.organization ?? null,
            organizations: response.organizations ?? [],
            isLoading: false,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Authentication failed";
          set({ error: message, isLoading: false });
          get().setSessionToken(null);
          throw error;
        }
      },

      logout: async () => {
        try {
          await authEndpoints.logout();
        } finally {
          get().reset();
        }
      },

      checkSession: async () => {
        const { sessionToken } = get();
        if (!sessionToken) {
          return false;
        }

        try {
          set({ isLoading: true });
          authEndpoints.setSession(sessionToken);
          const response = await authEndpoints.getMe();
          set({
            isAuthenticated: true,
            user: response.user,
            organization: response.organization ?? null,
            organizations: response.organizations ?? [],
            isLoading: false,
          });
          return true;
        } catch {
          get().reset();
          return false;
        }
      },

      switchOrganization: (orgId) => {
        const { organizations } = get();
        const org = organizations.find((o) => o.id === orgId);
        if (org) {
          set({ organization: org });
        }
      },

      reset: () => {
        authEndpoints.clearSession();
        set(initialState);
      },
    }),
    {
      name: "drovi-auth",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessionToken: state.sessionToken,
        organization: state.organization,
      }),
    }
  )
);

// Selector hooks for common patterns
export const useIsAuthenticated = () => useAuthStore((s) => s.isAuthenticated);
export const useCurrentUser = () => useAuthStore((s) => s.user);
export const useCurrentOrg = () => useAuthStore((s) => s.organization);
export const useOrgId = () => useAuthStore((s) => s.organization?.id ?? null);
